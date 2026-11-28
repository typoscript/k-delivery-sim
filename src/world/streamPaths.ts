/**
 * Streams on foot (하천 산책로 · 징검다리): a paved walkway runs along both banks of every stream inside the stone
 * embankment, and rows of stepping stones (징검다리) cross the water every so often. Walking into the water itself is
 * wading - slow - so the stepping stones and bridges are the way across. Pure geometry, unit tested; the chunk
 * builder draws the same walkways and stones.
 */
import type { WaterLineData } from './openworld/OpenWorldTypes';

/** Walkway width on each bank, between the water and the stone embankment */
export const WALKWAY_M = 1.8;
/** A row of stepping stones every this many metres along a stream piece */
export const STONE_ROW_SPACING_M = 120;
/** Gap between stone centres across the water */
export const STONE_STEP_M = 0.95;
/** Half size of a stepping stone's top */
export const STONE_HALF_M = 0.34;
/** No stepping stones this close to a road edge (they would poke through a bridge deck drawn over the water) */
export const STONE_ROAD_CLEARANCE_M = 2;
/** Walking speed while wading in a stream */
export const WADING_SPEED_MUL = 0.4;

export interface SteppingStoneRow {
  /** Stone centres, from one bank to the other */
  stones: Array<[number, number]>;
  /** Direction across the water (unit) */
  ax: number;
  az: number;
}

/**
 * Stepping-stone rows of a stream piece: across the water at every STONE_ROW_SPACING_M of its length (the first one
 * half a spacing in), only on pieces long enough to hold one. Rows are perpendicular to the segment they sit on.
 * `curbOffset` (metres to the nearest road edge, negative on a road) drops rows under or beside a road / bridge.
 */
export function steppingStoneRows(
  wl: WaterLineData,
  curbOffset?: (x: number, z: number) => number,
): SteppingStoneRow[] {
  const rows: SteppingStoneRow[] = [];
  let next = STONE_ROW_SPACING_M / 2;
  let walked = 0;
  let total = 0;
  for (let i = 1; i < wl.pts.length; i++)
    total += Math.hypot(wl.pts[i][0] - wl.pts[i - 1][0], wl.pts[i][1] - wl.pts[i - 1][1]);
  // no row right at the end of the piece (the next piece starts its own rows)
  const last = total - STONE_ROW_SPACING_M / 4;
  for (let i = 1; i < wl.pts.length; i++) {
    const [px, pz] = wl.pts[i - 1];
    const [qx, qz] = wl.pts[i];
    const len = Math.hypot(qx - px, qz - pz);
    if (len < 1e-6) continue;
    const fx = (qx - px) / len;
    const fz = (qz - pz) / len;
    while (next <= walked + len && next <= last) {
      const t = next - walked;
      const cx = px + fx * t;
      const cz = pz + fz * t;
      const ax = -fz;
      const az = fx;
      const n = Math.max(2, Math.round(wl.width / STONE_STEP_M));
      const span = (n - 1) * STONE_STEP_M;
      const stones: Array<[number, number]> = [];
      for (let k = 0; k < n; k++) {
        const o = -span / 2 + k * STONE_STEP_M;
        stones.push([cx + ax * o, cz + az * o]);
      }
      if (!curbOffset || stones.every(([sx, sz]) => curbOffset(sx, sz) >= STONE_ROAD_CLEARANCE_M)) {
        rows.push({ stones, ax, az });
      }
      next += STONE_ROW_SPACING_M;
    }
    walked += len;
  }
  return rows;
}

/** Distance from (x, z) to the centre line of a stream piece */
function distanceToLine(wl: WaterLineData, x: number, z: number): number {
  let best = Infinity;
  for (let i = 1; i < wl.pts.length; i++) {
    const [px, pz] = wl.pts[i - 1];
    const [qx, qz] = wl.pts[i];
    const dx = qx - px;
    const dz = qz - pz;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - px) * dx + (z - pz) * dz) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - (px + dx * t), z - (pz + dz * t)));
  }
  return best;
}

