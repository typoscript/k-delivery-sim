import { describe, expect, it } from 'vitest';
import { DeliveryManager, REPAIR_COST_PER_DAMAGE_STAGE } from '../../delivery/DeliveryManager';
import { DeliveryLocation } from '../../types';
import { PIN_MAX_TOKENS, pinTokenFor, posCharFor } from './keypads';
import { fullTankCost } from './fuelModal';
import {
  cargoHandBanner,
  cargoSlotCardsHtml,
  dailyReportHtml,
  garageBikeListHtml,
  garageUpgradeListHtml,
  repairCostFor,
  repairDiagHtml,
  settlementBreakdownHtml,
  settlementPhotoBadge,
} from './modalViews';
import { SCOOTER_MODEL_LIST } from '../../vehicle/ScooterModels';
import { RIDER_UPGRADE_LIST } from '../../delivery/RiderCareer';

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
  loc('r1', 300, 0, 'residential', { residenceKind: 'walkup_villa' }),
  loc('r2', 0, 400, 'residential'),
];

describe('keypads', () => {
  it('accepts order-number characters and door pattern tokens', () => {
    expect(posCharFor('a')).toBe('A');
    expect(posCharFor('7')).toBe('7');
    expect(posCharFor('-')).toBe('-');
    expect(posCharFor('Shift')).toBeNull();
    expect(posCharFor('!')).toBeNull();
    expect(pinTokenFor('b')).toBe('🔔');
    expect(pinTokenFor('K')).toBe('🔑');
    expect(pinTokenFor('c')).toBe('📞');
    expect(pinTokenFor('🔔')).toBe('🔔');
    expect(pinTokenFor('#')).toBe('#');
    expect(pinTokenFor('5')).toBe('5');
    expect(pinTokenFor('x')).toBeNull();
    expect(PIN_MAX_TOKENS).toBeGreaterThanOrEqual(6); // longest pattern: 🔑 + 4 digits + 📞
  });

  it('prices a full tank in ₩100 steps', () => {
    expect(fullTankCost(100)).toEqual({ needed: 1, cost: 100 });
    const half = fullTankCost(50.4);
    expect(half.needed).toBe(50);
    expect(half.cost % 100).toBe(0);
  });
});

describe('modal views', () => {
  it('cargo box: banner and one card per slot with load / unload buttons', () => {
    const dm = new DeliveryManager(LOCATIONS);
    const o = dm.availableOrders[0];
    dm.acceptOrder(o.id);
    dm.completePosPickup(o.id, false);
    const carrying = dm.getCarryingMission();
    expect(cargoHandBanner(carrying).className).toContain('carrying');
    expect(cargoHandBanner(null).className).toContain('free');
    let html = cargoSlotCardsHtml((i) => dm.getCargoSlotMission(i), carrying, 0, 0);
    expect(html.match(/cargo-slot-card empty actionable/g)).toHaveLength(3);
    dm.loadFoodIntoCargoSlot(1);
    html = cargoSlotCardsHtml((i) => dm.getCargoSlotMission(i), null, o.customer.x, o.customer.z);
    expect(html.match(/cargo-slot-card occupied near-dest/g)).toHaveLength(1);
    expect(html).toContain(`#${o.orderNumber}`);
    expect(html).toContain('data-slot="1"');
  });

  it('garage: repair diagnosis and price lists', () => {
    expect(repairCostFor(2)).toBe(2 * REPAIR_COST_PER_DAMAGE_STAGE);
    expect(repairDiagHtml(2, 5)).toContain('2단계 / 3 (누적 전도 5회)');
    expect(repairDiagHtml(0, 0)).toContain('양호');
    const garage = { modelId: SCOOTER_MODEL_LIST[0].id, paintId: 'mint' as never, ownedModels: [SCOOTER_MODEL_LIST[0].id], ownedPaints: [] };
    const bikes = garageBikeListHtml(garage);
    expect(bikes.match(/garage-bike-btn/g)).toHaveLength(SCOOTER_MODEL_LIST.length);
    expect(bikes).toContain('✓ 탑승 중');
    const upgrades = garageUpgradeListHtml({
      walletBalance: 0,
      lifetimeCompleted: 0,
      riderRating: 5,
      upgrades: [RIDER_UPGRADE_LIST[0].id],
      reviews: [],
      shopPickupCounts: {},
      customerDeliveryCounts: {},
      shopNames: {},
    });
    expect(upgrades).toContain('✓ 장착 완료');
    expect(upgrades.match(/upg-locked/g)).toHaveLength(RIDER_UPGRADE_LIST.length - 1);
  });

  it('daily statement and settlement popup', () => {
    const dm = new DeliveryManager(LOCATIONS);
    const o = dm.availableOrders[0];
    dm.acceptOrder(o.id);
    dm.completePosPickup(o.id, false);
    dm.loadFoodIntoCargoSlot(0);
    dm.unloadFoodFromCargoSlot(0);
    dm.unlockLobbyDoor(o.id);
    dm.enterCorridor(o.id);
    dm.placeFoodAtDoor();
    const result = dm.completePhotoSettlement()!;
    const st = settlementBreakdownHtml(result);
    expect(st).toContain('settlement-review-box');
    expect(st).toContain(result.review.comment);
    expect(settlementPhotoBadge('MEET_FACE')).toContain('대면');
    dm.finishAfterCorridorExit();

    const ledger = dm.getDailyLedger();
    expect(dailyReportHtml(ledger)).toContain(`(${ledger.completedCount}건 완료)`);
    expect(dailyReportHtml(ledger)).not.toContain('일차 목표');
    const res = dm.clockOut()!;
    expect(dailyReportHtml(res.ledger, res)).toContain(`${res.day}일차 목표`);
  });
});
