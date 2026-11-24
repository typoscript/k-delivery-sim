import { SUWON_INGYE_DATA } from '../data/suwonIngyeData';

export interface RoutePoint {
  x: number;
  z: number;
}

export interface AStarPathResult {
  points: RoutePoint[];
  distance: number;
}

export type TurnDirection = 'straight' | 'left' | 'right' | 'uturn' | 'arrive';

export interface TurnGuidance {
  direction: TurnDirection;
  distanceToTurn: number; // meters to next turn (or destination)
  totalDistance: number; // total remaining route distance in meters
  instructionText: string;
}

interface GraphNode {
  id: number;
  x: number;
  z: number;
}

interface GraphEdge {
  a: number;
  b: number;
  cost: number;
}

interface ProjectedPoint {
  x: number;
  z: number;
  edgeIdx: number;
  a: number;
  b: number;
  distFromSource: number;
}

const TURN_PENALTY_METERS = 3.5;

/**
 * General OpenStreetMap Road Network Graph & A* Shortest-Path Navigator
 * powered by real Suwon-si Paldal-gu Ingye-dong (Suwon City Hall Station) road topology!
 */
export class RoadNavigator {
  private readonly baseNodes: GraphNode[] = [];
  private readonly baseEdges: GraphEdge[] = [];
  private readonly baseAdj: Array<Array<{ to: number; cost: number }>> = [];

  constructor() {
    for (const n of SUWON_INGYE_DATA.nodes) {
      this.baseNodes.push({ id: n.id, x: n.x, z: n.z });
      this.baseAdj.push([]);
    }

    for (const e of SUWON_INGYE_DATA.edges) {
      // Slightly favor wider major boulevards (효원로/권광로/경수대로) over tiny alleys
      const weightMul = e.isMajor ? 0.92 : 1.05;
      const cost = Math.max(1, e.dist * weightMul);
      this.baseEdges.push({ a: e.a, b: e.b, cost });
      this.baseAdj[e.a].push({ to: e.b, cost });
      this.baseAdj[e.b].push({ to: e.a, cost });
    }
  }

  /** Projects an arbitrary world coordinate (x, z) onto the closest real Suwon OSM road segment */
  private projectToRoad(px: number, pz: number): ProjectedPoint {
    let best: ProjectedPoint = {
      x: px,
      z: pz,
      edgeIdx: 0,
      a: 0,
      b: 0,
      distFromSource: Infinity,
    };

    for (let i = 0; i < this.baseEdges.length; i++) {
      const e = this.baseEdges[i];
      const na = this.baseNodes[e.a];
      const nb = this.baseNodes[e.b];
      const vx = nb.x - na.x;
      const vz = nb.z - na.z;
      const lenSq = vx * vx + vz * vz;
      if (lenSq < 1e-5) continue;

      let t = ((px - na.x) * vx + (pz - na.z) * vz) / lenSq;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;

      const cx = na.x + vx * t;
      const cz = na.z + vz * t;
      const d = Math.hypot(px - cx, pz - cz);
      if (d < best.distFromSource) {
        best = {
          x: cx,
          z: cz,
          edgeIdx: i,
          a: e.a,
          b: e.b,
          distFromSource: d,
        };
      }
    }

    return best;
  }

  /** Fast road-network distance estimate used for multi-stop route optimization */
  public estimateRoadDistance(fromX: number, fromZ: number, toX: number, toZ: number): number {
    return this.findShortestPath(fromX, fromZ, toX, toZ).distance;
  }

