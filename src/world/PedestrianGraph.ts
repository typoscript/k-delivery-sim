import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import { getSignalAxis } from './TrafficRules';
import { midBlockAt } from './traffic/midBlockSignals';

export type PedestrianNodeKind = 'corner_tactile' | 'sidewalk_mid';
export type PedestrianEdgeKind = 'sidewalk' | 'crosswalk';
export type CrosswalkAxis = 'ns' | 'ew';

export interface PedestrianNode {
  id: number;
  x: number;
  z: number;
  kind: PedestrianNodeKind;
  blockIx: number;
  blockIz: number;
}

export interface PedestrianEdge {
  to: number;
  kind: PedestrianEdgeKind;
  /**
   * Vehicle signal phase pedestrians on this crosswalk walk with: the phase of traffic travelling PARALLEL
   * to the crossing direction (= getSignalAxis(junction, crossing direction)), so walk lights stay in sync
   * with car signals at oblique junctions too. On a grid: 'ns' = walking along Z across an EW road.
   */
  crossingAxis?: CrosswalkAxis;
  /**
   * Edge runs across a road. Signalized ones are kind 'crosswalk'; unsignalized ones stay kind 'sidewalk'
   * but pedestrians still wait for a gap in traffic (isRoadCrossingClear) and cross as CROSSING.
   */
  crossesRoad?: boolean;
  /**
   * A painted crosswalk away from the junctions (OSM): pedestrians have the right of way, so they wait only for a
   * car that could no longer stop, and cars stop for them
   */
  marked?: boolean;
  /** A painted crosswalk with its own lights: index into MID_BLOCK_CROSSINGS (wait for the walk light) */
  midSignal?: number;
  distance: number;
}


/**
 * Uniform grid bucket index of 2D points (ids) for fast radius / ring queries on the large unified map.
 * Points are bucketed once; `within` only scans the cells overlapping the query circle.
 */
export class PointGrid {
  private readonly cells = new Map<number, number[]>();

  constructor(
    private readonly xs: ArrayLike<number>,
    private readonly zs: ArrayLike<number>,
    count: number,
    public readonly cellSize = 100,
    include?: (id: number) => boolean
  ) {
    for (let id = 0; id < count; id++) {
      if (include && !include(id)) continue;
      const key = this.key(Math.floor(xs[id] / cellSize), Math.floor(zs[id] / cellSize));
      let bucket = this.cells.get(key);
      if (!bucket) {
        bucket = [];
        this.cells.set(key, bucket);
      }
      bucket.push(id);
    }
  }

  /** Number of non-empty cells (cellSize^2 each) — a cheap measure of how much ground the points cover */
  public get occupiedCellCount(): number {
    return this.cells.size;
  }

  private key(ix: number, iz: number): number {
    return (ix + 32768) * 65536 + (iz + 32768);
  }

  /** Ids with minR <= distance((x, z)) <= maxR, appended to `out` (unordered) */
  public within(x: number, z: number, minR: number, maxR: number, out: number[] = []): number[] {
    const cs = this.cellSize;
    const minSq = minR > 0 ? minR * minR : -1;
    const maxSq = maxR * maxR;
    const ix0 = Math.floor((x - maxR) / cs);
    const ix1 = Math.floor((x + maxR) / cs);
    const iz0 = Math.floor((z - maxR) / cs);
    const iz1 = Math.floor((z + maxR) / cs);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const bucket = this.cells.get(this.key(ix, iz));
        if (!bucket) continue;
        for (const id of bucket) {
          const dx = this.xs[id] - x;
          const dz = this.zs[id] - z;
          const dSq = dx * dx + dz * dz;
          if (dSq <= maxSq && dSq >= minSq) out.push(id);
        }
      }
    }
    return out;
  }

  /** Random id in the ring [minR, maxR] around (x, z) passing `accept`, or -1 when none */
  public randomWithin(
    x: number,
    z: number,
    minR: number,
    maxR: number,
    accept?: (id: number) => boolean,
    rng: () => number = Math.random
  ): number {
    const pool = this.within(x, z, minR, maxR);
    // Partial Fisher-Yates: random order without scanning the whole pool when most candidates pass
    for (let i = pool.length - 1; i >= 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const id = pool[j];
      pool[j] = pool[i];
      if (!accept || accept(id)) return id;
    }
    return -1;
  }
}

/**
 * Real Suwon Ingye-dong Sidewalk & Signalized Crosswalk Waypoint Graph!
 * Generates paired left/right roadside sidewalk edges along the real OSM road network
 * and connects both curbs at road junctions with traffic-signal-synced crosswalks.
 */
export class PedestrianGraph {
  public readonly nodes: PedestrianNode[] = [];
  public readonly adjacency: PedestrianEdge[][] = [];
  /** 100m grid buckets of sidewalk node ids (see nodesWithin / randomNodeWithin) */
  public readonly grid: PointGrid;
  /** Wall-clock construction time in ms (for profiling the large unified map) */
  public readonly buildMs: number;

