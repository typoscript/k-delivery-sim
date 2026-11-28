import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';

export interface RoutePoint {
  x: number;
  z: number;
}

export interface AStarPathResult {
  points: RoutePoint[];
  distance: number;
  /** Construction-zone road segments the path still runs through (0 when it could detour) */
  roadworks?: number;
  /** Middle of each construction segment on the path (for the approach warning) */
  roadworkPoints?: RoutePoint[];
  /** Construction segments the unpenalized shortest route would use but this one detours around */
  avoidedRoadworks?: number;
}

/** A road segment narrowed by construction (graph node ids of its ends) */
export interface RoadworkEdge {
  edgeA: number;
  edgeB: number;
}

export type TurnDirection = 'straight' | 'left' | 'right' | 'uturn' | 'arrive';

export interface TurnGuidance {
  direction: TurnDirection;
  distanceToTurn: number; // meters to next turn (or destination)
  totalDistance: number; // total remaining route distance in meters
  instructionText: string;
}



import { GraphEdge, GraphNode, ProjectedPoint, edgeKey } from './navigation/routeSearch';
export { ROADWORK_DETOUR_METERS } from './navigation/routeSearch';
import {
  projectToRoad as projectToRoadFn,
  estimateRoadDistance as estimateRoadDistanceFn,
  findShortestPath as findShortestPathFn,
  finalizePath as finalizePathFn,
} from './navigation/routeSearch';
import {
  computeTurnGuidance as computeTurnGuidanceFn,
} from './navigation/turnGuidance';

/**
 * General OpenStreetMap Road Network Graph & A* Shortest-Path Navigator
 * powered by real Suwon-si Paldal-gu Ingye-dong (Suwon City Hall Station) road topology!
 */
export class RoadNavigator {
  /** @internal navigation/* */
  readonly baseNodes: GraphNode[] = [];
  /** @internal navigation/* */
  readonly baseEdges: GraphEdge[] = [];
  /** @internal navigation/* */
  readonly baseAdj: Array<Array<{ to: number; cost: number }>> = [];
  /** @internal navigation/* */
  readonly roadworkKeys = new Set<number>();

  constructor() {
    for (const n of ACTIVE_MAP_DATA.nodes) {
      this.baseNodes.push({ id: n.id, x: n.x, z: n.z });
      this.baseAdj.push([]);
    }

    for (const e of ACTIVE_MAP_DATA.edges) {
      // Slightly favor wider major boulevards (효원로/권광로/경수대로) over tiny alleys
      const weightMul = e.isMajor ? 0.92 : 1.05;
      const cost = Math.max(1, e.dist * weightMul);
      this.baseEdges.push({ a: e.a, b: e.b, cost });
      this.baseAdj[e.a].push({ to: e.b, cost });
      this.baseAdj[e.b].push({ to: e.a, cost });
    }
  }

  /** Marks construction segments: routes avoid them when a reasonable detour exists */
  public setRoadworks(edges: readonly RoadworkEdge[]): void {
    this.roadworkKeys.clear();
    for (const e of edges) this.roadworkKeys.add(edgeKey(e.edgeA, e.edgeB));
  }

  public isRoadwork(a: number, b: number): boolean {
    return this.roadworkKeys.has(edgeKey(a, b));
  }

  /** Projects an arbitrary world coordinate (x, z) onto the closest real Suwon OSM road segment */
  /** @internal navigation/* */
  projectToRoad(px: number, pz: number): ProjectedPoint {
    return projectToRoadFn(this, px, pz);
  }

  /** Fast road-network distance estimate used for multi-stop route optimization */
  public estimateRoadDistance(fromX: number, fromZ: number, toX: number, toZ: number): number {
    return estimateRoadDistanceFn(this, fromX, fromZ, toX, toZ);
  }

  /** Computes the shortest path along the real Suwon Ingye-dong OSM road graph using A* */
  public findShortestPath(fromX: number, fromZ: number, toX: number, toZ: number): AStarPathResult {
    return findShortestPathFn(this, fromX, fromZ, toX, toZ);
  }

  /** Removes duplicate and redundant collinear vertices and computes exact polyline length */
  /** @internal navigation/* */
  finalizePath(raw: RoutePoint[]): AStarPathResult {
    return finalizePathFn(raw);
  }

  /**
   * Computes turn-by-turn navigation instruction for the 3D handlebar minimap.
   * Uses Three.js right-handed XZ coordinates: heading=0 -> +Z, +X is LEFT, -X is RIGHT.
   */
  public computeTurnGuidance(
    points: RoutePoint[],
    totalDistance: number,
    heading: number
  ): TurnGuidance {
    return computeTurnGuidanceFn(points, totalDistance, heading);
  }
}
