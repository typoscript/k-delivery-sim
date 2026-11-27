import { RiderTierSpec } from './RiderCareer';
import { SHIFT_LEDGER_KEYS, ShiftLedger } from './ShiftDay';
import { DailyFinanceLedger, FineKind } from './deliveryTypes';

/** Ledger keys that are income (everything else in the shift ledger except the counts is an expense) */
const INCOME_KEYS = [
  'baseFeeTotal',
  'distanceBonusTotal',
  'rainBonusTotal',
  'nightBonusTotal',
  'peakBonusTotal',
  'specialBonusTotal',
  'tierBonusTotal',
  'tipTotal',
  'missionBonusTotal',
] as const satisfies readonly (keyof ShiftLedger)[];

const EXPENSE_KEYS = [
  'damageDeductionTotal',
  'fuelExpense',
  'repairExpense',
  'upgradeExpense',
  'convenienceExpense',
  'fineExpense',
] as const satisfies readonly (keyof ShiftLedger)[];

export interface LedgerContext {
  shiftDay: number;
  walletBalance: number;
  lifetimeCompleted: number;
  riderTier: RiderTierSpec;
  riderRating: number;
  fines: Record<FineKind, number>;
}

/** Copies the shift ledger fields off any object that carries them (DeliveryManager keeps them as fields) */
export function pickShiftLedger(src: Readonly<ShiftLedger>): ShiftLedger {
  const out = {} as ShiftLedger;
  for (const k of SHIFT_LEDGER_KEYS) out[k] = src[k];
  return out;
}

/** The day's finance statement: itemized totals, gross income, expenses and net profit */
export function buildDailyLedger(l: Readonly<ShiftLedger>, ctx: LedgerContext): DailyFinanceLedger {
  const grossIncome = INCOME_KEYS.reduce((sum, k) => sum + l[k], 0);
  const totalExpenses = EXPENSE_KEYS.reduce((sum, k) => sum + l[k], 0);
  return {
    ...pickShiftLedger(l),
    shiftDay: ctx.shiftDay,
    grossIncome,
    totalExpenses,
    netProfit: grossIncome - totalExpenses,
    walletBalance: ctx.walletBalance,
    lifetimeCompleted: ctx.lifetimeCompleted,
    riderTier: ctx.riderTier,
    riderRating: ctx.riderRating,
    fines: { ...ctx.fines },
  };
}