  constructor() {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const osmNodes = ACTIVE_MAP_DATA.nodes;
    const osmEdges = ACTIVE_MAP_DATA.edges;

    // Pedestrians cross roads only at junctions, dead ends and signals - never at a bend in the middle of a block
    const roadDegree = new Array<number>(osmNodes.length).fill(0);
    for (const e of osmEdges) {
      roadDegree[e.a]++;
      roadDegree[e.b]++;
    }
    const canCrossAt = (id: number) => roadDegree[id] !== 2 || osmNodes[id].isSignal;

    // Track sidewalk endpoint nodes created near each OSM junction so sidewalks connect smoothly!
    const junctionSidewalkNodes: number[][] = Array.from({ length: osmNodes.length }, () => []);
    const crossingsByEdge = crossingStations(osmNodes, osmEdges, ACTIVE_MAP_DATA.crossings ?? []);

    for (let ei = 0; ei < osmEdges.length; ei++) {
      const e = osmEdges[ei];
      if (e.dist < 8) continue;
      const na = osmNodes[e.a];
      const nb = osmNodes[e.b];
      const dx = nb.x - na.x;
      const dz = nb.z - na.z;
      const len = Math.hypot(dx, dz);
      if (len < 6) continue;

      const ux = dx / len;
      const uz = dz / len;
      // Right-hand perpendicular normal
      const rx = -uz;
      const rz = ux;

      const offset = e.width * 0.5 + 0.9;
      const trim = Math.min(4.2, len * 0.22);

      // Left & right sidewalk rails parallel to the real Suwon road segment
      const pairA: number[] = [];
      const pairB: number[] = [];

      // real crosswalks on this block (distance along the road), clear of the trimmed ends
      const stations = (crossingsByEdge.get(ei) ?? []).filter((s) => s > trim + 1 && s < len - trim - 1);
      const crossNodes: number[][] = [];
      for (const side of [-1, 1]) {
        const ax = na.x + ux * trim + rx * side * offset;
        const az = na.z + uz * trim + rz * side * offset;
        const bx = nb.x - ux * trim + rx * side * offset;
        const bz = nb.z - uz * trim + rz * side * offset;

        const idA = this.addNode(ax, az, na.isSignal ? 'corner_tactile' : 'sidewalk_mid');
        const idB = this.addNode(bx, bz, nb.isSignal ? 'corner_tactile' : 'sidewalk_mid');
        if (stations.length === 0) {
          this.addBidirectionalEdge(idA, idB, 'sidewalk');
        } else {
          // the rail is split at each crosswalk, where a curb pad node is added
          let prev = idA;
          const pads: number[] = [];
          for (const s of stations) {
            const pad = this.addNode(na.x + ux * s + rx * side * offset, na.z + uz * s + rz * side * offset, 'corner_tactile');
            this.addBidirectionalEdge(prev, pad, 'sidewalk');
            pads.push(pad);
            prev = pad;
          }
          this.addBidirectionalEdge(prev, idB, 'sidewalk');
          crossNodes.push(pads);
        }

        pairA.push(idA);
        pairB.push(idB);
        junctionSidewalkNodes[e.a].push(idA);
        junctionSidewalkNodes[e.b].push(idB);
      }

      // Mid-block crosswalks: across the road between the two curb pads
      if (crossNodes.length === 2) {
        for (let k = 0; k < stations.length; k++) {
          const p0 = this.nodes[crossNodes[0][k]];
          const p1 = this.nodes[crossNodes[1][k]];
          const mid = midBlockAt((p0.x + p1.x) / 2, (p0.z + p1.z) / 2);
          this.addBidirectionalEdge(crossNodes[0][k], crossNodes[1][k], 'sidewalk', undefined, true, true, mid);
        }
      }

      // Crosswalk across road at ends (signalized if junction has traffic signals).
      // Crossing direction is the road normal: walk with the phase of traffic moving parallel to it,
      // i.e. while the cars on this road segment have red.
      if (canCrossAt(e.a)) {
        this.addBidirectionalEdge(
          pairA[0],
          pairA[1],
          na.isSignal ? 'crosswalk' : 'sidewalk',
          na.isSignal ? getSignalAxis(e.a, rx, rz) : undefined,
          true
        );
      }
      if (canCrossAt(e.b)) {
        this.addBidirectionalEdge(
          pairB[0],
          pairB[1],
          nb.isSignal ? 'crosswalk' : 'sidewalk',
          nb.isSignal ? getSignalAxis(e.b, rx, rz) : undefined,
          true
        );
      }
    }

    // Stitch sidewalk corner nodes belonging to the same OSM intersection within reasonable curb gap
    for (let j = 0; j < junctionSidewalkNodes.length; j++) {
      const list = junctionSidewalkNodes[j];
      const isSig = osmNodes[j].isSignal;
      for (let i = 0; i < list.length; i++) {
        for (let k = i + 1; k < list.length; k++) {
          const a = this.nodes[list[i]];
          const b = this.nodes[list[k]];
          const d = Math.hypot(b.x - a.x, b.z - a.z);
          if (d >= 1.5 && d <= 22) {
            // Avoid duplicate edges
            if (this.adjacency[a.id].some((ed) => ed.to === b.id)) continue;
            // Corner links longer than 9m span a road (shorter ones wrap around the curb corner)
            const crossesRoad = d > 9.0;
            if (crossesRoad && !canCrossAt(j)) continue;
            const signalized = crossesRoad && isSig;
            this.addBidirectionalEdge(
              a.id,
              b.id,
              signalized ? 'crosswalk' : 'sidewalk',
              signalized ? getSignalAxis(j, b.x - a.x, b.z - a.z) : undefined,
              crossesRoad
            );
          }
        }
      }
    }

    // Spatial index over nodes that have at least one edge (isolated nodes are useless spawn points)
    const n = this.nodes.length;
    const xs = new Float64Array(n);
    const zs = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = this.nodes[i].x;
      zs[i] = this.nodes[i].z;
    }
    this.grid = new PointGrid(xs, zs, n, 100, (id) => this.adjacency[id].length > 0);
    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.buildMs = t1 - t0;
  }

  /** Ids of connected sidewalk nodes whose distance to (x, z) lies in [minR, maxR] */
  public nodesWithin(x: number, z: number, minR: number, maxR: number): number[] {
    return this.grid.within(x, z, minR, maxR);
  }

  /**
   * Random connected sidewalk node in the ring [minR, maxR] around (x, z); `accept` can veto candidates.
   * Returns -1 if none qualifies.
   */
  public randomNodeWithin(
    x: number,
    z: number,
    minR: number,
    maxR: number,
    accept?: (id: number) => boolean
  ): number {
    return this.grid.randomWithin(x, z, minR, maxR, accept);
  }

  private addNode(x: number, z: number, kind: PedestrianNodeKind): number {
    const id = this.nodes.length;
    this.nodes.push({ id, x, z, kind, blockIx: 0, blockIz: 0 });
    this.adjacency.push([]);
    return id;
  }

  private addBidirectionalEdge(
    a: number,
    b: number,
    kind: PedestrianEdgeKind,
    crossingAxis?: CrosswalkAxis,
    crossesRoad = false,
    marked = false,
    midSignal = -1
  ): void {
    const na = this.nodes[a];
    const nb = this.nodes[b];
    const dist = Math.hypot(nb.x - na.x, nb.z - na.z);
    if (dist < 0.2) return;
    const extra = {
      ...(crossesRoad ? { crossesRoad: true } : {}),
      ...(marked ? { marked: true } : {}),
      ...(midSignal >= 0 ? { midSignal } : {}),
    };
    this.adjacency[a].push({ to: b, kind, crossingAxis, distance: dist, ...extra });
    this.adjacency[b].push({ to: a, kind, crossingAxis, distance: dist, ...extra });
  }

  public getNode(id: number): PedestrianNode {
    return this.nodes[id];
  }

  public getEdges(id: number): PedestrianEdge[] {
    return this.adjacency[id];
  }

  /** Picks a random next outgoing edge from currentNode, avoiding immediate U-turn when alternatives exist */
  public pickNextEdge(currentNodeId: number, prevNodeId: number): PedestrianEdge {
    const edges = this.adjacency[currentNodeId];
    const forward = edges.filter((e) => e.to !== prevNodeId);
    const pool = forward.length > 0 ? forward : edges;
    return pool[Math.floor(Math.random() * pool.length)];
  }
}

