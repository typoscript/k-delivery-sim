import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import { getSignalAxis } from './TrafficRules';

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

    // Track sidewalk endpoint nodes created near each OSM junction so sidewalks connect smoothly!
    const junctionSidewalkNodes: number[][] = Array.from({ length: osmNodes.length }, () => []);

    for (const e of osmEdges) {
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

      for (const side of [-1, 1]) {
        const ax = na.x + ux * trim + rx * side * offset;
        const az = na.z + uz * trim + rz * side * offset;
        const bx = nb.x - ux * trim + rx * side * offset;
        const bz = nb.z - uz * trim + rz * side * offset;

        const idA = this.addNode(ax, az, na.isSignal ? 'corner_tactile' : 'sidewalk_mid');
        const idB = this.addNode(bx, bz, nb.isSignal ? 'corner_tactile' : 'sidewalk_mid');
        this.addBidirectionalEdge(idA, idB, 'sidewalk');

        pairA.push(idA);
        pairB.push(idB);
        junctionSidewalkNodes[e.a].push(idA);
        junctionSidewalkNodes[e.b].push(idB);
      }

      // Crosswalk across road at ends (signalized if junction has traffic signals).
      // Crossing direction is the road normal: walk with the phase of traffic moving parallel to it,
      // i.e. while the cars on this road segment have red.
      this.addBidirectionalEdge(
        pairA[0],
        pairA[1],
        na.isSignal ? 'crosswalk' : 'sidewalk',
        na.isSignal ? getSignalAxis(e.a, rx, rz) : undefined
      );
      this.addBidirectionalEdge(
        pairB[0],
        pairB[1],
        nb.isSignal ? 'crosswalk' : 'sidewalk',
        nb.isSignal ? getSignalAxis(e.b, rx, rz) : undefined
      );
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
            const crossesRoad = d > 9.0 && isSig;
            this.addBidirectionalEdge(
              a.id,
              b.id,
              crossesRoad ? 'crosswalk' : 'sidewalk',
              crossesRoad ? getSignalAxis(j, b.x - a.x, b.z - a.z) : undefined
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
    crossingAxis?: CrosswalkAxis
  ): void {
    const na = this.nodes[a];
    const nb = this.nodes[b];
    const dist = Math.hypot(nb.x - na.x, nb.z - na.z);
    if (dist < 0.2) return;
    this.adjacency[a].push({ to: b, kind, crossingAxis, distance: dist });
    this.adjacency[b].push({ to: a, kind, crossingAxis, distance: dist });
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
