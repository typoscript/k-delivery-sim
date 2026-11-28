import { describe, expect, it } from 'vitest';
import {
  NO_GROUND_PARK_LIMIT_M,
  NO_GROUND_WALK_BONUS,
  COMPLEX_LINK_M,
  complexIdOf,
  complexKeyOf,
  indexComplexes,
  isNoGroundVehicleComplex,
  noGroundTagHtml,
  scooterInsideComplex,
} from './apartmentRules';
import { buildDeliveryOrder, createActiveMission } from './orderFactory';
import { computeSettlementPay } from './settlementPay';
import { settlementLines } from '../ui/receiptLines';
import { DeliveryLocation } from '../types';

const apt = (name: string): DeliveryLocation => ({
  id: name,
  name,
  x: 100,
  z: 0,
  type: 'residential',
  emoji: '🏢',
  residenceKind: 'apartment',
});
const names = Array.from({ length: 200 }, (_, i) => `테스트${i}단지아파트`);
const banned = names.find((n) => isNoGroundVehicleComplex(apt(n)))!;
const open = names.find((n) => !isNoGroundVehicleComplex(apt(n)))!;
const shop: DeliveryLocation = {
  id: 's',
  name: '가게',
  x: 0,
  z: 0,
  type: 'shop',
  emoji: '🍗',
  menus: ['후라이드 치킨'],
};

describe('지상 차량 출입 금지 단지', () => {
  it('is decided per complex: every 동 shares it, about a third of complexes have it', () => {
    expect(complexKeyOf('주공2단지아파트 206동')).toBe('주공2단지아파트');
    expect(complexKeyOf('한화꿈에그린 102동')).toBe('한화꿈에그린');
    for (const n of names.slice(0, 40)) {
      expect(isNoGroundVehicleComplex(apt(`${n} 101동`))).toBe(isNoGroundVehicleComplex(apt(`${n} 205동`)));
    }
    const share = names.filter((n) => isNoGroundVehicleComplex(apt(n))).length / names.length;
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.5);
  });

  it('never applies to villas or shops', () => {
    expect(isNoGroundVehicleComplex({ ...apt(banned), residenceKind: 'walkup_villa' })).toBe(false);
    expect(isNoGroundVehicleComplex({ ...apt(banned), type: 'shop' })).toBe(false);
    expect(noGroundTagHtml(apt(open))).toBe('');
    expect(noGroundTagHtml(apt(banned))).toContain(String(NO_GROUND_WALK_BONUS));
  });

  it('the scooter counts as inside the complex within the park limit of the lobby', () => {
    expect(scooterInsideComplex(0, 0, NO_GROUND_PARK_LIMIT_M - 1, 0)).toBe(true);
    expect(scooterInsideComplex(0, 0, NO_GROUND_PARK_LIMIT_M + 1, 0)).toBe(false);
  });

  it('pays the walking allowance only when the scooter was left outside, and lists it on the receipt', () => {
    const mission = (customer: DeliveryLocation) =>
      createActiveMission(
        buildDeliveryOrder({
          id: 'o',
          orderNumber: 'A-01',
          type: 'SINGLE',
          shop,
          customer,
          surcharges: { rainBonus: 0, nightBonus: 0, peakBonus: 0 },
        }),
        0,
        () => 0.99,
      );
    const kept = computeSettlementPay(mission(apt(banned)), 0);
    expect(kept.walkInBonus).toBe(NO_GROUND_WALK_BONUS);
    const broken = computeSettlementPay({ ...mission(apt(banned)), groundRuleBroken: true }, 0);
    expect(broken.walkInBonus).toBe(0);
    expect(kept.earned - broken.earned).toBe(NO_GROUND_WALK_BONUS);
    expect(computeSettlementPay(mission(apt(open)), 0).walkInBonus).toBe(0);
    const rows = settlementLines({
      ...kept,
      order: mission(apt(banned)).order,
      baseFee: 0,
      damageDeduction: 0,
      foodIntegrity: 100,
      foodTemp: 100,
      spillDamageAccum: 0,
      tierPromotedTo: null,
    } as unknown as Parameters<typeof settlementLines>[0]);
    expect(rows.find((r) => r.key === 'walkIn')?.amount).toBe(NO_GROUND_WALK_BONUS);
  });

  it('same-name complexes far apart are separate complexes; the 동s of one complex stay together', () => {
    const at = (id: string, name: string, x: number, z: number): DeliveryLocation => ({ ...apt(name), id, x, z });
    const list = [
      at('a1', '현대아파트 101동', 0, 0),
      at('a2', '현대아파트 102동', 120, 0),
      at('a3', '현대아파트 103동', 120 + COMPLEX_LINK_M - 10, 0), // chained through a2
      at('b1', '현대아파트 101동', 5000, 3000),
      at('c1', '삼성래미안 101동', 60, 0),
    ];
    indexComplexes(list);
    expect(complexIdOf(list[0])).toBe(complexIdOf(list[1]));
    expect(complexIdOf(list[0])).toBe(complexIdOf(list[2]));
    expect(complexIdOf(list[3])).not.toBe(complexIdOf(list[0]));
    expect(complexIdOf(list[4])).not.toBe(complexIdOf(list[0]));
    for (const l of list.slice(0, 3)) expect(isNoGroundVehicleComplex(l)).toBe(isNoGroundVehicleComplex(list[0]));
    // across many same-name complexes the rule differs somewhere (it is not one rule per name any more)
    const far = Array.from({ length: 30 }, (_, i) => at(`f${i}`, '현대아파트 101동', i * 2000, 9000));
    indexComplexes(far);
    expect(new Set(far.map((l) => isNoGroundVehicleComplex(l))).size).toBe(2);
  });
});
