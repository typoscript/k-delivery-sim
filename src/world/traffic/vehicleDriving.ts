/** One AI vehicle's frame: bus stop dwell, sensing (cars, player, parked scooter, pedestrians), passing, speed and edge progress */
import { clamp } from '../../types';
import { ACTIVE_MAP_DATA } from '../../data/suwonDistricts';
import { gapAheadOfBody, passShiftFor, shiftedLeft, toBodyFrame } from '../vehicleBodies';
import { SIGNAL_STOP_LINE_OFFSET, edgeDirection, getSignalAxis, laneBlendDecay, signalSpeedCap } from '../TrafficRules';
import type { SignalColor, TrafficSystem } from '../TrafficSystem';
import { computeVehicleWorldPose } from './trafficSpawn';
import {
  AiVehicle,
  BUS_SEGMENTS,
  CAR_SEGMENTS,
  FRONT_RAY_RANGE,
  IGNORE_BLOCKER_SEC,
  MAX_PASS_SHIFT,
  OsmAdjEdge,
  PASS_SPEED_CAP,
  PASS_WAIT_SEC,
  PEDESTRIAN_YIELD_RADIUS,
  PLAYER_COLLISION_PAD,
  PLAYER_RIDING_RADIUS,
  PLAYER_WALK_RADIUS,
  SAFE_FOLLOW_GAP,
  SIGNAL_LOOKAHEAD,
  STUCK_YIELD_SEC,
} from './trafficTypes';

/** Per-frame inputs shared by every vehicle */
export interface DriveFrame {
  clampedDt: number;
  blinkOn: boolean;
  ns: SignalColor;
  ew: SignalColor;
  playerX: number;
  playerZ: number;
  playerSpeedMps: number;
  isRiding: boolean;
  onVehicleCollision: (carX: number, carZ: number) => void;
  onAiCarHorn?: () => void;
  pedestrians?: ReadonlyArray<{
    x: number;
    z: number;
    fsm: string;
    resumeFsm?: string;
  }>;
  parkedScooter?: { x: number; z: number } | null;
}

