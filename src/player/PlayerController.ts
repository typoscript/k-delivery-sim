import { ObstacleBox, clamp, collidesWithWorld, wrapAngle } from '../types';
import { SCOOTER_SPECS, ScooterState } from '../vehicle/ScooterPhysics';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';

export interface OnFootInput {
  forward: number; // +1 W, -1 S
  strafe: number; // +1 A (left), -1 D (right)
  sprint: boolean;
  jump: boolean;
}

export interface PlayerState {
  mode: 'on_foot' | 'riding' | 'knockdown';
  inCorridor: boolean;
  baseY: number; // 0 outdoors, -500 inside underground corridor
  x: number;
  y: number;
  z: number;
  vy: number;
  heading: number; // radians; 0 = +Z
  moveSpeed: number;
  walkCycle: number;
  grounded: boolean;
  canMountScooter: boolean;
  distanceToScooter: number;
  stamina: number; // 0..100 (used when climbing walk-up villa stairs / sprinting)
  climbingStairs: boolean;
  energyBuffTimer: number; // seconds left of Energy Drink (+25% speed, -50% stair stamina drain)
  coffeeBuffTimer: number; // seconds left of Iced Coffee (2x stamina recovery)

  // Lowside crash tumble recovery
  knockdownTimer: number;
  knockdownRoll: number;
  tumbleVx: number;
  tumbleVz: number;
}

export const PLAYER_RADIUS = 0.42;
const WALK_SPEED = 4.6;
const SPRINT_SPEED = 8.0;
const GRAVITY = 22.0;
const JUMP_VEL = 7.4;
export const MOUNT_DISTANCE = 3.4;

export class PlayerController {
  public state: PlayerState;

  private readonly spawnX = ACTIVE_MAP_DATA.meta.playerSpawn.x;
  private readonly spawnZ = ACTIVE_MAP_DATA.meta.playerSpawn.z;
  private readonly spawnHeading = ACTIVE_MAP_DATA.meta.playerSpawn.heading;

  constructor() {
    this.state = this.createInitialState();
  }

  private createInitialState(): PlayerState {
    return {
      mode: 'on_foot',
      inCorridor: false,
      baseY: 0,
      x: this.spawnX,
      y: 0,
      z: this.spawnZ,
      vy: 0,
      heading: this.spawnHeading,
      moveSpeed: 0,
      walkCycle: 0,
      grounded: true,
      canMountScooter: false,
      distanceToScooter: 0,
      stamina: 100,
      climbingStairs: false,
      energyBuffTimer: 0,
      coffeeBuffTimer: 0,
      knockdownTimer: 0,
      knockdownRoll: 0,
      tumbleVx: 0,
      tumbleVz: 0,
    };
  }

  public reset(): void {
    this.state = this.createInitialState();
  }

  /** Applies 24h convenience store beverage buffs (Energy Drink / Iced Coffee) */
  public applyConvenienceDrink(kind: 'energy_drink' | 'iced_coffee'): void {
    if (kind === 'energy_drink') {
      this.state.stamina = 100;
      this.state.energyBuffTimer = 60;
    } else {
      this.state.stamina = clamp(this.state.stamina + 60, 0, 100);
      this.state.coffeeBuffTimer = 45;
    }
  }

  /** Called when the scooter suffers a lowside crash while riding! */
  public ejectFromScooter(scooter: ScooterState, crashSide: number, impactSpeed: number): void {
    const p = this.state;
    const leftX = Math.cos(scooter.heading);
    const leftZ = -Math.sin(scooter.heading);
    const fwdX = Math.sin(scooter.heading);
    const fwdZ = Math.cos(scooter.heading);

    // Eject slightly to the fallen side
    const sideDir = crashSide < 0 ? 1 : -1;
    p.mode = 'knockdown';
    p.x = scooter.x + leftX * sideDir * 0.9;
    p.z = scooter.z + leftZ * sideDir * 0.9;
    p.y = 0.35;
    p.vy = 2.0;
    p.grounded = false;
    p.heading = scooter.heading;
    p.moveSpeed = 0;

    p.knockdownTimer = 1.65;
    p.knockdownRoll = crashSide * 0.72;
    const slideMag = Math.min(impactSpeed * 0.65, 9.0);
    p.tumbleVx = fwdX * slideMag + leftX * sideDir * 2.4;
    p.tumbleVz = fwdZ * slideMag + leftZ * sideDir * 2.4;
  }

