/** Placing AI vehicles on the road graph: lane pose, the initial fleet, and recycling cars near the player */
import { clamp } from '../../types';
import { ACTIVE_MAP_DATA } from '../../data/suwonDistricts';
import { VehicleFleetRenderer } from '../VehicleFleetRenderer';
import type { TrafficSystem } from '../TrafficSystem';
import { ACTIVE_SPAWN_RADIUS, AiVehicle } from './trafficTypes';
import { drivingLaneOffset, isOneWayAlong } from '../roadDirections';

export function computeVehicleWorldPose(
  fromId: number,
  toId: number,
  progress: number,
  edgeDist: number,
  edgeWidth: number,
): { x: number; z: number; heading: number } {
  const a = ACTIVE_MAP_DATA.nodes[fromId];
  const b = ACTIVE_MAP_DATA.nodes[toId];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.max(0.1, edgeDist);
  const fx = dx / len;
  const fz = dz / len;
  // Right-hand lane offset per AGENTS.md: right = forward x up = (-fz, 0, fx)
  const rx = -fz;
  const rz = fx;
  const laneOffset = drivingLaneOffset(edgeWidth, isOneWayAlong(fromId, toId));

  const t = clamp(progress / len, 0, 1);
  return {
    x: a.x + dx * t + rx * laneOffset,
    z: a.z + dz * t + rz * laneOffset,
    heading: Math.atan2(fx, fz),
  };
}

export function spawnTrafficVehicles(host: TrafficSystem): void {
  const palette: Array<[number, string, boolean]> = [
    [0xf8fafc, '#f8fafc', false],
    [0x94a3b8, '#94a3b8', false],
    [0x1e293b, '#1e293b', false],
    [0x3b82f6, '#3b82f6', false],
    [0xf97316, '#f97316', true], // Taxi!
    [0xe2e8f0, '#e2e8f0', true], // Silver Suwon Taxi!
    [0xef4444, '#ef4444', false],
    [0x64748b, '#64748b', false],
  ];

  let pool = host.majorNodeIds.length > 0 ? host.majorNodeIds : ACTIVE_MAP_DATA.nodes.map((n) => n.id);
  if (ACTIVE_MAP_DATA.meta.unified) {
    // City-sized map: start traffic on the arterials around the spawn instead of scattered over 6km
    const sp = ACTIVE_MAP_DATA.meta.scooterSpawn;
    const nodes = ACTIVE_MAP_DATA.nodes;
    pool = [...pool]
      .sort(
        (a, b) => Math.hypot(nodes[a].x - sp.x, nodes[a].z - sp.z) - Math.hypot(nodes[b].x - sp.x, nodes[b].z - sp.z),
      )
      .slice(0, 60);
  }
  const total = 24;
  const busCount = 4;
  const carColors: number[] = [];
  const carTaxi: boolean[] = [];
  for (let i = busCount; i < total; i++) {
    const [hex, , isTaxi] = palette[i % palette.length];
    carColors.push(hex);
    carTaxi.push(isTaxi);
  }
  host.fleet = new VehicleFleetRenderer(host.root, carColors, carTaxi, busCount);

  for (let i = 0; i < total; i++) {
    const isBus = i < busCount;
    const [, css, isTaxi] = isBus ? [0x059669, '#059669', false] : palette[i % palette.length];

    const startNode = pool[Math.floor((i * 7) % pool.length)];
    const outs = host.adj[startNode];
    const preferred = isBus ? outs.filter((e) => e.isMajor) : outs;
    const chosen = (preferred.length > 0 ? preferred : outs)[0];
    if (!chosen) continue;

    const prog = Math.random() * chosen.dist * 0.7;
    const pose = computeVehicleWorldPose(startNode, chosen.to, prog, chosen.dist, chosen.width);

    host.vehicles.push({
      renderIndex: isBus ? i : i - busCount,
      wheelSpin: 0,
      hazardOn: false,
      isBus,
      isTaxi,
      driveState: 'CRUISING',
      fromNode: startNode,
      toNode: chosen.to,
      edgeDist: chosen.dist,
      edgeWidth: chosen.width,
      progress: prog,
      x: pose.x,
      z: pose.z,
      heading: pose.heading,
      speed: isBus ? 7.5 : 9.5 + (i % 4) * 1.1,
      cruiseSpeed: isBus ? 8.2 : 10.0 + (i % 4) * 1.2,
      braking: false,
      busStopWaitTimer: 0,
      busStopCooldown: 0,
      playerCutInActive: false,
      hornCooldown: 0,
      colorHex: css,
      halfWidth: isBus ? 1.25 : 0.96,
      halfLength: isBus ? 4.35 : 2.15,
      nextEdge: null,
      blendX: 0,
      blendZ: 0,
      stuckTimer: 0,
      blockedBy: -1,
      ignoreIdx: -1,
      ignoreTimer: 0,
      passOffset: 0,
      passTarget: 0,
      passWait: 0,
      passObsX: 0,
      passObsZ: 0,
    });
  }
}

/** A car that wandered more than ACTIVE_SPAWN_RADIUS from the player moves to a major road 65~145m away */
export function recycleVehicle(host: TrafficSystem, v: AiVehicle, playerX: number, playerZ: number): void {
  const nodes = ACTIVE_MAP_DATA.nodes;
  const dPlayer = Math.hypot(v.x - playerX, v.z - playerZ);
  if (dPlayer > ACTIVE_SPAWN_RADIUS) {
    const nearbyNodes = host.majorNodeIds.filter((nid) => {
      const d = Math.hypot(nodes[nid].x - playerX, nodes[nid].z - playerZ);
      return d >= 65 && d <= 145;
    });
    if (nearbyNodes.length > 0) {
      const pick = nearbyNodes[Math.floor(Math.random() * nearbyNodes.length)];
      const outs = host.adj[pick];
      const usable = v.isBus ? outs.filter((e) => e.isMajor) : outs;
      if (usable.length > 0) {
        const ed = usable[Math.floor(Math.random() * usable.length)];
        const spawn = computeVehicleWorldPose(pick, ed.to, 2.0, ed.dist, ed.width);
        // Don't drop the car on top of another one already occupying that lane
        const occupied = host.vehicles.some(
          (o) => o !== v && Math.hypot(o.x - spawn.x, o.z - spawn.z) < o.halfLength + v.halfLength + 2,
        );
        if (!occupied) {
          v.fromNode = pick;
          v.toNode = ed.to;
          v.edgeDist = ed.dist;
          v.edgeWidth = ed.width;
          v.progress = 2.0;
          v.nextEdge = null;
          v.blendX = 0;
          v.blendZ = 0;
          v.x = spawn.x;
          v.z = spawn.z;
          v.heading = spawn.heading;
          v.stuckTimer = 0;
          v.ignoreIdx = -1;
          v.passTarget = 0;
          v.passOffset = 0;
          v.passWait = 0;
        }
      }
    }
  }
}