  /** Computes the shortest path along the real Suwon Ingye-dong OSM road graph using A* */
  public findShortestPath(fromX: number, fromZ: number, toX: number, toZ: number): AStarPathResult {
    const directDist = Math.hypot(toX - fromX, toZ - fromZ);
    if (directDist < 14) {
      return {
        points: [
          { x: fromX, z: fromZ },
          { x: toX, z: toZ },
        ],
        distance: directDist,
      };
    }

    const startProj = this.projectToRoad(fromX, fromZ);
    const goalProj = this.projectToRoad(toX, toZ);

    // Same road segment -> direct along that road!
    if (startProj.edgeIdx === goalProj.edgeIdx) {
      return this.finalizePath([
        { x: fromX, z: fromZ },
        { x: startProj.x, z: startProj.z },
        { x: goalProj.x, z: goalProj.z },
        { x: toX, z: toZ },
      ]);
    }

    const baseCount = this.baseNodes.length;
    const START_ID = baseCount;
    const GOAL_ID = baseCount + 1;
    const totalNodes = baseCount + 2;

    const nodes: GraphNode[] = [
      ...this.baseNodes,
      { id: START_ID, x: startProj.x, z: startProj.z },
      { id: GOAL_ID, x: goalProj.x, z: goalProj.z },
    ];

    const extraAdj = new Map<number, Array<{ to: number; cost: number }>>();
    const addTempEdge = (a: number, b: number, cost: number) => {
      if (!extraAdj.has(a)) extraAdj.set(a, []);
      if (!extraAdj.has(b)) extraAdj.set(b, []);
      extraAdj.get(a)!.push({ to: b, cost });
      extraAdj.get(b)!.push({ to: a, cost });
    };

    const connectProjection = (nodeId: number, proj: ProjectedPoint) => {
      const na = this.baseNodes[proj.a];
      const nb = this.baseNodes[proj.b];
      addTempEdge(nodeId, proj.a, Math.hypot(proj.x - na.x, proj.z - na.z));
      addTempEdge(nodeId, proj.b, Math.hypot(proj.x - nb.x, proj.z - nb.z));
    };

    connectProjection(START_ID, startProj);
    connectProjection(GOAL_ID, goalProj);

    // --- Standard A* Search (Euclidean admissible heuristic for arbitrary OSM angles) ---
    const gScore = new Float64Array(totalNodes).fill(Infinity);
    const fScore = new Float64Array(totalNodes).fill(Infinity);
    const cameFrom = new Int16Array(totalNodes).fill(-1);
    const closed = new Uint8Array(totalNodes);
    const inOpen = new Uint8Array(totalNodes);

    const heuristic = (id: number) => {
      const n = nodes[id];
      return Math.hypot(n.x - goalProj.x, n.z - goalProj.z) * 0.92;
    };

    gScore[START_ID] = 0;
    fScore[START_ID] = heuristic(START_ID);
    const openList: number[] = [START_ID];
    inOpen[START_ID] = 1;

    while (openList.length > 0) {
      let bestIdx = 0;
      let bestF = fScore[openList[0]];
      for (let i = 1; i < openList.length; i++) {
        const f = fScore[openList[i]];
        if (f < bestF) {
          bestF = f;
          bestIdx = i;
        }
      }
      const current = openList[bestIdx];
      openList[bestIdx] = openList[openList.length - 1];
      openList.pop();
      inOpen[current] = 0;

      if (current === GOAL_ID) break;
      closed[current] = 1;

      const prev = cameFrom[current];
      const curNode = nodes[current];

      const checkNeighbor = (to: number, edgeCost: number) => {
        if (closed[to]) return;

        let turnPenalty = 0;
        if (prev !== -1) {
          const prevNode = nodes[prev];
          const nextNode = nodes[to];
          const dx1 = curNode.x - prevNode.x;
          const dz1 = curNode.z - prevNode.z;
          const dx2 = nextNode.x - curNode.x;
          const dz2 = nextNode.z - curNode.z;
          const l1 = Math.hypot(dx1, dz1);
          const l2 = Math.hypot(dx2, dz2);
          if (l1 > 0.5 && l2 > 0.5) {
            const dot = (dx1 * dx2 + dz1 * dz2) / (l1 * l2);
            if (dot < 0.72) {
              turnPenalty = TURN_PENALTY_METERS;
            }
          }
        }

        const tentativeG = gScore[current] + edgeCost + turnPenalty;
        if (tentativeG < gScore[to]) {
          cameFrom[to] = current;
          gScore[to] = tentativeG;
          fScore[to] = tentativeG + heuristic(to);
          if (!inOpen[to]) {
            openList.push(to);
            inOpen[to] = 1;
          }
        }
      };

      if (current < baseCount) {
        for (const e of this.baseAdj[current]) {
          checkNeighbor(e.to, e.cost);
        }
      }
      const extras = extraAdj.get(current);
      if (extras) {
        for (const e of extras) {
          checkNeighbor(e.to, e.cost);
        }
      }
    }

    const roadNodes: RoutePoint[] = [];
    let curr = GOAL_ID;
    let safety = 0;
    while (curr !== -1 && safety < 256) {
      roadNodes.push({ x: nodes[curr].x, z: nodes[curr].z });
      if (curr === START_ID) break;
      curr = cameFrom[curr];
      safety++;
    }
    roadNodes.reverse();

    if (roadNodes.length < 2) {
      return this.finalizePath([
        { x: fromX, z: fromZ },
        { x: toX, z: toZ },
      ]);
    }

    return this.finalizePath([{ x: fromX, z: fromZ }, ...roadNodes, { x: toX, z: toZ }]);
  }

