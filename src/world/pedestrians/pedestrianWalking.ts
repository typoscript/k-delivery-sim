/** Pedestrian navigation: sidewalk walking (yield + detour), waiting at / crossing roads, path following */
import { isMarkedCrossingSafe, isRoadCrossingClear, overlapsBody, pushOutOfBodies, type VehicleBody } from '../vehicleBodies';
import type { SignalStateSnapshot } from '../TrafficSystem';
import type {
  PedestrianAgent,
  PedestrianCollisionEvent,
  PedestrianManager,
  ScooterProximityInfo,
} from '../PedestrianManager';
import { evaluatePedestrianSignal } from '../PedestrianManager';
import { PedestrianFactory } from '../PedestrianFactory';
import {
  BLINK_RUN_MULTIPLIER,
  CAR_CHECK_RANGE_SQ,
  CAR_LOOKAHEAD_M,
  CROSS_LOOK_INTERVAL_SEC,
  CROSS_WAIT_GIVE_UP_SEC,
  DETOUR_SPEED,
  PEDESTRIAN_BODY_RADIUS,
  ROAD_Y,
  SIDEWALK_YIELD_SEC,
  SIDEWALK_Y,
} from './pedestrianTuning';

/** Per-frame inputs shared by every pedestrian */
export interface PedFrame {
  dt: number;
  signal: SignalStateSnapshot;
  playerX: number;
  playerZ: number;
  scooter: ScooterProximityInfo;
  scooterSpeedKmh: number;
  /** Riding at >= PEDESTRIAN_COLLISION_MIN_KMH and not crashed */
  canCollide: boolean;
  /** Only one pedestrian can be hit per frame */
  collisionTriggered: boolean;
  onPedestrianCollision?: (event: PedestrianCollisionEvent) => void;
  onPedestrianStartled?: () => void;
  cars: readonly VehicleBody[];
}

/** Per-pedestrian values the manager computes first (heading target, visibility, level of detail) */
export interface AgentFrame {
  targetNode: { x: number; z: number };
  dx: number;
  dz: number;
  distToTarget: number;
  isVisible: boolean;
  fullDetail: boolean;
}

