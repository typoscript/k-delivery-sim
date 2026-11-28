import { describe, expect, it } from 'vitest';
import {
  DeliveryManager,
  MAX_CONCURRENT_ORDERS,
  VILLA_STAIR_BONUS,
} from './DeliveryManager';
import { DeliveryLocation } from '../types';
import { CLEAN_GOAL, DELIVERIES_GOAL, SAFE_GOAL, goalsForDay } from './ShiftDay';
import { SHIFT_START_MINUTE, demandPhaseAt } from '../game/GameClock';

const DAILY_MISSION_TARGET = DELIVERIES_GOAL.target;

const loc = (id: string, x: number, z: number, type: 'shop' | 'residential', extra: Partial<DeliveryLocation> = {}): DeliveryLocation => ({
  id,
  name: id,
  x,
  z,
  type,
  emoji: '',
  menus: type === 'shop' ? ['제육볶음 정식'] : undefined,
  ...extra,
});

const LOCATIONS = [
  loc('s1', 0, 0, 'shop'),
  loc('s2', 40, 0, 'shop'),
  loc('s3', 0, 50, 'shop'),
  loc('r1', 300, 0, 'residential', { residenceKind: 'apartment' }),
  loc('r2', 0, 400, 'residential', { residenceKind: 'apartment' }),
  loc('r3', -350, 0, 'residential', { residenceKind: 'apartment' }),
  loc('r4', 0, -320, 'residential', { residenceKind: 'apartment' }),
];

function accept(dm: DeliveryManager) {
  const order = dm.availableOrders[0];
  expect(dm.acceptOrder(order.id)).not.toBeNull();
  return dm.getMissionById(order.id)!;
}

/** Drives one accepted mission from the pickup counter to the photo at the door */
function deliver(dm: DeliveryManager, id: string) {
  const pos = dm.completePosPickup(id, false)!;
  expect(pos.status).toBe('picked_up');
  expect(dm.getMissionById(id)!.phase).toBe('carrying_to_box');
  expect(dm.loadFoodIntoCargoSlot(dm.getFirstEmptyCargoSlot())!.phase).toBe('cargo_loaded');
  const slot = dm.getMissionById(id)!.cargoSlot!;
  expect(dm.unloadFoodFromCargoSlot(slot)!.phase).toBe('carrying_to_lobby');
  expect(dm.unlockLobbyDoor(id)!.phase).toBe('lobby_unlocked');
  expect(dm.enterCorridor(id)!.phase).toBe('in_corridor');
  expect(dm.placeFoodAtDoor()!.phase).toBe('photo_mode');
  const result = dm.completePhotoSettlement()!;
  expect(result).not.toBeNull();
  expect(dm.getMissionById(id)!.phase).toBe('corridor_exit');
  dm.finishAfterCorridorExit();
  expect(dm.getMissionById(id)).toBeNull();
  return result;
}

