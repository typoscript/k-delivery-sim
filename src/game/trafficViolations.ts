/**
 * Rider traffic violations beyond speeding: running a red light and riding on the sidewalk.
 * A patrol car close enough to see it writes a full ticket (fine + rider rating); otherwise the rider only
 * gets a warning (red lights keep their small automatic penalty). Pure logic, unit tested.
 */

/** 이륜차 신호위반 · 보도 통행 범칙금 */
export const RED_LIGHT_TICKET_FINE = 40000;
export const SIDEWALK_TICKET_FINE = 40000;
/** Rider trust rating lost per ticket written by a patrol */
export const TICKET_RATING_PENALTY = 0.1;
/** A patrol car within this distance witnesses the violation */
export const PATROL_WITNESS_RADIUS_M = 45;

/** Sidewalk strip: beyond the road edge by more than this (kerb / parking margin) ... */
export const SIDEWALK_MIN_OFFSET_M = 0.8;
/** ... and not further than this (open squares, lots and plazas are not "the sidewalk") */
export const SIDEWALK_MAX_OFFSET_M = 6;
/** Riding faster than this on the sidewalk counts (walking the scooter in to park does not) */
export const SIDEWALK_MIN_KMH = 12;
/** Must keep riding on the sidewalk this long before it counts */
export const SIDEWALK_GRACE_SEC = 1.5;
export const SIDEWALK_COOLDOWN_SEC = 15;

export function isSidewalkOffset(curbOffset: number): boolean {
  return curbOffset > SIDEWALK_MIN_OFFSET_M && curbOffset <= SIDEWALK_MAX_OFFSET_M;
}

export interface SidewalkInput {
  isRiding: boolean;
  crashed: boolean;
  speedKmh: number;
  /** Metres beyond the nearest road surface edge (negative on the road) */
  curbOffset: number;
  /** Near a spot where riding off the road is normal (gas station forecourt) */
  exempt?: boolean;
}

/** Fires once per stretch of sidewalk riding (after a short grace), then waits out a cooldown */
export class SidewalkRidingMonitor {
  private onSidewalkSec = 0;
  private cooldown = 0;
  private fired = false;

  public step(dt: number, i: SidewalkInput): boolean {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const riding = i.isRiding && !i.crashed && !i.exempt && i.speedKmh >= SIDEWALK_MIN_KMH && isSidewalkOffset(i.curbOffset);
    if (!riding) {
      this.onSidewalkSec = 0;
      this.fired = false;
      return false;
    }
    this.onSidewalkSec += dt;
    if (this.fired || this.cooldown > 0 || this.onSidewalkSec < SIDEWALK_GRACE_SEC) return false;
    this.fired = true;
    this.cooldown = SIDEWALK_COOLDOWN_SEC;
    return true;
  }
}

export interface PatrolPosition {
  id: string;
  x: number;
  z: number;
}

/** Nearest patrol car within the witness radius, if any */
export function findWitness<T extends PatrolPosition>(patrols: readonly T[], x: number, z: number): T | null {
  let best: T | null = null;
  let bestD = PATROL_WITNESS_RADIUS_M;
  for (const p of patrols) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d <= bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}
