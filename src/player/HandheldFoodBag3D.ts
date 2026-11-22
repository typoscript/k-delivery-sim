import * as THREE from 'three';
import { PlayerState } from './PlayerController';

/**
 * 1st-Person 3D Left Gloved Hand carrying the delivery takeout food bag.
 * Held on the left side of the camera so it never overlaps the right-hand 3D smartphone!
 */
export class HandheldFoodBag3D {
  public readonly root = new THREE.Group();
  private raiseProgress = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    const bagMesh = HandheldFoodBag3D.createFoodBagMesh();
    bagMesh.position.set(0, -0.14, 0);
    this.root.add(bagMesh);

    const gloveMat = new THREE.MeshStandardMaterial({ color: 0x181c22, roughness: 0.85 });
    const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x0f766e, roughness: 0.72 });
    const cuffMat = new THREE.MeshStandardMaterial({ color: 0x134e4a, roughness: 0.8 });

    // Gloved left fist gripping the bag handles
    const fist = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.065, 0.085), gloveMat);
    fist.position.set(0, 0.02, 0);
    this.root.add(fist);

    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.05, 0.045, 10), cuffMat);
    cuff.position.set(-0.045, 0.01, 0.07);
    cuff.rotation.set(1.25, 0, 0.45);
    this.root.add(cuff);

    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.066, 0.34, 10), sleeveMat);
    forearm.position.set(-0.13, -0.02, 0.21);
    forearm.rotation.set(1.25, 0, 0.45);
    this.root.add(forearm);

    this.root.position.set(-0.22, -0.16, -0.45);
    this.root.rotation.set(0.08, 0.22, -0.06);
    this.root.visible = false;

    camera.add(this.root);
  }

  /** Reusable 3D takeout paper food bag mesh (used in hand AND placed on doormat!) */
  public static createFoodBagMesh(): THREE.Group {
    const g = new THREE.Group();

    const kraftMat = new THREE.MeshStandardMaterial({
      color: 0xd9a96f, // Classic warm kraft delivery bag
      roughness: 0.88,
    });
    const foldMat = new THREE.MeshStandardMaterial({
      color: 0xc28f52,
      roughness: 0.9,
    });
    const sealMat = new THREE.MeshStandardMaterial({
      color: 0x0d9488, // Mint-teal delivery seal sticker
      roughness: 0.5,
    });
    const receiptMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.8,
    });
    const handleMat = new THREE.MeshStandardMaterial({
      color: 0xb07d42,
      roughness: 0.85,
    });

    // Main paper bag body (origin at top handle grip for hand, or bottom offset for floor)
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.26, 0.14), kraftMat);
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    // Folded top flap
    const fold = new THREE.Mesh(new THREE.BoxGeometry(0.225, 0.045, 0.145), foldMat);
    fold.position.set(0, 0.12, 0);
    g.add(fold);

    // Delivery seal tape & order receipt slip on front
    const seal = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.148), sealMat);
    seal.position.set(0, 0.115, 0);
    g.add(seal);

    const receipt = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.11, 0.004), receiptMat);
    receipt.position.set(0.03, 0.02, 0.072);
    receipt.rotation.z = -0.06;
    g.add(receipt);

    // Two paper loop handles on top
    for (const zOff of [-0.035, 0.035]) {
      const handle = new THREE.Mesh(
        new THREE.TorusGeometry(0.042, 0.007, 6, 12, Math.PI),
        handleMat
      );
      handle.position.set(0, 0.135, zOff);
      g.add(handle);
    }

    return g;
  }

  public update(visible: boolean, player: PlayerState, dt: number, elapsedTime: number): void {
    const clampedDt = Math.min(dt, 0.05);
    const target = visible ? 1 : 0;
    this.raiseProgress += (target - this.raiseProgress) * Math.min(1, clampedDt * 11);

    if (this.raiseProgress < 0.01 && !visible) {
      this.root.visible = false;
      return;
    }

    this.root.visible = true;
    const ease = 1 - Math.pow(1 - this.raiseProgress, 3);
    const dropY = (1 - ease) * -0.45;

    const walkFactor = Math.min(player.moveSpeed / 6.5, 1);
    const swingZ = Math.sin(player.walkCycle) * 0.09 * walkFactor;
    const bobY = Math.abs(Math.sin(player.walkCycle)) * 0.016 * walkFactor;
    const breathY = Math.sin(elapsedTime * 1.9) * 0.003;

    this.root.position.set(-0.22, -0.15 + dropY + breathY - bobY, -0.46);
    this.root.rotation.set(0.08 + swingZ * 0.6, 0.22, -0.06 + swingZ);
  }
}
