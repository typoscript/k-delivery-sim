/** Rider controls: steering, throttle / brakes / reverse, fuel burn, speed, turn rate and blinker auto-cancel */
import { clamp } from '../../types';
import { SCOOTER_MODELS, ScooterModelSpec } from '../ScooterModels';
import type { RoadCondition, ScooterInput, ScooterPhysics, ScooterState } from '../ScooterPhysics';
import { OUT_OF_FUEL_PUSH_SPEED, SCOOTER_SPECS } from '../scooterSpecs';

/** What the lean / traction and motion stages need from this frame's controls */
export interface DriveResult {
  bikeSpec: ScooterModelSpec;
  absSpeed: number;
  speedRatio: number;
  steerDir: number;
  isBraking: boolean;
  throttleAmt: number;
  omega: number;
  lateralAccel: number;
}

export function stepDrive(
  host: ScooterPhysics,
  s: ScooterState,
  dt: number,
  input: ScooterInput,
  road: RoadCondition,
): DriveResult {
  // --- 2. Mounted Riding Physics (Tuned per Scooter Model + Permanent Upgrades!) ---
  const bikeSpec = SCOOTER_MODELS[s.modelId];
  const effectiveMaxSpeed = bikeSpec.maxForwardSpeed * host.upgradeSpeedMul;
  const absSpeed = Math.abs(s.speed);
  const speedRatio = clamp(absSpeed / effectiveMaxSpeed, 0, 1);

  // Progressive steering limit: enough authority at 50-75 km/h to over-lean if you push too hard!
  const maxSteer =
    (SCOOTER_SPECS.maxSteerAngle * Math.min(1.12, bikeSpec.steerAgilityMul)) / (1 + Math.pow(absSpeed / 10.5, 1.2));
  const steerRate = (2.6 - 1.05 * speedRatio) * bikeSpec.steerAgilityMul;
  const returnRate = 3.8 + 2.4 * speedRatio;

  let steerDir = 0;
  if (input.steerLeft) steerDir += 1;
  if (input.steerRight) steerDir -= 1;

  if (steerDir !== 0) {
    s.steerAngle = clamp(s.steerAngle + steerDir * steerRate * dt, -maxSteer, maxSteer);
  } else {
    const delta = returnRate * dt;
    if (Math.abs(s.steerAngle) <= delta) s.steerAngle = 0;
    else s.steerAngle -= Math.sign(s.steerAngle) * delta;
  }

  // Longitudinal acceleration / braking (affected by bike model, ECU upgrade, damageLevel -10%/stage, rain grip, & out-of-fuel!)
  const damageAccelMul = host.getAccelMultiplier();
  const maxAccel = 7.6 * bikeSpec.accelMul * host.upgradeAccelMul * (1 - 0.58 * speedRatio) * damageAccelMul;
  let brakeGripMul = road.isRaining ? 0.86 : 1.0;
  if (road.isRaining && road.surface === 'manhole') brakeGripMul = 0.55;
  else if (road.isRaining && road.surface === 'crosswalk_paint') brakeGripMul = 0.68;
  if (road.isSnowing) brakeGripMul *= 0.82; // packed snow: brakes bite even less
  const brakeDecel = (input.handbrake ? 14.5 : 11.5) * brakeGripMul;
  const rollingDrag = 0.55;
  const aeroDrag = 0.0044 * s.speed * absSpeed;

  let accel = 0;
  let isBraking = false;
  let throttleAmt = 0;

  s.outOfFuel = s.fuel <= 0.01;
  s.lowFuelWarning = s.fuel <= 10;
  s.engineOn = s.mounted && !s.outOfFuel;

  if (input.handbrake) {
    isBraking = absSpeed > 0.05;
    if (absSpeed > 0.05) accel = -Math.sign(s.speed) * brakeDecel;
    else s.speed = 0;
    host.reverseHoldTimer = 0;
  } else if (input.throttle) {
    host.reverseHoldTimer = 0;
    if (s.speed < -0.1) {
      accel = brakeDecel;
      isBraking = true;
    } else if (!s.outOfFuel) {
      accel = maxAccel;
      throttleAmt = 1;
    } else if (s.speed < OUT_OF_FUEL_PUSH_SPEED) {
      // Out of fuel: the rider pushes the scooter along at walking pace (to the nearest gas station)
      accel = Math.min(1.6, (OUT_OF_FUEL_PUSH_SPEED - s.speed) / Math.max(dt, 1e-3));
    }
  } else if (input.brake) {
    if (s.speed > 0.15) {
      accel = -brakeDecel;
      isBraking = true;
      host.reverseHoldTimer = 0;
    } else {
      host.reverseHoldTimer += dt;
      if (host.reverseHoldTimer > 0.16) {
        accel = -2.4;
      } else {
        s.speed = 0;
        isBraking = true;
      }
    }
  } else {
    host.reverseHoldTimer = 0;
  }

  // Real-time fuel / EV battery burn while engine is running (scaled by bike model & Eco Tank upgrade!)
  if (s.engineOn) {
    const idleBurn = bikeSpec.isElectric ? 0.004 : 0.025;
    const burnRate =
      (idleBurn + throttleAmt * (0.28 + speedRatio * 0.44)) * bikeSpec.fuelBurnMul * host.upgradeFuelBurnMul;
    s.fuel = Math.max(0, s.fuel - burnRate * dt);
    s.lowFuelWarning = s.fuel <= 10;
    if (s.fuel <= 0.01) {
      s.fuel = 0;
      s.outOfFuel = true;
      s.engineOn = false;
      throttleAmt = 0;
      if (accel > 0) accel = 0;
    }
  }

  if (absSpeed > 0.02) {
    accel += -Math.sign(s.speed) * rollingDrag - aeroDrag;
  }

  const nextSpeed = s.speed + accel * dt;
  if (isBraking && s.speed !== 0 && Math.sign(nextSpeed) !== Math.sign(s.speed)) {
    s.speed = 0;
  } else {
    s.speed = clamp(nextSpeed, -SCOOTER_SPECS.maxReverseSpeed, effectiveMaxSpeed);
  }

  if (!input.throttle && !input.brake && Math.abs(s.speed) < 0.06) {
    s.speed = 0;
  }

  s.braking = isBraking;
  s.throttleAmount = throttleAmt;

  // Bicycle model turning
  const omega = (s.speed / SCOOTER_SPECS.wheelbase) * Math.tan(s.steerAngle);
  const lateralAccel = s.speed * omega; // m/s^2 (positive when turning left while moving forward)

  // Auto-cancel turn signal cleanly after completing a turn (> 52 deg) and straightening handlebars
  if (!s.hazard && (s.leftBlinker || s.rightBlinker)) {
    const expectedSign = s.leftBlinker ? 1 : -1;
    if (omega * expectedSign > 0.15) {
      host.blinkerTurnAccum += Math.abs(omega * dt);
    }
    if (host.blinkerTurnAccum > 0.92 && Math.abs(s.steerAngle) < 0.08) {
      s.leftBlinker = false;
      s.rightBlinker = false;
      host.blinkerTurnAccum = 0;
    }
  } else {
    host.blinkerTurnAccum = 0;
  }

  return { bikeSpec, absSpeed, speedRatio, steerDir, isBraking, throttleAmt, omega, lateralAccel };
}
