/** Moving the scooter: building collisions (and head-on crashes), speed bumps, suspension pitch and engine RPM */
import { ObstacleBox, clamp, collidesWithWorld, wrapAngle } from '../../types';
import type { RoadCondition, ScooterPhysics, ScooterState } from '../ScooterPhysics';
import { SCOOTER_SPECS } from '../scooterSpecs';
import type { DriveResult } from './driveControl';

export function integrateMotion(
  host: ScooterPhysics,
  s: ScooterState,
  dt: number,
  obstacles: ObstacleBox[],
  road: RoadCondition,
  d: DriveResult,
  effectiveOmega: number,
): void {
  const { absSpeed, speedRatio, throttleAmt } = d;
  // --- 4. World Integration & Building Collisions ---
  const nextHeading = wrapAngle(s.heading + effectiveOmega * dt);
  const midHeading = s.heading + effectiveOmega * dt * 0.5;
  const nextX = s.x + s.speed * Math.sin(midHeading) * dt;
  const nextZ = s.z + s.speed * Math.cos(midHeading) * dt;

  const hitBoth = collidesWithWorld(nextX, nextZ, SCOOTER_SPECS.radius, obstacles);
  if (!hitBoth) {
    s.x = nextX;
    s.z = nextZ;
    s.heading = nextHeading;
  } else {
    // High-speed head-on impact into a wall also knocks you off!
    if (absSpeed > 13.5) {
      host.triggerLowside(s.leanAngle >= 0 ? 1 : -1, 'collision');
      return;
    }
    const hitXOnly = collidesWithWorld(nextX, s.z, SCOOTER_SPECS.radius, obstacles);
    const hitZOnly = collidesWithWorld(s.x, nextZ, SCOOTER_SPECS.radius, obstacles);
    if (!hitXOnly) {
      s.x = nextX;
      s.speed *= 0.68;
    } else if (!hitZOnly) {
      s.z = nextZ;
      s.speed *= 0.68;
    } else {
      s.speed = -s.speed * 0.2;
      if (Math.abs(s.speed) < 0.4) s.speed = 0;
    }
  }

  s.wheelSpin += (s.speed * dt) / SCOOTER_SPECS.wheelRadius;

  // Pitch on accel/brake + speed bump suspension shock!
  const longAccel = (s.speed - host.prevSpeed) / Math.max(dt, 0.0001);
  host.prevSpeed = s.speed;
  s.lastLongAccel = longAccel;

  if (host.bumpCooldown > 0) {
    host.bumpCooldown = Math.max(0, host.bumpCooldown - dt);
  }
  const onBump = Boolean(road.onSpeedBump);
  if (onBump && !host.wasOnSpeedBump && host.bumpCooldown <= 0 && absSpeed > 1.8) {
    const speedKmh = absSpeed * 3.6;
    const shock = clamp((speedKmh - 10) / 36, 0.16, 1.0);
    s.bumpJolt = Math.max(s.bumpJolt, shock);
    // Upward nose kick when hitting the speed bump!
    s.pitchAngle = clamp(s.pitchAngle - shock * 0.12, -0.16, 0.12);
    host.bumpCooldown = 0.65;
    if (host.onSpeedBumpCallback) {
      host.onSpeedBumpCallback(speedKmh, road.speedBumpLabel ?? '과속방지턱');
    }
  }
  host.wasOnSpeedBump = onBump;
  s.bumpJolt = Math.max(0, s.bumpJolt - dt * 2.8);

  const targetPitch = clamp(-longAccel * 0.011, -0.09, 0.09);
  s.pitchAngle += (targetPitch - s.pitchAngle) * Math.min(1, dt * 11);

  // CVT RPM
  const targetRpm = clamp(0.12 + speedRatio * 0.72 + throttleAmt * 0.22, 0.08, 1);
  s.rpmNorm += (targetRpm - s.rpmNorm) * Math.min(1, dt * 8);
}
