import { ObstacleBox, SlipSurfaceType, clamp, collidesWithWorld, wrapAngle } from '../types';

export interface ScooterInput {
  throttle: boolean;
  brake: boolean;
  steerLeft: boolean;
  steerRight: boolean;
  handbrake: boolean;
}

export interface RoadCondition {
  isRaining: boolean;
  surface: SlipSurfaceType;
}

export type CrashCause =
  | 'corner'
  | 'collision'
  | 'rain_manhole'
  | 'rain_paint'
  | 'rain_corner'
  | 'pedestrian_hit';

export interface ScooterState {
  x: number;
  z: number;
  heading: number; // radians; 0 = +Z, positive = left (+X)
  speed: number; // m/s
  steerAngle: number; // radians; positive = left
  wheelSpin: number;

  // Dynamic cornering lean & wet-surface slip physics
  leanAngle: number; // radians; negative = lean left (+X), positive = lean right (-X)
  leanVel: number; // rad/s
  leanRisk: number; // 0..1 (approaching lowside slip!)
  slipWarning: boolean;
  activeSlipSurface: SlipSurfaceType;
  wetSlipWarning: 'none' | 'manhole' | 'crosswalk_paint' | 'corner';
  pitchAngle: number; // suspension dive/squat

  // Crash / fallen state
  crashed: boolean;
  crashSide: number; // -1 (left) or +1 (right)
  slideVx: number;
  slideVz: number;

  rpmNorm: number; // 0..1 for audio
  throttleAmount: number;

  // Phase 3: Fuel & Damage Systems
  fuel: number; // 0..100%
  lowFuelWarning: boolean; // <= 10%
  outOfFuel: boolean; // <= 0% (cannot accelerate!)
  damageLevel: number; // 0..3 (each crash reduces acceleration by 10% & shakes side mirrors)
  crashCount: number;

  mounted: boolean;
  engineOn: boolean;
  headlights: boolean;
  leftBlinker: boolean;
  rightBlinker: boolean;
  hazard: boolean;
  braking: boolean;
}

export const SCOOTER_SPECS = {
  wheelbase: 1.38,
  wheelRadius: 0.28,
  maxSteerAngle: (36 * Math.PI) / 180,
  maxForwardSpeed: 22.5, // ~81 km/h
  maxReverseSpeed: 1.8, // ~6.5 km/h (foot-push reverse)
  radius: 0.72,
  dryGripLeanLimit: (44 * Math.PI) / 180, // ~44 deg max safe lean before lowside
  brakingLeanLimit: (32 * Math.PI) / 180, // hard braking while leaned reduces grip!
};

export class ScooterPhysics {
  public state: ScooterState;
  private prevSpeed = 0;
  private reverseHoldTimer = 0;
  private overLeanTimer = 0;
  private blinkerTurnAccum = 0;
  private onCrashCallback:
    | ((crashSide: number, impactSpeed: number, cause: CrashCause) => void)
    | null = null;

  private readonly spawnX = -62;
  private readonly spawnZ = -34.2;
  private readonly spawnHeading = Math.PI / 2; // parked along curb facing east (+X)

  constructor() {
    this.state = this.createInitialState();
  }

  public setOnCrash(
    cb: (crashSide: number, impactSpeed: number, cause: CrashCause) => void
  ): void {
    this.onCrashCallback = cb;
  }

  private createInitialState(): ScooterState {
    return {
      x: this.spawnX,
      z: this.spawnZ,
      heading: this.spawnHeading,
      speed: 0,
      steerAngle: 0,
      wheelSpin: 0,
      leanAngle: -0.17, // resting on left kickstand when unmounted
      leanVel: 0,
      leanRisk: 0,
      slipWarning: false,
      activeSlipSurface: 'none',
      wetSlipWarning: 'none',
      pitchAngle: 0,
      crashed: false,
      crashSide: -1,
      slideVx: 0,
      slideVz: 0,
      rpmNorm: 0,
      throttleAmount: 0,
      fuel: 100,
      lowFuelWarning: false,
      outOfFuel: false,
      damageLevel: 0,
      crashCount: 0,
      mounted: false,
      engineOn: false,
      headlights: false,
      leftBlinker: false,
      rightBlinker: false,
      hazard: false,
      braking: false,
    };
  }

  public reset(): void {
    const keepLights = this.state.headlights;
    const keepFuel = this.state.fuel;
    const keepDamage = this.state.damageLevel;
    const keepCrashes = this.state.crashCount;
    this.state = this.createInitialState();
    this.state.headlights = keepLights;
    this.state.fuel = keepFuel;
    this.state.lowFuelWarning = keepFuel <= 10;
    this.state.outOfFuel = keepFuel <= 0.01;
    this.state.damageLevel = keepDamage;
    this.state.crashCount = keepCrashes;
    this.prevSpeed = 0;
    this.reverseHoldTimer = 0;
    this.overLeanTimer = 0;
    this.blinkerTurnAccum = 0;
  }

