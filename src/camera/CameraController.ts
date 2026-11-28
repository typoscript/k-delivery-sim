import * as THREE from 'three';
import { PlayerState } from '../player/PlayerController';
import { ScooterState } from '../vehicle/ScooterPhysics';
import { ScooterMesh } from '../vehicle/ScooterMesh';
import { clamp, wrapAngle } from '../types';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';

/**
 * Always First-Person Camera Controller:
 * - On-Foot: Eye-level 1st-person view with natural walk bob & 360° mouse-drag / arrow-key look
 * - Riding: Helmet 1st-person view looking over turning handlebars with dynamic horizon lean roll
 * - Knockdown: Dramatic asphalt tumble & stand-up recovery camera when over-leaning in a corner
 */
export class CameraController {
  // World-space look yaw when on-foot (0 = +Z)
  public onFootYaw = ACTIVE_MAP_DATA.meta.playerSpawn.heading;
  public sensitivity = 1.0;
  private onFootPitch = -0.06;

  // Relative head-look offset when riding
  private rideLookYaw = 0;
  private rideLookPitch = -0.08;

  private isDragging = false;
  private lastX = 0;
  private lastY = 0;

  private smoothedRoll = 0;
  /** Extra horizon roll from a crosswind gust while riding (set every frame by the world frame, radians) */
  public windRoll = 0;
  private smoothedEyeY = 1.62;

  private readonly tmpEye = new THREE.Vector3();
  private readonly tmpTarget = new THREE.Vector3();
  private readonly tmpUp = new THREE.Vector3(0, 1, 0);

