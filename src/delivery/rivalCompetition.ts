/**
 * Rival delivery riders compete for calls near them: a rival close to an offer's shop takes the offer if the
 * rider waits too long, and calls on the [콜 목록] board near a rival disappear now and then. Pure logic, unit tested.
 */

/** A rival this close to an order's shop competes for it */
export const RIVAL_CONTEST_RADIUS_M = 300;
/** Seconds into a contested offer before the rival takes it: a rival at the shop / at the contest radius */
export const RIVAL_SNATCH_MIN_SEC = 7;
export const RIVAL_SNATCH_MAX_SEC = 15;
/** How often the call board is checked, and the chance a contested call is taken per check */
export const BOARD_CHECK_SEC = 15;
export const BOARD_TAKE_CHANCE = 0.3;

export interface RivalPosition {
  id: string;
  x: number;
  z: number;
}

export interface RivalContest {
  rivalId: string;
  /** Rival's distance to the shop (m) */
  distM: number;
}

/**
 * Nearest rival within RIVAL_CONTEST_RADIUS_M of the shop at (x, z) that is also closer to it than the player
 * (a rival further away than you could not get there first), if any.
 */
export function contestingRival(
  rivals: readonly RivalPosition[],
  x: number,
  z: number,
  player?: { x: number; z: number }
): RivalContest | null {
  const playerDist = player ? Math.hypot(player.x - x, player.z - z) : Infinity;
  let best: RivalContest | null = null;
  for (const r of rivals) {
    const d = Math.hypot(r.x - x, r.z - z);
    if (d <= RIVAL_CONTEST_RADIUS_M && d < playerDist && (!best || d < best.distM)) best = { rivalId: r.id, distM: d };
  }
  return best;
}

/** Seconds a contested offer stays open before the rival takes it (closer rival -> sooner) */
export function snatchDelaySec(distM: number): number {
  const t = Math.min(1, Math.max(0, distM / RIVAL_CONTEST_RADIUS_M));
  return RIVAL_SNATCH_MIN_SEC + (RIVAL_SNATCH_MAX_SEC - RIVAL_SNATCH_MIN_SEC) * t;
}

/**
 * One call-board check: the id of a contested call a rival takes now (at most one per check), or null.
 * `rand` is called once per contested call.
 */
export function pickBoardCallTaken(
  orders: ReadonlyArray<{ id: string; shop: { x: number; z: number } }>,
  rivals: readonly RivalPosition[],
  rand: () => number = Math.random,
  player?: { x: number; z: number }
): string | null {
  for (const o of orders) {
    if (!contestingRival(rivals, o.shop.x, o.shop.z, player)) continue;
    if (rand() < BOARD_TAKE_CHANCE) return o.id;
  }
  return null;
}