  public addFuel(percent: number): number {
    this.state.fuel = clamp(this.state.fuel + percent, 0, 100);
    this.state.lowFuelWarning = this.state.fuel <= 10;
    this.state.outOfFuel = this.state.fuel <= 0.01;
    if (!this.state.outOfFuel && this.state.mounted) {
      this.state.engineOn = true;
    }
    return this.state.fuel;
  }

  public repairVehicle(): void {
    this.state.damageLevel = 0;
  }

  public getAccelMultiplier(): number {
    // Each crash damage stage lowers acceleration by 10% (min 70% at max stage 3)
    return Math.max(0.7, 1 - this.state.damageLevel * 0.1);
  }

  public toggleLeftBlinker(): boolean {
    this.state.hazard = false;
    this.state.leftBlinker = !this.state.leftBlinker;
    if (this.state.leftBlinker) this.state.rightBlinker = false;
    this.blinkerTurnAccum = 0;
    return this.state.leftBlinker;
  }

  public toggleRightBlinker(): boolean {
    this.state.hazard = false;
    this.state.rightBlinker = !this.state.rightBlinker;
    if (this.state.rightBlinker) this.state.leftBlinker = false;
    this.blinkerTurnAccum = 0;
    return this.state.rightBlinker;
  }

  public toggleHazard(): boolean {
    this.state.hazard = !this.state.hazard;
    if (this.state.hazard) {
      this.state.leftBlinker = false;
      this.state.rightBlinker = false;
    }
    this.blinkerTurnAccum = 0;
    return this.state.hazard;
  }

  public setMounted(mounted: boolean): void {
    this.state.mounted = mounted;
    this.state.engineOn = mounted;
    if (mounted) {
      // Pick up fallen scooter upright when remounting!
      this.state.crashed = false;
      this.state.slideVx = 0;
      this.state.slideVz = 0;
      this.state.leanVel = 0;
      this.state.leanAngle = 0;
      this.state.leanRisk = 0;
      this.state.slipWarning = false;
      this.state.wetSlipWarning = 'none';
      this.overLeanTimer = 0;
    } else {
      this.state.throttleAmount = 0;
      this.state.braking = false;
      this.state.rpmNorm = 0;
      this.state.leanRisk = 0;
      this.state.slipWarning = false;
      this.state.wetSlipWarning = 'none';
      this.reverseHoldTimer = 0;
      this.overLeanTimer = 0;
    }
  }

  public triggerExternalCrash(side: number, cause: CrashCause = 'collision'): void {
    if (!this.state.mounted || this.state.crashed) return;
    this.triggerLowside(side, cause);
  }

  private triggerLowside(side: number, cause: CrashCause = 'corner'): void {
    const s = this.state;
    const impactSpeed = Math.abs(s.speed);
    s.crashed = true;
    s.crashSide = side === 0 ? -1 : Math.sign(side);
    s.crashCount += 1;
    s.damageLevel = Math.min(3, s.damageLevel + 1);
    s.mounted = false;
    s.engineOn = false;
    s.throttleAmount = 0;
    s.braking = false;
    s.rpmNorm = 0;
    s.leanRisk = 1;
    s.slipWarning = false;
    s.wetSlipWarning = 'none';

    // Preserve forward + slight outward slide momentum along the asphalt
    const fwdX = Math.sin(s.heading);
    const fwdZ = Math.cos(s.heading);
    const leftX = Math.cos(s.heading);
    const leftZ = -Math.sin(s.heading);
    // Leaning left (side < 0) means turning left -> centrifugal outward slide is right (-left)
    const outward = -s.crashSide * Math.min(impactSpeed * 0.25, 3.5);
    s.slideVx = fwdX * s.speed * 0.85 + leftX * outward;
    s.slideVz = fwdZ * s.speed * 0.85 + leftZ * outward;
    s.speed = 0;
    this.overLeanTimer = 0;

    if (this.onCrashCallback) {
      this.onCrashCallback(s.crashSide, impactSpeed, cause);
    }
  }

  public step(
    dt: number,
    input: ScooterInput | null,
    obstacles: ObstacleBox[],
    road: RoadCondition = { isRaining: false, surface: 'none' }
  ): void {
    const clampedDt = Math.min(dt, 0.05);
    const substeps = 4;
    const subDt = clampedDt / substeps;
    for (let i = 0; i < substeps; i++) {
      this.stepSub(subDt, input, obstacles, road);
    }
  }

