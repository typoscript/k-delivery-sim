import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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
  shiftRecapHtml,
} from './modalViews';
import { SCOOTER_MODEL_LIST } from '../../vehicle/ScooterModels';
import { RIDER_UPGRADE_LIST } from '../../delivery/RiderCareer';
import { ledgerIncomeLines } from '../receiptLines';

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
    const html = dailyReportHtml(res.ledger, res);
    expect(html).toContain(`${res.day}일차 목표`);
    expect(html).toContain(`${res.day}일차 기록`);
    expect(html).toContain('첫 근무일 기록이에요');
    expect(html).toContain('🛵 첫 배달'); // unlocked today
    expect(dailyReportHtml(res.ledger)).not.toContain('일차 기록'); // mid-day statement: no recap
    expect(html).not.toContain('주간 정산'); // day 1 is not a week end
    const weekly = dailyReportHtml(res.ledger, { ...res, recap: { ...res.recap, week: { week: 1, firstDay: 1, lastDay: 7, days: [], deliveries: 12, income: 90000, expenses: 8000, net: 82000, bestDay: null, avgStars: 4.6, safeDays: 5, weatherDeliveries: 0, quickReplies: 0, achievements: [] } } });
    expect(weekly).toContain('1주차 주간 정산');
    expect(weekly).toContain('₩82,000');
    expect(weekly.match(/week-bar-col/g)).toHaveLength(7);
    const worse = { ...res, recap: { ...res.recap, previous: { ...res.ledger, day: 7, deliveries: 9, income: 0, expenses: 0, net: res.ledger.netProfit + 5000, avgStars: null, goalsMet: 0, goalsTotal: 4, accidents: 0 } } };
    expect(shiftRecapHtml(worse)).toContain('▼ ₩5,000');
  });
});

/** One order from the board through pickup, cargo box, corridor and the doorstep photo */
function deliverOne(dm: DeliveryManager): void {
  const o = dm.availableOrders[0];
  dm.acceptOrder(o.id);
  dm.completePosPickup(o.id, false);
  dm.loadFoodIntoCargoSlot(dm.getFirstEmptyCargoSlot());
  dm.unloadFoodFromCargoSlot(dm.getMissionById(o.id)!.cargoSlot!);
  dm.unlockLobbyDoor(o.id);
  dm.enterCorridor(o.id);
  dm.placeFoodAtDoor();
  expect(dm.completePhotoSettlement()).not.toBeNull();
  dm.finishAfterCorridorExit();
}

/** "+₩12,300" / "-₩500" / "₩0" -> number */
const wonOf = (text: string) => Number(text.replace(/[^0-9-]/g, '') || 0);

describe('daily statement', () => {
  it("the 7th day's statement lists the weekly goals with progress and the paid bonus", () => {
    const dm = new DeliveryManager(LOCATIONS);
    let res = null;
    for (let d = 1; d <= 7; d++) {
      deliverOne(dm);
      res = dm.clockOut()!;
    }
    const goals = res!.recap.weekGoals!;
    const html = dailyReportHtml(res!.ledger, res!);
    expect(html).toContain('1주차 주간 정산 (1~7일차)');
    // one row per goal: title, progress on its own line, bonus or 미달성
    for (const g of goals) {
      expect(html).toContain(`${g.icon} ${g.title}<small class="rep-progress">`);
    }
    expect(html.match(/class="rep-progress"/g)).toHaveLength(goals.length);
    const paid = goals.filter((g) => g.met).reduce((a, g) => a + g.bonus, 0);
    expect(html).toContain(`주간 목표 보너스 (지갑 반영)</span><span>+₩${paid.toLocaleString()}`);
    expect(html.match(/미달성/g)?.length ?? 0).toBeGreaterThanOrEqual(goals.filter((g) => !g.met).length);
    // day 1~6 statements have no weekly section
    const day1 = new DeliveryManager(LOCATIONS);
    deliverOne(day1);
    const r1 = day1.clockOut()!;
    expect(dailyReportHtml(r1.ledger, r1)).not.toContain('rep-progress');
  });

  it('income rows add up to the total income, weekly bonus included', () => {
    const dm = new DeliveryManager(LOCATIONS);
    let res = null;
    for (let d = 1; d <= 7; d++) {
      deliverOne(dm);
      deliverOne(dm);
      res = dm.clockOut()!;
    }
    const ledger = res!.ledger;
    const rows = ledgerIncomeLines(ledger);
    expect(rows.reduce((a, l) => a + l.amount, 0)).toBe(ledger.grossIncome);
    const html = dailyReportHtml(ledger, res!);
    const incomeSection = html.slice(html.indexOf('배달 수입 명세'), html.indexOf('총 수입 소계'));
    const shown = [...incomeSection.matchAll(/<span>([^<]*)<\/span><\/div>/g)].map((m) => wonOf(m[1]));
    expect(shown.reduce((a, b) => a + b, 0)).toBe(ledger.grossIncome);
    expect(html).toContain(`총 수입 소계</span><span>+₩${ledger.grossIncome.toLocaleString()}`);
    if (ledger.weeklyBonusTotal > 0) expect(rows.some((l) => l.amount === ledger.weeklyBonusTotal)).toBe(true);
  });

  it('the statement card fits the screen and its body scrolls (long weekly statements)', () => {
    // Regression: the 7th day's statement was taller than the viewport and cut off its OK button
    const css = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
    const rule = (sel: string) => css.match(new RegExp(`\\n${sel.replace('.', '\\.')} \\{([^}]*)\\}`))?.[1] ?? '';
    expect(rule('.report-card')).toMatch(/max-height:\s*calc\(100vh/);
    expect(rule('.report-body')).toMatch(/overflow-y:\s*auto/);
    expect(rule('.report-body')).toMatch(/min-height:\s*0/);
  });
});