/** Drives vehicle `v` (index `i`) for one frame, up to (not including) its final pose */
export function driveVehicle(host: TrafficSystem, v: AiVehicle, i: number, f: DriveFrame): void {
  const {
    clampedDt,
    blinkOn,
    ns,
    ew,
    playerX,
    playerZ,
    playerSpeedMps,
    isRiding,
    onVehicleCollision,
    onAiCarHorn,
    pedestrians,
    parkedScooter,
  } = f;
  // Bus stop dwell check
  if (v.isBus && v.busStopWaitTimer > 0) {
    v.busStopWaitTimer = Math.max(0, v.busStopWaitTimer - clampedDt);
    v.speed = Math.max(0, v.speed - 14 * clampedDt);
    v.braking = true;
    v.hazardOn = blinkOn;
  } else {
    v.hazardOn = false;

    if (v.isBus && v.busStopCooldown <= 0) {
      for (const bs of host.busStops) {
        if (Math.hypot(v.x - bs.x, v.z - bs.z) < 4.5) {
          v.busStopWaitTimer = 3.2;
          v.busStopCooldown = 26.0;
          break;
        }
      }
    }

    const fx = Math.sin(v.heading);
    const fz = Math.cos(v.heading);
    const distToNode = Math.max(0, v.edgeDist - v.progress);

    let targetSpd = v.cruiseSpeed;
    let emergency = false;

    // Pre-pick the next edge on approach so a short follow-on edge into a signal is braked for in time
    if (!v.nextEdge && distToNode < SIGNAL_LOOKAHEAD) {
      v.nextEdge = pickNextEdge(host, v);
    }

    // Traffic light: smooth braking profile to the stop line (works on short approach edges too)
    targetSpd = Math.min(targetSpd, signalCapFor(v, distToNode, ns, ew));

    // Forward 12m raycast against other AI vehicles & player scooter
    host.frontRay.origin.set(v.x + fx * (v.halfLength + 0.2), 0.7, v.z + fz * (v.halfLength + 0.2));
    host.frontRay.direction.set(fx, 0, fz);

    if (v.ignoreTimer > 0) {
      v.ignoreTimer = Math.max(0, v.ignoreTimer - clampedDt);
      if (v.ignoreTimer === 0) v.ignoreIdx = -1;
    }

    let minGap = Infinity;
    let blocker = -1;
    for (let j = 0; j < host.vehicles.length; j++) {
      if (i === j || j === v.ignoreIdx) continue;
      const o = host.vehicles[j];
      const dSq = (o.x - v.x) ** 2 + (o.z - v.z) ** 2;
      if (dSq > 625) continue;
      const gap = rayGapToVehicle(host, o);
      if (gap < minGap) {
        minGap = gap;
        blocker = j;
      }
    }
    const aiGap = minGap;

    // Player (riding or on foot) in our swept lane ahead, incl. right at the front corners
    const toPlX = playerX - v.x;
    const toPlZ = playerZ - v.z;
    const distPl = Math.hypot(toPlX, toPlZ);
    if (distPl < FRONT_RAY_RANGE + v.halfLength + 2) {
      const plGap = gapAheadOfBody(
        v,
        playerX,
        playerZ,
        isRiding ? PLAYER_RIDING_RADIUS : PLAYER_WALK_RADIUS,
        FRONT_RAY_RANGE,
      );
      if (plGap < minGap) {
        minGap = plGap;
        if (isRiding && plGap < 5.2 && v.speed > 3.0) {
          emergency = true;
          if (!v.playerCutInActive && v.hornCooldown <= 0) {
            v.playerCutInActive = true;
            v.hornCooldown = 5.0;
            onAiCarHorn?.();
          }
        }
      }
      if (plGap === Infinity) v.playerCutInActive = false;

      // Direct physical collision with riding player (heading-aligned body rectangle)
      const along = toPlX * fx + toPlZ * fz;
      const side = toPlX * -fz + toPlZ * fx;
      if (
        isRiding &&
        Math.abs(along) < v.halfLength + PLAYER_COLLISION_PAD &&
        Math.abs(side) < v.halfWidth + PLAYER_COLLISION_PAD &&
        Math.abs(playerSpeedMps) > 3.2
      ) {
        onVehicleCollision(v.x, v.z);
      }
    } else {
      v.playerCutInActive = false;
    }

    // Parked scooter left on the road: stop behind it like any other obstacle
    let standing: { x: number; z: number; gap: number } | null = null;
    if (parkedScooter) {
      const scGap = gapAheadOfBody(v, parkedScooter.x, parkedScooter.z, PLAYER_RIDING_RADIUS, FRONT_RAY_RANGE);
      if (scGap < minGap) minGap = scGap;
      if (scGap < SAFE_FOLLOW_GAP + 1) standing = { x: parkedScooter.x, z: parkedScooter.z, gap: scGap };
    } else if (isRiding && Math.abs(playerSpeedMps) < 0.3) {
      const plGap = gapAheadOfBody(v, playerX, playerZ, PLAYER_RIDING_RADIUS, FRONT_RAY_RANGE);
      if (plGap < SAFE_FOLLOW_GAP + 1) standing = { x: playerX, z: playerZ, gap: plGap };
    }
    updatePass(host, v, i, standing, clampedDt);

    // Yield to pedestrians crossing the road (or lying fallen / startled in it) inside our lane ahead
    if (pedestrians) {
      for (const pd of pedestrians) {
        const onRoad =
          pd.fsm === 'CROSSING' || pd.fsm === 'FALLEN' || (pd.fsm === 'STARTLED' && pd.resumeFsm === 'CROSSING');
        if (!onRoad) continue;
        const px = pd.x - v.x;
        const pz = pd.z - v.z;
        if (px * px + pz * pz > 400) continue;
        const pedGap = gapAheadOfBody(v, pd.x, pd.z, PEDESTRIAN_YIELD_RADIUS, FRONT_RAY_RANGE + 6);
        if (pedGap < minGap) minGap = pedGap;
      }
    }

    // Cross-traffic deadlock breaker: two cars nosed into each other at an unsignalized junction.
    // Queues (same direction) never trigger it; the player is never ignored.
    v.blockedBy = aiGap < SAFE_FOLLOW_GAP ? blocker : -1;
    if (v.blockedBy >= 0 && v.speed < 0.3 && minGap === aiGap) {
      const o = host.vehicles[v.blockedBy];
      const sameDir = fx * Math.sin(o.heading) + fz * Math.cos(o.heading) > 0.85;
      v.stuckTimer = sameDir ? 0 : v.stuckTimer + clampedDt;
      // Mutual block -> lower index gets right of way; one-sided block -> go after a wait
      if (v.stuckTimer > STUCK_YIELD_SEC && (o.blockedBy !== i || i < v.blockedBy)) {
        v.ignoreIdx = v.blockedBy;
        v.ignoreTimer = IGNORE_BLOCKER_SEC;
        v.stuckTimer = 0;
      }
    } else {
      v.stuckTimer = 0;
    }

    if (minGap < SAFE_FOLLOW_GAP) {
      targetSpd = 0;
    } else if (minGap < FRONT_RAY_RANGE) {
      targetSpd = Math.min(
        targetSpd,
        v.cruiseSpeed * ((minGap - SAFE_FOLLOW_GAP) / (FRONT_RAY_RANGE - SAFE_FOLLOW_GAP)),
      );
    }

    if (v.passTarget > 0 || v.passOffset > 0.05) targetSpd = Math.min(targetSpd, PASS_SPEED_CAP);

    const accelRate = emergency ? 18 : targetSpd < v.speed ? 11 : 4.2;
    v.speed += clamp(targetSpd - v.speed, -accelRate * clampedDt, accelRate * clampedDt);
    v.braking = targetSpd < v.speed - 0.5 || v.speed < 0.2;
    v.driveState = emergency ? 'EMERGENCY_BRAKE' : v.speed < 0.2 ? 'STOPPED' : v.braking ? 'DECELERATING' : 'CRUISING';

    const travelled = v.speed * clampedDt;
    v.progress += travelled;
    const decay = laneBlendDecay(travelled);
    v.blendX *= decay;
    v.blendZ *= decay;
    if (v.progress >= v.edgeDist) {
      const nextEdge = v.nextEdge ?? pickNextEdge(host, v);
      v.nextEdge = null;
      const carry = v.progress - v.edgeDist;
      // Pulled-out cars merge back at the next node (the lane blend smooths the jump)
      v.passTarget = 0;
      v.fromNode = v.toNode;
      v.toNode = nextEdge.to;
      v.edgeDist = nextEdge.dist;
      v.edgeWidth = nextEdge.width;
      v.progress = Math.min(carry, Math.max(0, v.edgeDist - 0.2));
      // Carry the visible position across the node: the lane-offset jump is blended out while driving
      const np = computeVehicleWorldPose(v.fromNode, v.toNode, v.progress, v.edgeDist, v.edgeWidth);
      v.blendX = v.x - np.x;
      v.blendZ = v.z - np.z;
    }
  }
}