/** Section D: walking / waiting / crossing, then movement, curb height and the walk animation */
export function stepNavigation(host: PedestrianManager, a: PedestrianAgent, f: PedFrame, g: AgentFrame): void {
  // --- D. Standard FSM Navigation (WALKING / WAITING_CROSSWALK / CROSSING) ---
  let desiredSpeed = a.walkSpeed;

  if (a.fsm === 'WAITING_CROSSWALK') {
    desiredSpeed = 0;

    // Face across the crosswalk while waiting at the yellow tactile pad
    if (g.distToTarget > 0.1) {
      a.heading = lerpAngle(a.heading, Math.atan2(g.dx, g.dz), Math.min(1, f.dt * 8));
    }

    if (a.activeEdge.kind === 'crosswalk') {
      // Crosswalk light turned solid green -> step off curb and start CROSSING (unless a car sits on it)
      const pedSig = evaluatePedestrianSignal(a.activeEdge.crossingAxis ?? 'ns', f.signal);
      if (
        pedSig === 'green' &&
        !carBlocksPath(host, a.x, a.z, g.dx / (g.distToTarget || 1), g.dz / (g.distToTarget || 1))
      ) {
        a.fsm = 'CROSSING';
        desiredSpeed = a.walkSpeed;
      }
    } else {
      // No f.signal: look both ways and go only when no car will reach the crossing before we are across.
      // Traffic prediction is the costly part, so look ~3 times a second (and right on arrival)
      const prevWait = a.crossWaitTimer;
      a.crossWaitTimer += f.dt;
      const look =
        prevWait === 0 ||
        Math.floor(prevWait / CROSS_LOOK_INTERVAL_SEC) !== Math.floor(a.crossWaitTimer / CROSS_LOOK_INTERVAL_SEC);
      // a painted crosswalk: cars must stop (they see where it leads), so only a car too close to stop matters
      a.markedCrossTo = a.activeEdge.marked ? { x: g.targetNode.x, z: g.targetNode.z } : null;
      const clear =
        look &&
        (a.activeEdge.marked
          ? isMarkedCrossingSafe(a.x, a.z, g.targetNode.x, g.targetNode.z, f.cars)
          : isRoadCrossingClear(a.x, a.z, g.targetNode.x, g.targetNode.z, f.cars, a.walkSpeed));
      if (clear) {
        a.fsm = 'CROSSING';
        a.crossWaitTimer = 0;
        desiredSpeed = a.walkSpeed;
      } else if (a.crossWaitTimer > CROSS_WAIT_GIVE_UP_SEC) {
        walkOnInstead(host, a);
        return;
      }
    }
  } else if (a.fsm === 'CROSSING') {
    if (a.activeEdge.kind === 'crosswalk') {
      const pedSig = evaluatePedestrianSignal(a.activeEdge.crossingAxis ?? 'ns', f.signal);
      // Blinking green (or turning yellow/red while already in road) -> sprint at 1.5x speed!
      desiredSpeed = pedSig === 'blinking' || pedSig === 'red' ? a.walkSpeed * BLINK_RUN_MULTIPLIER : a.walkSpeed;
    } else {
      // Unsignalized crossing: brisk walk to get out of the road
      desiredSpeed = a.walkSpeed * 1.15;
    }

    if (g.distToTarget < 0.45) {
      // Reached opposite sidewalk tactile pad -> resume WALKING!
      advanceToNextEdge(host, a, f.signal);
    }
  } else {
    // WALKING along sidewalk centerlines.
    // Politely pause if the on-foot player or a parked f.scooter is right IN FRONT (never for ones behind),
    // then walk around it after a short wait instead of freezing forever.
    let detour = 0;
    if (g.isVisible && g.distToTarget > 0.05) {
      const ux = g.dx / g.distToTarget;
      const uz = g.dz / g.distToTarget;
      const blockers: Array<[number, number, number]> = [
        [f.playerX, f.playerZ, 1.9],
        [f.scooter.x, f.scooter.z, 2.2],
      ];
      for (const [bx, bz, radius] of blockers) {
        const rx = bx - a.x;
        const rz = bz - a.z;
        const ahead = rx * ux + rz * uz;
        const lateral = rx * -uz + rz * ux;
        if (ahead > 0 && ahead < radius && Math.abs(lateral) < 1.0) {
          // (-uz, ux) = forward x up = RIGHT; lateral > 0 -> blocker on the right -> detour to the left
          detour = lateral >= 0 ? 1 : -1;
          break;
        }
      }
    }
    if (detour !== 0) {
      a.yieldTimer += f.dt;
      if (a.yieldTimer < SIDEWALK_YIELD_SEC) {
        desiredSpeed = 0;
      } else {
        // Walk around: drift sideways (perpendicular to the path) while continuing forward slowly
        desiredSpeed = a.walkSpeed * 0.6;
        const ux = g.dx / g.distToTarget;
        const uz = g.dz / g.distToTarget;
        const sideX = uz * detour;
        const sideZ = -ux * detour;
        a.x += sideX * DETOUR_SPEED * f.dt;
        a.z += sideZ * DETOUR_SPEED * f.dt;
      }
    } else {
      a.yieldTimer = 0;
    }

    if (g.distToTarget < 0.45) {
      advanceToNextEdge(host, a, f.signal);
    }
  }

  // Never walk into a car body (a car stopped on the crosswalk, a car parked across the path...)
  if (
    desiredSpeed > 0 &&
    g.distToTarget > 0.05 &&
    carBlocksPath(host, a.x, a.z, g.dx / g.distToTarget, g.dz / g.distToTarget)
  ) {
    desiredSpeed = 0;
    a.currentSpeed = 0;
  }

  // Smooth acceleration / deceleration for natural Idle <-> Walk <-> Run transitions
  // weather: people hurry in the rain and step carefully on snow
  desiredSpeed *= host.walkSpeedMul;
  a.currentSpeed += (desiredSpeed - a.currentSpeed) * Math.min(1, f.dt * 9);
  if (desiredSpeed === 0 && a.currentSpeed < 0.03) {
    a.currentSpeed = 0;
  }

  // Integrate logical (x, z) coordinates (runs even beyond 80m for seamless city flow!)
  if (a.currentSpeed > 0.01 && g.distToTarget > 0.05) {
    const moveDist = Math.min(a.currentSpeed * f.dt, g.distToTarget);
    const nx = g.dx / g.distToTarget;
    const nz = g.dz / g.distToTarget;
    a.x += nx * moveDist;
    a.z += nz * moveDist;

    const targetHeading = Math.atan2(nx, nz);
    a.heading = lerpAngle(a.heading, targetHeading, Math.min(1, f.dt * 9));
  }

  // Smooth curb step height (y=0.16 on sidewalks, y=0.04 on crosswalk asphalt)
  const targetY =
    a.fsm === 'CROSSING' && g.distToTarget > 1.8 && g.distToTarget < a.activeEdge.distance - 1.8 ? ROAD_Y : SIDEWALK_Y;
  a.y += (targetY - a.y) * Math.min(1, f.dt * 12);

  // A car that drove into us (turning onto the crossing, startle sidestep into the road): step out of it
  pushOutOfCars(host, a);

  // Only update 3D transforms & procedural limb animation for visible pedestrians within 80m!
  if (g.isVisible) {
    a.rig.root.position.set(a.x, a.y, a.z);
    a.rig.root.rotation.y = a.heading;
    if (g.fullDetail) PedestrianFactory.updateWalkAnimation(a.rig, a.currentSpeed, f.dt);
  }
}

