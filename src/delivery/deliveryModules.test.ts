import { describe, expect, it } from 'vitest';
import {
  BUSY_KITCHEN_SHOPS,
  buildDeliveryOrder,
  createActiveMission,
  kitchenDelayChance,
  pickOrderNumber,
  rollSpecialOrder,
  singleDistanceBonus,
} from './orderFactory';
import { settlementGoalCounters } from './shiftProgress';
import { RiderRecords, ratingAfterReview, reviewInputFor } from './riderRecords';
import { buildDailyLedger } from './dailyLedger';
import { emptyLedger } from './ShiftDay';
import { RIDER_TIERS, RiderCareerSave } from './RiderCareer';
import { computeSettlementPay } from './settlementPay';
import { applyCrashToCargo, applySpeedBumpToCargo, createCustomerChatEvent } from './cargoCare';
import { ActiveMission, ALTTLE_FLAT_FEE, REGULAR_CUSTOMER_TIP, SINGLE_FLAT_FEE, SPECIAL_ORDERS, VILLA_STAIR_BONUS } from './deliveryTypes';
import { DeliveryLocation } from '../types';

const shop: DeliveryLocation = { id: 's', name: '가게', x: 0, z: 0, type: 'shop', emoji: '🍗', menus: ['후라이드 치킨'] };
const home: DeliveryLocation = { id: 'r', name: '빌라', x: 300, z: 200, type: 'residential', emoji: '🏠', residenceKind: 'walkup_villa' };
const surcharges = { rainBonus: 1500, nightBonus: 0, peakBonus: 1000 };

const mission = (over: Partial<ActiveMission> = {}): ActiveMission => ({
  order: buildDeliveryOrder({ id: 'o1', orderNumber: 'A-01', type: 'SINGLE', shop, customer: home, surcharges }),
  phase: 'cargo_loaded',
  foodIntegrity: 100,
  foodTemp: 100,
  spillDamageAccum: 0,
  startedAt: 0,
  remainingTimeSec: 300,
  cookingDurationSec: 0,
  cookingRemainingSec: 0,
  cargoSlot: 0,
  pickedUp: true,
  chatEventTriggered: false,
  chatTriggerDelaySec: 0,
  chatLoadedElapsedSec: 0,
  chatNote: null,
  promisedExtraTip: 0,
  ...over,
});

describe('orderFactory', () => {
  it('prices 한집 with the distance surcharge and 알뜰 flat, stamping surcharges', () => {
    const single = buildDeliveryOrder({ id: 'a', orderNumber: 'A-01', type: 'SINGLE', shop, customer: home, surcharges });
    expect(single.distanceMeters).toBe(500);
    expect(single.baseFee).toBe(SINGLE_FLAT_FEE + singleDistanceBonus(500));
    expect(single.timeLimitSec).toBe(300);
    expect(single.peakBonus).toBe(1000);
    expect(single.menuName).toBe('후라이드 치킨');
    const bundle = buildDeliveryOrder({ id: 'b', orderNumber: 'B-01', type: 'ALTTLE_BUNDLE', shop, customer: home, surcharges });
    expect(bundle.baseFee).toBe(ALTTLE_FLAT_FEE);
    expect(bundle.timeLimitSec).toBe(500);
  });
  it('never repeats an order number in use', () => {
    const used = new Set<string>();
    for (let i = 0; i < 50; i++) pickOrderNumber(used, ['A-'], 'X');
    expect(used.size).toBe(50);
  });
});

describe('settlement pay', () => {
  it('earned is the exact sum of its parts', () => {
    const pay = computeSettlementPay(mission(), 600);
    expect(pay.villaStairBonus).toBe(VILLA_STAIR_BONUS);
    expect(pay.tip).toBe(500);
    expect(pay.damageDed).toBe(0);
    expect(pay.earned).toBe(
      pay.basePart + pay.distPart - pay.damageDed + pay.tip + pay.tempBonus + pay.villaStairBonus +
        pay.promisedTipBonus + pay.rainBonus + pay.nightBonus + pay.peakBonus + pay.tierBonus
    );
  });
  it('damaged, lukewarm food loses tip and part of the base fee', () => {
    const pay = computeSettlementPay(mission({ foodIntegrity: 80, foodTemp: 40 }), 0);
    expect(pay.tip).toBe(100); // 200 halved
    expect(pay.tempBonus).toBe(0);
    expect(pay.damageDed).toBeGreaterThan(0);
  });
});

