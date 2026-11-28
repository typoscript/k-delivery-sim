/**
 * Riding hazard alerts: a red / yellow light for our direction, or a pedestrian in our path, within stopping
 * distance. New riders spawn 12m before a signal that is red at first; without a warning the first throttle runs
 * the light straight into people on the crosswalk. Pure logic (the caller passes signals / pedestrians), unit tested.
 */

/** Alerts only above this speed (rolling off at walking pace is fine) */
export const ALERT_MIN_KMH = 8;
/** Comfortable braking used for the stopping distance (m/s²) and the extra margin (m) */
export const ALERT_DECEL = 5.5;
export const ALERT_MARGIN_M = 8;
export const ALERT_MAX_DIST_M = 45;
/** Half width of the path a pedestrian must be in (scooter + body + margin) */
export const PATH_HALF_WIDTH_M = 1.6;
/** Same alert again only after this long */
export const ALERT_COOLDOWN_SEC = 4;

export type SignalColor = 'green' | 'yellow' | 'red';

export interface RiderPose {
  x: number;
  z: number;
  heading: number;
  /** m/s along the heading */
  speed: number;
}

/** Distance ahead within which a hazard is worth a warning at this speed */
export function warnDistance(speedMps: number): number {
  return Math.min(ALERT_MAX_DIST_M, (speedMps * speedMps) / (2 * ALERT_DECEL) + ALERT_MARGIN_M);
}

/** Position of (x, z) in the rider's frame: along the heading and to the side */
function toRiderFrame(p: RiderPose, x: number, z: number): { along: number; side: number } {
  const fx = Math.sin(p.heading);
  const fz = Math.cos(p.heading);
  const dx = x - p.x;
  const dz = z - p.z;
  return { along: dx * fx + dz * fz, side: dx * -fz + dz * fx };
}

export interface SignalAhead {
  id: number;
  x: number;
  z: number;
  /** Light for our direction of travel through this junction */
  color: SignalColor;
}

/** Nearest red / yellow junction ahead within the warning distance (its distance), else null */
export function redLightAhead(p: RiderPose, signals: readonly SignalAhead[]): number | null {
  const range = warnDistance(p.speed);
  let best: number | null = null;
  for (const s of signals) {
    if (s.color === 'green') continue;
    const { along, side } = toRiderFrame(p, s.x, s.z);
    // Junction centre ahead of us, roughly on our road (signal nodes sit at the junction centre)
    if (along < 3 || along > range || Math.abs(side) > 9) continue;
    if (best === null || along < best) best = along;
  }
  return best;
}

/** Nearest pedestrian in our path within the warning distance (its distance), else null */
export function pedestrianAhead(p: RiderPose, pedestrians: ReadonlyArray<{ x: number; z: number; visible?: boolean }>): number | null {
  const range = warnDistance(p.speed);
  let best: number | null = null;
  for (const a of pedestrians) {
    if (a.visible === false) continue;
    const { along, side } = toRiderFrame(p, a.x, a.z);
    if (along < 1 || along > range || Math.abs(side) > PATH_HALF_WIDTH_M) continue;
    if (best === null || along < best) best = along;
  }
  return best;
}

export type RiderAlert = { kind: 'red_light' | 'pedestrian'; distance: number };

/** Decides which alert to show this frame (pedestrians first), each kind at most once per cooldown */
export class RiderAlertMonitor {
  private cooldown = { red_light: 0, pedestrian: 0 };

  public step(
    dt: number,
    riding: boolean,
    p: RiderPose,
    signals: readonly SignalAhead[],
    pedestrians: ReadonlyArray<{ x: number; z: number; visible?: boolean }>
  ): RiderAlert | null {
    this.cooldown.red_light = Math.max(0, this.cooldown.red_light - dt);
    this.cooldown.pedestrian = Math.max(0, this.cooldown.pedestrian - dt);
    if (!riding || p.speed * 3.6 < ALERT_MIN_KMH) return null;
    if (this.cooldown.pedestrian <= 0) {
      const d = pedestrianAhead(p, pedestrians);
      if (d !== null) {
        this.cooldown.pedestrian = ALERT_COOLDOWN_SEC;
        return { kind: 'pedestrian', distance: d };
      }
    }
    if (this.cooldown.red_light <= 0) {
      const d = redLightAhead(p, signals);
      if (d !== null) {
        this.cooldown.red_light = ALERT_COOLDOWN_SEC;
        return { kind: 'red_light', distance: d };
      }
    }
    return null;
  }
}

/** Stopped for a red light: below this speed before reaching the junction */
export const SAFE_STOP_KMH = 3;
/** Slowed for a pedestrian: below this speed before reaching them */
export const SAFE_YIELD_KMH = 10;
/** A warning is followed for this long at most */
export const SAFE_STOP_WINDOW_SEC = 8;
/** The same spot does not count twice within this distance / time (no creeping-and-stopping farming) */
export const SAFE_STOP_REPEAT_M = 30;
export const SAFE_STOP_REPEAT_SEC = 40;

export type SafeStopKind = 'safe_stop' | 'safe_yield';

/**
 * Follows each warning: braking to a stop before the red-light junction (or slowing down before the pedestrian)
 * counts as a safe stop; riding past it or crashing drops the warning. Pure logic (dt-driven), unit tested.
 */
export class SafeStopTracker {
  private watch: { kind: RiderAlert['kind']; x: number; z: number; fx: number; fz: number; distance: number; t: number } | null = null;
  private last: { x: number; z: number; t: number } | null = null;
  private time = 0;

  /** Starts following a warning that was just shown */
  public onAlert(alert: RiderAlert, p: RiderPose): void {
    this.watch = { kind: alert.kind, x: p.x, z: p.z, fx: Math.sin(p.heading), fz: Math.cos(p.heading), distance: alert.distance, t: 0 };
  }

  /** Returns a safe stop / yield the moment it happens, else null */
  public step(dt: number, p: RiderPose, crashed: boolean): SafeStopKind | null {
    this.time += dt;
    const w = this.watch;
    if (!w) return null;
    w.t += dt;
    const along = (p.x - w.x) * w.fx + (p.z - w.z) * w.fz;
    if (crashed || w.t > SAFE_STOP_WINDOW_SEC || along > w.distance) {
      this.watch = null; // rode past it / crashed / took too long
      return null;
    }
    const limitKmh = w.kind === 'red_light' ? SAFE_STOP_KMH : SAFE_YIELD_KMH;
    if (Math.abs(p.speed) * 3.6 >= limitKmh) return null;
    this.watch = null;
    const l = this.last;
    if (l && this.time - l.t < SAFE_STOP_REPEAT_SEC && Math.hypot(p.x - l.x, p.z - l.z) < SAFE_STOP_REPEAT_M) return null;
    this.last = { x: p.x, z: p.z, t: this.time };
    return w.kind === 'red_light' ? 'safe_stop' : 'safe_yield';
  }
}
