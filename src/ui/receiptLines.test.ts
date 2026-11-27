import { describe, expect, it } from 'vitest';
import { DeliveryManager } from '../delivery/DeliveryManager';
import { DeliveryLocation } from '../types';
import { PHONE_RECEIPT_GROUPS, compactLines, ledgerExpenseLines, ledgerIncomeLines, settlementLines } from './receiptLines';

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
  loc('r1', 300, 0, 'residential', { residenceKind: 'walkup_villa' }),
  loc('r2', 0, 400, 'residential'),
  loc('r3', -350, 0, 'residential'),
];

function deliverOne(dm: DeliveryManager, damage: boolean) {
  const o = dm.availableOrders[0];
  dm.acceptOrder(o.id);
  dm.completePosPickup(o.id, false);
  dm.loadFoodIntoCargoSlot(dm.getFirstEmptyCargoSlot());
  if (damage) dm.applyCrashDamage(true);
  dm.unloadFoodFromCargoSlot(dm.getMissionById(o.id)!.cargoSlot!);
  dm.unlockLobbyDoor(o.id);
  dm.enterCorridor(o.id);
  dm.placeFoodAtDoor();
  const r = dm.completePhotoSettlement()!;
  dm.finishAfterCorridorExit();
  return r;
}

const sum = (lines: { amount: number }[]) => lines.reduce((s, l) => s + l.amount, 0);

describe('receipt lines', () => {
  it('settlement rows always add up to the payout (with and without damage)', () => {
    const dm = new DeliveryManager(LOCATIONS);
    dm.setWeatherRaining(true);
    dm.setNightMode(true);
    for (let i = 0; i < 6; i++) {
      const r = deliverOne(dm, i % 2 === 1);
      expect(sum(settlementLines(r))).toBe(r.earned);
    }
  });

  it('daily ledger rows add up to the net profit, also in the compact phone receipt', () => {
    const dm = new DeliveryManager(LOCATIONS);
    for (let i = 0; i < 4; i++) deliverOne(dm, i === 2);
    dm.applyFine(1000);
    dm.recordFuelExpense(1500);
    dm.recordConvenienceExpense(1200);
    const l = dm.getDailyLedger();
    expect(sum(ledgerIncomeLines(l))).toBe(l.grossIncome);
    expect(-sum(ledgerExpenseLines(l))).toBe(l.totalExpenses);
    const phoneIncome = compactLines(ledgerIncomeLines(l), PHONE_RECEIPT_GROUPS);
    const phoneExpense = compactLines(ledgerExpenseLines(l), PHONE_RECEIPT_GROUPS);
    expect(sum(phoneIncome) + sum(phoneExpense)).toBe(l.netProfit);
    expect(phoneExpense.length).toBeLessThan(ledgerExpenseLines(l).length);
  });
});
