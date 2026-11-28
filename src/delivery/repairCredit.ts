/**
 * Repair credit rules (외상 수리): the shop trusts regulars with more, and an unpaid debt gets a late fee.
 * - Limit by garage level: how many times the rider had the scooter repaired here (any repair, paid or credit).
 * - Due: a debt taken on day d is due by the clock-out of day d + REPAIR_DEBT_DUE_DAYS - 1; every clock-out from
 *   then on with debt left adds a late fee (10%, at least ₩500) to the debt.
 * Pure logic, unit tested.
 */

export const REPAIR_DEBT_DUE_DAYS = 3;
export const LATE_FEE_RATE = 0.1;
export const LATE_FEE_MIN = 500;
/** Lifetime counter of repairs done at the shop (garage level) */
export const GARAGE_VISIT_COUNTER = 'garage_visits';

export interface GarageLevel {
  label: string;
  /** Most the shop lets the rider owe */
  limit: number;
  /** Visits needed for the next level (null at the top) */
  nextAt: number | null;
}

const LEVELS = [
  { from: 0, label: '처음 손님', limit: 15_000 },
  { from: 3, label: '🔧 단골', limit: 25_000 },
  { from: 6, label: '🔧⭐ VIP 단골', limit: 40_000 },
] as const;

export function garageLevel(visits: number): GarageLevel {
  let i = 0;
  while (i + 1 < LEVELS.length && visits >= LEVELS[i + 1].from) i++;
  return { label: LEVELS[i].label, limit: LEVELS[i].limit, nextAt: i + 1 < LEVELS.length ? LEVELS[i + 1].from : null };
}

/** Last working day the debt taken on `sinceDay` can be paid back without a late fee */
export const repairDebtDueDay = (sinceDay: number) => sinceDay + REPAIR_DEBT_DUE_DAYS - 1;

/** Late fee added at the clock-out of `closingDay` (0 when nothing is owed or it is not overdue yet) */
export function repairLateFee(debt: number, sinceDay: number, closingDay: number): number {
  if (debt <= 0 || closingDay < repairDebtDueDay(sinceDay)) return 0;
  return Math.max(LATE_FEE_MIN, Math.round((debt * LATE_FEE_RATE) / 100) * 100);
}
