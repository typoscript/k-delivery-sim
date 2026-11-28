/**
 * Winter black ice (블랙아이스): on winter nights and early mornings a few shaded spots - quiet residential alleys,
 * living streets and on/off ramps - freeze into invisible ice. Riding over one is like braking on a wet manhole:
 * almost no grip. Spots are picked per working day from the road graph (deterministic hash, different every day),
 * kept in a coarse grid for quick lookups; the phone map and a warning toast show the ones nearby.
 */
import type { OsmGraphEdge, OsmGraphNode } from '../data/suwonTypes';

export interface IcePatch {
  id: number;
  x: number;
  z: number;
  radius: number;
}

/** Share of road segments that freeze over, by road type (shaded side streets and ramps most) */
const FREEZE_CHANCE: Record<string, number> = {
  living_street: 0.09,
  residential: 0.04,
  unclassified: 0.04,
  primary_link: 0.12,
  secondary_link: 0.12,
  tertiary_link: 0.12,
};
const CELL_M = 100;

function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x27d4eb2f);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/** The frozen spots of a working day: one patch somewhere along each frozen segment */
export function planBlackIce(nodes: readonly OsmGraphNode[], edges: readonly OsmGraphEdge[], day: number): IcePatch[] {
  const out: IcePatch[] = [];
  edges.forEach((e, i) => {
    const chance = FREEZE_CHANCE[e.highway] ?? 0;
    if (chance === 0 || e.dist < 20 || hash01(i, day) >= chance) return;
    const a = nodes[e.a];
    const b = nodes[e.b];
    const t = 0.25 + hash01(i, day + 7919) * 0.5;
    out.push({
      id: i,
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      radius: Math.min(7, Math.max(3.5, e.width * 0.7)),
    });
  });
  return out;
}

/** True on winter nights / early mornings, when the shaded spots freeze */
export function blackIceActive(season: string, night: boolean, minuteOfDay: number): boolean {
  return season === 'winter' && (night || minuteOfDay < 9 * 60);
}

export class BlackIceField {
  /** Today's frozen spots (empty while not active) - the phone map draws these */
  public readonly patches: IcePatch[] = [];
  private readonly grid = new Map<string, IcePatch[]>();
  private day = -1;
  private active = false;
  /** The last patch the rider was warned about (warn once per patch) */
  public warnedId = -1;

  constructor(
    private readonly nodes: readonly OsmGraphNode[],
    private readonly edges: readonly OsmGraphEdge[],
  ) {}

  public get isActive(): boolean {
    return this.active;
  }

  /** Ice for the working `day` when `active` (rebuilt only when either changes) */
  public set(day: number, active: boolean): void {
    if (day === this.day && active === this.active) return;
    this.day = day;
    this.active = active;
    this.patches.length = 0;
    this.grid.clear();
    if (!active) return;
    for (const p of planBlackIce(this.nodes, this.edges, day)) {
      this.patches.push(p);
      const key = `${Math.floor(p.x / CELL_M)},${Math.floor(p.z / CELL_M)}`;
      const list = this.grid.get(key);
      if (list) list.push(p);
      else this.grid.set(key, [p]);
    }
  }

  /** The patch under (x, z), or null */
  public patchAt(x: number, z: number): IcePatch | null {
    return this.nearest(x, z, 0, true);
  }

  /** The closest patch whose edge is within `range` m of (x, z), or null */
  public nearest(x: number, z: number, range: number, inside = false): IcePatch | null {
    if (!this.active) return null;
    const cx = Math.floor(x / CELL_M);
    const cz = Math.floor(z / CELL_M);
    let best: IcePatch | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        for (const p of this.grid.get(`${ix},${iz}`) ?? []) {
          const d = Math.hypot(p.x - x, p.z - z) - p.radius;
          if ((inside ? d <= 0 : d <= range) && d < bestD) {
            best = p;
            bestD = d;
          }
        }
      }
    }
    return best;
  }
}