  constructor(domElement: HTMLElement) {
    domElement.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      this.isDragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });

    domElement.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('pointerup', () => {
      this.isDragging = false;
    });

    window.addEventListener('pointermove', (e) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;

      this.onFootYaw = wrapAngle(this.onFootYaw - dx * 0.0055 * this.sensitivity);
      this.onFootPitch = clamp(this.onFootPitch - dy * 0.0045 * this.sensitivity, -0.75, 0.75);

      this.rideLookYaw = clamp(this.rideLookYaw - dx * 0.005 * this.sensitivity, -1.45, 1.45);
      this.rideLookPitch = clamp(this.rideLookPitch - dy * 0.004 * this.sensitivity, -0.45, 0.45);
    });

    domElement.addEventListener('dblclick', () => {
      if (performance.now() < this.ignoreDblclickUntil) return;
      this.resetLook();
    });
  }

  private ignoreDblclickUntil = 0;

  /** A gesture on the in-world phone owns this press: stop turning the view, skip the double-click reset */
  public yieldPointerToPhone(): void {
    this.isDragging = false;
    this.ignoreDblclickUntil = performance.now() + 600;
  }

  public rotateOnFootYaw(deltaRad: number): void {
    this.onFootYaw = wrapAngle(this.onFootYaw + deltaRad);
  }

  public resetLook(): void {
    this.rideLookYaw = 0;
    this.rideLookPitch = -0.08;
    this.onFootPitch = -0.06;
  }

  public syncYawOnModeChange(player: PlayerState, scooter: ScooterState): void {
    if (player.mode === 'riding') {
      this.rideLookYaw = 0;
      this.rideLookPitch = -0.08;
    } else {
      this.onFootYaw = scooter.heading;
      this.onFootPitch = -0.06;
    }
  }

  public update(
    camera: THREE.PerspectiveCamera,
    player: PlayerState,
    scooter: ScooterState,
    scooterMesh: ScooterMesh,
    dt: number
  ): void {
    const clampedDt = Math.min(dt, 0.05);

    // 1. Knockdown / Lowside Crash 1st-Person Camera
    if (player.mode === 'knockdown') {
      const standProgress = clamp(1 - player.knockdownTimer / 0.55, 0, 1);
      const targetY = 0.42 + standProgress * 1.15;
      this.smoothedEyeY += (targetY - this.smoothedEyeY) * Math.min(1, clampedDt * 12);
      this.smoothedRoll += (player.knockdownRoll - this.smoothedRoll) * Math.min(1, clampedDt * 12);

      this.tmpEye.set(player.x, player.y + this.smoothedEyeY, player.z);
      // Look toward fallen scooter as rider recovers!
      const lookYaw = Math.atan2(scooter.x - player.x, scooter.z - player.z);
      this.onFootYaw = lookYaw;

      this.tmpTarget.set(
        this.tmpEye.x + Math.sin(lookYaw) * 10,
        this.tmpEye.y - 0.15,
        this.tmpEye.z + Math.cos(lookYaw) * 10
      );

      this.applyCameraWithRoll(camera, this.tmpEye, this.tmpTarget, this.smoothedRoll);
      return;
    }

    // 2. On-Foot 1st-Person Camera
    if (player.mode === 'on_foot') {
      const bobAmp = Math.min(player.moveSpeed / 7.5, 1) * 0.055;
      const walkBob = player.grounded ? Math.sin(player.walkCycle * 2) * bobAmp : 0;
      const targetY = 1.62 + walkBob;
      this.smoothedEyeY += (targetY - this.smoothedEyeY) * Math.min(1, clampedDt * 14);
      this.smoothedRoll += (0 - this.smoothedRoll) * Math.min(1, clampedDt * 10);

      this.tmpEye.set(player.x, player.y + this.smoothedEyeY, player.z);

      const cosP = Math.cos(this.onFootPitch);
      this.tmpTarget.set(
        this.tmpEye.x + Math.sin(this.onFootYaw) * cosP * 16,
        this.tmpEye.y + Math.sin(this.onFootPitch) * 16,
        this.tmpEye.z + Math.cos(this.onFootYaw) * cosP * 16
      );

      this.applyCameraWithRoll(camera, this.tmpEye, this.tmpTarget, this.smoothedRoll);
      return;
    }

    // 3. Riding Scooter 1st-Person Helmet Camera (with cornering horizon lean roll!)
    if (!this.isDragging && Math.abs(scooter.speed) > 1.2) {
      this.rideLookYaw *= Math.exp(-clampedDt * 2.5);
    }

    scooterMesh.root.updateMatrixWorld(true);
    scooterMesh.getFirstPersonEyeWorld(this.tmpEye);
    // Physical vertical suspension bounce when hitting a speed bump at speed!
    if (scooter.bumpJolt > 0.01) {
      this.tmpEye.y += Math.sin(scooter.bumpJolt * Math.PI) * 0.14 * scooter.bumpJolt;
    }
    this.smoothedEyeY = this.tmpEye.y;

    // Horizon tilts smoothly with the scooter's physical cornering lean (~62% roll)
    const targetRoll = scooter.leanAngle * 0.62 + this.windRoll;
    this.smoothedRoll += (targetRoll - this.smoothedRoll) * Math.min(1, clampedDt * 14);

    // Slight look-into-turn head turn + pitch
    const lookYaw = scooter.heading + this.rideLookYaw + scooter.steerAngle * 0.25;
    const cosP = Math.cos(this.rideLookPitch);
    this.tmpTarget.set(
      this.tmpEye.x + Math.sin(lookYaw) * cosP * 22,
      this.tmpEye.y + Math.sin(this.rideLookPitch) * 22,
      this.tmpEye.z + Math.cos(lookYaw) * cosP * 22
    );

    this.applyCameraWithRoll(camera, this.tmpEye, this.tmpTarget, this.smoothedRoll);
  }

  private applyCameraWithRoll(
    camera: THREE.PerspectiveCamera,
    eye: THREE.Vector3,
    target: THREE.Vector3,
    roll: number
  ): void {
    // Compute forward & right basis so roll tilts camera cleanly around view axis
    const fwd = target.clone().sub(eye).normalize();
    const worldUp = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(fwd, worldUp).normalize();
    // Negative roll = lean left (-right)
    this.tmpUp
      .copy(worldUp)
      .multiplyScalar(Math.cos(roll))
      .addScaledVector(right, Math.sin(roll))
      .normalize();

    camera.up.copy(this.tmpUp);
    camera.position.copy(eye);
    camera.lookAt(target);
  }
}
