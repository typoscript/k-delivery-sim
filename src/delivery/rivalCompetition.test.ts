import { describe, expect, it } from 'vitest';
import { DeliveryManager } from './DeliveryManager';
import { DispatchOffer, OFFER_DURATION_SEC, OrderDispatchManager } from './OrderDispatchManager';
import {
  BOARD_CHECK_SEC,
  RIVAL_CONTEST_RADIUS_M,
  RIVAL_SNATCH_MAX_SEC,
  RIVAL_SNATCH_MIN_SEC,
  contestingRival,
  pickBoardCallTaken,
  snatchDelaySec,
} from './rivalCompetition';
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
// One shop, so every call starts at (0, 0)
const locations = [loc('s1', 0, 0, 'shop'), loc('r1', 300, 0, 'residential'), loc('r2', 0, 400, 'residential'), loc('r3', -350, 0, 'residential')];

const DT = 0.05;
function runUntilOffer(dispatch: OrderDispatchManager, delivery: DeliveryManager, rivals: { id: string; x: number; z: number }[]): void {
  for (let t = 0; t < 30 && !dispatch.activeOffer; t += DT) dispatch.step(DT, delivery, false, false, rivals);
}

describe('rival competition', () => {
  it('only rivals near the shop compete, the closest one first', () => {
    expect(contestingRival([], 0, 0)).toBeNull();
    expect(contestingRival([{ id: 'far', x: RIVAL_CONTEST_RADIUS_M + 1, z: 0 }], 0, 0)).toBeNull();
    expect(contestingRival([{ id: 'a', x: 200, z: 0 }, { id: 'b', x: 0, z: 50 }], 0, 0)).toEqual({ rivalId: 'b', distM: 50 });
    // a rival further from the shop than the player cannot get there first
    expect(contestingRival([{ id: 'a', x: 200, z: 0 }], 0, 0, { x: 100, z: 0 })).toBeNull();
    expect(contestingRival([{ id: 'a', x: 50, z: 0 }], 0, 0, { x: 100, z: 0 })?.rivalId).toBe('a');
    expect(snatchDelaySec(0)).toBe(RIVAL_SNATCH_MIN_SEC);
    expect(snatchDelaySec(RIVAL_CONTEST_RADIUS_M * 2)).toBe(RIVAL_SNATCH_MAX_SEC);
    expect(snatchDelaySec(100)).toBeLessThan(snatchDelaySec(200));
  });

  it('a nearby rival takes an unanswered offer early; without one it runs the full 20s', () => {
    for (const [rivals, expectTaken] of [
      [[{ id: 'r', x: 30, z: 0 }], true],
      [[{ id: 'r', x: 2000, z: 0 }], false],
    ] as const) {
      const delivery = new DeliveryManager(locations);
      let taken: DispatchOffer | null = null;
      let expired: DispatchOffer | null = null;
      const dispatch = new OrderDispatchManager(locations, {
        onOfferArrived: () => {},
        onOfferExpired: (o) => (expired = o),
        onOfferTakenByRival: (o) => (taken = o),
      });
      runUntilOffer(dispatch, delivery, [...rivals]);
      const offer = dispatch.activeOffer!;
      expect(offer.rival !== null).toBe(expectTaken);
      let open = 0;
      while (dispatch.activeOffer === offer && open < OFFER_DURATION_SEC + 1) {
        dispatch.step(DT, delivery, false, false, [...rivals]);
        open += DT;
      }
      if (expectTaken) {
        expect(taken).toBe(offer);
        expect(expired).toBeNull();
        expect(open).toBeCloseTo(snatchDelaySec(30), 0);
      } else {
        expect(taken).toBeNull();
        expect(expired).toBe(offer);
        expect(open).toBeCloseTo(OFFER_DURATION_SEC, 0);
      }
    }
  });

  it('accepting in time beats the rival', () => {
    const delivery = new DeliveryManager(locations);
    const dispatch = new OrderDispatchManager(locations, { onOfferArrived: () => {}, onOfferExpired: () => {} });
    const rivals = [{ id: 'r', x: 10, z: 0 }];
    runUntilOffer(dispatch, delivery, rivals);
    for (let t = 0; t < RIVAL_SNATCH_MIN_SEC - 1; t += DT) dispatch.step(DT, delivery, false, false, rivals);
    expect(dispatch.acceptCurrentOffer(delivery)).not.toBeNull();
    expect(delivery.activeMissions.length).toBeGreaterThan(0);
  });

  it('rivals near a board call take it now and then, and the board refills', () => {
    const orders = [
      { id: 'near', shop: { x: 0, z: 0 } },
      { id: 'far', shop: { x: 5000, z: 0 } },
    ];
    const rivals = [{ id: 'r', x: 20, z: 0 }];
    expect(pickBoardCallTaken(orders, rivals, () => 0)).toBe('near');
    expect(pickBoardCallTaken(orders, rivals, () => 0.99)).toBeNull();
    expect(pickBoardCallTaken(orders, [], () => 0)).toBeNull();

    const delivery = new DeliveryManager(locations);
    const before = delivery.availableOrders.map((o) => o.id);
    const takenIds: string[] = [];
    const dispatch = new OrderDispatchManager(locations, {
      onOfferArrived: () => {},
      onOfferExpired: () => {},
      onBoardCallTaken: (o) => takenIds.push(o.id),
    });
    const origRandom = Math.random;
    let calls = 0;
    // The first random draw is the board check's "take" roll: force it; the board refill stays random
    Math.random = () => (calls++ === 0 ? 0 : origRandom());
    try {
      for (let t = 0; t < BOARD_CHECK_SEC + 0.2; t += DT) dispatch.step(DT, delivery, true, false, rivals); // indoors: paused
      expect(takenIds).toEqual([]);
      for (let t = 0; t < BOARD_CHECK_SEC + 0.2; t += DT) dispatch.step(DT, delivery, false, true, rivals);
    } finally {
      Math.random = origRandom;
    }
    expect(takenIds).toHaveLength(1);
    expect(before).toContain(takenIds[0]);
    expect(delivery.availableOrders.map((o) => o.id)).not.toContain(takenIds[0]);
    expect(delivery.availableOrders.length).toBe(before.length);
  });
});