/**
 * Real crosswalks per road edge: edge index -> distances along the edge (from node a) of the crossings lying on it
 * (the build snapped each crossing onto a road centre line)
 */
export function crossingStations(
  nodes: ReadonlyArray<{ x: number; z: number }>,
  edges: ReadonlyArray<{ a: number; b: number; width: number }>,
  crossings: ReadonlyArray<{ x: number; z: number }>,
): Map<number, number[]> {
  const out = new Map<number, number[]>();
  if (crossings.length === 0) return out;
  for (const c of crossings) {
    let best = -1;
    let bestD = 1.5;
    let bestS = 0;
    for (let i = 0; i < edges.length; i++) {
      const a = nodes[edges[i].a];
      const b = nodes[edges[i].b];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const l2 = dx * dx + dz * dz;
      if (l2 < 1e-6) continue;
      const t = ((c.x - a.x) * dx + (c.z - a.z) * dz) / l2;
      if (t < 0 || t > 1) continue;
      const d = Math.hypot(c.x - (a.x + dx * t), c.z - (a.z + dz * t));
      if (d < bestD) {
        bestD = d;
        best = i;
        bestS = t * Math.sqrt(l2);
      }
    }
    if (best < 0) continue;
    const list = out.get(best) ?? [];
    list.push(bestS);
    out.set(best, list.sort((p, q) => p - q));
  }
  return out;
}