  private stepSub(
    dt: number,
    input: ScooterInput | null,
    obstacles: ObstacleBox[],
    road: RoadCondition
  ): void {
    const s = this.state;
    s.activeSlipSurface = road.surface;

    // --- 0. Crashed / Fallen Scooter Asphalt Slide Physics ---
    if (s.crashed) {
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
      return;
    }

    // --- 1. Parked / Unmounted State ---
    if (!s.mounted || !input) {
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
      return;
    }

    // --- 2. Mounted Riding Physics ---
    const absSpeed = Math.abs(s.speed);
    const speedRatio = clamp(absSpeed / SCOOTER_SPECS.maxForwardSpeed, 0, 1);

    // Progressive steering limit: enough authority at 50-75 km/h to over-lean if you push too hard!
    const maxSteer = SCOOTER_SPECS.maxSteerAngle / (1 + Math.pow(absSpeed / 10.5, 1.2));
    const steerRate = 2.6 - 1.05 * speedRatio;
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

    // Longitudinal acceleration / braking (affected by damageLevel -10%/stage, rain grip, & out-of-fuel!)
    const damageAccelMul = this.getAccelMultiplier();
    const maxAccel = 7.6 * (1 - 0.6 * speedRatio) * damageAccelMul;
    let brakeGripMul = road.isRaining ? 0.86 : 1.0;
    if (road.isRaining && road.surface === 'manhole') brakeGripMul = 0.55;
    else if (road.isRaining && road.surface === 'crosswalk_paint') brakeGripMul = 0.68;
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
      this.reverseHoldTimer = 0;
    } else if (input.throttle) {
      this.reverseHoldTimer = 0;
      if (s.speed < -0.1) {
        accel = brakeDecel;
        isBraking = true;
      } else if (!s.outOfFuel) {
        accel = maxAccel;
        throttleAmt = 1;
      }
    } else if (input.brake) {
      if (s.speed > 0.15) {
        accel = -brakeDecel;
        isBraking = true;
        this.reverseHoldTimer = 0;
      } else {
        this.reverseHoldTimer += dt;
        if (this.reverseHoldTimer > 0.16) {
          accel = -2.4;
        } else {
          s.speed = 0;
          isBraking = true;
        }
      }
    } else {
      this.reverseHoldTimer = 0;
    }

    // Real-time fuel burn while engine is running (idle + throttle/speed load)
    if (s.engineOn) {
      const burnRate = 0.025 + throttleAmt * (0.28 + speedRatio * 0.44);
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
      s.speed = clamp(nextSpeed, -SCOOTER_SPECS.maxReverseSpeed, SCOOTER_SPECS.maxForwardSpeed);
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
        this.blinkerTurnAccum += Math.abs(omega * dt);
      }
      if (this.blinkerTurnAccum > 0.92 && Math.abs(s.steerAngle) < 0.08) {
        s.leftBlinker = false;
        s.rightBlinker = false;
        this.blinkerTurnAccum = 0;
      }
    } else {
      this.blinkerTurnAccum = 0;
    }

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
      isBraking || input.handbrake ? SCOOTER_SPECS.brakingLeanLimit : SCOOTER_SPECS.dryGripLeanLimit;

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
      onWetHazard &&
      (isBraking || input.handbrake) &&
      absSpeed > (road.surface === 'manhole' ? 4.8 : 6.0);
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
        (road.surface === 'manhole' ? 1.15 : 0.92) *
        (input.handbrake ? 1.25 : 1.0) *
        clamp(absSpeed / 8.5, 0.55, 1.35);
      rawRisk = Math.max(rawRisk, brakeSlipBoost);
    }
    if (sharpTurnOnWetHazard) {
      const turnSlipBoost =
        (road.surface === 'manhole' ? 1.12 : 0.96) * clamp(absSpeed / 8.0, 0.6, 1.3);
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
      effectiveOmega += kickSign * slipExtra * Math.sin(performance.now() * 0.042);
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
      this.overLeanTimer += dt;
      if (this.overLeanTimer >= slipTriggerTime) {
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
        this.triggerLowside(fallSide, cause);
        return;
      }
    } else {
      this.overLeanTimer = Math.max(0, this.overLeanTimer - dt * 2.5);
    }

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
        this.triggerLowside(s.leanAngle >= 0 ? 1 : -1, 'collision');
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

    // Pitch on accel/brake
    const longAccel = (s.speed - this.prevSpeed) / Math.max(dt, 0.0001);
    this.prevSpeed = s.speed;
    const targetPitch = clamp(-longAccel * 0.011, -0.09, 0.09);
    s.pitchAngle += (targetPitch - s.pitchAngle) * Math.min(1, dt * 11);

    // CVT RPM
    const targetRpm = clamp(0.12 + speedRatio * 0.72 + throttleAmt * 0.22, 0.08, 1);
    s.rpmNorm += (targetRpm - s.rpmNorm) * Math.min(1, dt * 8);
  }
}