/**
 * Going around a scooter standing in the lane (parked, or the rider stopped): after PASS_WAIT_SEC stopped
 * behind it, pull out left just enough to clear it if that path is free of other cars, creep past, and
 * merge back once it is behind us (or at the next node).
 */
export function updatePass(
  host: TrafficSystem,
  v: AiVehicle,
  idx: number,
  standing: { x: number; z: number; gap: number } | null,
  dt: number,
): void {
  if (v.passTarget > 0) {
    const { along } = toBodyFrame(v, v.passObsX, v.passObsZ);
    if (along < -(v.halfLength + 1.5)) v.passTarget = 0;
    return;
  }
  if (!standing || v.speed > 0.3) {
    v.passWait = 0;
    return;
  }
  v.passWait += dt;
  if (v.passWait < PASS_WAIT_SEC) return;
  const shift = passShiftFor(v, standing.x, standing.z, PLAYER_RIDING_RADIUS);
  if (shift <= 0 || shift > MAX_PASS_SHIFT) return;
  // The pulled-out path must be free of other cars (oncoming or parked in it) for the next 20m
  const out = shiftedLeft(v, shift);
  for (let j = 0; j < host.vehicles.length; j++) {
    if (j === idx) continue;
    const o = host.vehicles[j];
    if ((o.x - v.x) ** 2 + (o.z - v.z) ** 2 > 900) continue;
    if (gapAheadOfBody(out, o.x, o.z, o.halfWidth + 0.4, 20) < Infinity) return;
  }
  v.passTarget = shift;
  v.passObsX = standing.x;
  v.passObsZ = standing.z;
  v.passWait = 0;
}

