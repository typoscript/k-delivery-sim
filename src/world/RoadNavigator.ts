import { CITY_ROAD_LINES } from '../types';

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

interface ProjectedPoint {
  x: number;
  z: number;
  isHorizontal: boolean;
  roadIndex: number; // index in CITY_ROAD_LINES for fixed axis
  segLow: number; // lower intersection index on varying axis (0..4)
  segHigh: number; // upper intersection index on varying axis (1..5)
  distFromSource: number;
}

const GRID_SIZE = CITY_ROAD_LINES.length; // 6x6 = 36 intersections
const TURN_PENALTY_METERS = 3.0; // slight preference for straight roads to avoid unnecessary zig-zags

/**
 * 6x6 Road Network Graph & A* Shortest-Path Navigator.
 * Connects arbitrary outdoor positions cleanly to the nearest road segment,
 * runs A* over the 36 intersections, and computes real-time turn-by-turn guidance.
 */
export class RoadNavigator {
  private readonly baseNodes: GraphNode[] = [];
  private readonly baseAdj: Array<Array<{ to: number; cost: number }>> = [];

  constructor() {
    // Create 36 intersection nodes (id = ix * 6 + iz)
    for (let ix = 0; ix < GRID_SIZE; ix++) {
      for (let iz = 0; iz < GRID_SIZE; iz++) {
        const id = ix * GRID_SIZE + iz;
        this.baseNodes.push({
          id,
          x: CITY_ROAD_LINES[ix],
          z: CITY_ROAD_LINES[iz],
        });
        this.baseAdj.push([]);
      }
    }

    // Connect 4-way orthogonal road edges
    for (let ix = 0; ix < GRID_SIZE; ix++) {
      for (let iz = 0; iz < GRID_SIZE; iz++) {
        const id = ix * GRID_SIZE + iz;
        if (ix + 1 < GRID_SIZE) {
          const nid = (ix + 1) * GRID_SIZE + iz;
          const cost = Math.abs(CITY_ROAD_LINES[ix + 1] - CITY_ROAD_LINES[ix]);
          this.baseAdj[id].push({ to: nid, cost });
          this.baseAdj[nid].push({ to: id, cost });
        }
        if (iz + 1 < GRID_SIZE) {
          const nid = ix * GRID_SIZE + (iz + 1);
          const cost = Math.abs(CITY_ROAD_LINES[iz + 1] - CITY_ROAD_LINES[iz]);
          this.baseAdj[id].push({ to: nid, cost });
          this.baseAdj[nid].push({ to: id, cost });
        }
      }
    }
  }

