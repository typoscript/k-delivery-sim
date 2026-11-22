import { ObstacleBox, clamp, collidesWithWorld, wrapAngle } from '../types';

export interface ScooterInput {
  throttle: boolean;
  brake: boolean;
  steerLeft: boolean;
  steerRight: boolean;
  handbrake: boolean;
}

export interface ScooterState {
  x: number;
  z: number;
  heading: number; // radians; 0 = +Z, positive = left (+X)
  speed: number; // m/s
  steerAngle: number; // radians; positive = left
  wheelSpin: number;

  // Dynamic cornering lean physics
  leanAngle: number; // radians; negative = lean left (+X), positive = lean right (-X)
  leanVel: number; // rad/s
  leanRisk: number; // 0..1 (approaching lowside slip!)
  slipWarning: boolean;
  pitchAngle: number; // suspension dive/squat

  // Crash / fallen state
  crashed: boolean;
  crashSide: number; // -1 (left) or +1 (right)
  slideVx: number;
  slideVz: number;

  rpmNorm: number; // 0..1 for audio
  throttleAmount: number;

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
  private onCrashCallback: ((crashSide: number, impactSpeed: number) => void) | null = null;

  private readonly spawnX = -62;
  private readonly spawnZ = -34.2;
  private readonly spawnHeading = Math.PI / 2; // parked along curb facing east (+X)

  constructor() {
    this.state = this.createInitialState();
  }

  public setOnCrash(cb: (crashSide: number, impactSpeed: number) => void): void {
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
      pitchAngle: 0,
      crashed: false,
      crashSide: -1,
      slideVx: 0,
      slideVz: 0,
      rpmNorm: 0,
      throttleAmount: 0,
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
    this.state = this.createInitialState();
    this.state.headlights = keepLights;
    this.prevSpeed = 0;
    this.reverseHoldTimer = 0;
    this.overLeanTimer = 0;
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
      this.overLeanTimer = 0;
    } else {
      this.state.throttleAmount = 0;
      this.state.braking = false;
      this.state.rpmNorm = 0;
      this.state.leanRisk = 0;
      this.state.slipWarning = false;
      this.reverseHoldTimer = 0;
      this.overLeanTimer = 0;
    }
  }

  public triggerExternalCrash(side: number): void {
    if (!this.state.mounted || this.state.crashed) return;
    this.triggerLowside(side);
  }

  private triggerLowside(side: number): void {
    const s = this.state;
    const impactSpeed = Math.abs(s.speed);
    s.crashed = true;
    s.crashSide = side === 0 ? -1 : Math.sign(side);
    s.mounted = false;
    s.engineOn = false;
    s.throttleAmount = 0;
    s.braking = false;
    s.rpmNorm = 0;
    s.leanRisk = 1;
    s.slipWarning = false;

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
      this.onCrashCallback(s.crashSide, impactSpeed);
    }
  }

  public step(dt: number, input: ScooterInput | null, obstacles: ObstacleBox[]): void {
    const clampedDt = Math.min(dt, 0.05);
    const substeps = 4;
    const subDt = clampedDt / substeps;
    for (let i = 0; i < substeps; i++) {
      this.stepSub(subDt, input, obstacles);
    }
  }

  private stepSub(dt: number, input: ScooterInput | null, obstacles: ObstacleBox[]): void {
    const s = this.state;

    // --- 0. Crashed / Fallen Scooter Asphalt Slide Physics ---
    if (s.crashed) {
      const slideSpeed = Math.hypot(s.slideVx, s.slideVz);
      if (slideSpeed > 0.08) {
        const friction = 7.8; // asphalt metal/plastic friction decel
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

    // Longitudinal acceleration / braking
    const maxAccel = 7.6 * (1 - 0.6 * speedRatio);
    const brakeDecel = input.handbrake ? 14.5 : 11.5;
    const rollingDrag = 0.55;
    const aeroDrag = 0.0044 * s.speed * absSpeed;

    let accel = 0;
    let isBraking = false;
    let throttleAmt = 0;

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
      } else {
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

    // Tire traction limit (braking hard while leaning dramatically shrinks available lateral grip!)
    const activeGripLimit =
      isBraking || input.handbrake ? SCOOTER_SPECS.brakingLeanLimit : SCOOTER_SPECS.dryGripLeanLimit;

    // Lean risk 0..1+ (only risky above walking speeds > 6.5 m/s ≈ 23 km/h)
    const speedRiskGate = clamp((absSpeed - 5.5) / 4.0, 0, 1);
    const rawRisk = (Math.abs(s.leanAngle) / activeGripLimit) * speedRiskGate;
    s.leanRisk = clamp(rawRisk, 0, 1.2);
    s.slipWarning = rawRisk >= 0.72 && absSpeed > 7.0;

    // Rear tire drift wobble when near traction limit
    let effectiveOmega = omega;
    if (s.slipWarning) {
      const slipExtra = (rawRisk - 0.72) * 1.1;
      effectiveOmega += Math.sign(omega) * slipExtra * Math.sin(performance.now() * 0.035);
    }

    // Trigger Lowside Crash if over-leaning past tire grip limit!
    if (rawRisk >= 1.0 && absSpeed > 7.5) {
      this.overLeanTimer += dt;
      if (this.overLeanTimer >= 0.16) {
        this.triggerLowside(Math.sign(s.leanAngle));
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
        this.triggerLowside(s.leanAngle >= 0 ? 1 : -1);
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
