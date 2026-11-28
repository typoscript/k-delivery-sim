import { DeliveryLocation } from '../types';

/**
 * Picks shop/customer pairs that make sense on a city-sized map: a shop near the rider and a customer
 * near that shop. On a single 820m legacy district every location is within these radii, so selection
 * is the same uniform pick as before.
 */

/** Shops offered to the rider: within this distance of the rider */
export const LOCAL_SHOP_RADIUS_M = 900;
/** Customers for a shop: within this distance of the shop (a realistic delivery radius) */
export const LOCAL_CUSTOMER_RADIUS_M = 1100;
/** Customers this close to the shop are skipped when enough farther ones exist (no 20m next-door runs) */
export const MIN_CUSTOMER_DIST_M = 120;
/** If too few locations are inside the radius (e.g. between districts), fall back to the nearest N */
const MIN_CANDIDATES = 3;
const FALLBACK_NEAREST = 5;

function localCandidates<T extends { x: number; z: number }>(items: readonly T[], x: number, z: number, radius: number): T[] {
  const within = items.filter((it) => Math.hypot(it.x - x, it.z - z) <= radius);
  if (within.length >= MIN_CANDIDATES) return within;
  return [...items]
    .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))
    .slice(0, FALLBACK_NEAREST);
}

export function pickLocalShop(
  shops: readonly DeliveryLocation[],
  refX: number,
  refZ: number,
  rand: () => number = Math.random
): DeliveryLocation {
  const pool = localCandidates(shops, refX, refZ, LOCAL_SHOP_RADIUS_M);
  return pool[Math.floor(rand() * pool.length)];
}

/**
 * The stream benches today: `closed` (하천 산책로 통제, flooded) stops their calls; `outing` (🌿 나들이 콜, a clear
 * weekend afternoon) makes them OUTING_WEIGHT times as likely
 */
export const riversideAccess = { closed: false, outing: false };
export const OUTING_WEIGHT = 4;

export function pickLocalCustomer(
  residences: readonly DeliveryLocation[],
  shop: { x: number; z: number },
  rand: () => number = Math.random
): DeliveryLocation {
  let open: readonly DeliveryLocation[] = riversideAccess.closed
    ? residences.filter((r) => r.residenceKind !== 'riverside')
    : residences;
  if (riversideAccess.outing && !riversideAccess.closed) {
    const benches = open.filter((r) => r.residenceKind === 'riverside');
    open = [...open, ...Array.from({ length: OUTING_WEIGHT - 1 }, () => benches).flat()];
  }
  const local = localCandidates(open, shop.x, shop.z, LOCAL_CUSTOMER_RADIUS_M);
  const far = local.filter((r) => Math.hypot(r.x - shop.x, r.z - shop.z) >= MIN_CUSTOMER_DIST_M);
  const pool = far.length >= MIN_CANDIDATES ? far : local;
  return pool[Math.floor(rand() * pool.length)];
}
