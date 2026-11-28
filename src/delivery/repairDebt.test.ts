// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { DeliveryManager } from './DeliveryManager';
import { loadRiderCareer } from './RiderCareer';
import { DeliveryLocation } from '../types';

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
    expect(dm.repairOnCredit(10_000)).toBe(true);
    expect(dm.totalEarnings).toBe(50);
    expect(dm.repairDebt).toBe(7_000);
    expect(dm.repairExpense).toBe(3_000);
    expect(dm.repairOnCredit(10_000)).toBe(false); // still owing
  });

  it("settlements pay the debt back (as today's repair expense) and it survives a reload", () => {
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
    expect(dm.repairExpense).toBe(9_000);
    expect(loadRiderCareer().repairDebt).toBeUndefined();
    expect(dm.repayRepairDebt(6_000)).toBe(0);
  });
});
