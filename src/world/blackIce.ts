/**
 * Winter black ice (블랙아이스): on winter nights and early mornings bridges (half of their segments) and a few shaded
 * spots - quiet residential alleys, living streets and on/off ramps - freeze into invisible ice. Riding over one is like braking on a wet manhole:
 * almost no grip. Spots are picked per working day from the road graph (deterministic hash, different every day),
 * kept in a coarse grid for quick lookups; the phone map and a warning toast show the ones nearby.
 */
import type { OsmGraphEdge, OsmGraphNode } from '../data/suwonTypes';

export interface IcePatch {
  id: number;
  x: number;
  z: number;
  radius: number;
  /** On a bridge deck (shown as 다리 위 결빙) */
  onBridge?: boolean;
  /** Bridge direction (unit): a road crossing under the deck at the same drawn height is not on the ice */
  dirX?: number;
  dirZ?: number;
}

/** Riding within ~40° of a bridge's direction counts as being on its deck */
const ALONG_COS = 0.75;

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
/** Bridges freeze first (cold air under the deck): this share of bridge segments ices over */
const BRIDGE_FREEZE_CHANCE = 0.5;

function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x27d4eb2f);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/** The frozen spots of a working day: one patch somewhere along each frozen segment */
export function planBlackIce(nodes: readonly OsmGraphNode[], edges: readonly OsmGraphEdge[], day: number): IcePatch[] {
  const out: IcePatch[] = [];
  edges.forEach((e, i) => {
    // underpasses stay dry; bridges freeze first, whatever the road class
    const chance = e.tunnel ? 0 : e.bridge ? BRIDGE_FREEZE_CHANCE : (FREEZE_CHANCE[e.highway] ?? 0);
    if (chance === 0 || e.dist < 20 || hash01(i, day) >= chance) return;
    const a = nodes[e.a];
    const b = nodes[e.b];
    const t = 0.25 + hash01(i, day + 7919) * 0.5;
    out.push({
      id: i,
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      radius: e.bridge ? Math.max(5, e.width * 0.75) : Math.min(7, Math.max(3.5, e.width * 0.7)),
      ...(e.bridge ? { onBridge: true, dirX: (b.x - a.x) / e.dist, dirZ: (b.z - a.z) / e.dist } : {}),
    });
  });
  return out;
}

/** True on winter nights / early mornings, when the shaded spots freeze */
export function blackIceActive(season: string, night: boolean, minuteOfDay: number): boolean {
  return season === 'winter' && (night || minuteOfDay < 9 * 60);
}

/** Bridges stay frozen this long after the shaded streets thaw in the morning (cold air under the deck) */
export const BRIDGE_THAW_LAG_MIN = 60;

export type BlackIceStage = 'none' | 'bridges' | 'all';

/**
 * How much is frozen on a winter day: bridges freeze first - from sunset (`duskStart`), before the shaded streets
 * follow at night - and thaw last (until 10:00, an hour after the streets). 'all' = bridges + shaded streets.
 */
export function blackIceStage(season: string, night: boolean, minuteOfDay: number, duskStart: number): BlackIceStage {
  if (season !== 'winter') return 'none';
  if (blackIceActive(season, night, minuteOfDay)) return 'all';
  if (minuteOfDay >= duskStart || minuteOfDay < 9 * 60 + BRIDGE_THAW_LAG_MIN) return 'bridges';
  return 'none';
}

export class BlackIceField {
  /** Today's frozen spots (empty while not active) - the phone map draws these */
  public readonly patches: IcePatch[] = [];
  private readonly grid = new Map<string, IcePatch[]>();
  private day = -1;
  private stage: BlackIceStage = 'none';
  /** The last patch the rider was warned about (warn once per patch) */
  public warnedId = -1;
  /** The patch the rider is crossing right now (-1: none) and whether they went down on it */
  public crossingId = -1;
  public crashedOnCrossing = false;
  /** Bumped whenever the frozen spots change (the bridge sheen redraws) */
  public version = 0;

  constructor(
    private readonly nodes: readonly OsmGraphNode[],
    private readonly edges: readonly OsmGraphEdge[],
  ) {}

  public get isActive(): boolean {
    return this.stage !== 'none';
  }

  /** What is frozen right now: nothing, bridges only (dusk / late morning) or bridges + shaded streets */
  public get currentStage(): BlackIceStage {
    return this.stage;
  }

  /**
   * Ice for the working `day` (rebuilt only when it or the stage changes). `true` / `false` = 'all' / 'none';
   * 'bridges' keeps only the bridge-deck patches.
   */
  public set(day: number, stage: BlackIceStage | boolean): void {
    const s: BlackIceStage = stage === true ? 'all' : stage === false ? 'none' : stage;
    if (day === this.day && s === this.stage) return;
    this.day = day;
    this.stage = s;
    this.version++;
    this.patches.length = 0;
    this.grid.clear();
    if (s === 'none') return;
    for (const p of planBlackIce(this.nodes, this.edges, day)) {
      if (s === 'bridges' && !p.onBridge) continue;
      this.patches.push(p);
      const key = `${Math.floor(p.x / CELL_M)},${Math.floor(p.z / CELL_M)}`;
      const list = this.grid.get(key);
      if (list) list.push(p);
      else this.grid.set(key, [p]);
    }
  }

  /** The patch under (x, z), or null; with `heading`, bridge ice counts only when riding along the bridge */
  public patchAt(x: number, z: number, heading?: number): IcePatch | null {
    return this.nearest(x, z, 0, true, heading);
  }

  /** The closest patch whose edge is within `range` m of (x, z), or null (bridge ice: see patchAt) */
  public nearest(x: number, z: number, range: number, inside = false, heading?: number): IcePatch | null {
    const hx = heading === undefined ? 0 : Math.sin(heading);
    const hz = heading === undefined ? 0 : Math.cos(heading);
    if (this.stage === 'none') return null;
    const cx = Math.floor(x / CELL_M);
    const cz = Math.floor(z / CELL_M);
    let best: IcePatch | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        for (const p of this.grid.get(`${ix},${iz}`) ?? []) {
          if (heading !== undefined && p.onBridge && Math.abs(hx * (p.dirX ?? 0) + hz * (p.dirZ ?? 0)) < ALONG_COS) {
            continue; // crossing under the bridge, not on its deck
          }
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

/** Up to this many icy bridge decks glisten at once (one InstancedMesh) */
export const MAX_ICE_SHEENS = 96;

/**
 * Where the icy bridge decks glisten: one flat rectangle per frozen bridge patch, along the bridge (length 2.2 x the
 * patch radius, about the road's width across). Shaded street ice stays invisible - that is what black ice is.
 */
export function iceSheenRects(
  patches: readonly IcePatch[],
): Array<{ x: number; z: number; heading: number; length: number; width: number }> {
  return patches
    .filter((p) => p.onBridge && p.dirX !== undefined && p.dirZ !== undefined)
    .slice(0, MAX_ICE_SHEENS)
    .map((p) => ({ x: p.x, z: p.z, heading: Math.atan2(p.dirX!, p.dirZ!), length: p.radius * 2.2, width: p.radius * 1.3 }));
}
