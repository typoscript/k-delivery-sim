/** Scooter states without a rider in control: sliding on its side after a crash, and parked / unmounted */
import { ObstacleBox, collidesWithWorld, wrapAngle } from '../../types';
import type { RoadCondition, ScooterState } from '../ScooterPhysics';
import { SCOOTER_SPECS } from '../scooterSpecs';

/** Crashed: slides on its side until friction stops it, then lies flat on the crashed side */
export function stepCrashedSlide(s: ScooterState, dt: number, road: RoadCondition, obstacles: ObstacleBox[]): void {
  const slideSpeed = Math.hypot(s.slideVx, s.slideVz);
  if (slideSpeed > 0.08) {
    const friction = road.isRaining ? 5.1 : 7.8; // slick wet asphalt slides much further!
    const newSpeed = Math.max(0, slideSpeed - friction * dt);
    const ratio = newSpeed / slideSpeed;
    s.slideVx *= ratio;
    s.slideVz *= ratio;

    const nx = s.x + s.slideVx * dt;
    const nz = s.z + s.slideVz * dt;
    if (!collidesWithWorld(nx, nz, SCOOTER_SPECS.radius, obstacles)) {
      s.x = nx;
      s.z = nz;
    } else {
      s.slideVx *= -0.2;
      s.slideVz *= -0.2;
    }
    // Slight spin as scooter slides on its side
    s.heading = wrapAngle(s.heading + s.crashSide * slideSpeed * 0.12 * dt);
  } else {
    s.slideVx = 0;
    s.slideVz = 0;
  }

  // Drop flat onto the crashed side (~81 deg)
  const fallenLean = s.crashSide * 1.42;
  s.leanAngle += (fallenLean - s.leanAngle) * Math.min(1, dt * 14);
  s.pitchAngle += (0 - s.pitchAngle) * Math.min(1, dt * 8);
  s.leanRisk = 0;
  s.slipWarning = false;
}

/** Parked / unmounted (or no input): rolls to a stop on the kickstand lean */
export function stepParked(s: ScooterState, dt: number, obstacles: ObstacleBox[]): void {
  if (Math.abs(s.speed) > 0.05) {
    s.speed -= Math.sign(s.speed) * 6.5 * dt;
    if (Math.abs(s.speed) < 0.08) s.speed = 0;
  } else {
    s.speed = 0;
  }

  if (s.speed !== 0) {
    const nx = s.x + s.speed * Math.sin(s.heading) * dt;
    const nz = s.z + s.speed * Math.cos(s.heading) * dt;
    if (!collidesWithWorld(nx, nz, SCOOTER_SPECS.radius, obstacles)) {
      s.x = nx;
      s.z = nz;
    } else {
      s.speed = 0;
    }
    s.wheelSpin += (s.speed * dt) / SCOOTER_SPECS.wheelRadius;
  }

  s.steerAngle += (0.28 - s.steerAngle) * Math.min(1, dt * 5);
  s.leanAngle += (-0.17 - s.leanAngle) * Math.min(1, dt * 6);
  s.leanVel = 0;
  s.leanRisk = 0;
  s.slipWarning = false;
  s.pitchAngle += (0 - s.pitchAngle) * Math.min(1, dt * 8);
  s.rpmNorm = 0;
  s.throttleAmount = 0;
  s.braking = false;
}