  public teleportTo(x: number, baseY: number, z: number, heading: number, inCorridor: boolean): void {
    const p = this.state;
    p.mode = 'on_foot';
    p.inCorridor = inCorridor;
    p.baseY = baseY;
    p.x = x;
    p.y = baseY;
    p.z = z;
    p.vy = 0;
    p.heading = heading;
    p.moveSpeed = 0;
    p.grounded = true;
    p.stamina = 100;
    p.climbingStairs = false;
    p.knockdownTimer = 0;
    p.knockdownRoll = 0;
  }

  public tryToggleMount(
    scooter: ScooterState,
    setScooterMounted: (mounted: boolean) => void,
    obstacles: ObstacleBox[],
    isCarryingFood: boolean
  ): { changed: boolean; message: string } {
    const p = this.state;

    if (p.inCorridor) {
      return { changed: false, message: '실내 복도에서는 오토바이를 탈 수 없습니다' };
    }

    if (p.mode === 'knockdown') {
      return { changed: false, message: '일어나는 중...' };
    }

    if (p.mode === 'on_foot') {
      const dist = Math.hypot(p.x - scooter.x, p.z - scooter.z);
      if (dist > MOUNT_DISTANCE) {
        return { changed: false, message: '오토바이 가까이 가서 [F]를 누르세요' };
      }
      if (isCarryingFood) {
        return {
          changed: false,
          message: '🚫 음식을 손에 든 채로는 운전할 수 없습니다! 뒤편 배달통에서 [E]로 적재하세요',
        };
      }
      const wasFallen = scooter.crashed;
      p.mode = 'riding';
      p.y = 0;
      p.vy = 0;
      p.moveSpeed = 0;
      p.grounded = true;
      setScooterMounted(true);
      return {
        changed: true,
        message: wasFallen
          ? '쓰러진 오토바이를 일으켜 탑승했습니다!'
          : '오토바이 탑승! (코너링 시 과속 기울기 주의)',
      };
    }

    // Riding -> dismount
    if (Math.abs(scooter.speed) > 4.2) {
      return { changed: false, message: '속도를 줄인 뒤 [F]로 하차하세요!' };
    }

    const leftX = Math.cos(scooter.heading);
    const leftZ = -Math.sin(scooter.heading);
    const fwdX = Math.sin(scooter.heading);
    const fwdZ = Math.cos(scooter.heading);

    const candidates: Array<[number, number]> = [
      [scooter.x + leftX * 1.25 + fwdX * 0.25, scooter.z + leftZ * 1.25 + fwdZ * 0.25],
      [scooter.x - leftX * 1.25 + fwdX * 0.25, scooter.z - leftZ * 1.25 + fwdZ * 0.25],
      [scooter.x - fwdX * 1.6, scooter.z - fwdZ * 1.6],
      [scooter.x + fwdX * 2.1, scooter.z + fwdZ * 2.1],
    ];

    let exitX = scooter.x + leftX * 1.25;
    let exitZ = scooter.z + leftZ * 1.25;
    for (const [cx, cz] of candidates) {
      if (!collidesWithWorld(cx, cz, PLAYER_RADIUS, obstacles)) {
        exitX = cx;
        exitZ = cz;
        break;
      }
    }

    p.mode = 'on_foot';
    p.x = exitX;
    p.y = 0;
    p.z = exitZ;
    p.vy = 0;
    p.heading = scooter.heading;
    p.moveSpeed = 0;
    p.grounded = true;
    setScooterMounted(false);

    return { changed: true, message: '하차 완료 — 도보 이동 모드' };
  }

