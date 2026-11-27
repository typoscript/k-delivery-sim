import { ObstacleBox, SlipSurfaceType, clamp } from '../types';
import { stepCrashedSlide, stepParked } from './physics/fallenAndParked';
import { stepDrive } from './physics/driveControl';
import { stepLeanTraction } from './physics/leanTraction';
import { integrateMotion } from './physics/motionIntegration';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import {
  ScooterModelId,
  ScooterPaintId,
  loadBikeGarage,
} from './ScooterModels';

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
  onSpeedBump?: boolean;
  speedBumpLabel?: string;
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
  bumpJolt: number; // 0..1 vertical suspension shock bounce from speed bumps
  lastLongAccel: number; // m/s^2 longitudinal acceleration for spill physics

  // Crash / fallen state
  crashed: boolean;
  crashSide: number; // -1 (left) or +1 (right)
  slideVx: number;
  slideVz: number;

  rpmNorm: number; // 0..1 for audio
  throttleAmount: number;

  // Phase 3: Fuel & Damage Systems + Bike Model Customization
  modelId: ScooterModelId;
  paintId: ScooterPaintId;
  fuel: number; // 0..100% (or EV battery % when electric)
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

export { OUT_OF_FUEL_PUSH_SPEED, SCOOTER_SPECS } from './scooterSpecs';

export class ScooterPhysics {
  public state: ScooterState;
  /** @internal vehicle/physics/* */
  prevSpeed = 0;
  /** @internal vehicle/physics/* */
  reverseHoldTimer = 0;
  /** @internal vehicle/physics/* */
  overLeanTimer = 0;
  /** @internal vehicle/physics/* */
  blinkerTurnAccum = 0;
  /** @internal vehicle/physics/* */
  bumpCooldown = 0;
  /** @internal vehicle/physics/* */
  wasOnSpeedBump = false;
  private onCrashCallback:
    | ((crashSide: number, impactSpeed: number, cause: CrashCause) => void)
    | null = null;
  /** @internal vehicle/physics/* */
  onSpeedBumpCallback: ((speedKmh: number, label: string) => void) | null = null;

  /** Simulated seconds (wobble phase) — not wall-clock time, so the physics is reproducible */
  /** @internal vehicle/physics/* */
  simTime = 0;
  private readonly spawnX = ACTIVE_MAP_DATA.meta.scooterSpawn.x;
  private readonly spawnZ = ACTIVE_MAP_DATA.meta.scooterSpawn.z;
  private readonly spawnHeading = ACTIVE_MAP_DATA.meta.scooterSpawn.heading;

  // Performance upgrade multipliers from 번개 오토바이 센터 (saved in localStorage)
  /** @internal vehicle/physics/* */
  upgradeAccelMul = 1.0;
  /** @internal vehicle/physics/* */
  upgradeSpeedMul = 1.0;
  /** @internal vehicle/physics/* */
  upgradeFuelBurnMul = 1.0;
  /** @internal vehicle/physics/* */
  upgradeGripMul = 1.0;

  constructor() {
    this.state = this.createInitialState();
  }

  public setOnCrash(
    cb: (crashSide: number, impactSpeed: number, cause: CrashCause) => void
  ): void {
    this.onCrashCallback = cb;
  }

  public setOnSpeedBump(cb: (speedKmh: number, label: string) => void): void {
    this.onSpeedBumpCallback = cb;
  }

  private createInitialState(): ScooterState {
    const garage = loadBikeGarage();
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
      bumpJolt: 0,
      lastLongAccel: 0,
      crashed: false,
      crashSide: -1,
      slideVx: 0,
      slideVz: 0,
      rpmNorm: 0,
      throttleAmount: 0,
      modelId: garage.modelId,
      paintId: garage.paintId,
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

  /** Parks the scooter at a new spot (district teleport); keeps fuel, damage, lights and model like reset() */
  public placeAt(x: number, z: number, heading: number): void {
    this.reset();
    this.state.x = x;
    this.state.z = z;
    this.state.heading = heading;
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

  public setBikeCustomization(modelId: ScooterModelId, paintId: ScooterPaintId): void {
    this.state.modelId = modelId;
    this.state.paintId = paintId;
  }

  public setUpgradeModifiers(mods: {
    accelMul: number;
    speedMul: number;
    fuelBurnMul: number;
    gripMul: number;
  }): void {
    this.upgradeAccelMul = mods.accelMul;
    this.upgradeSpeedMul = mods.speedMul;
    this.upgradeFuelBurnMul = mods.fuelBurnMul;
    this.upgradeGripMul = mods.gripMul;
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

  /** @internal vehicle/physics/* */
  triggerLowside(side: number, cause: CrashCause = 'corner'): void {
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
    // leftVec points to +left, so the outward (right) slide for a left lean (crashSide = -1) needs a negative scale
    const outward = s.crashSide * Math.min(impactSpeed * 0.25, 3.5);
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
    this.simTime += dt;
    s.activeSlipSurface = road.surface;

    // 0. Crashed: slide on its side / 1. Parked or unmounted
    if (s.crashed) {
      stepCrashedSlide(s, dt, road, obstacles);
      return;
    }
    if (!s.mounted || !input) {
      stepParked(s, dt, obstacles);
      return;
    }
    // 2. Rider controls -> 3. lean & traction (may crash) -> 4. move through the world
    const drive = stepDrive(this, s, dt, input, road);
    const effectiveOmega = stepLeanTraction(this, s, dt, input, road, drive);
    if (effectiveOmega === null) return;
    integrateMotion(this, s, dt, obstacles, road, drive, effectiveOmega);
  }
}