  /** Projects an arbitrary world coordinate (x, z) orthogonally onto the closest 6x6 road segment */
  private projectToRoad(px: number, pz: number): ProjectedPoint {
    const minC = CITY_ROAD_LINES[0];
    const maxC = CITY_ROAD_LINES[GRID_SIZE - 1];
    const clampedX = Math.max(minC, Math.min(maxC, px));
    const clampedZ = Math.max(minC, Math.min(maxC, pz));

    let best: ProjectedPoint = {
      x: clampedX,
      z: CITY_ROAD_LINES[0],
      isHorizontal: true,
      roadIndex: 0,
      segLow: 0,
      segHigh: 1,
      distFromSource: Infinity,
    };

    const findSegmentBounds = (val: number): [number, number] => {
      for (let i = 0; i < GRID_SIZE - 1; i++) {
        if (val >= CITY_ROAD_LINES[i] && val <= CITY_ROAD_LINES[i + 1]) {
          return [i, i + 1];
        }
      }
      return val < CITY_ROAD_LINES[0] ? [0, 1] : [GRID_SIZE - 2, GRID_SIZE - 1];
    };

    // Check 6 horizontal roads (constant Z = CITY_ROAD_LINES[iz])
    const [xLow, xHigh] = findSegmentBounds(clampedX);
    for (let iz = 0; iz < GRID_SIZE; iz++) {
      const rz = CITY_ROAD_LINES[iz];
      const d = Math.hypot(px - clampedX, pz - rz);
      if (d < best.distFromSource) {
        best = {
          x: clampedX,
          z: rz,
          isHorizontal: true,
          roadIndex: iz,
          segLow: xLow,
          segHigh: xHigh,
          distFromSource: d,
        };
      }
    }

    // Check 6 vertical roads (constant X = CITY_ROAD_LINES[ix])
    const [zLow, zHigh] = findSegmentBounds(clampedZ);
    for (let ix = 0; ix < GRID_SIZE; ix++) {
      const rx = CITY_ROAD_LINES[ix];
      const d = Math.hypot(px - rx, pz - clampedZ);
      if (d < best.distFromSource) {
        best = {
          x: rx,
          z: clampedZ,
          isHorizontal: false,
          roadIndex: ix,
          segLow: zLow,
          segHigh: zHigh,
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

  /** Computes the shortest path along the 6x6 road network graph using A* */
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

    // If start and goal project onto the exact same road line, connect directly along that road
    if (
      startProj.isHorizontal === goalProj.isHorizontal &&
      startProj.roadIndex === goalProj.roadIndex
    ) {
      const raw: RoutePoint[] = [
        { x: fromX, z: fromZ },
        { x: startProj.x, z: startProj.z },
        { x: goalProj.x, z: goalProj.z },
        { x: toX, z: toZ },
      ];
      return this.finalizePath(raw);
    }

    const START_ID = 36;
    const GOAL_ID = 37;
    const totalNodes = 38;

    const nodes: GraphNode[] = [
      ...this.baseNodes,
      { id: START_ID, x: startProj.x, z: startProj.z },
      { id: GOAL_ID, x: goalProj.x, z: goalProj.z },
    ];

    // Extra dynamic edges attached to intersections (avoid mutating baseAdj)
    const extraAdj = new Map<number, Array<{ to: number; cost: number }>>();
    const addTempEdge = (a: number, b: number, cost: number) => {
      if (!extraAdj.has(a)) extraAdj.set(a, []);
      if (!extraAdj.has(b)) extraAdj.set(b, []);
      extraAdj.get(a)!.push({ to: b, cost });
      extraAdj.get(b)!.push({ to: a, cost });
    };

    const connectProjection = (nodeId: number, proj: ProjectedPoint) => {
      const n1 = proj.isHorizontal
        ? proj.segLow * GRID_SIZE + proj.roadIndex
        : proj.roadIndex * GRID_SIZE + proj.segLow;
      const n2 = proj.isHorizontal
        ? proj.segHigh * GRID_SIZE + proj.roadIndex
        : proj.roadIndex * GRID_SIZE + proj.segHigh;

      const d1 = Math.hypot(proj.x - this.baseNodes[n1].x, proj.z - this.baseNodes[n1].z);
      const d2 = Math.hypot(proj.x - this.baseNodes[n2].x, proj.z - this.baseNodes[n2].z);
      addTempEdge(nodeId, n1, d1);
      addTempEdge(nodeId, n2, d2);
    };

    connectProjection(START_ID, startProj);
    connectProjection(GOAL_ID, goalProj);

    // --- Standard A* Search ---
    const gScore = new Float64Array(totalNodes).fill(Infinity);
    const fScore = new Float64Array(totalNodes).fill(Infinity);
    const cameFrom = new Int16Array(totalNodes).fill(-1);
    const closed = new Uint8Array(totalNodes);
    const inOpen = new Uint8Array(totalNodes);

    const heuristic = (id: number) => {
      const n = nodes[id];
      return Math.abs(n.x - goalProj.x) + Math.abs(n.z - goalProj.z);
    };

    gScore[START_ID] = 0;
    fScore[START_ID] = heuristic(START_ID);
    const openList: number[] = [START_ID];
    inOpen[START_ID] = 1;

    while (openList.length > 0) {
      // Pick node in openList with smallest fScore (totalNodes <= 38, linear scan is ultra-fast)
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

      if (current === GOAL_ID) {
        break;
      }
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
            if (dot < 0.7) {
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

      if (current < 36) {
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

    // Reconstruct polyline
    const roadNodes: RoutePoint[] = [];
    let curr = GOAL_ID;
    let safety = 0;
    while (curr !== -1 && safety < 64) {
      roadNodes.push({ x: nodes[curr].x, z: nodes[curr].z });
      if (curr === START_ID) break;
      curr = cameFrom[curr];
      safety++;
    }
    roadNodes.reverse();

    const raw: RoutePoint[] = [{ x: fromX, z: fromZ }, ...roadNodes, { x: toX, z: toZ }];
    return this.finalizePath(raw);
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

    // Collapse near-collinear interior points to keep vertex count minimal for Line2
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
        if (dot > 0.992) {
          continue; // collinear -> skip intermediate point
        }
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

    // Check current player forward heading against first meaningful path segment
    const fwdX = Math.sin(heading);
    const fwdZ = Math.cos(heading);

    // Find first segment >= 4m from player to evaluate immediate heading alignment
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

    // Scan upcoming vertices for the first significant turn (> ~35 degrees)
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

      if (dot < 0.8) {
        // Right-handed Y-up cross product: (u1 x u2).y = u1z * u2x - u1x * u2z
        // Positive => CCW => LEFT turn (+X when heading +Z)
        // Negative => CW  => RIGHT turn (-X when heading +Z)
        const crossY = u1z * u2x - u1x * u2z;
        const turnDir: TurnDirection = crossY >= 0 ? 'left' : 'right';
        const turnDist = Math.max(1, Math.round(accum));
        const label = turnDir === 'left' ? '좌회전' : '우회전';

        // If turn is very far away (> 140m), tell rider to go straight first
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

    // No turn remaining before destination
    const rem = Math.max(1, Math.round(totalDistance));
    return {
      direction: rem <= 25 ? 'arrive' : 'straight',
      distanceToTurn: rem,
      totalDistance: rem,
      instructionText: rem <= 25 ? `${rem}m 앞 목적지 도착` : `${rem}m 직진`,
    };
  }
}
