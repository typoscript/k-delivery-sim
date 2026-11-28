/** Route search on the road graph: projecting points onto the nearest road, A* with turn and construction penalties, and the finished path */
import type { AStarPathResult, RoadNavigator, RoutePoint } from '../RoadNavigator';

/** Extra route cost of a construction segment: the planner detours unless the way around is much longer */
export const ROADWORK_DETOUR_METERS = 220;

export interface GraphNode {
  id: number;
  x: number;
  z: number;
}

export interface GraphEdge {
  a: number;
  b: number;
  cost: number;
}

export interface ProjectedPoint {
  x: number;
  z: number;
  edgeIdx: number;
  a: number;
  b: number;
  distFromSource: number;
}

/** Extra route cost of every turn (prefers straighter routes of similar length) */
export const TURN_PENALTY_METERS = 3.5;

/** Undirected edge id (smaller node id first) */
export const edgeKey = (a: number, b: number) => (a < b ? a * 1_000_000 + b : b * 1_000_000 + a);

/** Projects an arbitrary world coordinate (x, z) onto the closest real Suwon OSM road segment */
export function projectToRoad(host: RoadNavigator, px: number, pz: number): ProjectedPoint {
  let best: ProjectedPoint = {
    x: px,
    z: pz,
    edgeIdx: 0,
    a: 0,
    b: 0,
    distFromSource: Infinity,
  };

  for (let i = 0; i < host.baseEdges.length; i++) {
    const e = host.baseEdges[i];
    const na = host.baseNodes[e.a];
    const nb = host.baseNodes[e.b];
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
export function estimateRoadDistance(
  host: RoadNavigator,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
): number {
  return host.findShortestPath(fromX, fromZ, toX, toZ).distance;
}

/** Computes the shortest path along the real Suwon Ingye-dong OSM road graph using A* */
export function findShortestPath(
  host: RoadNavigator,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
): AStarPathResult {
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

  const startProj = host.projectToRoad(fromX, fromZ);
  const goalProj = host.projectToRoad(toX, toZ);

  // Same road segment -> direct along that road!
  if (startProj.edgeIdx === goalProj.edgeIdx) {
    const direct = finalizePath([
      { x: fromX, z: fromZ },
      { x: startProj.x, z: startProj.z },
      { x: goalProj.x, z: goalProj.z },
      { x: toX, z: toZ },
    ]);
    if (host.isRoadwork(startProj.a, startProj.b)) {
      const na = host.baseNodes[startProj.a];
      const nb = host.baseNodes[startProj.b];
      direct.roadworks = 1;
      direct.roadworkPoints = [{ x: (na.x + nb.x) / 2, z: (na.z + nb.z) / 2 }];
    }
    return direct;
  }

  const baseCount = host.baseNodes.length;
  const START_ID = baseCount;
  const GOAL_ID = baseCount + 1;
  const totalNodes = baseCount + 2;

  const nodes: GraphNode[] = [
    ...host.baseNodes,
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
    const na = host.baseNodes[proj.a];
    const nb = host.baseNodes[proj.b];
    addTempEdge(nodeId, proj.a, Math.hypot(proj.x - na.x, proj.z - na.z));
    addTempEdge(nodeId, proj.b, Math.hypot(proj.x - nb.x, proj.z - nb.z));
  };

  connectProjection(START_ID, startProj);
  connectProjection(GOAL_ID, goalProj);

  /** A* over the road graph; `penalty` adds the construction detour cost (off: what the route would be without it) */
  const search = (penalty: boolean) => {
    let touchedRoadwork = false;
    // --- Standard A* Search (Euclidean admissible heuristic for arbitrary OSM angles) ---
    const gScore = new Float64Array(totalNodes).fill(Infinity);
    const fScore = new Float64Array(totalNodes).fill(Infinity);
    const cameFrom = new Int32Array(totalNodes).fill(-1);
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

        const isRoadwork =
          host.roadworkKeys.size > 0 &&
          current < baseCount &&
          to < baseCount &&
          host.roadworkKeys.has(edgeKey(current, to));
        if (isRoadwork) touchedRoadwork = true;
        const roadwork = isRoadwork && penalty ? ROADWORK_DETOUR_METERS : 0;
        const tentativeG = gScore[current] + edgeCost + turnPenalty + roadwork;
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
        for (const e of host.baseAdj[current]) {
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
    let roadworks = 0;
    const roadworkPoints: RoutePoint[] = [];
    let curr = GOAL_ID;
    let safety = 0;
    while (curr !== -1 && safety <= totalNodes) {
      roadNodes.push({ x: nodes[curr].x, z: nodes[curr].z });
      const from = cameFrom[curr];
      if (from !== -1 && curr < baseCount && from < baseCount && host.isRoadwork(curr, from)) {
        roadworks++;
        roadworkPoints.push({ x: (nodes[curr].x + nodes[from].x) / 2, z: (nodes[curr].z + nodes[from].z) / 2 });
      }
      if (curr === START_ID) break;
      curr = cameFrom[curr];
      safety++;
    }
    roadNodes.reverse();
    return { roadNodes, roadworks, roadworkPoints, touchedRoadwork };
  };

  const found = search(true);
  const { roadNodes, roadworks, roadworkPoints } = found;
  // The search ran into construction but the route avoids it: was that a detour? (the unpenalized route uses it)
  const avoided = found.touchedRoadwork && roadworks === 0 ? search(false).roadworks : 0;

  if (roadNodes.length < 2) {
    return finalizePath([
      { x: fromX, z: fromZ },
      { x: toX, z: toZ },
    ]);
  }

  const result = finalizePath([{ x: fromX, z: fromZ }, ...roadNodes, { x: toX, z: toZ }]);
  if (roadworks > 0) {
    result.roadworks = roadworks;
    result.roadworkPoints = roadworkPoints;
  }
  if (avoided > 0) result.avoidedRoadworks = avoided;
  return result;
}

/** Removes duplicate and redundant collinear vertices and computes exact polyline length */
export function finalizePath(raw: RoutePoint[]): AStarPathResult {
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
