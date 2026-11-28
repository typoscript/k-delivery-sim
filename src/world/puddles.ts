/**
 * Rain puddles (물웅덩이): while it rains, water pools by the curb here and there - many more spots during 장마.
 * Riding through one at speed drags the scooter down and splashes. Spots are picked per working day from the road
 * graph (deterministic hash), kept in a grid; the world draws only the puddles around the player.
 */
import type { OsmGraphEdge, OsmGraphNode } from '../data/suwonTypes';

export interface Puddle {
  id: number;
  x: number;
  z: number;
  radius: number;
}

/** Share of road segments with a puddle on a rainy day, and during 장마 */
export const PUDDLE_CHANCE = 0.05;
export const MONSOON_PUDDLE_CHANCE = 0.14;
const CELL_M = 100;

function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x7f4a7c15, 0x85ebca6b) ^ Math.imul(b + 0x165667b1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x27d4eb2f);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/** Puddles of a working day: by the curb of the right-hand lane (either direction), away from the junctions */
export function planPuddles(
  nodes: readonly OsmGraphNode[],
  edges: readonly OsmGraphEdge[],
  day: number,
  monsoon: boolean,
): Puddle[] {
  const chance = monsoon ? MONSOON_PUDDLE_CHANCE : PUDDLE_CHANCE;
  const out: Puddle[] = [];
  edges.forEach((e, i) => {
    // underpasses are drained and covered; very short links get none
    if (e.tunnel || e.dist < 25 || hash01(i, day) >= chance) return;
    const a = nodes[e.a];
    const b = nodes[e.b];
    const t = 0.2 + hash01(i, day + 31) * 0.6;
    const dx = (b.x - a.x) / e.dist;
    const dz = (b.z - a.z) / e.dist;
    // right of the travel direction is (-dz, dx)... forward x up = (-fz, 0, fx); pick a side, stay ~1.4 m off the curb
    const side = hash01(i, day + 67) < 0.5 ? 1 : -1;
    const off = (e.width / 2 - 1.4) * side;
    out.push({
      id: i,
      x: a.x + (b.x - a.x) * t - dz * off,
      z: a.z + (b.z - a.z) * t + dx * off,
      radius: 1.3 + hash01(i, day + 97) * 1.2,
    });
  });
  return out;
}

export class PuddleField {
  public readonly puddles: Puddle[] = [];
  private readonly grid = new Map<string, Puddle[]>();
  private key = '';
  /** Bumped whenever the set of puddles changes (the world redraws them) */
  public version = 0;
  /** The last puddle the rider splashed through (one splash per puddle) */
  public splashedId = -1;

  constructor(
    private readonly nodes: readonly OsmGraphNode[],
    private readonly edges: readonly OsmGraphEdge[],
  ) {}

  /** Puddles for `day` while `raining` (more during 장마); cheap when nothing changed */
  public set(day: number, raining: boolean, monsoon: boolean): void {
    const key = raining ? `${day}|${monsoon}` : '';
    if (key === this.key) return;
    this.key = key;
    this.version++;
    this.puddles.length = 0;
    this.grid.clear();
    if (!raining) return;
    for (const p of planPuddles(this.nodes, this.edges, day, monsoon)) {
      this.puddles.push(p);
      const k = `${Math.floor(p.x / CELL_M)},${Math.floor(p.z / CELL_M)}`;
      const list = this.grid.get(k);
      if (list) list.push(p);
      else this.grid.set(k, [p]);
    }
  }

  /** The puddle under (x, z), or null */
  public puddleAt(x: number, z: number): Puddle | null {
    const list = this.grid.get(`${Math.floor(x / CELL_M)},${Math.floor(z / CELL_M)}`);
    if (!list) return null;
    for (const p of list) if ((p.x - x) ** 2 + (p.z - z) ** 2 <= p.radius * p.radius) return p;
    return null;
  }

  /** Puddles within `range` of (x, z) (for drawing) */
  public near(x: number, z: number, range: number): Puddle[] {
    const out: Puddle[] = [];
    const r = Math.ceil(range / CELL_M);
    const cx = Math.floor(x / CELL_M);
    const cz = Math.floor(z / CELL_M);
    for (let ix = cx - r; ix <= cx + r; ix++)
      for (let iz = cz - r; iz <= cz + r; iz++)
        for (const p of this.grid.get(`${ix},${iz}`) ?? []) if (Math.hypot(p.x - x, p.z - z) <= range) out.push(p);
    return out;
  }
}
