/** Money going out: traffic tickets, fines, pedestrian accident penalty and fuel / repair / store expenses */
import type { DeliveryManager } from './DeliveryManager';
import { FineKind, PEDESTRIAN_ACCIDENT_FINE, PEDESTRIAN_RATING_PENALTY, fineCounterKey } from './deliveryTypes';

/** Ticket written by a patrol (red light / sidewalk): fine + rider trust rating penalty */
export function applyTrafficTicket(
  host: DeliveryManager,
  fine: number,
  ratingPenalty: number,
  kind: FineKind,
): { fine: number; newRating: number } {
  host.applyFine(fine, kind);
  host.riderRating = Math.max(0, Math.round((host.riderRating - ratingPenalty) * 10) / 10);
  host.persistCareer();
  return { fine, newRating: host.riderRating };
}

/** Fine paid from the wallet; `kind` sorts it on the daily statement (untyped fines show as 기타) */
export function applyFine(host: DeliveryManager, amount: number, kind?: FineKind): number {
  host.fineExpense += amount;
  if (kind) host.progress.bump(fineCounterKey(kind), amount);
  host.totalEarnings -= amount;
  host.persistCareer();
  return amount;
}

/**
 * Applies pedestrian collision accident penalties:
 * - Immediately deducts -₩50,000 fine & settlement from player wallet balance (and daily ledger)
 * - Deducts 1.0 point from Rider Trust Rating (min 0.0)
 */
export function applyPedestrianAccidentPenalty(host: DeliveryManager): {
  fine: number;
  ratingLoss: number;
  newRating: number;
  newBalance: number;
} {
  const fine = host.applyFine(PEDESTRIAN_ACCIDENT_FINE, 'pedestrian');
  host.pedestrianAccidentCount += 1;
  const prevRating = host.riderRating;
  host.riderRating = Math.max(0, Math.round((host.riderRating - PEDESTRIAN_RATING_PENALTY) * 10) / 10);
  host.persistCareer();
  return {
    fine,
    ratingLoss: Math.round((prevRating - host.riderRating) * 10) / 10,
    newRating: host.riderRating,
    newBalance: host.totalEarnings,
  };
}

export function recordFuelExpense(host: DeliveryManager, amount: number): void {
  const rounded = Math.max(0, Math.round(amount / 100) * 100);
  host.fuelExpense += rounded;
  host.totalEarnings -= rounded;
  host.persistCareer();
}

export function recordRepairExpense(host: DeliveryManager, amount: number): void {
  const rounded = Math.max(0, Math.round(amount / 100) * 100);
  host.repairExpense += rounded;
  host.totalEarnings -= rounded;
  host.persistCareer();
}

export function recordConvenienceExpense(host: DeliveryManager, amount: number): void {
  const rounded = Math.max(0, Math.round(amount / 100) * 100);
  host.convenienceExpense += rounded;
  host.totalEarnings -= rounded;
  host.persistCareer();
}
