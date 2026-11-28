import { describe, expect, it } from 'vitest';
import {
  NO_GROUND_PARK_LIMIT_M,
  NO_GROUND_WALK_BONUS,
  complexKeyOf,
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
});
