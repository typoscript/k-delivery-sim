/** Placing police / rivals on roads near the player, recycling them when they drift away, their next road edge, and culling far static props */
import type { RoadHazardManager } from '../RoadHazardManager';
import { ACTIVE_MAP_DATA } from '../../data/suwonDistricts';
import {
  HAZARD_RECYCLE_DISTANCE,
  HAZARD_RESPAWN_MAX_RADIUS,
  HAZARD_RESPAWN_MIN_RADIUS,
  OsmAdjEdge,
  PolicePatrolUnit,
  RivalRiderUnit,
  STATIC_PROP_VISIBLE_DIST,
} from './hazardTypes';

/** Max distance a respawned unit ends up from its picked start node (15m progress + lane offset) */
const SPAWN_SLACK_M = 18;

/**
 * Picks a road edge whose start node lies minR~maxR from (x, z), away from the other moving units.
 * preferMajor: try nodes on major roads first and leave along a major edge when possible.
 */
export function pickSpawnEdge(
  host: RoadHazardManager,
  x: number,
  z: number,
  minR: number,
  maxR: number,
  preferMajor: boolean,
  self: { x: number; z: number },
): { from: number; edge: OsmAdjEdge } | null {
  const others = [...host.patrolCars, ...host.rivalRiders].filter((u) => u !== self);
  const nodes = ACTIVE_MAP_DATA.nodes;
  const clear = (id: number) => {
    const n = nodes[id];
    return !others.some((o) => Math.abs(o.x - n.x) < 14 && Math.abs(o.z - n.z) < 14);
  };
  const grids = preferMajor ? [host.majorNodeGrid, host.nodeGrid] : [host.nodeGrid];
  for (const grid of grids) {
    const id = grid.randomWithin(x, z, minR, maxR, (nid) => host.adj[nid].some((e) => e.dist >= 8) && clear(nid));
    if (id < 0) continue;
    let outs = host.adj[id].filter((e) => e.dist >= 8);
    if (preferMajor) {
      const maj = outs.filter((e) => e.isMajor);
      if (maj.length > 0) outs = maj;
    }
    return { from: id, edge: outs[Math.floor(Math.random() * outs.length)] };
  }
  return null;
}

/** Moves a police car / rival rider onto a fresh edge near (x, z). Returns false when no road qualifies. */
export function respawnMovingUnit(
  host: RoadHazardManager,
  u: PolicePatrolUnit | RivalRiderUnit,
  x: number,
  z: number,
  minR: number,
  maxR: number,
  preferMajor: boolean,
  laneFrac: number,
): boolean {
  // The unit moves up to 15m along the edge plus its lane offset: keep that slack inside maxR
  const pick = host.pickSpawnEdge(x, z, minR, Math.max(minR, maxR - SPAWN_SLACK_M), preferMajor, u);
  if (!pick) return false;
  const { from, edge } = pick;
  u.fromNode = from;
  u.toNode = edge.to;
  u.edgeDist = edge.dist;
  u.edgeWidth = edge.width;
  // Stay close to the picked start node (<= 15m) so the unit really lands inside the requested ring
  u.progress = Math.min(edge.dist * 0.25, 15, Math.max(0, edge.dist - 0.2));
  u.blendX = 0;
  u.blendZ = 0;
  u.speed = u.cruiseSpeed * 0.7;
  const pose = host.computeEdgePose(from, edge.to, u.progress, edge.dist, edge.width, laneFrac);
  u.x = pose.x;
  u.z = pose.z;
  u.heading = pose.heading;
  u.group.position.set(u.x, 0, u.z);
  u.group.rotation.y = u.heading;
  return true;
}

/** Respawns police / rivals that drifted > HAZARD_RECYCLE_DISTANCE away to 120~250m from the player */
export function recycleMovingUnits(host: RoadHazardManager, playerX: number, playerZ: number): number {
  const farSq = HAZARD_RECYCLE_DISTANCE * HAZARD_RECYCLE_DISTANCE;
  let moved = 0;
  const isFar = (u: { x: number; z: number }) =>
    (u.x - playerX) * (u.x - playerX) + (u.z - playerZ) * (u.z - playerZ) > farSq;
  host.patrolCars.forEach((p, i) => {
    if (!isFar(p)) return;
    if (host.respawnMovingUnit(p, playerX, playerZ, HAZARD_RESPAWN_MIN_RADIUS, HAZARD_RESPAWN_MAX_RADIUS, true, 0.25)) {
      p.sirenTimer = 0;
      host.patrolMarkers[i].x = p.x;
      host.patrolMarkers[i].z = p.z;
      host.patrolMarkers[i].heading = p.heading;
      host.patrolMarkers[i].sirenActive = false;
      moved++;
    }
  });
  host.rivalRiders.forEach((r, i) => {
    if (!isFar(r)) return;
    if (
      host.respawnMovingUnit(r, playerX, playerZ, HAZARD_RESPAWN_MIN_RADIUS, HAZARD_RESPAWN_MAX_RADIUS, false, 0.22)
    ) {
      host.rivalRiderMarkers[i].x = r.x;
      host.rivalRiderMarkers[i].z = r.z;
      host.rivalRiderMarkers[i].heading = r.heading;
      moved++;
    }
  });
  host.recycledCount += moved;
  return moved;
}

/** @internal hazards/* */
export function pickNextGraphEdge(
  host: RoadHazardManager,
  fromNode: number,
  toNode: number,
  preferMajor: boolean,
): OsmAdjEdge {
  const outs = host.adj[toNode];
  const nodes = ACTIVE_MAP_DATA.nodes;
  const prev = nodes[fromNode];
  const cur = nodes[toNode];
  const inDx = cur.x - prev.x;
  const inDz = cur.z - prev.z;
  const inLen = Math.hypot(inDx, inDz) || 1;
  const inUx = inDx / inLen;
  const inUz = inDz / inLen;

  let cands = outs.filter((e) => e.to !== fromNode);
  if (preferMajor) {
    const maj = cands.filter((e) => e.isMajor);
    if (maj.length > 0) cands = maj;
  }
  if (cands.length === 0) cands = outs;

  const straight = cands.filter((e) => {
    const nb = nodes[e.to];
    const dx = nb.x - cur.x;
    const dz = nb.z - cur.z;
    const l = Math.hypot(dx, dz) || 1;
    return (dx / l) * inUx + (dz / l) * inUz > 0.4;
  });
  if (straight.length > 0 && Math.random() < 0.65) {
    return straight[Math.floor(Math.random() * straight.length)];
  }
  return cands[Math.floor(Math.random() * cands.length)];
}

export function updateStaticPropVisibility(host: RoadHazardManager, playerX: number, playerZ: number): void {
  const maxSq = STATIC_PROP_VISIBLE_DIST * STATIC_PROP_VISIBLE_DIST;
  for (const p of host.staticProps) {
    const dx = p.x - playerX;
    const dz = p.z - playerZ;
    p.group.visible = dx * dx + dz * dz <= maxSq;
  }
}
