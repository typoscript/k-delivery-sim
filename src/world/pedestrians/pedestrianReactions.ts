/** Pedestrian reactions to the rider's scooter: direct hits (fall down), lying fallen, startle + sidestep */
import type { PedestrianAgent, PedestrianManager, ScooterProximityInfo } from '../PedestrianManager';
import { PedestrianFactory } from '../PedestrianFactory';
import type { AgentFrame, PedFrame } from './pedestrianWalking';
import { lerpAngle, pushOutOfCars } from './pedestrianWalking';
import {
  COLLISION_DIST,
  PEDESTRIAN_SPHERE_RADIUS,
  EVADE_STEP_DIST,
  FALL_RECOVERY_SEC,
  PEDESTRIAN_STARTLE_RADIUS,
  STARTLE_COOLDOWN_SEC,
  STARTLE_HOLD_SEC,
  STARTLE_MIN_CLOSING_MPS,
  STARTLE_PANIC_RADIUS,
  STARTLE_RELEASE_RADIUS,
} from './pedestrianTuning';

/** Section A: the riding scooter touching this pedestrian knocks it down (one hit per frame) */
export function checkScooterContact(a: PedestrianAgent, f: PedFrame, g: AgentFrame): void {
  // --- A. Direct Contact Collision Detection (BoundingSphere + AABB, ONLY when riding >= 5 km/h!) ---
  if (
    g.isVisible &&
    f.canCollide &&
    !f.collisionTriggered &&
    a.fsm !== 'FALLEN' &&
    a.hitCooldown <= 0 &&
    isScooterTouchingPedestrian(a.x, a.z, f.scooter)
  ) {
    f.collisionTriggered = true;
    if (a.fsm === 'WALKING' || a.fsm === 'WAITING_CROSSWALK' || a.fsm === 'CROSSING') {
      a.resumeFsm = a.fsm;
    }
    a.fsm = 'FALLEN';
    a.currentSpeed = 0;
    a.reactionTimer = FALL_RECOVERY_SEC;
    a.hitCooldown = FALL_RECOVERY_SEC + 1.5;

    const relX = a.x - f.scooter.x;
    const relZ = a.z - f.scooter.z;
    const leftX = Math.cos(f.scooter.heading);
    const leftZ = -Math.sin(f.scooter.heading);
    const sideDot = relX * leftX + relZ * leftZ;
    const hitSide = sideDot >= 0 ? 1 : -1;
    a.fallSide = hitSide;

    // Nudge fallen pedestrian slightly clear of the f.scooter impact vector
    const norm = Math.hypot(relX, relZ) || 1;
    a.x += (relX / norm) * 0.55;
    a.z += (relZ / norm) * 0.55;
    a.heading = Math.atan2(f.scooter.x - a.x, f.scooter.z - a.z);

    if (f.onPedestrianCollision) {
      f.onPedestrianCollision({
        pedestrianId: a.id,
        pedX: a.x,
        pedZ: a.z,
        impactSpeedKmh: f.scooterSpeedKmh,
        hitSide,
      });
    }
  }
}

/** Section B: a fallen pedestrian lies still until it recovers; returns true when it handled this frame */
export function stepFallen(host: PedestrianManager, a: PedestrianAgent, f: PedFrame, g: AgentFrame): boolean {
  // --- B. Fallen State Handling ---
  if (a.fsm === 'FALLEN') {
    a.currentSpeed = 0;
    a.reactionTimer -= f.dt;
    if (a.reactionTimer <= 0) {
      // Knocked down mid-crosswalk -> keep CROSSING so the f.signal-aware sprint logic finishes the crossing
      a.fsm = a.resumeFsm;
    }
    pushOutOfCars(host, a);
    if (g.isVisible) {
      a.rig.root.position.set(a.x, a.y, a.z);
      a.rig.root.rotation.y = a.heading;
      PedestrianFactory.updateFallenAnimation(a.rig, a.fallSide, f.dt);
    }
    return true;
  }
  return false;
}