/** Forward-ray gap to vehicle `o` using its segment chain (Infinity if the ray misses) */
export function rayGapToVehicle(host: TrafficSystem, o: AiVehicle): number {
  const fx = Math.sin(o.heading);
  const fz = Math.cos(o.heading);
  const r = o.halfWidth;
  let best = Infinity;
  for (const off of o.isBus ? BUS_SEGMENTS : CAR_SEGMENTS) {
    const cx = o.x + fx * off;
    const cz = o.z + fz * off;
    host.tmpMin.set(cx - r, 0, cz - r);
    host.tmpMax.set(cx + r, 2.5, cz + r);
    host.tmpBox.set(host.tmpMin, host.tmpMax);
    if (host.frontRay.intersectBox(host.tmpBox, host.rayHitPoint)) {
      const gap = host.frontRay.origin.distanceTo(host.rayHitPoint);
      if (gap < best) best = gap;
    }
  }
  return best;
}

/** Speed cap from red/yellow signals on the current edge and (looking ahead) the pre-picked next edge */
export function signalCapFor(v: AiVehicle, distToNode: number, ns: SignalColor, ew: SignalColor): number {
  const nodes = ACTIVE_MAP_DATA.nodes;
  let cap = Infinity;
  if (nodes[v.toNode].isSignal && distToNode - SIGNAL_STOP_LINE_OFFSET < SIGNAL_LOOKAHEAD) {
    const d = edgeDirection(v.fromNode, v.toNode);
    const sig = getSignalAxis(v.toNode, d.fx, d.fz) === 'ns' ? ns : ew;
    cap = Math.min(cap, signalSpeedCap(v.speed, distToNode - SIGNAL_STOP_LINE_OFFSET, sig));
  }
  const ne = v.nextEdge;
  if (ne && nodes[ne.to].isSignal) {
    const stopDist = distToNode + ne.dist - SIGNAL_STOP_LINE_OFFSET;
    if (stopDist < SIGNAL_LOOKAHEAD) {
      const d = edgeDirection(v.toNode, ne.to);
      const sig = getSignalAxis(ne.to, d.fx, d.fz) === 'ns' ? ns : ew;
      cap = Math.min(cap, signalSpeedCap(v.speed, stopDist, sig));
    }
  }
  return cap;
}

export function pickNextEdge(host: TrafficSystem, v: AiVehicle): OsmAdjEdge {
  const outs = host.adj[v.toNode];
  const nodes = ACTIVE_MAP_DATA.nodes;
  const prevA = nodes[v.fromNode];
  const cur = nodes[v.toNode];
  const inDx = cur.x - prevA.x;
  const inDz = cur.z - prevA.z;
  const inLen = Math.hypot(inDx, inDz) || 1;
  const inUx = inDx / inLen;
  const inUz = inDz / inLen;

  let candidates = outs.filter((e) => e.to !== v.fromNode);
  if (v.isBus) {
    const majorOnly = candidates.filter((e) => e.isMajor);
    if (majorOnly.length > 0) candidates = majorOnly;
  }
  if (candidates.length === 0) candidates = outs;

  // Prefer going roughly straight (dot > 0.4) 65% of the time for realistic boulevard flow
  const straight = candidates.filter((e) => {
    const nb = nodes[e.to];
    const dx = nb.x - cur.x;
    const dz = nb.z - cur.z;
    const l = Math.hypot(dx, dz) || 1;
    return (dx / l) * inUx + (dz / l) * inUz > 0.45;
  });
  if (straight.length > 0 && Math.random() < 0.65) {
    return straight[Math.floor(Math.random() * straight.length)];
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}
