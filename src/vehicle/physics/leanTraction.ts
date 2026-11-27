/** Cornering lean (roll spring-damper), tire grip limits, wet manhole / paint slips and the lowside crash */
import { clamp } from '../../types';
import type { CrashCause, RoadCondition, ScooterInput, ScooterPhysics, ScooterState } from '../ScooterPhysics';
import { SCOOTER_SPECS } from '../scooterSpecs';
import type { DriveResult } from './driveControl';

/** Returns the yaw rate to integrate (with slip wobble), or null when the rider just crashed */
export function stepLeanTraction(
  host: ScooterPhysics,
  s: ScooterState,
  dt: number,
  input: ScooterInput,
  road: RoadCondition,
  d: DriveResult,
): number | null {
  const { bikeSpec, absSpeed, speedRatio, steerDir, isBraking, omega, lateralAccel } = d;
  // --- 3. Realistic Motorcycle Cornering Lean Dynamics & Traction Circle ---
  // Equilibrium lean angle to counter centrifugal force: tan(theta) = a_lat / g
  // Facing +Z: leaning LEFT (+X) is NEGATIVE rotation around +Z.
  const gravity = 9.81;
  let targetLean = -Math.atan2(lateralAccel * 0.68, gravity);
  // Add direct rider body-lean input feel at speed
  if (absSpeed > 3.5 && steerDir !== 0) {
    targetLean += -steerDir * 0.1 * speedRatio;
  }
  targetLean = clamp(targetLean, -1.15, 1.15);

  // 2nd-order roll spring-damper for weighty bike lean momentum
  const rollStiffness = 22.0;
  const rollDamping = 6.2;
  const leanAcc = (targetLean - s.leanAngle) * rollStiffness - s.leanVel * rollDamping;
  s.leanVel += leanAcc * dt;
  s.leanAngle += s.leanVel * dt;

  // Tire traction limit (wet road & slick metal manhole / white crosswalk paint dramatically cut grip!)
  let activeGripLimit =
    (isBraking || input.handbrake ? SCOOTER_SPECS.brakingLeanLimit : SCOOTER_SPECS.dryGripLeanLimit) *
    bikeSpec.gripMul *
    host.upgradeGripMul;

  if (road.isRaining) {
    activeGripLimit *= isBraking || input.handbrake ? 0.78 : 0.84;
    if (road.surface === 'manhole') {
      activeGripLimit *= 0.34; // slick iron manhole cover!
    } else if (road.surface === 'crosswalk_paint') {
      activeGripLimit *= 0.48; // slick white thermoplastic crosswalk paint!
    }
  }

  // Wet manhole / crosswalk paint slip risk from braking OR sharp turning!
  const onWetHazard = road.isRaining && road.surface !== 'none';
  const hardBrakeOnWetHazard =
    onWetHazard && (isBraking || input.handbrake) && absSpeed > (road.surface === 'manhole' ? 4.8 : 6.0);
  const sharpTurnOnWetHazard =
    onWetHazard &&
    (Math.abs(s.steerAngle) > 0.12 || Math.abs(s.leanAngle) > 0.17) &&
    absSpeed > (road.surface === 'manhole' ? 4.4 : 5.4);

  // Lean risk 0..1+ (lower speed threshold when slipping on wet manhole/paint!)
  const riskSpeedFloor = onWetHazard ? 3.5 : 5.5;
  const speedRiskGate = clamp((absSpeed - riskSpeedFloor) / 3.8, 0, 1);
  let rawRisk = (Math.abs(s.leanAngle) / activeGripLimit) * speedRiskGate;

  // Even straight hard braking on a wet manhole or crosswalk paint breaks tire traction!
  if (hardBrakeOnWetHazard) {
    const brakeSlipBoost =
      (road.surface === 'manhole' ? 1.15 : 0.92) * (input.handbrake ? 1.25 : 1.0) * clamp(absSpeed / 8.5, 0.55, 1.35);
    rawRisk = Math.max(rawRisk, brakeSlipBoost);
  }
  if (sharpTurnOnWetHazard) {
    const turnSlipBoost = (road.surface === 'manhole' ? 1.12 : 0.96) * clamp(absSpeed / 8.0, 0.6, 1.3);
    rawRisk = Math.max(rawRisk, turnSlipBoost);
  }

  s.leanRisk = clamp(rawRisk, 0, 1.25);
  s.slipWarning =
    (rawRisk >= 0.7 && absSpeed > (onWetHazard ? 4.5 : 7.0)) ||
    (onWetHazard && absSpeed > 5.0 && (isBraking || Math.abs(s.steerAngle) > 0.08));

  if (onWetHazard && (s.slipWarning || absSpeed > 5.5)) {
    s.wetSlipWarning = road.surface === 'manhole' ? 'manhole' : 'crosswalk_paint';
  } else if (s.slipWarning) {
    s.wetSlipWarning = 'corner';
  } else {
    s.wetSlipWarning = 'none';
  }

  // Rear tire drift wobble & sudden traction kick when slipping on wet manhole/paint
  let effectiveOmega = omega;
  if (s.slipWarning) {
    const slipExtra = Math.max(0.18, rawRisk - 0.68) * (onWetHazard ? 1.9 : 1.1);
    const kickSign = omega !== 0 ? Math.sign(omega) : s.leanAngle !== 0 ? -Math.sign(s.leanAngle) : 1;
    effectiveOmega += kickSign * slipExtra * Math.sin(host.simTime * 42);
    if (onWetHazard && rawRisk >= 0.95) {
      s.leanVel += -kickSign * 3.8 * dt;
    }
  }

  // Trigger Lowside Crash if over traction limit!
  const crashSpeedMin = onWetHazard ? 4.5 : 7.5;
  const slipTriggerTime =
    onWetHazard && road.surface === 'manhole'
      ? 0.085
      : onWetHazard && road.surface === 'crosswalk_paint'
        ? 0.115
        : 0.16;

  if (rawRisk >= 1.0 && absSpeed > crashSpeedMin) {
    host.overLeanTimer += dt;
    if (host.overLeanTimer >= slipTriggerTime) {
      const fallSide =
        Math.abs(s.leanAngle) > 0.06
          ? Math.sign(s.leanAngle)
          : steerDir !== 0
            ? -steerDir
            : Math.random() < 0.5
              ? -1
              : 1;
      const cause: CrashCause =
        road.isRaining && road.surface === 'manhole'
          ? 'rain_manhole'
          : road.isRaining && road.surface === 'crosswalk_paint'
            ? 'rain_paint'
            : road.isRaining
              ? 'rain_corner'
              : 'corner';
      host.triggerLowside(fallSide, cause);
      return null;
    }
  } else {
    host.overLeanTimer = Math.max(0, host.overLeanTimer - dt * 2.5);
  }

  return effectiveOmega;
}
