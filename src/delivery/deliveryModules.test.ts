import { describe, expect, it } from 'vitest';
import { buildDeliveryOrder, pickOrderNumber, rollSpecialOrder, singleDistanceBonus } from './orderFactory';
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