/** Section C: startle + sidestep when a riding scooter closes in; returns true when it handled this frame */
export function stepStartle(host: PedestrianManager, a: PedestrianAgent, f: PedFrame, g: AgentFrame): boolean {
  // --- C. Sidewalk Scooter 3.5m Proximity Startle & Evasive Sidestep Reaction ---
  const sdx = f.scooter.x - a.x;
  const sdz = f.scooter.z - a.z;
  const distScooter = Math.hypot(sdx, sdz);

  // Only a f.scooter actually MOVING TOWARD the pedestrian is a threat. A stopped / idling / departing
  // f.scooter is not, otherwise the sidestep pushes the pedestrian just outside the radius, it resumes
  // walking back inside, and gets startled again in an endless startle -> walk -> startle loop.
  if (a.startleCooldown > 0) a.startleCooldown = Math.max(0, a.startleCooldown - f.dt);
  const scVelX = Math.sin(f.scooter.heading) * f.scooter.speedMps;
  const scVelZ = Math.cos(f.scooter.heading) * f.scooter.speedMps;
  // Component of f.scooter velocity pointing at the pedestrian (f.scooter -> ped = -sd)
  const closingSpeed = distScooter > 0.01 ? -(sdx * scVelX + sdz * scVelZ) / distScooter : 0;
  const scooterActive = g.isVisible && f.scooter.isRiding && !f.scooter.crashed;

  // Trigger startled avoidance when a riding f.scooter approaches within 3.5m (forward or lateral)
  let scooterThreatNear = false;
  if (scooterActive && distScooter <= PEDESTRIAN_STARTLE_RADIUS && closingSpeed >= STARTLE_MIN_CLOSING_MPS) {
    const pedFx = Math.sin(a.heading);
    const pedFz = Math.cos(a.heading);
    const toScooterDot = distScooter > 0.01 ? (sdx * pedFx + sdz * pedFz) / distScooter : 1;
    // Front or lateral hemisphere (dot >= -0.35), or very close from any direction (<= 2.6m)
    if (toScooterDot >= -0.35 || distScooter <= 2.6) {
      scooterThreatNear = true;
    }
  }
  // Right after recovering, only a f.scooter charging in very close can re-trigger a startle
  if (scooterThreatNear && a.fsm !== 'STARTLED' && a.startleCooldown > 0 && distScooter > STARTLE_PANIC_RADIUS) {
    scooterThreatNear = false;
  }
  // While already startled, stay alert until the f.scooter is clearly away or no longer approaching
  const scooterStillThreat =
    scooterActive && distScooter <= STARTLE_RELEASE_RADIUS && closingSpeed > STARTLE_MIN_CLOSING_MPS * 0.5;

  if (scooterThreatNear) {
    if (a.fsm !== 'STARTLED') {
      if (a.fsm === 'WALKING' || a.fsm === 'WAITING_CROSSWALK' || a.fsm === 'CROSSING') {
        a.resumeFsm = a.fsm;
      }
      a.fsm = 'STARTLED';
      a.currentSpeed = 0;
      a.reactPhase = 0;
      a.evadeRemaining = EVADE_STEP_DIST;

      // Compute evasive sidestep vector away from the f.scooter's path
      const awayLen = distScooter > 0.05 ? distScooter : 1;
      a.evadeDirX = -sdx / awayLen;
      a.evadeDirZ = -sdz / awayLen;

      if (f.onPedestrianStartled && host.startleAudioCooldown <= 0) {
        host.startleAudioCooldown = 1.6;
        f.onPedestrianStartled();
      }
    }
    a.reactionTimer = STARTLE_HOLD_SEC;
  }

  if (a.fsm === 'STARTLED') {
    a.currentSpeed = 0;
    a.reactPhase += f.dt;
    a.reactionTimer -= f.dt;

    // Turn quickly to face the approaching f.scooter
    if (distScooter > 0.08) {
      const faceScooter = Math.atan2(sdx, sdz);
      a.heading = lerpAngle(a.heading, faceScooter, Math.min(1, f.dt * 14));
    }

    // Quick defensive sidestep back (~0.62m) away from f.scooter
    if (a.evadeRemaining > 0.01) {
      const step = Math.min(a.evadeRemaining, 2.2 * f.dt);
      a.x += a.evadeDirX * step;
      a.z += a.evadeDirZ * step;
      a.evadeRemaining -= step;
    }

    if (a.reactionTimer <= 0 && !scooterStillThreat) {
      a.fsm = a.resumeFsm;
      a.startleCooldown = STARTLE_COOLDOWN_SEC;
    }
    pushOutOfCars(host, a);

    if (g.isVisible) {
      a.rig.root.position.set(a.x, a.y, a.z);
      a.rig.root.rotation.y = a.heading;
      PedestrianFactory.updateStartledAnimation(a.rig, a.reactPhase, f.dt);
    }
    return true;
  }
  return false;
}

/**
 * Checks oriented AABB + BoundingSphere overlap between a pedestrian cylinder (r=0.42m)
 * and the player's delivery scooter (width=1.04m, length=1.84m, sphere r=0.72m).
 */
export function isScooterTouchingPedestrian(pedX: number, pedZ: number, scooter: ScooterProximityInfo): boolean {
  const dx = pedX - scooter.x;
  const dz = pedZ - scooter.z;
  const distSq = dx * dx + dz * dz;
  // Fast broad-phase BoundingSphere reject (1.5m)
  if (distSq > 2.25) return false;
  // Direct BoundingSphere contact (0.42 + 0.72 = 1.14m)
  if (distSq <= COLLISION_DIST * COLLISION_DIST) return true;

  // Oriented AABB check in scooter local frame (heading=0 -> +Z forward, +X left)
  const fwdX = Math.sin(scooter.heading);
  const fwdZ = Math.cos(scooter.heading);
  const leftX = Math.cos(scooter.heading);
  const leftZ = -Math.sin(scooter.heading);

  const localForward = dx * fwdX + dz * fwdZ;
  const localLeft = dx * leftX + dz * leftZ;
  const halfLen = 0.92 + PEDESTRIAN_SPHERE_RADIUS;
  const halfWid = 0.52 + PEDESTRIAN_SPHERE_RADIUS;
  return Math.abs(localForward) <= halfLen && Math.abs(localLeft) <= halfWid;
}
