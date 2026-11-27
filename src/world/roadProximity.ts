import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';

/** Road segment as drawn: a ribbon of `width` between two graph nodes (junction discs ≈ the capsule ends) */
export interface RoadSegment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  width: number;
}

const CELL = 40;
/** How far beyond a road edge queries still look (sidewalk strip width) */
export const ROADSIDE_REACH_M = 8;

const cellKey = (cx: number, cz: number) => cx * 73856093 + cz * 19349663;

/**
 * Spatial grid over road segments: how far a point is from the nearest road surface edge.
 * Negative = on the road, small positive = right beside it (the sidewalk strip). Built once, O(1)-ish queries.
 */
export class RoadProximityGrid {
  private readonly cells = new Map<number, number[]>();

  constructor(private readonly segments: readonly RoadSegment[]) {
    segments.forEach((s, i) => {
      const pad = s.width / 2 + ROADSIDE_REACH_M;
      const x0 = Math.floor((Math.min(s.ax, s.bx) - pad) / CELL);
      const x1 = Math.floor((Math.max(s.ax, s.bx) + pad) / CELL);
      const z0 = Math.floor((Math.min(s.az, s.bz) - pad) / CELL);
      const z1 = Math.floor((Math.max(s.az, s.bz) + pad) / CELL);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const k = cellKey(cx, cz);
          let list = this.cells.get(k);
          if (!list) this.cells.set(k, (list = []));
          list.push(i);
        }
      }
    });
  }

  /** Metres from (x, z) to the nearest road surface edge (negative inside a road); Infinity when far from roads */
  public curbOffset(x: number, z: number): number {
    const list = this.cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return Infinity;
    let best = Infinity;
    for (const i of list) {
      const s = this.segments[i];
      const dx = s.bx - s.ax;
      const dz = s.bz - s.az;
      const len2 = dx * dx + dz * dz;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / len2)) : 0;
      const d = Math.hypot(s.ax + dx * t - x, s.az + dz * t - z) - s.width / 2;
      if (d < best) best = d;
    }
    return best;
  }
}

let shared: RoadProximityGrid | null = null;

/** Grid over the active map's road graph (built on first use) */
export function activeRoadProximity(): RoadProximityGrid {
  if (!shared) {
    const nodes = ACTIVE_MAP_DATA.nodes;
    shared = new RoadProximityGrid(
      ACTIVE_MAP_DATA.edges.map((e) => ({ ax: nodes[e.a].x, az: nodes[e.a].z, bx: nodes[e.b].x, bz: nodes[e.b].z, width: e.width }))
    );
  }
  return shared;
}
