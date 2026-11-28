/**
 * Apartment complex rules. Like many real Korean complexes, some ban vehicles above ground ("지상 차량 출입 금지"):
 * the rider leaves the scooter outside the complex and walks the food in, and is paid a walking allowance for it.
 * Decided per complex (every 동 of a complex shares the rule), deterministic from its name and where it is: Suwon has
 * many complexes with the same name ("현대아파트"), so lobbies sharing a name only form one complex when they stand
 * close together (`indexComplexes`).
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

/** Lobbies with the same complex name this close (chained) belong to one complex */
export const COMPLEX_LINK_M = 350;

/** location id -> its complex key (name + where the complex is); filled by indexComplexes */
const complexOfLocation = new Map<string, string>();
const indexedLists = new WeakSet<readonly DeliveryLocation[]>();

/**
 * Groups apartment lobbies into complexes: same complex name and chained within COMPLEX_LINK_M of each other. The
 * key carries the position of the group's first lobby (by id), so two far-apart "현대아파트" get their own rule.
 * Idempotent; call with the map's location list before asking isNoGroundVehicleComplex.
 */
export function indexComplexes(locations: readonly DeliveryLocation[]): void {
  if (indexedLists.has(locations)) return;
  indexedLists.add(locations);
  const byName = new Map<string, DeliveryLocation[]>();
  for (const l of locations) {
    if (l.type !== 'residential' || (l.residenceKind ?? 'apartment') !== 'apartment') continue;
    const key = complexKeyOf(l.name);
    const list = byName.get(key);
    if (list) list.push(l);
    else byName.set(key, [l]);
  }
  for (const [name, list] of byName) {
    const sorted = [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const parent = sorted.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < sorted.length; i++)
      for (let j = i + 1; j < sorted.length; j++)
        if (Math.hypot(sorted[i].x - sorted[j].x, sorted[i].z - sorted[j].z) <= COMPLEX_LINK_M) {
          const a = find(i);
          const b = find(j);
          if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
        }
    sorted.forEach((l, i) => {
      const root = sorted[find(i)];
      complexOfLocation.set(l.id, `${name}@${Math.round(root.x)},${Math.round(root.z)}`);
    });
  }
}

/** The complex a lobby belongs to (name only when its list was never indexed) */
export function complexIdOf(loc: Pick<DeliveryLocation, 'name'> & Partial<Pick<DeliveryLocation, 'id'>>): string {
  return (loc.id !== undefined && complexOfLocation.get(loc.id)) || complexKeyOf(loc.name);
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** True for an apartment whose complex bans vehicles above ground */
export function isNoGroundVehicleComplex(
  loc: Pick<DeliveryLocation, 'name' | 'residenceKind' | 'type'> & Partial<Pick<DeliveryLocation, 'id'>>,
): boolean {
  if (loc.type !== 'residential' || (loc.residenceKind ?? 'apartment') !== 'apartment') return false;
  return hashString(complexIdOf(loc)) % 100 < NO_GROUND_SHARE_PCT;
}

/** Whether the scooter (where it stands now) counts as ridden into the complex of this lobby */
export function scooterInsideComplex(lobbyX: number, lobbyZ: number, scooterX: number, scooterZ: number): boolean {
  return Math.hypot(scooterX - lobbyX, scooterZ - lobbyZ) < NO_GROUND_PARK_LIMIT_M;
}

/** Short tag for call cards: '🚫지상X 도보+700' (empty for other places) */
export function noGroundTagHtml(
  loc: Pick<DeliveryLocation, 'name' | 'residenceKind' | 'type'> & Partial<Pick<DeliveryLocation, 'id'>>,
): string {
  return isNoGroundVehicleComplex(loc)
    ? `<span class="villa-tag no-ground-tag">🚫지상 차량X 도보+${NO_GROUND_WALK_BONUS}</span>`
    : '';
}