  /** Removes duplicate and redundant collinear vertices and computes exact polyline length */
  private finalizePath(raw: RoutePoint[]): AStarPathResult {
    const dedup: RoutePoint[] = [raw[0]];
    for (let i = 1; i < raw.length; i++) {
      const prev = dedup[dedup.length - 1];
      if (Math.hypot(raw[i].x - prev.x, raw[i].z - prev.z) > 1.2) {
        dedup.push(raw[i]);
      }
    }
    if (dedup.length === 1) {
      dedup.push(raw[raw.length - 1]);
    }

    const simplified: RoutePoint[] = [dedup[0]];
    for (let i = 1; i < dedup.length - 1; i++) {
      const a = simplified[simplified.length - 1];
      const b = dedup[i];
      const c = dedup[i + 1];
      const v1x = b.x - a.x;
      const v1z = b.z - a.z;
      const v2x = c.x - b.x;
      const v2z = c.z - b.z;
      const l1 = Math.hypot(v1x, v1z);
      const l2 = Math.hypot(v2x, v2z);
      if (l1 > 0.1 && l2 > 0.1) {
        const dot = (v1x * v2x + v1z * v2z) / (l1 * l2);
        if (dot > 0.992) continue;
      }
      simplified.push(b);
    }
    simplified.push(dedup[dedup.length - 1]);

    let total = 0;
    for (let i = 1; i < simplified.length; i++) {
      total += Math.hypot(simplified[i].x - simplified[i - 1].x, simplified[i].z - simplified[i - 1].z);
    }
    return { points: simplified, distance: total };
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
    if (points.length < 2 || totalDistance <= 14) {
      const dist = Math.max(0, Math.round(totalDistance));
      return {
        direction: 'arrive',
        distanceToTurn: dist,
        totalDistance: dist,
        instructionText: dist <= 6 ? '목적지 도착!' : `${dist}m 앞 목적지`,
      };
    }

    const fwdX = Math.sin(heading);
    const fwdZ = Math.cos(heading);

    let firstSegIdx = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const d = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z);
      if (d >= 4.0) {
        firstSegIdx = i;
        break;
      }
    }

    const s0 = points[firstSegIdx];
    const s1 = points[firstSegIdx + 1];
    const sLen = Math.hypot(s1.x - s0.x, s1.z - s0.z);
    if (sLen > 0.5) {
      const ux = (s1.x - s0.x) / sLen;
      const uz = (s1.z - s0.z) / sLen;
      const alignDot = fwdX * ux + fwdZ * uz;
      if (alignDot < -0.55 && totalDistance > 18) {
        return {
          direction: 'uturn',
          distanceToTurn: Math.round(totalDistance),
          totalDistance: Math.round(totalDistance),
          instructionText: '경로 반대 방향 · 유턴하세요',
        };
      }
    }

    let accum = 0;
    for (let i = 0; i < points.length - 2; i++) {
      const a = points[i];
      const b = points[i + 1];
      const c = points[i + 2];
      const dx1 = b.x - a.x;
      const dz1 = b.z - a.z;
      const dx2 = c.x - b.x;
      const dz2 = c.z - b.z;
      const l1 = Math.hypot(dx1, dz1);
      const l2 = Math.hypot(dx2, dz2);
      accum += l1;

      if (l1 < 2.0 || l2 < 2.0) continue;

      const u1x = dx1 / l1;
      const u1z = dz1 / l1;
      const u2x = dx2 / l2;
      const u2z = dz2 / l2;
      const dot = u1x * u2x + u1z * u2z;

      if (dot < 0.78) {
        const crossY = u1z * u2x - u1x * u2z;
        const turnDir: TurnDirection = crossY >= 0 ? 'left' : 'right';
        const turnDist = Math.max(1, Math.round(accum));
        const label = turnDir === 'left' ? '좌회전' : '우회전';

        if (turnDist > 140) {
          return {
            direction: 'straight',
            distanceToTurn: turnDist,
            totalDistance: Math.round(totalDistance),
            instructionText: `${turnDist}m 직진 후 ${label}`,
          };
        }
        return {
          direction: turnDir,
          distanceToTurn: turnDist,
          totalDistance: Math.round(totalDistance),
          instructionText: turnDist <= 15 ? `잠시 후 ${label}` : `${turnDist}m 앞 ${label}`,
        };
      }
    }

    const rem = Math.max(1, Math.round(totalDistance));
    return {
      direction: rem <= 25 ? 'arrive' : 'straight',
      distanceToTurn: rem,
      totalDistance: rem,
      instructionText: rem <= 25 ? `${rem}m 앞 목적지 도착` : `${rem}m 직진`,
    };
  }
}
