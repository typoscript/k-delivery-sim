import { describe, expect, it } from 'vitest';
import { DEMAND_EVENTS, activeDemandEvents, eventBonusEarned, eventForMenu, pickMenu } from './demandEvents';
import { buildDeliveryOrder, createActiveMission } from './orderFactory';
import { computeSettlementPay } from './settlementPay';
import { settlementLines } from '../ui/receiptLines';
import { DeliveryLocation } from '../types';

const { rain_soup: SOUP, late_snack: SNACK } = DEMAND_EVENTS;

/** Deterministic random numbers for sampling */
function seeded(seed: number): () => number {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

describe('which events run', () => {
  it('rain -> soups, night -> late-night snacks, both on a rainy night (soup first)', () => {
    expect(activeDemandEvents(false, false)).toEqual([]);
    expect(activeDemandEvents(true, false).map((e) => e.id)).toEqual(['rain_soup']);
    expect(activeDemandEvents(false, true).map((e) => e.id)).toEqual(['late_snack']);
    expect(activeDemandEvents(true, true).map((e) => e.id)).toEqual(['rain_soup', 'late_snack']);
  });
});

describe('menus of an event', () => {
  it('soups and stews, not 탕수육', () => {
    for (const m of [
      '진한 돼지국밥 특',
      '차돌 짬뽕 + 볶음밥',
      '매운 미소 라멘 세트',
      '우거지 감자탕 소(2인)',
      '양지 차돌 쌀국수 + 짜조',
      '얼큰 오뎅탕 + 볶음밥',
    ])
      expect(SOUP.menu.test(m), m).toBe(true);
    for (const m of ['짜장면 + 미니 탕수육', '아이스 아메리카노 2잔', '모둠 특선 초밥 18p', '와퍼 세트 + 어니언링'])
      expect(SOUP.menu.test(m), m).toBe(false);
  });

  it('late-night snacks', () => {
    for (const m of ['간장치킨 + 치즈볼', '양념반 후라이드반 통닭', '페퍼로니 피자 + 파스타', '한신 국물닭발 + 주먹밥'])
      expect(SNACK.menu.test(m), m).toBe(true);
    for (const m of ['바닐라 라떼 2잔', '물냉면 + 숯불고기 세트']) expect(SNACK.menu.test(m), m).toBe(false);
  });

  it('an order belongs to the first running event its menu matches', () => {
    expect(eventForMenu('수원 왕갈비통닭 + 콜라', [SOUP, SNACK])?.id).toBe('late_snack');
    expect(eventForMenu('한신 국물닭발 + 주먹밥', [SOUP, SNACK])?.id).toBe('rain_soup'); // 국물 is a soup word
    expect(eventForMenu('한신 국물닭발 + 주먹밥', [SNACK])?.id).toBe('late_snack');
    expect(eventForMenu('바닐라 라떼 2잔', [SOUP, SNACK])).toBeNull();
  });
});

describe('picking the menu of a new call', () => {
  const menus = ['돈코츠 차슈 라멘 + 교자', '모둠 특선 초밥 18p', '연어·광어 반반 초밥', '광어 초밥 12p'];

  it('without events: one random number, like before', () => {
    let calls = 0;
    const r = () => (calls++, 0.6);
    expect(pickMenu(menus, [], r)).toBe(menus[2]);
    expect(calls).toBe(1);
  });

  it('during the event the matching menu comes up far more often', () => {
    const rand = seeded(7);
    let plain = 0;
    let event = 0;
    for (let i = 0; i < 2000; i++) {
      if (/라멘/.test(pickMenu(menus, [], rand))) plain++;
      if (/라멘/.test(pickMenu(menus, [SOUP], rand))) event++;
    }
    expect(plain / 2000).toBeCloseTo(0.25, 1);
    expect(event / 2000).toBeGreaterThan(0.6); // pickChance 0.6 + the plain share of the rest
  });

  it('a shop without matching menus is unaffected', () => {
    const cafe = ['아이스 아메리카노 2잔', '바닐라 라떼 2잔'];
    const rand = seeded(3);
    for (let i = 0; i < 50; i++) expect(cafe).toContain(pickMenu(cafe, [SOUP, SNACK], rand));
  });
});

describe('event orders and their pay', () => {
  const shop: DeliveryLocation = {
    id: 's',
    name: '국밥집',
    x: 0,
    z: 0,
    type: 'shop',
    emoji: '🍲',
    menus: ['진한 돼지국밥 특'],
  };
  const home: DeliveryLocation = { id: 'r', name: '집', x: 200, z: 0, type: 'residential', emoji: '🏠' };
  const order = (raining: boolean) =>
    buildDeliveryOrder({
      id: 'o',
      orderNumber: 'A-01',
      type: 'SINGLE',
      shop,
      customer: home,
      surcharges: {
        rainBonus: raining ? 1500 : 0,
        nightBonus: 0,
        peakBonus: 0,
        events: activeDemandEvents(raining, false),
      },
      rand: seeded(11),
    });

  it('a soup ordered in the rain carries the event surcharge; on a dry day it does not', () => {
    expect(order(true)).toMatchObject({ demandEvent: 'rain_soup', eventBonus: SOUP.bonus });
    expect(order(false).demandEvent).toBeUndefined();
  });

  it('pays the surcharge only when the condition holds, and it adds up on the receipt', () => {
    const o = order(true);
    const m = (integrity: number) => ({ ...createActiveMission(o, 0), foodIntegrity: integrity, foodTemp: 90 });
    const good = computeSettlementPay(m(95), 0);
    const spilled = computeSettlementPay(m(60), 0);
    expect(good.eventBonus).toBe(SOUP.bonus);
    expect(spilled.eventBonus).toBe(0);
    expect(eventBonusEarned(m(95))).toBe(SOUP.bonus);
    // the receipt rows sum to the payout either way, and say why nothing was paid
    for (const [pay, mi] of [
      [good, m(95)],
      [spilled, m(60)],
    ] as const) {
      const rows = settlementLines({
        order: o,
        baseFee: o.baseFee,
        rainBonus: pay.rainBonus,
        nightBonus: pay.nightBonus,
        peakBonus: pay.peakBonus,
        specialBonus: pay.specialBonus,
        regularCustomerTip: pay.regularCustomerTip,
        eventBonus: pay.eventBonus,
        damageDeduction: pay.damageDed,
        tierBonus: pay.tierBonus,
        tierPromotedTo: null,
        foodIntegrity: mi.foodIntegrity,
        foodTemp: mi.foodTemp,
        spillDamageAccum: 0,
        tempBonus: pay.tempBonus,
        villaStairBonus: pay.villaStairBonus,
        promisedTipBonus: pay.promisedTipBonus,
        tip: pay.tip,
        tipPenalty: pay.tipPenalty,
        earned: pay.earned,
      } as Parameters<typeof settlementLines>[0]);
      const ev = rows.find((r) => r.key === 'event')!;
      expect(ev.amount).toBe(pay.eventBonus);
      if (pay.eventBonus === 0) expect(ev.label).toContain('할증 없음');
    }
    expect(good.earned - spilled.earned).toBeGreaterThanOrEqual(SOUP.bonus);
  });

  it('a late-night snack pays only when it arrives warm', () => {
    const base = { order: { demandEvent: 'late_snack' as const, eventBonus: SNACK.bonus }, foodIntegrity: 100 };
    expect(eventBonusEarned({ ...base, foodTemp: 70 })).toBe(SNACK.bonus);
    expect(eventBonusEarned({ ...base, foodTemp: 40 })).toBe(0);
  });
});
