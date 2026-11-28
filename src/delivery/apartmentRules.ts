/**
 * Apartment complex rules. Like many real Korean complexes, some ban vehicles above ground ("지상 차량 출입 금지"):
 * the rider leaves the scooter outside the complex and walks the food in, and is paid a walking allowance for it.
 * Decided per complex (every 동 of a complex shares the rule), deterministic from its name.
 */
import type { DeliveryLocation } from '../types';

/** Walking allowance for a no-vehicle complex, paid when the scooter was left outside */
export const NO_GROUND_WALK_BONUS = 700;
/** Scooter parked closer than this to the lobby = ridden into the complex */
export const NO_GROUND_PARK_LIMIT_M = 18;
/** Share of complexes with the rule (percent) */
const NO_GROUND_SHARE_PCT = 35;

/** "주공2단지아파트 206동" -> "주공2단지아파트" (the 동 number dropped) */
export function complexKeyOf(name: string): string {
  return name.replace(/\s*[0-9A-Za-z-]+동$/, '').trim() || name;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** True for an apartment whose complex bans vehicles above ground */
export function isNoGroundVehicleComplex(loc: Pick<DeliveryLocation, 'name' | 'residenceKind' | 'type'>): boolean {
  if (loc.type !== 'residential' || (loc.residenceKind ?? 'apartment') !== 'apartment') return false;
  return hashString(complexKeyOf(loc.name)) % 100 < NO_GROUND_SHARE_PCT;
}

/** Whether the scooter (where it stands now) counts as ridden into the complex of this lobby */
export function scooterInsideComplex(lobbyX: number, lobbyZ: number, scooterX: number, scooterZ: number): boolean {
  return Math.hypot(scooterX - lobbyX, scooterZ - lobbyZ) < NO_GROUND_PARK_LIMIT_M;
}

/** Short tag for call cards: '🚫지상X 도보+700' (empty for other places) */
export function noGroundTagHtml(loc: Pick<DeliveryLocation, 'name' | 'residenceKind' | 'type'>): string {
  return isNoGroundVehicleComplex(loc)
    ? `<span class="villa-tag no-ground-tag">🚫지상 차량X 도보+${NO_GROUND_WALK_BONUS}</span>`
    : '';
}
