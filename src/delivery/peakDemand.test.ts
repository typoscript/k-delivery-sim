import { describe, expect, it } from 'vitest';
import { DeliveryManager } from './DeliveryManager';
import { OrderDispatchManager, REJECT_COOLDOWN_SEC } from './OrderDispatchManager';
import { PEAK_SURCHARGE_BONUS, demandPhaseAt } from '../game/GameClock';
import { DeliveryLocation } from '../types';

const loc = (id: string, x: number, z: number, type: 'shop' | 'residential'): DeliveryLocation => ({
  id,
  name: id,
  x,
  z,
  type,
  emoji: '',
  menus: type === 'shop' ? ['제육볶음 정식'] : undefined,
});
const locations = [
  loc('s1', 0, 0, 'shop'),
  loc('s2', 50, 0, 'shop'),
  loc('s3', 0, 60, 'shop'),
  loc('r1', 300, 0, 'residential'),
  loc('r2', 0, 400, 'residential'),
  loc('r3', -350, 0, 'residential'),
  loc('r4', 0, -320, 'residential'),
];

describe('rush-hour demand (game clock)', () => {
  it('peak calls carry the peak surcharge and come faster; off-peak calls do not', () => {
    const delivery = new DeliveryManager(locations);
    const offers: number[] = [];
    const dispatch = new OrderDispatchManager(locations, { onOfferArrived: (o) => offers.push(o.totalPeakBonus), onOfferExpired: () => {} });

    delivery.setDemandPhase(demandPhaseAt(15 * 60));
    dispatch.step(0.05, delivery, false, false);
    expect(dispatch.nextOfferDelaySec()).toBeCloseTo(REJECT_COOLDOWN_SEC * 1.2);
    expect(delivery.availableOrders.every((o) => (o.peakBonus ?? 0) === 0)).toBe(true);

    delivery.setDemandPhase(demandPhaseAt(12 * 60));
    // refreshed board shows the surcharge at once
    expect(delivery.availableOrders.length).toBeGreaterThan(0);
    expect(delivery.availableOrders.every((o) => o.peakBonus === PEAK_SURCHARGE_BONUS)).toBe(true);
    for (let t = 0; t < 5; t += 0.05) dispatch.step(0.05, delivery, false, false);
    expect(dispatch.nextOfferDelaySec()).toBeLessThan(REJECT_COOLDOWN_SEC * 0.5);
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.at(-1)).toBeGreaterThanOrEqual(PEAK_SURCHARGE_BONUS);
  });
});

describe('rider reputation and calls', () => {
  it('a top reputation brings calls faster, a low one slower', () => {
    const delivery = new DeliveryManager(locations);
    const dispatch = new OrderDispatchManager(locations, { onOfferArrived: () => {}, onOfferExpired: () => {} });
    delivery.setDemandPhase(demandPhaseAt(15 * 60));
    dispatch.step(0.05, delivery, false, false);
    const normal = dispatch.nextOfferDelaySec();
    const review = (stars: number) => ({ stars }) as (typeof delivery.career.reviews)[number];
    delivery.career.reviews = [5, 5, 5, 5, 5].map(review);
    dispatch.step(0.05, delivery, false, false);
    expect(delivery.getReputation().tier).toBe('top');
    expect(dispatch.nextOfferDelaySec()).toBeLessThan(normal);
    delivery.career.reviews = [2, 2, 3, 2].map(review);
    dispatch.step(0.05, delivery, false, false);
    expect(delivery.getReputation().tier).toBe('low');
    expect(dispatch.nextOfferDelaySec()).toBeGreaterThan(normal);
  });
});