describe('cargo care', () => {
  it('speed bumps below 22 km/h do nothing; crashes hit every loaded bag', () => {
    const a = mission();
    const b = mission();
    expect(applySpeedBumpToCargo([a], 20, { tempDecayMul: 1, spillDamageMul: 1 } as never).damagedCount).toBe(0);
    expect(applyCrashToCargo([a, b], 'pedestrian_hit')).toEqual({ damagedCount: 2, loss: 55 });
    expect(a.foodIntegrity).toBe(45);
  });
  it('customer chat events change the order as announced', () => {
    const seq = [0.0, 0.5, 0.99];
    for (const r of seq) {
      const m = mission();
      const before = { ...m.order };
      const ev = createCustomerChatEvent(m, false, () => r);
      if (ev.kind === 'change_to_photo') expect(m.order.deliveryInstruction).toBe('PHOTO_DOOR');
      if (ev.kind === 'fix_unit_number') expect(m.order.unitNumber).not.toBe(before.unitNumber);
      if (ev.kind === 'extra_tip_careful') expect(m.promisedExtraTip).toBe(1000);
    }
  });
});

describe('special orders and regular customers', () => {
  it('rolls specials only sometimes, urgent mostly at night and group orders mostly at rush hour', () => {
    let n = 0;
    const seq = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
    const count = (isNight: boolean, isPeak: boolean) => {
      const c = { none: 0, urgent: 0, group: 0 };
      for (let i = 0; i < 20000; i++) c[rollSpecialOrder(isNight, isPeak, seq) ?? 'none']++;
      return c;
    };
    const day = count(false, false);
    expect(day.none / 20000).toBeGreaterThan(0.8);
    const night = count(true, false);
    expect(night.urgent).toBeGreaterThan(night.group * 2);
    const rush = count(false, true);
    expect(rush.group).toBeGreaterThan(rush.urgent * 2);
  });

  it('an urgent delivery has a short limit and pays its surcharge only when on time', () => {
    const order = buildDeliveryOrder({ id: 'p', orderNumber: 'A-02', type: 'SINGLE', shop, customer: home, surcharges, special: 'urgent' });
    expect(order.timeLimitSec).toBe(SPECIAL_ORDERS.urgent.timeLimitSec);
    expect(order.menuName).toBe('후라이드 치킨 (급해요!)');
    const onTime = computeSettlementPay(mission({ order, remainingTimeSec: 20 }), 0);
    const late = computeSettlementPay(mission({ order, remainingTimeSec: 0 }), 0);
    expect(onTime.specialBonus).toBe(SPECIAL_ORDERS.urgent.bonus);
    expect(late.specialBonus).toBe(0);
    expect(onTime.earned - late.earned).toBe(SPECIAL_ORDERS.urgent.bonus);
  });

  it('special orders are 한집배달 only; regular customers tip when the food is in good shape', () => {
    const bundle = buildDeliveryOrder({ id: 'b', orderNumber: 'B-02', type: 'ALTTLE_BUNDLE', shop, customer: home, surcharges, special: 'group' });
    expect(bundle.special).toBeUndefined();
    const order = buildDeliveryOrder({ id: 'r', orderNumber: 'A-03', type: 'SINGLE', shop, customer: home, surcharges, regularCustomer: true });
    expect(computeSettlementPay(mission({ order }), 0).regularCustomerTip).toBe(REGULAR_CUSTOMER_TIP);
    expect(computeSettlementPay(mission({ order, foodIntegrity: 60 }), 0).regularCustomerTip).toBe(0);
  });
});

