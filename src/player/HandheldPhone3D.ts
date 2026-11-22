import * as THREE from 'three';
import { PlayerState } from './PlayerController';

type HandAnimMode = 'none' | 'mounting' | 'unmounting';

/**
 * 1st-Person 3D Gloved Hand & Forearm holding the Rider's Smartphone.
 * Supports:
 * - On-foot handheld view (pocket <-> in_hand)
 * - Riding mount animation (pocket -> forward onto 3D scooter handlebar cradle -> hand retracts)
 * - Unmount animation (grabs phone from 3D handlebar cradle -> pulls back into pocket)
 */
export class HandheldPhone3D {
  public readonly root = new THREE.Group();
  public readonly hitMesh: THREE.Mesh;

  private readonly rigGroup = new THREE.Group();
  private readonly phoneBodyGroup = new THREE.Group();
  private raiseProgress = 0;

  private animMode: HandAnimMode = 'none';
  private animTime = 0;
  private animClickFired = false;
  private onMountClickCallback: ((mounting: boolean) => void) | null = null;

  constructor(camera: THREE.PerspectiveCamera, screenTexture: THREE.CanvasTexture) {
    this.root.add(this.rigGroup);

    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x1e2530,
      roughness: 0.28,
      metalness: 0.65,
    });
    const backMat = new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.35,
      metalness: 0.4,
    });
    const gloveMat = new THREE.MeshStandardMaterial({
      color: 0x181c22,
      roughness: 0.85,
      metalness: 0.05,
    });
    const knuckleMat = new THREE.MeshStandardMaterial({
      color: 0x2a313c,
      roughness: 0.75,
    });
    const sleeveMat = new THREE.MeshStandardMaterial({
      color: 0x0f766e,
      roughness: 0.72,
    });
    const cuffMat = new THREE.MeshStandardMaterial({
      color: 0x134e4a,
      roughness: 0.8,
    });

    // --- 3D Smartphone Body (grouped separately so hand can release it into cradle!) ---
    const phoneW = 0.148;
    const phoneH = 0.278;
    const phoneD = 0.013;

    const phoneBody = new THREE.Mesh(new THREE.BoxGeometry(phoneW, phoneH, phoneD), frameMat);
    this.phoneBodyGroup.add(phoneBody);

    const camBump = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, 0.008), backMat);
    camBump.position.set(0.032, 0.095, -phoneD / 2 - 0.003);
    this.phoneBodyGroup.add(camBump);

    const screenMat = new THREE.MeshBasicMaterial({
      map: screenTexture,
      toneMapped: false,
    });
    const screenPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(phoneW - 0.012, phoneH - 0.016),
      screenMat
    );
    screenPlane.position.z = phoneD / 2 + 0.001;
    this.phoneBodyGroup.add(screenPlane);
    this.hitMesh = screenPlane;

    const islandBar = new THREE.Mesh(
      new THREE.BoxGeometry(0.034, 0.007, 0.002),
      new THREE.MeshBasicMaterial({ color: 0x05070a })
    );
    islandBar.position.set(0, phoneH / 2 - 0.016, phoneD / 2 + 0.0018);
    this.phoneBodyGroup.add(islandBar);

    this.rigGroup.add(this.phoneBodyGroup);

    // --- 3D Gloved Right Hand Gripping the Smartphone ---
    const handGroup = new THREE.Group();

    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.11, 0.044), gloveMat);
    palm.position.set(0.02, -0.072, -0.028);
    palm.rotation.z = -0.1;
    handGroup.add(palm);

    for (let i = 0; i < 4; i++) {
      const fy = -0.015 - i * 0.025;
      const fLen = i === 0 || i === 3 ? 0.036 : 0.042;
      const fingerBack = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.011, 0.042, 4, 8),
        gloveMat
      );
      fingerBack.rotation.z = Math.PI / 2;
      fingerBack.position.set(-0.056, fy, -0.016);
      handGroup.add(fingerBack);

      const fingerTip = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.0105, fLen * 0.45, 4, 8),
        knuckleMat
      );
      fingerTip.rotation.z = Math.PI / 2 - 0.18;
      fingerTip.position.set(-phoneW / 2 - 0.002, fy, 0.005);
      handGroup.add(fingerTip);
    }

    const thumbBase = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.014, 0.045, 4, 8),
      gloveMat
    );
    thumbBase.position.set(phoneW / 2 + 0.01, -0.095, -0.004);
    thumbBase.rotation.set(0.32, 0, 0.25);
    handGroup.add(thumbBase);

    const thumbTip = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.0125, 0.036, 4, 8),
      knuckleMat
    );
    thumbTip.position.set(phoneW / 2 - 0.003, -0.052, 0.012);
    thumbTip.rotation.set(0.15, 0, 0.42);
    handGroup.add(thumbTip);

    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.052, 0.045, 12), cuffMat);
    cuff.position.set(0.055, -0.165, -0.01);
    cuff.rotation.set(0.35, 0, -0.45);
    handGroup.add(cuff);

    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.054, 0.068, 0.34, 12), sleeveMat);
    forearm.position.set(0.13, -0.32, 0.05);
    forearm.rotation.set(0.35, 0, -0.45);
    handGroup.add(forearm);

    this.rigGroup.add(handGroup);

    this.root.position.set(0.115, -0.145, -0.46);
    this.root.rotation.set(0.18, -0.22, 0.05);
    this.root.visible = false;

    camera.add(this.root);
  }

  public setOnMountClick(cb: (mounting: boolean) => void): void {
    this.onMountClickCallback = cb;
  }

  /** Plays 1st-person 3D hand placing phone from pocket onto scooter handlebar mount */
  public startMountAnimation(): void {
    this.animMode = 'mounting';
    this.animTime = 0;
    this.animClickFired = false;
    this.phoneBodyGroup.visible = true;
    this.root.visible = true;
  }

  /** Plays 1st-person 3D hand grabbing phone off scooter mount back into pocket */
  public startUnmountAnimation(): void {
    this.animMode = 'unmounting';
    this.animTime = 0;
    this.animClickFired = false;
    this.phoneBodyGroup.visible = true;
    this.root.visible = true;
  }

  public cancelMountAnimation(): void {
    this.animMode = 'none';
    this.animTime = 0;
    this.phoneBodyGroup.visible = true;
  }

  /** True while the hand is carrying the phone TO the mount (before snapping in) */
  public isHoldingPhoneDuringMountAnim(): boolean {
    if (this.animMode === 'mounting') {
      return this.animTime < 0.44;
    }
    return false;
  }

  public update(visibleInHand: boolean, player: PlayerState, dt: number, elapsedTime: number): void {
    const clampedDt = Math.min(dt, 0.05);

    // --- 1. Playing Pocket -> Scooter Mount Animation ---
    if (this.animMode === 'mounting') {
      this.animTime += clampedDt;
      const snapT = 0.44;
      const endT = 0.72;

      if (this.animTime < snapT) {
        // Hand rises from pocket and pushes phone right into handlebar cradle center!
        const u = Math.min(1, this.animTime / snapT);
        const ease = 1 - Math.pow(1 - u, 3);
        this.phoneBodyGroup.visible = true;
        this.root.visible = true;
        this.root.position.set(
          THREE.MathUtils.lerp(0.24, 0.0, ease),
          THREE.MathUtils.lerp(-0.56, -0.22, ease),
          THREE.MathUtils.lerp(-0.34, -0.64, ease)
        );
        this.root.rotation.set(
          THREE.MathUtils.lerp(-0.45, 0.34, ease),
          THREE.MathUtils.lerp(-0.35, 0.0, ease),
          THREE.MathUtils.lerp(0.18, 0.0, ease)
        );
        return;
      }

      if (!this.animClickFired) {
        this.animClickFired = true;
        if (this.onMountClickCallback) this.onMountClickCallback(true);
      }

      // Phone is now snapped on scooter cradle -> empty gloved hand pulls smoothly back down
      this.phoneBodyGroup.visible = false;
      const v = Math.min(1, (this.animTime - snapT) / (endT - snapT));
      const easeOut = v * v;
      this.root.position.set(
        THREE.MathUtils.lerp(0.0, 0.28, easeOut),
        THREE.MathUtils.lerp(-0.22, -0.62, easeOut),
        THREE.MathUtils.lerp(-0.64, -0.35, easeOut)
      );
      this.root.rotation.set(0.34 - easeOut * 0.6, -easeOut * 0.25, 0);

      if (this.animTime >= endT) {
        this.animMode = 'none';
        this.phoneBodyGroup.visible = true;
        this.root.visible = false;
      }
      return;
    }

    // --- 2. Playing Scooter Mount -> Pocket Unmount Animation ---
    if (this.animMode === 'unmounting') {
      this.animTime += clampedDt;
      const grabT = 0.14;
      const endT = 0.62;

      if (!this.animClickFired && this.animTime >= grabT * 0.5) {
        this.animClickFired = true;
        if (this.onMountClickCallback) this.onMountClickCallback(false);
      }

      this.phoneBodyGroup.visible = true;
      this.root.visible = true;

      if (this.animTime < grabT) {
        // Brief grab settle right at cradle
        const u = this.animTime / grabT;
        this.root.position.set(0.0, -0.22 + u * 0.025, -0.64 + u * 0.04);
        this.root.rotation.set(0.34 - u * 0.08, 0, 0);
        return;
      }

      // Pull phone back toward rider & tuck down into pocket
      const v = Math.min(1, (this.animTime - grabT) / (endT - grabT));
      const ease = v * v * (3 - 2 * v);
      this.root.position.set(
        THREE.MathUtils.lerp(0.0, 0.24, ease),
        THREE.MathUtils.lerp(-0.195, -0.58, ease),
        THREE.MathUtils.lerp(-0.6, -0.34, ease)
      );
      this.root.rotation.set(
        THREE.MathUtils.lerp(0.26, -0.48, ease),
        THREE.MathUtils.lerp(0.0, -0.35, ease),
        THREE.MathUtils.lerp(0.0, 0.18, ease)
      );

      if (this.animTime >= endT) {
        this.animMode = 'none';
        this.root.visible = false;
      }
      return;
    }

    // --- 3. Normal On-Foot Handheld Pose ---
    this.phoneBodyGroup.visible = true;
    const target = visibleInHand ? 1 : 0;
    this.raiseProgress += (target - this.raiseProgress) * Math.min(1, clampedDt * 12);

    if (this.raiseProgress < 0.01 && !visibleInHand) {
      this.root.visible = false;
      return;
    }

    this.root.visible = true;
    const ease = 1 - Math.pow(1 - this.raiseProgress, 3);
    const dropY = (1 - ease) * -0.42;
    const dropPitch = (1 - ease) * -0.65;

    const walkFactor = Math.min(player.moveSpeed / 6.5, 1);
    const breathY = Math.sin(elapsedTime * 2.1) * 0.0025;
    const swayX = Math.cos(player.walkCycle) * 0.011 * walkFactor;
    const swayY = Math.abs(Math.sin(player.walkCycle)) * 0.012 * walkFactor;

    this.root.position.set(0.115 + swayX, -0.145 + dropY + breathY - swayY, -0.46);
    this.root.rotation.set(0.18 + dropPitch, -0.22 + swayX * 0.6, 0.05 - swayX * 0.8);
  }
}
