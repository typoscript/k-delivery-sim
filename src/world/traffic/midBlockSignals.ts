/**
 * Mid-block crosswalk signals (도로 중간 신호 횡단보도): the OSM crosswalks with their own lights get a car signal
 * and a walk signal. Each runs its own cycle - cars green, yellow, then red while people walk - offset per crossing
 * so they do not all switch together. Cars stop at the stop line on red / yellow, pedestrians wait for the walk light
 * and the riding player running the red gets the same violation as at a junction. Pure timing and lookups, unit
 * tested; TrafficSystem advances the shared clock and draws the lamps.
 */
import { ACTIVE_MAP_DATA } from '../../data/suwonDistricts';
import type { SignalColor } from '../TrafficSystem';

export const MID_CYCLE_SEC = 34;
/** Cars: green, then yellow; then red (walk) for the rest of the cycle */
export const MID_CAR_GREEN_SEC = 22;
export const MID_CAR_YELLOW_SEC = 3;
/** Stop line this far before the crosswalk centre */
export const MID_STOP_OFFSET_M = 2.6;

export interface MidBlockCrossing {
  x: number;
  z: number;
  /** Road heading and width (from the map data) */
  h: number;
  w: number;
  /** Cycle offset (s) */
  offset: number;
}

/** The signalized mid-block crossings, in map order (their index is their id) */
export const MID_BLOCK_CROSSINGS: readonly MidBlockCrossing[] = (ACTIVE_MAP_DATA.crossings ?? [])
  .filter((c) => c.sig)
  .map((c, i) => ({ x: c.x, z: c.z, h: c.h, w: c.w, offset: ((i * 7919) % 97) / 97 * MID_CYCLE_SEC }));

export interface MidBlockPhase {
  car: SignalColor;
  walk: boolean;
  /** Seconds until the next change */
  remaining: number;
}

export function midBlockPhase(t: number, offset: number): MidBlockPhase {
  const c = (((t + offset) % MID_CYCLE_SEC) + MID_CYCLE_SEC) % MID_CYCLE_SEC;
  if (c < MID_CAR_GREEN_SEC) return { car: 'green', walk: false, remaining: MID_CAR_GREEN_SEC - c };
  if (c < MID_CAR_GREEN_SEC + MID_CAR_YELLOW_SEC)
    return { car: 'yellow', walk: false, remaining: MID_CAR_GREEN_SEC + MID_CAR_YELLOW_SEC - c };
  return { car: 'red', walk: true, remaining: MID_CYCLE_SEC - c };
}

/** The shared clock of the mid-block signals (TrafficSystem sets it every frame from its game time) */
let clockSec = 0;
export function setMidBlockClock(t: number): void {
  clockSec = t;
}
export function midBlockPhaseNow(index: number): MidBlockPhase {
  const c = MID_BLOCK_CROSSINGS[index];
  return midBlockPhase(clockSec, c ? c.offset : 0);
}

/** Index of the signalized crossing at (x, z) (within `radius`), or -1 */
export function midBlockAt(x: number, z: number, radius = 3): number {
  for (let i = 0; i < MID_BLOCK_CROSSINGS.length; i++) {
    const c = MID_BLOCK_CROSSINGS[i];
    if (Math.abs(c.x - x) < radius && Math.abs(c.z - z) < radius && Math.hypot(c.x - x, c.z - z) < radius) return i;
  }
  return -1;
}

/** Road edge key (unordered node pair) */
const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Per road edge: the signalized crossings on it as { index, s = distance from node `a` of the edge } */
const byEdge = new Map<string, { a: number; list: Array<{ index: number; s: number }> }>();
{
  const nodes = ACTIVE_MAP_DATA.nodes;
  MID_BLOCK_CROSSINGS.forEach((c, index) => {
    let best: { e: (typeof ACTIVE_MAP_DATA.edges)[number]; s: number; d: number } | null = null;
    for (const e of ACTIVE_MAP_DATA.edges) {
      const a = nodes[e.a];
      const b = nodes[e.b];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const l2 = dx * dx + dz * dz;
      if (l2 < 1e-6) continue;
      const t = ((c.x - a.x) * dx + (c.z - a.z) * dz) / l2;
      if (t < 0 || t > 1) continue;
      const d = Math.hypot(c.x - (a.x + dx * t), c.z - (a.z + dz * t));
      if (d < 1.5 && (!best || d < best.d)) best = { e, s: t * Math.sqrt(l2), d };
    }
    if (!best) return;
    const k = key(best.e.a, best.e.b);
    const entry = byEdge.get(k) ?? { a: best.e.a, list: [] };
    entry.list.push({ index, s: best.s });
    byEdge.set(k, entry);
  });
}

/**
 * The signalized crossings ahead of a car on edge from -> to (length `edgeDist`) at `progress` metres from `from`:
 * their indices and the distance to their stop lines
 */
export function midBlockAhead(
  from: number,
  to: number,
  edgeDist: number,
  progress: number,
): Array<{ index: number; stopDist: number }> {
  const entry = byEdge.get(key(from, to));
  if (!entry) return [];
  const out: Array<{ index: number; stopDist: number }> = [];
  for (const c of entry.list) {
    const fromStart = entry.a === from ? c.s : edgeDist - c.s;
    const stopDist = fromStart - progress - MID_STOP_OFFSET_M;
    if (stopDist > -1) out.push({ index: c.index, stopDist });
  }
  return out;
}