describe('DeliveryManager mission flow', () => {
  it('runs a full delivery: counter -> top box -> lobby -> corridor -> photo -> settlement', () => {
    const dm = new DeliveryManager(LOCATIONS);
    const before = dm.totalEarnings;
    const m = accept(dm);
    expect(m.phase).toBe('to_pickup');
    const r = deliver(dm, m.order.id);
    expect(r.earned).toBeGreaterThan(0);
    expect(dm.totalEarnings - before).toBe(r.earned);
    expect(dm.completedCount).toBe(1);
    expect(dm.getCargoSlotOccupiedFlags()).toEqual([false, false, false]);
  });

  it('kitchen wait: cooking_wait -> pickup_ready after the countdown, then the bag can be collected', () => {
    const dm = new DeliveryManager(LOCATIONS);
    const m = accept(dm);
    const pos = dm.completePosPickup(m.order.id, true)!;
    if (pos.status !== 'cooking') return; // regular-shop perk may hand it over at once
    expect(m.phase).toBe('cooking_wait');
    expect(dm.collectReadyPickup(m.order.id)).toBeNull(); // not ready yet
    let ready = 0;
    for (let t = 0; t < pos.waitSec + 1; t += 0.1) dm.stepTimers(0.1, () => ready++);
    expect(ready).toBe(1);
    expect(m.phase).toBe('pickup_ready');
    expect(dm.collectReadyPickup(m.order.id)!.phase).toBe('carrying_to_box');
  });

  it('guards: one bag in hand, no double-loading a slot, no more than 3 orders', () => {
    const dm = new DeliveryManager(LOCATIONS);
    const a = accept(dm);
    const b = accept(dm);
    dm.completePosPickup(a.order.id, false);
    // holding a's bag: can't take b's bag too
    expect(dm.completePosPickup(b.order.id, false)).toBeNull();
    dm.loadFoodIntoCargoSlot(0);
    dm.completePosPickup(b.order.id, false);
    expect(dm.loadFoodIntoCargoSlot(0)).toBeNull(); // slot 0 taken
    expect(dm.loadFoodIntoCargoSlot(1)).not.toBeNull();
    while (dm.activeMissions.length < MAX_CONCURRENT_ORDERS) accept(dm);
    expect(dm.canAcceptMoreOrders()).toBe(false);
    expect(dm.acceptOrder(dm.availableOrders[0].id)).toBeNull();
  });

  it('cancelling frees the cargo slot, but a delivery inside the building cannot be cancelled', () => {
    const dm = new DeliveryManager(LOCATIONS);
    const a = accept(dm);
    dm.completePosPickup(a.order.id, false);
    dm.loadFoodIntoCargoSlot(2);
    expect(dm.cancelMission(a.order.id)).not.toBeNull();
    expect(dm.getCargoSlotOccupiedFlags()[2]).toBe(false);

    const b = accept(dm);
    dm.completePosPickup(b.order.id, false);
    dm.loadFoodIntoCargoSlot(0);
    dm.unloadFoodFromCargoSlot(0);
    dm.unlockLobbyDoor(b.order.id);
    dm.enterCorridor(b.order.id);
    expect(dm.cancelMission(b.order.id)).toBeNull();
  });

  it('crashes only damage food loaded in the top box, and damage cuts the payout', () => {
    const dm = new DeliveryManager(LOCATIONS);
    const a = accept(dm);
    const b = accept(dm);
    dm.completePosPickup(a.order.id, false);
    dm.loadFoodIntoCargoSlot(0);
    expect(dm.applyCrashDamage(true)).toEqual({ damagedCount: 1, loss: 32 });
    expect(a.foodIntegrity).toBe(68);
    expect(b.foodIntegrity).toBe(100); // still at the shop
    dm.unloadFoodFromCargoSlot(0);
    dm.unlockLobbyDoor(a.order.id);
    dm.enterCorridor(a.order.id);
    dm.placeFoodAtDoor();
    const r = dm.completePhotoSettlement()!;
    expect(r.tip).toBe(0); // < 70% integrity
    expect(r.earned).toBeLessThan(
      a.order.baseFee + r.tierBonus + r.rainBonus + r.nightBonus + r.peakBonus + r.specialBonus + r.regularCustomerTip + 500
    );
  });

  it('walk-up villas pay the stair bonus', () => {
    const villa = [...LOCATIONS.filter((l) => l.type === 'shop'), loc('v1', 300, 0, 'residential', { residenceKind: 'walkup_villa' }), loc('v2', 0, 300, 'residential', { residenceKind: 'walkup_villa' }), loc('v3', -300, 0, 'residential', { residenceKind: 'walkup_villa' })];
    const dm = new DeliveryManager(villa);
    const m = accept(dm);
    expect(deliver(dm, m.order.id).villaStairBonus).toBe(VILLA_STAIR_BONUS);
  });

  it('the daily ledger always matches the wallet (income, mission bonus, fines and expenses)', () => {
    const dm = new DeliveryManager(LOCATIONS);
    const start = dm.totalEarnings;
    const startLedger = dm.getDailyLedger().netProfit;
    let missionBonus = 0;
    for (let i = 0; i < DAILY_MISSION_TARGET; i++) {
      const r = deliver(dm, accept(dm).order.id);
      missionBonus += r.missionBonusAwarded;
    }
    dm.applyFine(1000);
    dm.recordFuelExpense(1234);
    dm.recordConvenienceExpense(1500);
    const l = dm.getDailyLedger();
    expect(l.netProfit - startLedger).toBe(dm.totalEarnings - start);
    expect(l.completedCount).toBe(DAILY_MISSION_TARGET);
    expect(missionBonus).toBeGreaterThanOrEqual(DELIVERIES_GOAL.bonus);
  });

  it('daily goals pay once each: 3 deliveries, and a rotating goal when its counter is reached', () => {
    const dm = new DeliveryManager(LOCATIONS);
    // pick a day whose rotating goals include the rush-hour goal
    const districts = [{ id: 'ingye', label: '인계동' }];
    let day = 1;
    while (!goalsForDay(day, districts).some((g) => g.id === 'peak')) day++;
    dm.shiftDay = day;
    const ids = dm.todaysGoals().map((g) => g.id);
    expect(ids[0]).toBe('deliveries');
    expect(ids.slice(-2)).toEqual(['safe', 'clean']);
    expect(ids).toContain('peak');
    const paid: string[] = [];
    for (let i = 0; i < 3; i++) paid.push(...deliver(dm, accept(dm).order.id).goalsCompleted.map((g) => g.id));
    expect(paid).toContain('deliveries');
    expect(paid).not.toContain('peak');
    dm.setDemandPhase(demandPhaseAt(12 * 60)); // lunch rush: new calls carry the peak surcharge
    for (let i = 0; i < 2; i++) paid.push(...deliver(dm, accept(dm).order.id).goalsCompleted.map((g) => g.id));
    expect(paid).toContain('peak');
    expect(new Set(paid).size).toBe(paid.length); // each goal paid once
    expect(dm.getShiftGoals().find((g) => g.id === 'peak')!.claimed).toBe(true);
  });

  it('clock-out pays the accident-free bonus, closes the day and starts the next one fresh', () => {
    const dm = new DeliveryManager(LOCATIONS);
    for (let i = 0; i < 3; i++) deliver(dm, accept(dm).order.id);
    const wallet = dm.totalEarnings;
    const res = dm.clockOut()!;
    expect(res.day).toBe(1);
    expect(res.nextDay).toBe(2);
    expect(res.awardedAtClockOut.map((g) => g.id)).toEqual(['safe', 'clean']);
    expect(dm.totalEarnings).toBe(wallet + SAFE_GOAL.bonus + CLEAN_GOAL.bonus);
    expect(res.ledger.completedCount).toBe(3);
    // every claimed goal's bonus (deliveries, maybe a rotating one, and the clock-out goal) is in the ledger
    expect(res.ledger.missionBonusTotal).toBe(res.goals.filter((g) => g.claimed).reduce((a, g) => a + g.bonus, 0));
    expect(res.goals.find((g) => g.id === 'safe')!.claimed).toBe(true);
    // day 2: empty ledger, fresh goals, shift start time
    expect(dm.shiftDay).toBe(2);
    expect(dm.getDailyLedger().completedCount).toBe(0);
    expect(dm.getDailyLedger().netProfit).toBe(0);
    expect(dm.getShiftGoals().every((g) => !g.claimed)).toBe(true);
    expect(dm.shiftClockMinute).toBe(SHIFT_START_MINUTE);
  });

  it('clock-out records the day in the career history and unlocks achievements once', () => {
    const dm = new DeliveryManager(LOCATIONS);
    for (let i = 0; i < 3; i++) deliver(dm, accept(dm).order.id);
    expect(dm.collectNewAchievements().map((a) => a.id)).toContain('first');
    expect(dm.collectNewAchievements()).toEqual([]);
    const res = dm.clockOut()!;
    const [rec] = dm.getDayHistory();
    expect(dm.getDayHistory()).toHaveLength(1);
    expect(rec).toMatchObject({ day: 1, deliveries: 3, net: res.ledger.netProfit, accidents: 0, goalsTotal: res.goals.length });
    expect(rec.avgStars).not.toBeNull();
    expect(dm.getAchievements().find((a) => a.id === 'first')).toMatchObject({ unlocked: true, unlockedDay: 1 });
    // Day 1 recap: no previous day, 1-day accident-free streak, today's achievements include the first delivery
    expect(res.recap.previous).toBeNull();
    expect(res.recap.safeStreak).toBe(1);
    expect(res.recap.achievementsToday.map((a) => a.id)).toContain('first');
    expect(res.recap.next).not.toBeNull();

    // Day 2 compares against day 1
    for (let i = 0; i < 3; i++) deliver(dm, accept(dm).order.id);
    const res2 = dm.clockOut()!;
    expect(res2.recap.previous).toMatchObject({ day: 1, net: res.ledger.netProfit });
    expect(res2.recap.safeStreak).toBe(2);
    expect(res2.recap.achievementsToday.map((a) => a.id)).not.toContain('first');
    expect(res2.recap.week).toBeNull();
  });

  it('the 7th clock-out closes the week with a weekly statement', () => {
    const dm = new DeliveryManager(LOCATIONS);
    let last = null;
    for (let d = 1; d <= 7; d++) {
      deliver(dm, accept(dm).order.id);
      last = dm.clockOut()!;
      if (d < 7) expect(last.recap.week).toBeNull();
    }
    const w = last!.recap.week!;
    expect(w).toMatchObject({ week: 1, firstDay: 1, lastDay: 7, deliveries: 7 });
    expect(w.days).toHaveLength(7);
    expect(w.net).toBe(dm.getDayHistory().reduce((a, d) => a + d.net, 0));
    // day 8 starts week 2 with nothing finished yet
    expect(dm.getWeekSummary()).toMatchObject({ week: 2, days: [] });
    // the week's goals were checked; met goals were paid into day 7's ledger and the wallet
    const goals = last!.recap.weekGoals!;
    expect(goals).toHaveLength(3);
    const paid = goals.filter((g) => g.met).reduce((acc, g) => acc + g.bonus, 0);
    expect(last!.recap.weeklyBonus).toBe(paid);
    expect(last!.ledger.weeklyBonusTotal).toBe(paid);
    expect(dm.getDailyLedger().weeklyBonusTotal).toBe(0); // day 8 starts at zero
  });

  it("live week goals count today's deliveries before clock-out", () => {
    const dm = new DeliveryManager(LOCATIONS);
    deliver(dm, accept(dm).order.id);
    deliver(dm, accept(dm).order.id);
    const live = dm.getWeekGoalsLive().find((g) => g.id === 'week_deliveries')!;
    expect(live.current).toBe(2);
    expect(dm.getWeekGoals().find((g) => g.id === 'week_deliveries')!.current).toBe(0); // finished days only
    dm.clockOut();
    expect(dm.getWeekGoals().find((g) => g.id === 'week_deliveries')!.current).toBe(2);
  });

  it('announces each week goal once, the moment it is met', () => {
    const dm = new DeliveryManager(LOCATIONS);
    const announced: string[] = [];
    for (let d = 1; d <= 7; d++) {
      for (let i = 0; i < 4; i++) {
        deliver(dm, accept(dm).order.id);
        announced.push(...dm.collectNewlyMetWeekGoals().map((g) => `${d}:${g.id}`));
      }
      if (d < 7) {
        dm.clockOut();
        announced.push(...dm.collectNewlyMetWeekGoals().map((g) => `${d + 1}:${g.id}`));
      }
    }
    // 25 deliveries are reached on day 7 (4 a day); showing up on day 7 completes 7일 모두 출근
    expect(announced.filter((a) => a.endsWith(':week_deliveries'))).toEqual(['7:week_deliveries']);
    if (dm.getWeekGoalsLive().some((g) => g.id === 'week_all_days')) expect(announced).toContain('7:week_all_days');
    expect(new Set(announced).size).toBe(announced.length); // never twice
    expect(dm.collectNewlyMetWeekGoals()).toEqual([]);
  });

  it('safe stops give back rating (3 a day) and pay the safe-stop goal when it is today\'s goal', () => {
    const dm = new DeliveryManager(LOCATIONS);
    // a working day whose goals include the safe-stop goal
    while (!dm.getShiftGoals().some((g) => g.id === 'safe_stop') && dm.shiftDay < 500) dm.shiftDay++;
    dm.riderRating = 4.5;
    const wallet = dm.totalEarnings;
    const r1 = dm.recordSafeStop();
    expect(r1).toMatchObject({ count: 1, ratingGain: 0.1, newRating: 4.6, bonus: 0 });
    dm.recordSafeStop();
    const r3 = dm.recordSafeStop();
    expect(r3.newRating).toBe(4.8);
    expect(r3.goals.map((g) => g.id)).toEqual(['safe_stop']);
    expect(r3.bonus).toBe(3000);
    expect(dm.totalEarnings).toBe(wallet + 3000);
    const r4 = dm.recordSafeStop();
    expect(r4).toMatchObject({ count: 4, ratingGain: 0, newRating: 4.8 }); // daily rating cap
    // rating never goes above 5.0
    const top = new DeliveryManager(LOCATIONS);
    expect(top.recordSafeStop()).toMatchObject({ ratingGain: 0, newRating: 5 });
  });

  it('no accident-free bonus after a pedestrian accident, and no clock-out mid-delivery', () => {
    const dm = new DeliveryManager(LOCATIONS);
    for (let i = 0; i < 3; i++) deliver(dm, accept(dm).order.id);
    dm.applyPedestrianAccidentPenalty();
    const m = accept(dm);
    expect(dm.clockOut()).toBeNull(); // still has an order
    dm.cancelMission(m.order.id);
    // no accident-free bonus; the no-violation goal is about traffic rules and still pays
    expect(dm.clockOut()!.awardedAtClockOut.map((g) => g.id)).toEqual(['clean']);
  });

  it('a traffic violation loses today\'s no-violation bonus; days in a row without one unlock 무위반 7일', () => {
    const dm = new DeliveryManager(LOCATIONS);
    for (let i = 0; i < 3; i++) deliver(dm, accept(dm).order.id);
    expect(dm.getShiftGoals().find((g) => g.id === 'clean')!.met).toBe(true);
    dm.applyFine(1000, 'signal'); // ran a red light
    expect(dm.getShiftGoals().find((g) => g.id === 'clean')!.met).toBe(false);
    const day1 = dm.clockOut()!;
    expect(day1.awardedAtClockOut.map((g) => g.id)).toEqual(['safe']);
    expect(dm.getDayHistory().at(-1)!.violations).toBe(1);
    // the pedestrian accident fine is not a traffic violation
    for (let d = 0; d < 7; d++) {
      for (let i = 0; i < 3; i++) deliver(dm, accept(dm).order.id);
      if (d === 0) dm.applyFine(500, 'pedestrian');
      dm.clockOut();
    }
    const clean7 = dm.getAchievements().find((a) => a.id === 'clean7')!;
    expect(clean7.current).toBe(7);
    expect(clean7.unlocked).toBe(true);
  });

  it('a group order always waits at the counter; a customer becomes a regular after 2 deliveries', () => {
    const dm = new DeliveryManager(LOCATIONS);
    const m = accept(dm);
    m.order.special = 'group';
    const pos = dm.completePosPickup(m.order.id)!;
    expect(pos.status).toBe('cooking');
    expect(pos.waitSec).toBeGreaterThanOrEqual(8);
    dm.cancelMission(m.order.id);

    const customer = LOCATIONS.find((l) => l.id === 'r1')!;
    expect(dm.isRegularCustomer(customer.id)).toBe(false);
    for (let i = 0; i < 2; i++) {
      const a = accept(dm);
      a.order.customer = customer;
      deliver(dm, a.order.id);
    }
    expect(dm.isRegularCustomer(customer.id)).toBe(true);
  });
});

describe('weather surcharges on new calls', () => {
  it('rain stamps ₩1,500, snow ₩2,000 marked as a snow day; dry weather nothing', () => {
    const dm = new DeliveryManager(LOCATIONS);
    dm.setWeatherPrecipitation('rain');
    expect(dm.availableOrders.length).toBeGreaterThan(0);
    expect(dm.availableOrders.every((o) => o.rainBonus === 1500 && !o.snowDay)).toBe(true);
    dm.setWeatherPrecipitation('snow');
    expect(dm.isWeatherRaining).toBe(false);
    expect(dm.availableOrders.every((o) => o.rainBonus === 2000 && o.snowDay)).toBe(true);
    dm.setWeatherPrecipitation(null);
    expect(dm.availableOrders.every((o) => o.rainBonus === 0 && !o.snowDay)).toBe(true);
  });
});