/** Is a walker at (x, z) standing in the water of one of the streams (not on a stepping stone)? */
export function isWadingAt(
  lines: Iterable<WaterLineData>,
  x: number,
  z: number,
  curbOffset?: (x: number, z: number) => number,
): boolean {
  // on a road / bridge over the water: dry
  if (curbOffset && curbOffset(x, z) < 0.3) return false;
  for (const wl of lines) {
    if (distanceToLine(wl, x, z) > wl.width / 2 - 0.15) continue;
    // stones of a row are close enough that the row is one path across (step from stone to stone)
    const onStone = steppingStoneRows(wl, curbOffset).some((r) =>
      r.stones.some(([sx, sz]) => Math.hypot(x - sx, z - sz) <= STONE_STEP_M * 0.8),
    );
    if (!onStone) return true;
  }
  return false;
}

/** Length of a stream piece's centre line */
export function lineLength(wl: WaterLineData): number {
  let len = 0;
  for (let i = 1; i < wl.pts.length; i++) len += Math.hypot(wl.pts[i][0] - wl.pts[i - 1][0], wl.pts[i][1] - wl.pts[i - 1][1]);
  return len;
}

/**
 * Point `s` metres along a stream piece on the walkway of `side` (+1 = left of the flow direction, -1 = right),
 * with the walking direction (unit) along the line
 */
export function walkwayPoint(
  wl: WaterLineData,
  s: number,
  side: number,
): { x: number; z: number; fx: number; fz: number } {
  const off = side * (wl.width / 2 + WALKWAY_M / 2);
  let walked = 0;
  for (let i = 1; i < wl.pts.length; i++) {
    const [px, pz] = wl.pts[i - 1];
    const [qx, qz] = wl.pts[i];
    const len = Math.hypot(qx - px, qz - pz);
    if (len < 1e-6) continue;
    if (s <= walked + len || i === wl.pts.length - 1) {
      const t = Math.max(0, Math.min(1, (s - walked) / len));
      const fx = (qx - px) / len;
      const fz = (qz - pz) / len;
      // left of the walking direction (heading 0 = +Z has +X on its left): left = (fz, 0, -fx)
      return { x: px + (qx - px) * t + fz * off, z: pz + (qz - pz) * t - fx * off, fx, fz };
    }
    walked += len;
  }
  const [x, z] = wl.pts[0];
  return { x, z, fx: 0, fz: 1 };
}

/**
 * The walk from the road to a bench (phone map): from `from` (where the route leaves the road) onto the walkway on
 * the bench's side, along it to the bench, then to `to`. Null when no stream piece runs by the bench.
 */
export function walkwayPath(
  lines: readonly WaterLineData[],
  from: { x: number; z: number },
  to: { x: number; z: number },
): Array<{ x: number; z: number }> | null {
  let best: { wl: WaterLineData; s: number; side: number; d: number } | null = null;
  for (const wl of lines) {
    let walked = 0;
    for (let i = 1; i < wl.pts.length; i++) {
      const [px, pz] = wl.pts[i - 1];
      const [qx, qz] = wl.pts[i];
      const len = Math.hypot(qx - px, qz - pz);
      if (len < 1e-6) continue;
      const fx = (qx - px) / len;
      const fz = (qz - pz) / len;
      const t = Math.max(0, Math.min(len, (to.x - px) * fx + (to.z - pz) * fz));
      const cx = px + fx * t;
      const cz = pz + fz * t;
      const d = Math.hypot(to.x - cx, to.z - cz);
      if (!best || d < best.d) {
        const side = (to.x - cx) * fz + (to.z - cz) * -fx >= 0 ? 1 : -1;
        best = { wl, s: walked + t, side, d };
      }
      walked += len;
    }
  }
  if (!best || best.d > best.wl.width / 2 + WALKWAY_M + 4) return null;
  // where `from` meets the same walkway
  const { wl, side } = best;
  let fromS = 0;
  let fromD = Infinity;
  const len = lineLength(wl);
  for (let s = 0; s <= len; s += 2) {
    const p = walkwayPoint(wl, s, side);
    const d = Math.hypot(p.x - from.x, p.z - from.z);
    if (d < fromD) {
      fromD = d;
      fromS = s;
    }
  }
  const out: Array<{ x: number; z: number }> = [{ x: from.x, z: from.z }];
  const dir = best.s >= fromS ? 1 : -1;
  for (let s = fromS; dir > 0 ? s < best.s : s > best.s; s += dir * 6) {
    const p = walkwayPoint(wl, s, side);
    out.push({ x: p.x, z: p.z });
  }
  const end = walkwayPoint(wl, best.s, side);
  out.push({ x: end.x, z: end.z }, { x: to.x, z: to.z });
  return out;
}

