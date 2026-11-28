// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { DeliveryManager } from './DeliveryManager';
import { loadRiderCareer } from './RiderCareer';
import { DeliveryLocation } from '../types';
import { ledgerExpenseLines } from '../ui/receiptLines';
import { repairDebtCardHtml } from '../ui/phone/sheetEarningsTabs';
import { REPAIR_DEBT_DUE_DAYS, garageLevel, repairDebtDueDay, repairLateFee } from './repairCredit';

const loc = (id: string, x: number, type: 'shop' | 'residential'): DeliveryLocation => ({
  id,
  name: id,
  x,
  z: 0,
  type,
  emoji: '',
  menus: type === 'shop' ? ['제육볶음 정식'] : undefined,
});
const LOCATIONS = [loc('s1', 0, 'shop'), loc('s2', 40, 'shop'), loc('r1', 300, 'residential')];

describe('repair on credit (외상 수리)', () => {
  beforeEach(() => window.localStorage.clear());

  it('pays what the wallet holds now, owes the rest, one credit at a time', () => {
    const dm = new DeliveryManager(LOCATIONS);
    dm.totalEarnings = 3_050;
    expect(dm.repairOnCredit(10_000)).toBe('ok');
    expect(dm.totalEarnings).toBe(50);
    expect(dm.repairDebt).toBe(7_000);
    expect(dm.repairExpense).toBe(3_000);
    expect(dm.repairOnCredit(10_000)).toBe('debt_open'); // still owing
  });

  it("settlements pay the debt back (today's 외상 상환 line) and it survives a reload", () => {
    const dm = new DeliveryManager(LOCATIONS);
    dm.totalEarnings = 0;
    dm.repairOnCredit(9_000);
    expect(loadRiderCareer().repairDebt).toBe(9_000);
    dm.totalEarnings += 5_000; // a settlement paid 5,000
    expect(dm.repayRepairDebt(5_000)).toBe(5_000);
    expect(dm.repairDebt).toBe(4_000);
    dm.totalEarnings += 6_000;
    expect(dm.repayRepairDebt(6_000)).toBe(4_000);
    expect(dm.repairDebt).toBe(0);
    expect(dm.totalEarnings).toBe(2_000);
    expect(dm.repairExpense).toBe(0); // the repair itself was all on credit
    expect(dm.debtRepayExpense).toBe(9_000);
    const l = dm.getDailyLedger();
    expect(l.totalExpenses).toBe(9_000);
    expect(ledgerExpenseLines(l).find((x) => x.key === 'debt')).toMatchObject({ amount: -9_000 });
    expect(repairDebtCardHtml(dm.repairDebt, l.debtRepayExpense)).toContain('오늘 모두 갚았어요');
    expect(repairDebtCardHtml(4_000, 5_000)).toContain('남은 외상 ₩4,000');
    expect(repairDebtCardHtml(0, 0)).toBe('');
    expect(loadRiderCareer().repairDebt).toBeUndefined();
    expect(dm.repayRepairDebt(6_000)).toBe(0);
  });
});

describe('repair credit terms', () => {
  beforeEach(() => window.localStorage.clear());

  it('the credit limit grows with the garage level', () => {
    expect(garageLevel(0)).toMatchObject({ label: '처음 손님', limit: 15_000, nextAt: 3 });
    expect(garageLevel(3).limit).toBe(25_000);
    expect(garageLevel(9)).toMatchObject({ limit: 40_000, nextAt: null });
    const dm = new DeliveryManager(LOCATIONS);
    dm.totalEarnings = 0;
    expect(dm.repairOnCredit(20_000)).toBe('over_limit');
    expect(dm.repairDebt).toBe(0);
    for (let i = 0; i < 3; i++) dm.recordGarageVisit();
    expect(dm.garageLevel.limit).toBe(25_000);
    expect(dm.repairOnCredit(20_000)).toBe('ok');
  });

  it('an overdue debt grows by a late fee at each clock-out from its due day', () => {
    expect(repairDebtDueDay(4)).toBe(4 + REPAIR_DEBT_DUE_DAYS - 1);
    expect(repairLateFee(10_000, 4, 5)).toBe(0);
    expect(repairLateFee(10_000, 4, repairDebtDueDay(4))).toBe(1_000);
    expect(repairLateFee(3_000, 4, 9)).toBe(500); // at least ₩500
    expect(repairLateFee(0, 4, 9)).toBe(0);

    const dm = new DeliveryManager(LOCATIONS);
    dm.totalEarnings = 0;
    dm.repairOnCredit(10_000);
    const fees: number[] = [];
    for (let d = 0; d < REPAIR_DEBT_DUE_DAYS + 1; d++) {
      expect(dm.repairDebtDaysLeft).toBe(Math.max(0, REPAIR_DEBT_DUE_DAYS - 1 - d));
      fees.push(dm.clockOut()!.recap.repairLateFee ?? 0);
    }
    expect(fees).toEqual([0, 0, 1_000, 1_100]);
    expect(dm.repairDebt).toBe(12_100);
    expect(dm.messenger.get('notice')!.messages.at(-1)!.text).toContain('연체료 ₩1,100');
    // the terms survive a reload
    const again = new DeliveryManager(LOCATIONS);
    expect(again.repairDebt).toBe(12_100);
    expect(again.repairDebtDaysLeft).toBe(0);
  });
});
