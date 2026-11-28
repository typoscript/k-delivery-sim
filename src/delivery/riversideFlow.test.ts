/**
 * A riverside (산책로 쉼터) delivery from the call to the customer leaving, on the real map: accept, pick up at the
 * shop, load the cargo box, ride (timers, chat events), park and unload on the road, walk to the bench, hand over,
 * settle, and the bench customer waves and leaves. Scene-free: the systems the game wires together each frame, in
 * the same order the hand-over takes (deliveryFlow.handleRiversideHandoff). Refactors of any of them must keep this.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DeliveryManager } from './DeliveryManager';
import { RIVERSIDE_WALK_BONUS } from './apartmentRules';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import { RoadNavigator } from '../world/RoadNavigator';
import { BENCH_GOODBYE_SEC, BenchCustomers, benchSeat } from '../world/benchCustomers';
import { settlementLines } from '../ui/receiptLines';
import { getPhaseShortLabel } from '../ui/phone/phoneFormat';
import type { DeliveryLocation } from '../types';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  };
});

describe('riverside delivery, end to end (real map)', () => {
  it('call -> pickup -> ride -> walk the walkway -> hand over on the bench -> customer leaves', () => {
    const locations = [...ACTIVE_MAP_DATA.shops, ...ACTIVE_MAP_DATA.residences] as DeliveryLocation[];
    const bench = locations.find((l) => l.residenceKind === 'riverside')!;
    expect(bench).toBeDefined();
    // the nearest shop to the bench takes the order
    const shop = locations
      .filter((l) => l.type === 'shop')
      .sort((a, b) => Math.hypot(a.x - bench.x, a.z - bench.z) - Math.hypot(b.x - bench.x, b.z - bench.z))[0];
    const dm = new DeliveryManager([shop, bench]);
    const order = dm.availableOrders.find((o) => o.customer.id === bench.id)!;
    expect(order.deliveryInstruction).toBe('MEET_FACE');

    // 1. accept, POS pickup (a ready kitchen), load the cargo box
    expect(dm.acceptOrder(order.id)).toBeTruthy();
    const m = dm.getMissionById(order.id)!;
    dm.completePosPickup(order.id, false);
    while (m.phase === 'cooking_wait') dm.stepTimers(0.5);
    if (m.phase === 'pickup_ready') dm.collectReadyPickup(order.id);
    dm.loadFoodIntoCargoSlot(0);
    expect(m.phase).toBe('cargo_loaded');

    // 2. the route goes to the bench; riding there, the customer may message (never a door photo / unit fix)
    const nav = new RoadNavigator();
    const plan = dm.getNavigationPlan(shop.x, shop.z, 0, shop.x, shop.z, false, 0, nav);
    expect(plan.target?.id).toBe(bench.id);
    const riding = { x: shop.x, z: shop.z, speed: 8, heading: 0, leanAngle: 0, crashed: false } as never;
    for (let t = 0; t < 120; t += 0.5) {
      dm.stepTimers(0.5);
      dm.stepCustomerChatEvents(0.5, false, true, (ev) => expect(ev.kind).toBe('extra_tip_careful'));
      dm.stepCargoPhysics(0.5, riding, true, () => {});
    }
    expect(m.remainingTimeSec).toBeGreaterThan(0);

    // 3. park on the road, take the food out and walk along the walkway to the bench
    dm.unloadFoodFromCargoSlot(m.cargoSlot!);
    expect(m.phase).toBe('carrying_to_lobby');
    expect(getPhaseShortLabel(m.phase, null, 0, true)).toContain('산책로 벤치');
    const seat = benchSeat(bench);
    const customers = new BenchCustomers(new THREE.Group());
    customers.update(0.1, bench.x + 60, bench.z, [bench], null);
    expect(customers.poses()).toEqual([{ id: bench.id, pose: 'sitting' }]);
    expect(dm.getMissionNearCustomerLobby(bench.x + 60, bench.z)).toBeNull(); // not there yet
    customers.update(0.1, seat.x + 1, seat.z, [bench], bench.id);
    expect(customers.root.children[0].position.y).toBe(0); // stood up for the food
    expect(dm.getMissionNearCustomerLobby(bench.x, bench.z)?.order.id).toBe(order.id);

    // 4. the hand-over (as deliveryFlow.handleRiversideHandoff): settle right on the walkway
    const walletBefore = dm.totalEarnings;
    m.phase = 'meet_waiting';
    const r = dm.completePhotoSettlement()!;
    expect(r).not.toBeNull();
    expect(r.walkInBonus).toBe(RIVERSIDE_WALK_BONUS);
    expect(settlementLines(r).some((l) => l.key === 'walkIn' && l.label.includes('하천 산책로'))).toBe(true);
    expect(dm.totalEarnings).toBe(walletBefore + r.earned);
    expect(dm.messenger.get(`c:${order.id}`)!.messages.at(-1)!.text).toContain(r.review.comment);
    dm.finishAfterCorridorExit();
    expect(dm.activeMissions).toHaveLength(0);
    expect(dm.getDailyLedger().completedCount).toBe(1);

    // 5. the customer waves, then leaves the bench
    customers.update(0.1, seat.x + 1, seat.z, [], null);
    expect(customers.poses()[0].pose).toBe('waving');
    for (let t = 0; t <= BENCH_GOODBYE_SEC + 1; t += 0.5) customers.update(0.5, seat.x + 1, seat.z, [], null);
    expect(customers.poses()).toEqual([]);
  });
});