export function advanceToNextEdge(host: PedestrianManager, a: PedestrianAgent, signal: SignalStateSnapshot): void {
  const arrivedNode = host.graph.getNode(a.toNodeId);
  a.x = arrivedNode.x;
  a.z = arrivedNode.z;
  a.prevNodeId = a.fromNodeId;
  a.fromNodeId = arrivedNode.id;

  const nextEdge = host.graph.pickNextEdge(arrivedNode.id, a.prevNodeId);
  a.activeEdge = nextEdge;
  a.toNodeId = nextEdge.to;

  if (nextEdge.kind === 'crosswalk') {
    const axis = nextEdge.crossingAxis ?? 'ns';
    const pedSig = evaluatePedestrianSignal(axis, signal);
    if (pedSig === 'green') {
      a.fsm = 'CROSSING';
    } else {
      // Stop cleanly at the yellow tactile block until green light!
      a.fsm = 'WAITING_CROSSWALK';
      a.currentSpeed = 0;
    }
  } else if (nextEdge.crossesRoad) {
    // Unsignalized road crossing: wait at the curb until there is a gap in traffic
    a.fsm = 'WAITING_CROSSWALK';
    a.currentSpeed = 0;
    a.crossWaitTimer = 0;
  } else {
    a.fsm = 'WALKING';
  }
}

/** Gave up waiting for a gap: take a sidewalk edge from the curb node instead of crossing */
export function walkOnInstead(host: PedestrianManager, a: PedestrianAgent): void {
  const edges = host.graph.getEdges(a.fromNodeId).filter((e) => !e.crossesRoad);
  a.crossWaitTimer = 0;
  if (edges.length === 0) return;
  const edge = edges[Math.floor(Math.random() * edges.length)];
  a.activeEdge = edge;
  a.prevNodeId = a.fromNodeId;
  a.toNodeId = edge.to;
  a.fsm = 'WALKING';
}

/** True if the next CAR_LOOKAHEAD_M of the path from (x, z) along (ux, uz) runs into a car body */
export function carBlocksPath(host: PedestrianManager, x: number, z: number, ux: number, uz: number): boolean {
  const px = x + ux * CAR_LOOKAHEAD_M;
  const pz = z + uz * CAR_LOOKAHEAD_M;
  for (const c of host.cars) {
    if ((c.x - x) ** 2 + (c.z - z) ** 2 > CAR_CHECK_RANGE_SQ) continue;
    if (overlapsBody(c, px, pz, PEDESTRIAN_BODY_RADIUS)) return true;
  }
  return false;
}

export function pushOutOfCars(host: PedestrianManager, a: PedestrianAgent): void {
  if (host.cars.length === 0) return;
  const out = pushOutOfBodies(a.x, a.z, PEDESTRIAN_BODY_RADIUS, host.cars);
  if (out) {
    a.x = out.x;
    a.z = out.z;
  }
}

export function lerpAngle(cur: number, target: number, alpha: number): number {
  let diff = target - cur;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return cur + diff * alpha;
}