describe('split DeliveryManager helpers', () => {
  it('a delivery bumps exactly the goal counters it qualifies for', () => {
    const zero = { peakBonus: 0, rainBonus: 0, nightBonus: 0, specialBonus: 0 };
    // villa customer, 100% food, ~360m away
    expect(settlementGoalCounters(mission(), zero, () => 'ingye')).toEqual(['villa', 'perfect', 'district:ingye']);
    const urgentFar = mission({ foodIntegrity: 80 });
    urgentFar.order = { ...urgentFar.order, special: 'urgent', regularCustomer: true, distanceMeters: 1500, customer: { ...home, residenceKind: 'apartment' } };
    expect(settlementGoalCounters(urgentFar, { peakBonus: 1000, rainBonus: 1500, nightBonus: 1200, specialBonus: 3000 }, () => 'gwanggyo')).toEqual([
      'peak',
      'rain',
      'night',
      'urgentOnTime',
      'regular',
      'far',
      'district:gwanggyo',
    ]);
    // a late urgent delivery (no special bonus) does not count as on time
    expect(settlementGoalCounters(urgentFar, zero, () => 'x')).not.toContain('urgentOnTime');
  });

  it('trust rating moves 0.1 per review within its bounds', () => {
    expect(ratingAfterReview(4.5, 95, 4)).toBe(4.6);
    expect(ratingAfterReview(4.5, 50, 5)).toBe(4.6);
    expect(ratingAfterReview(5.0, 100, 5)).toBe(5.0);
    expect(ratingAfterReview(4.5, 50, 2)).toBe(4.4);
    expect(ratingAfterReview(1.0, 50, 1)).toBe(1.0);
    expect(ratingAfterReview(4.5, 70, 3)).toBe(4.5);
    expect(reviewInputFor(mission({ remainingTimeSec: 150 }), true, false, '12:00')).toMatchObject({
      remainingRatio: 0.5,
      isWalkupVilla: true,
      isRain: true,
      isNight: false,
      createdAt: '12:00',
    });
  });

  it('records regular shops and customers and caps reviews', () => {
    const career: RiderCareerSave = {
      walletBalance: 0,
      lifetimeCompleted: 0,
      riderRating: 5,
      upgrades: [],
      reviews: [],
      shopPickupCounts: {},
      customerDeliveryCounts: {},
      shopNames: {},
    };
    const rec = new RiderRecords(career, [shop]);
    expect(rec.recordShopPickup(shop)).toEqual({ count: 1, isRegularPerk: false, justBecameRegular: false });
    expect(rec.recordShopPickup(shop)).toEqual({ count: 2, isRegularPerk: false, justBecameRegular: true });
    expect(rec.recordShopPickup(shop)).toEqual({ count: 3, isRegularPerk: true, justBecameRegular: false });
    expect(rec.regularShops()).toEqual([{ shopId: 's', name: '🍗 가게', count: 3 }]);
    expect(rec.isRegularCustomer('r')).toBe(false);
    rec.recordCustomerDelivery('r');
    rec.recordCustomerDelivery('r');
    expect(rec.isRegularCustomer('r')).toBe(true);
    for (let i = 0; i < 30; i++) {
      rec.addReview({ id: `${i}`, orderNumber: `A-${i}`, shopId: 's', shopName: '가게', shopEmoji: '', menuName: '', customerName: '', unitNumber: '', stars: i % 2 ? 5 : 4, comment: '', tags: [], createdAt: '' });
    }
    expect(rec.reviews()).toHaveLength(25);
    expect(rec.reviews()[0].orderNumber).toBe('A-29');
    expect(rec.averageStars()).toBe(4.5);
    expect(rec.reputation(5)).toBe(rec.reputation(5)); // cached while nothing changed
  });

  it('the daily ledger sums income and expenses', () => {
    const l = { ...emptyLedger(), baseFeeTotal: 9000, tipTotal: 1000, missionBonusTotal: 5000, fuelExpense: 2000, fineExpense: 40000, completedCount: 2 };
    const d = buildDailyLedger(l, { shiftDay: 3, walletBalance: -27000, lifetimeCompleted: 9, riderTier: RIDER_TIERS[1], riderRating: 4.9, fines: { speeding: 40000, signal: 0, sidewalk: 0, pedestrian: 0 } });
    expect(d).toMatchObject({ shiftDay: 3, completedCount: 2, grossIncome: 15000, totalExpenses: 42000, netProfit: -27000, walletBalance: -27000 });
  });

  it('kitchen delays and new missions', () => {
    expect(kitchenDelayChance([...BUSY_KITCHEN_SHOPS][0], 1)).toBe(0.8);
    expect(kitchenDelayChance('shop-quiet', 2)).toBe(0.8);
    expect(kitchenDelayChance('shop-quiet', 1)).toBe(0.45);
    const order = mission().order;
    const chatty = createActiveMission(order, 10, () => 0.5);
    expect(chatty).toMatchObject({ phase: 'to_pickup', startedAt: 10, remainingTimeSec: order.timeLimitSec, cargoSlot: null });
    expect(chatty.chatTriggerDelaySec).toBeCloseTo(4.5 + 0.5 * 6.5);
    expect(createActiveMission(order, 0, () => 0.9).chatTriggerDelaySec).toBe(0);
  });
});

describe('snow and walk-in goals', () => {
  const pay = { peakBonus: 0, rainBonus: 2000, nightBonus: 0, specialBonus: 0 };
  it('a snow-day delivery counts for snow, not rain; a walked-in delivery counts for walkIn', () => {
    const snowy = mission();
    snowy.order.snowDay = true;
    const keys = settlementGoalCounters(snowy, pay, () => 'x');
    expect(keys).toContain('snow');
    expect(keys).not.toContain('rain');
    expect(settlementGoalCounters(mission(), { ...pay, rainBonus: 1500 }, () => 'x')).toContain('rain');
    expect(settlementGoalCounters(mission(), { ...pay, rainBonus: 0, walkInBonus: 700 }, () => 'x')).toContain('walkIn');
    expect(settlementGoalCounters(mission(), { ...pay, rainBonus: 0, walkInBonus: 0 }, () => 'x')).not.toContain('walkIn');
  });
  it('rotating goals and achievements exist for both', async () => {
    const { ROTATING_GOALS } = await import('./ShiftDay');
    const { ACHIEVEMENTS } = await import('./careerHistory');
    expect(ROTATING_GOALS.map((g) => g.counter)).toEqual(expect.arrayContaining(['snow', 'walkIn']));
    expect(ACHIEVEMENTS.map((a) => a.id)).toEqual(expect.arrayContaining(['snowrider', 'walker']));
  });
});
