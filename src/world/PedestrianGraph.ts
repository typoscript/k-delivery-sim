import { CITY_BLOCK_CENTERS } from '../types';

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
  crossingAxis?: CrosswalkAxis; // 'ns' crosses EW road along Z; 'ew' crosses NS road along X
  distance: number;
}

const BLOCK_COUNT = CITY_BLOCK_CENTERS.length; // 5x5 = 25 blocks
const TACTILE_OFFSET = 30.8; // matches yellow tactile paving blocks (점자블록) in CityWorld!

/**
 * 25-Block Sidewalk Centerline & Crosswalk Tactile Entry Waypoint Graph.
 * Connects all 25 city blocks via:
 *  - 100 corner tactile nodes (점자블록 횡단보도 진입 지점)
 *  - 100 sidewalk midpoint nodes (인도 중심선 경유지)
 *  - 200 bidirectional sidewalk edges + 80 signalized crosswalk edges
 */
export class PedestrianGraph {
  public readonly nodes: PedestrianNode[] = [];
  public readonly adjacency: PedestrianEdge[][] = [];

  // Lookup corner node ID by (blockIx, blockIz, cornerIndex: 0=SW, 1=SE, 2=NE, 3=NW)
  private readonly cornerIds: number[][][] = [];

  constructor() {
    for (let ix = 0; ix < BLOCK_COUNT; ix++) {
      this.cornerIds[ix] = [];
      for (let iz = 0; iz < BLOCK_COUNT; iz++) {
        this.cornerIds[ix][iz] = [];
        const bx = CITY_BLOCK_CENTERS[ix];
        const bz = CITY_BLOCK_CENTERS[iz];

        // 4 tactile corner nodes (SW, SE, NE, NW) matching CityWorld's yellow tactile blocks
        const corners: Array<[number, number]> = [
          [bx - TACTILE_OFFSET, bz - TACTILE_OFFSET], // 0: SW (-X, -Z)
          [bx + TACTILE_OFFSET, bz - TACTILE_OFFSET], // 1: SE (+X, -Z)
          [bx + TACTILE_OFFSET, bz + TACTILE_OFFSET], // 2: NE (+X, +Z)
          [bx - TACTILE_OFFSET, bz + TACTILE_OFFSET], // 3: NW (-X, +Z)
        ];
        const cIds: number[] = [];
        for (const [cx, cz] of corners) {
          cIds.push(this.addNode(cx, cz, 'corner_tactile', ix, iz));
        }
        this.cornerIds[ix][iz] = cIds;

        // 4 sidewalk centerline midpoint nodes along South, East, North, West edges of the block
        const mids: Array<[number, number, number, number]> = [
          [bx, bz - TACTILE_OFFSET, cIds[0], cIds[1]], // South sidewalk
          [bx + TACTILE_OFFSET, bz, cIds[1], cIds[2]], // East sidewalk
          [bx, bz + TACTILE_OFFSET, cIds[2], cIds[3]], // North sidewalk
          [bx - TACTILE_OFFSET, bz, cIds[3], cIds[0]], // West sidewalk
        ];
        for (const [mx, mz, a, b] of mids) {
          const midId = this.addNode(mx, mz, 'sidewalk_mid', ix, iz);
          this.addBidirectionalEdge(a, midId, 'sidewalk');
          this.addBidirectionalEdge(midId, b, 'sidewalk');
        }
      }
    }

    // Connect adjacent blocks across roads via signalized crosswalk edges!
    for (let ix = 0; ix < BLOCK_COUNT; ix++) {
      for (let iz = 0; iz < BLOCK_COUNT; iz++) {
        const cur = this.cornerIds[ix][iz];

        // Cross NS road (walking along X -> uses EW traffic green!) to block (ix + 1, iz)
        if (ix + 1 < BLOCK_COUNT) {
          const eastBlk = this.cornerIds[ix + 1][iz];
          // SE (1) <-> SW (0) & NE (2) <-> NW (3)
          this.addBidirectionalEdge(cur[1], eastBlk[0], 'crosswalk', 'ew');
          this.addBidirectionalEdge(cur[2], eastBlk[3], 'crosswalk', 'ew');
        }

        // Cross EW road (walking along Z -> uses NS traffic green!) to block (ix, iz + 1)
        if (iz + 1 < BLOCK_COUNT) {
          const northBlk = this.cornerIds[ix][iz + 1];
          // NW (3) <-> SW (0) & NE (2) <-> SE (1)
          this.addBidirectionalEdge(cur[3], northBlk[0], 'crosswalk', 'ns');
          this.addBidirectionalEdge(cur[2], northBlk[1], 'crosswalk', 'ns');
        }
      }
    }
  }

  private addNode(
    x: number,
    z: number,
    kind: PedestrianNodeKind,
    blockIx: number,
    blockIz: number
  ): number {
    const id = this.nodes.length;
    this.nodes.push({ id, x, z, kind, blockIx, blockIz });
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