  public step(
    dt: number,
    input: OnFootInput,
    cameraYaw: number,
    scooter: ScooterState,
    obstacles: ObstacleBox[],
    corridorClamp?: (x: number, z: number) => [number, number],
    corridorFloorY?: (x: number, z: number) => number,
    onStairStep?: () => void
  ): void {
    const p = this.state;
    const clampedDt = Math.min(dt, 0.05);

    if (p.energyBuffTimer > 0) p.energyBuffTimer = Math.max(0, p.energyBuffTimer - clampedDt);
    if (p.coffeeBuffTimer > 0) p.coffeeBuffTimer = Math.max(0, p.coffeeBuffTimer - clampedDt);

    if (p.mode === 'riding') {
      p.x = scooter.x;
      p.z = scooter.z;
      p.y = 0;
      p.heading = scooter.heading;
      p.moveSpeed = 0;
      p.canMountScooter = false;
      p.distanceToScooter = 0;
      // Recover stamina nicely while resting on scooter seat
      const recMul = p.coffeeBuffTimer > 0 ? 2.0 : 1.0;
      p.stamina = clamp(p.stamina + 18 * recMul * clampedDt, 0, 100);
      return;
    }

    if (p.mode === 'knockdown') {
      // Tumble & slide on asphalt, then get back up on foot!
      const speed = Math.hypot(p.tumbleVx, p.tumbleVz);
      if (speed > 0.08) {
        const newSpeed = Math.max(0, speed - 9.5 * clampedDt);
        const ratio = newSpeed / speed;
        p.tumbleVx *= ratio;
        p.tumbleVz *= ratio;
        const nx = p.x + p.tumbleVx * clampedDt;
        const nz = p.z + p.tumbleVz * clampedDt;
        if (!collidesWithWorld(nx, p.z, PLAYER_RADIUS, obstacles)) p.x = nx;
        if (!collidesWithWorld(p.x, nz, PLAYER_RADIUS, obstacles)) p.z = nz;
      }

      if (!p.grounded) {
        p.vy -= GRAVITY * clampedDt;
        p.y += p.vy * clampedDt;
        if (p.y <= 0) {
          p.y = 0;
          p.vy = 0;
          p.grounded = true;
        }
      }

      p.knockdownTimer -= clampedDt;
      // Smoothly level out roll in the last 0.5s as rider stands up
      if (p.knockdownTimer < 0.5) {
        p.knockdownRoll *= Math.exp(-clampedDt * 7);
      }

      if (p.knockdownTimer <= 0) {
        p.mode = 'on_foot';
        p.knockdownRoll = 0;
        p.knockdownTimer = 0;
        p.tumbleVx = 0;
        p.tumbleVz = 0;
        // Face toward the fallen scooter so player immediately sees it!
        p.heading = Math.atan2(scooter.x - p.x, scooter.z - p.z);
      }

      p.distanceToScooter = Math.hypot(p.x - scooter.x, p.z - scooter.z);
      p.canMountScooter = false;
      return;
    }

    // --- 1st-Person On-Foot Movement ---
    const fwdX = Math.sin(cameraYaw);
    const fwdZ = Math.cos(cameraYaw);
    const leftX = Math.cos(cameraYaw);
    const leftZ = -Math.sin(cameraYaw);

    let dirX = fwdX * input.forward + leftX * input.strafe;
    let dirZ = fwdZ * input.forward + leftZ * input.strafe;
    const len = Math.hypot(dirX, dirZ);

    // In 1st-person, player's heading always aligns with look direction
    p.heading = wrapAngle(cameraYaw);

    const prevBaseY = p.baseY;
    const exhaustedMul = p.stamina < 15 ? 0.68 : 1.0;
    const energySpeedMul = p.energyBuffTimer > 0 ? 1.25 : 1.0;
    const stairSprintAllowed = input.sprint && p.stamina > 8;
    const targetSpeed =
      len > 0.01 ? (stairSprintAllowed ? SPRINT_SPEED : WALK_SPEED) * exhaustedMul * energySpeedMul : 0;
    if (len > 0.01) {
      dirX /= len;
      dirZ /= len;
    }

    const accelRate = targetSpeed > p.moveSpeed ? 20 : 24;
    p.moveSpeed += clamp(targetSpeed - p.moveSpeed, -accelRate * clampedDt, accelRate * clampedDt);

    const prevWalkStep = Math.floor(p.walkCycle / 1.45);
    if (p.moveSpeed > 0.05 && len > 0.01) {
      const nx = p.x + dirX * p.moveSpeed * clampedDt;
      const nz = p.z + dirZ * p.moveSpeed * clampedDt;

      if (p.inCorridor && corridorClamp) {
        const [cx, cz] = corridorClamp(nx, nz);
        p.x = cx;
        p.z = cz;
      } else {
        const hitsScooter = (tx: number, tz: number) =>
          Math.hypot(tx - scooter.x, tz - scooter.z) < SCOOTER_SPECS.radius + PLAYER_RADIUS * 0.55;

        if (!collidesWithWorld(nx, p.z, PLAYER_RADIUS, obstacles) && !hitsScooter(nx, p.z)) {
          p.x = nx;
        }
        if (!collidesWithWorld(p.x, nz, PLAYER_RADIUS, obstacles) && !hitsScooter(p.x, nz)) {
          p.z = nz;
        }
      }

      p.walkCycle += p.moveSpeed * clampedDt * 2.1;
    }

    // Update indoor floor elevation (supports multi-story walk-up villa staircases!)
    let ascending = false;
    if (p.inCorridor && corridorFloorY) {
      const nextFloorY = corridorFloorY(p.x, p.z);
      const dy = nextFloorY - prevBaseY;
      ascending = dy > 0.002;
      p.baseY = nextFloorY;
      p.climbingStairs = Math.abs(dy) > 0.002;
      const curWalkStep = Math.floor(p.walkCycle / 1.45);
      if (p.climbingStairs && curWalkStep !== prevWalkStep && onStairStep) {
        onStairStep();
      }
    } else {
      p.climbingStairs = false;
    }

    // Stamina drain when climbing walk-up villa stairs or sprinting; buffed by convenience drinks!
    const drainMul = p.energyBuffTimer > 0 ? 0.5 : 1.0;
    const recoverMul = p.coffeeBuffTimer > 0 ? 2.0 : 1.0;
    if (ascending) {
      const drain = (input.sprint ? 24 : 11) * drainMul;
      p.stamina = clamp(p.stamina - drain * clampedDt, 0, 100);
    } else if (input.sprint && p.moveSpeed > 5.2) {
      const drain = (p.inCorridor ? 9 : 7.5) * drainMul;
      p.stamina = clamp(p.stamina - drain * clampedDt, 0, 100);
    } else {
      const recover = (p.moveSpeed < 0.2 ? 28 : 14) * recoverMul;
      p.stamina = clamp(p.stamina + recover * clampedDt, 0, 100);
    }

    // Jump & gravity relative to current floor level (0 outdoors, -500 inside corridor)
    if (input.jump && p.grounded) {
      p.vy = JUMP_VEL;
      p.grounded = false;
    }
    if (!p.grounded) {
      p.vy -= GRAVITY * clampedDt;
      p.y += p.vy * clampedDt;
      if (p.y <= p.baseY) {
        p.y = p.baseY;
        p.vy = 0;
        p.grounded = true;
      }
    } else {
      p.y = p.baseY;
    }

    if (p.inCorridor) {
      p.distanceToScooter = 999;
      p.canMountScooter = false;
    } else {
      p.distanceToScooter = Math.hypot(p.x - scooter.x, p.z - scooter.z);
      p.canMountScooter = p.distanceToScooter <= MOUNT_DISTANCE;
    }
  }
}
