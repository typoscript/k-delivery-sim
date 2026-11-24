import { SUWON_INGYE_DATA } from '../data/suwonIngyeData';

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

/**
 * Real Suwon Ingye-dong Sidewalk & Signalized Crosswalk Waypoint Graph!
 * Generates paired left/right roadside sidewalk edges along the real OSM road network
 * and connects both curbs at road junctions with traffic-signal-synced crosswalks.
 */
export class PedestrianGraph {
  public readonly nodes: PedestrianNode[] = [];
  public readonly adjacency: PedestrianEdge[][] = [];

  constructor() {
    const osmNodes = SUWON_INGYE_DATA.nodes;
    const osmEdges = SUWON_INGYE_DATA.edges;

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

      // Crosswalk across road at ends (signalized if junction has traffic signals)
      const crossAxis: CrosswalkAxis = Math.abs(rz) >= Math.abs(rx) ? 'ns' : 'ew';
      this.addBidirectionalEdge(
        pairA[0],
        pairA[1],
        na.isSignal ? 'crosswalk' : 'sidewalk',
        na.isSignal ? crossAxis : undefined
      );
      this.addBidirectionalEdge(
        pairB[0],
        pairB[1],
        nb.isSignal ? 'crosswalk' : 'sidewalk',
        nb.isSignal ? crossAxis : undefined
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
            const axis: CrosswalkAxis = Math.abs(b.z - a.z) >= Math.abs(b.x - a.x) ? 'ns' : 'ew';
            this.addBidirectionalEdge(
              a.id,
              b.id,
              crossesRoad ? 'crosswalk' : 'sidewalk',
              crossesRoad ? axis : undefined
            );
          }
        }
      }
    }
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
