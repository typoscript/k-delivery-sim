import * as THREE from 'three';
import { PlayerState } from './PlayerController';

export class PlayerMesh {
  public readonly root = new THREE.Group();
  private readonly torsoGroup = new THREE.Group();
  private readonly headGroup = new THREE.Group();
  private readonly leftArm = new THREE.Group();
  private readonly rightArm = new THREE.Group();
  private readonly leftLeg = new THREE.Group();
  private readonly rightLeg = new THREE.Group();

  private readonly scene: THREE.Scene;
  private isAttachedToScooter = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    const jacketMat = new THREE.MeshStandardMaterial({
      color: 0x0f766e, // Delivery rider teal windbreaker
      roughness: 0.65,
    });
    const stripeMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.5,
    });
    const pantsMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.8,
    });
    const shoeMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      roughness: 0.7,
    });
    const helmetMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.22,
      metalness: 0.2,
    });
    const visorMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.12,
      metalness: 0.6,
    });
    const gloveMat = new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.8,
    });

    // Legs (hip pivot at y = 0.86)
    const buildLeg = (xOff: number, pivot: THREE.Group) => {
      pivot.position.set(xOff, 0.86, 0);
      const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.76, 0.18), pantsMat);
      thigh.position.set(0, -0.38, 0);
      thigh.castShadow = true;
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.12, 0.28), shoeMat);
      shoe.position.set(0, -0.8, 0.05);
      shoe.castShadow = true;
      pivot.add(thigh, shoe);
      this.root.add(pivot);
    };
    buildLeg(0.11, this.leftLeg);
    buildLeg(-0.11, this.rightLeg);

    // Torso (pivot at waist y = 0.86)
    this.torsoGroup.position.set(0, 0.86, 0);
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.56, 0.24), jacketMat);
    chest.position.set(0, 0.3, 0);
    chest.castShadow = true;
    const chestStripe = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.08, 0.25), stripeMat);
    chestStripe.position.set(0, 0.36, 0);
    this.torsoGroup.add(chest, chestStripe);

    // Arms (shoulder pivot at y = 0.54 relative to torso)
    const buildArm = (xOff: number, pivot: THREE.Group) => {
      pivot.position.set(xOff, 0.52, 0);
      const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.52, 0.14), jacketMat);
      sleeve.position.set(0, -0.24, 0);
      sleeve.castShadow = true;
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.12), gloveMat);
      hand.position.set(0, -0.52, 0.02);
      pivot.add(sleeve, hand);
      this.torsoGroup.add(pivot);
    };
    buildArm(0.28, this.leftArm);
    buildArm(-0.28, this.rightArm);

    // Head + Delivery Helmet
    this.headGroup.position.set(0, 0.62, 0);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 12), helmetMat);
    helmet.position.set(0, 0.14, 0);
    helmet.castShadow = true;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.11, 0.14), visorMat);
    visor.position.set(0, 0.14, 0.13);
    this.headGroup.add(helmet, visor);
    this.torsoGroup.add(this.headGroup);

    this.root.add(this.torsoGroup);
    this.scene.add(this.root);
  }

  public sync(
    state: PlayerState,
    riderMountPoint: THREE.Group,
    scooterSteerAngle: number,
    hideInFirstPerson: boolean
  ): void {
    this.root.visible = !hideInFirstPerson;

    if (state.mode === 'riding') {
      if (!this.isAttachedToScooter) {
        riderMountPoint.add(this.root);
        this.isAttachedToScooter = true;
      }

      // Seated riding pose relative to scooter's riderMountPoint
      this.root.position.set(0, -0.78, 0);
      this.root.rotation.set(0, 0, 0);

      // Slight forward lean toward handlebars
      this.torsoGroup.position.set(0, 0.82, -0.02);
      this.torsoGroup.rotation.x = 0.24;

      // Arms reaching forward to handlebar grips (slightly shifting with steering!)
      this.leftArm.rotation.set(-1.12, -0.08, 0.12);
      this.rightArm.rotation.set(-1.12, 0.08, -0.12);
      this.leftArm.position.z = scooterSteerAngle * 0.08;
      this.rightArm.position.z = -scooterSteerAngle * 0.08;

      // Seated legs bent forward onto scooter floorboard
      this.leftLeg.rotation.set(-1.15, 0, 0.16);
      this.rightLeg.rotation.set(-1.15, 0, -0.16);
      this.leftLeg.position.set(0.14, 0.82, 0.08);
      this.rightLeg.position.set(-0.14, 0.82, 0.08);
      return;
    }

    // On-foot mode: ensure attached to world scene
    if (this.isAttachedToScooter) {
      this.scene.add(this.root);
      this.isAttachedToScooter = false;
    }

    this.root.position.set(state.x, state.y, state.z);
    this.root.rotation.set(0, state.heading, 0);

    // Reset seated offsets
    this.leftArm.position.z = 0;
    this.rightArm.position.z = 0;
    this.leftLeg.position.set(0.11, 0.86, 0);
    this.rightLeg.position.set(-0.11, 0.86, 0);

    const speedFactor = Math.min(state.moveSpeed / 6.5, 1);
    const swing = Math.sin(state.walkCycle) * 0.72 * speedFactor;

    // Subtle torso bob and forward run lean
    const bob = Math.abs(Math.sin(state.walkCycle)) * 0.045 * speedFactor;
    this.torsoGroup.position.set(0, 0.86 + bob, 0);
    this.torsoGroup.rotation.x = 0.12 * speedFactor;

    if (!state.grounded) {
      // Mid-air jump pose
      this.leftLeg.rotation.set(-0.45, 0, 0.08);
      this.rightLeg.rotation.set(0.35, 0, -0.08);
      this.leftArm.rotation.set(-0.6, 0, 0.25);
      this.rightArm.rotation.set(-0.6, 0, -0.25);
    } else {
      this.leftLeg.rotation.set(swing, 0, 0);
      this.rightLeg.rotation.set(-swing, 0, 0);
      this.leftArm.rotation.set(-swing * 0.85, 0, 0.06);
      this.rightArm.rotation.set(swing * 0.85, 0, -0.06);
    }
  }
}
