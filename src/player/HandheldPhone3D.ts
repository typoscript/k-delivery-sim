import * as THREE from 'three';
import { PlayerState } from './PlayerController';

/**
 * 1st-Person 3D Gloved Hand & Forearm holding the Rider's Smartphone.
 * Attached directly to the PerspectiveCamera so the player views the phone
 * naturally through their own hand in 3D perspective (and ready for future delivery photo mode!).
 */
export class HandheldPhone3D {
  public readonly root = new THREE.Group();
  public readonly hitMesh: THREE.Mesh;

  private readonly rigGroup = new THREE.Group();
  private raiseProgress = 0; // 0 = stowed in pocket, 1 = held up in hand

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
      color: 0x0f766e, // Matches rider's teal windbreaker!
      roughness: 0.72,
    });
    const cuffMat = new THREE.MeshStandardMaterial({
      color: 0x134e4a,
      roughness: 0.8,
    });

    // --- 3D Smartphone Body ---
    const phoneW = 0.148;
    const phoneH = 0.278;
    const phoneD = 0.013;

    const phoneBody = new THREE.Mesh(new THREE.BoxGeometry(phoneW, phoneH, phoneD), frameMat);
    this.rigGroup.add(phoneBody);

    // Back camera bump (visible if reflected in mirrors or future photo tilt)
    const camBump = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, 0.008), backMat);
    camBump.position.set(0.032, 0.095, -phoneD / 2 - 0.003);
    this.rigGroup.add(camBump);

    // Live Smartphone Screen facing the player (+Z in camera-attached local space!)
    const screenMat = new THREE.MeshBasicMaterial({
      map: screenTexture,
      toneMapped: false,
    });
    const screenPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(phoneW - 0.012, phoneH - 0.016),
      screenMat
    );
    screenPlane.position.z = phoneD / 2 + 0.001;
    this.rigGroup.add(screenPlane);
    this.hitMesh = screenPlane;

    // Subtle glass specular bevel edges
    const islandBar = new THREE.Mesh(
      new THREE.BoxGeometry(0.034, 0.007, 0.002),
      new THREE.MeshBasicMaterial({ color: 0x05070a })
    );
    islandBar.position.set(0, phoneH / 2 - 0.016, phoneD / 2 + 0.0018);
    this.rigGroup.add(islandBar);

    // --- 3D Gloved Right Hand Gripping the Smartphone ---
    const handGroup = new THREE.Group();

    // Palm behind lower phone
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.11, 0.044), gloveMat);
    palm.position.set(0.02, -0.072, -0.028);
    palm.rotation.z = -0.1;
    handGroup.add(palm);

    // 4 fingers wrapping cleanly around the LEFT edge of the phone
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

      // Wrapped fingertip gripping the front-left bezel edge
      const fingerTip = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.0105, fLen * 0.45, 4, 8),
        knuckleMat
      );
      fingerTip.rotation.z = Math.PI / 2 - 0.18;
      fingerTip.position.set(-phoneW / 2 - 0.002, fy, 0.005);
      handGroup.add(fingerTip);
    }

    // Right thumb resting naturally on the lower-right edge of the phone
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

    // Wrist + Teal Windbreaker Forearm extending naturally toward bottom-right
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.052, 0.045, 12), cuffMat);
    cuff.position.set(0.055, -0.165, -0.01);
    cuff.rotation.set(0.35, 0, -0.45);
    handGroup.add(cuff);

    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.054, 0.068, 0.34, 12), sleeveMat);
    forearm.position.set(0.13, -0.32, 0.05);
    forearm.rotation.set(0.35, 0, -0.45);
    handGroup.add(forearm);

    this.rigGroup.add(handGroup);

    // Base resting pose in camera space (held cleanly in front with natural 3D perspective!)
    this.root.position.set(0.115, -0.145, -0.46);
    this.root.rotation.set(0.18, -0.22, 0.05);
    this.root.visible = false;

    camera.add(this.root);
  }

  public update(visibleInHand: boolean, player: PlayerState, dt: number, elapsedTime: number): void {
    const clampedDt = Math.min(dt, 0.05);
    const target = visibleInHand ? 1 : 0;
    this.raiseProgress += (target - this.raiseProgress) * Math.min(1, clampedDt * 12);

    if (this.raiseProgress < 0.01 && !visibleInHand) {
      this.root.visible = false;
      return;
    }

    this.root.visible = true;

    // Smooth pocket-to-hand raise curve
    const ease = 1 - Math.pow(1 - this.raiseProgress, 3);
    const dropY = (1 - ease) * -0.42;
    const dropPitch = (1 - ease) * -0.65;

    // Natural subtle breathing + walking hand sway
    const walkFactor = Math.min(player.moveSpeed / 6.5, 1);
    const breathY = Math.sin(elapsedTime * 2.1) * 0.0025;
    const swayX = Math.cos(player.walkCycle) * 0.011 * walkFactor;
    const swayY = Math.abs(Math.sin(player.walkCycle)) * 0.012 * walkFactor;

    this.root.position.set(0.115 + swayX, -0.145 + dropY + breathY - swayY, -0.46);
    this.root.rotation.set(0.18 + dropPitch, -0.22 + swayX * 0.6, 0.05 - swayX * 0.8);
  }
}
