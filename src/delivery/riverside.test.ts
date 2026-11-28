import { describe, expect, it } from 'vitest';
import { DeliveryManager } from './DeliveryManager';
import { RIVERSIDE_WALK_BONUS } from './apartmentRules';
import { finishBenchHandoff, startBenchHandoff } from './riversideHandoff';
import { createCustomerChatEvent } from './cargoCare';
import { settlementLines } from '../ui/receiptLines';
import { DeliveryLocation } from '../types';

const shop = (id: string, x: number): DeliveryLocation => ({ id, name: id, x, z: 0, type: 'shop', emoji: '', menus: ['제육볶음 정식'] });
const bench: DeliveryLocation = {
  id: 'gen-riv-1',
  name: '수원천 산책로 쉼터 1',
  x: 300,
  z: 0,
  type: 'residential',
  residenceKind: 'riverside',
  emoji: '🌿',
};

describe('riverside customers (산책로 쉼터)', () => {
  it('are handed the food in person on the bench, with the walkway allowance', () => {
    const dm = new DeliveryManager([shop('s1', 0), shop('s2', 40), bench]);
    const o = dm.availableOrders.find((x) => x.customer.id === bench.id)!;
    expect(o).toBeDefined();
    expect(o.deliveryInstruction).toBe('MEET_FACE');
    expect(o.unitNumber).toBe('벤치');
    dm.acceptOrder(o.id);
    dm.completePosPickup(o.id, false);
    dm.loadFoodIntoCargoSlot(0);
    dm.unloadFoodFromCargoSlot(0);
    const m = dm.getMissionById(o.id)!;
    expect(m.phase).toBe('carrying_to_lobby');
    expect(dm.getMissionNearCustomerLobby(bench.x, bench.z)?.order.id).toBe(o.id);
    // the game's hand-over: settle right on the walkway
    expect(startBenchHandoff(dm, o.id)).toBe(true);
    const r = dm.completePhotoSettlement()!;
    expect(r.walkInBonus).toBe(RIVERSIDE_WALK_BONUS);
    expect(settlementLines(r).find((l) => l.key === 'walkIn')?.label).toContain('하천 산책로');
    finishBenchHandoff(dm);
    expect(dm.activeMissions).toHaveLength(0);
  });

  it('their mid-ride messages never ask for a door photo or a unit fix', () => {
    const dm = new DeliveryManager([shop('s1', 0), shop('s2', 40), bench]);
    const o = dm.availableOrders.find((x) => x.customer.id === bench.id)!;
    dm.acceptOrder(o.id);
    const m = dm.getMissionById(o.id)!;
    for (let i = 0; i < 20; i++) {
      const ev = createCustomerChatEvent(m, false, () => i / 20);
      expect(ev.kind).toBe('extra_tip_careful');
      expect(m.order.deliveryInstruction).toBe('MEET_FACE');
    }
  });
});
