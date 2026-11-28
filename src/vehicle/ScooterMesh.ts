import * as THREE from 'three';
import { mergeStaticByMaterial } from '../world/instancing';
import { SideMirrors } from './scooter/sideMirrors';
import { drawDashboardCluster } from './scooter/dashboardCluster';
import { ScooterState } from './ScooterPhysics';
import {
  SCOOTER_PAINTS,
  ScooterModelId,
  ScooterPaintId,
} from './ScooterModels';


import { ScooterBuildMats, buildFrontLights, buildRearBody, buildSteeringAssembly } from './scooter/scooterBody';

import {
  sync as syncFn,
} from './scooter/scooterSync';

export class ScooterMesh {
  public readonly root = new THREE.Group();
  /** @internal scooter/* */
  readonly bodyTiltGroup = new THREE.Group();
  /** @internal scooter/* */
  readonly handlebarGroup = new THREE.Group();
  /** @internal scooter/* */
  readonly frontWheel: THREE.Object3D;
  /** @internal scooter/* */
  readonly rearWheel: THREE.Object3D;
  /** @internal scooter/* */
  readonly kickstandGroup = new THREE.Group();
  /** @internal scooter/* */
  readonly cargoLidPivot = new THREE.Group();
  /** @internal scooter/* */
  readonly cargoSlotLedMats: THREE.MeshStandardMaterial[] = [];
  /** @internal scooter/* */
  readonly cargoSlotBags: THREE.Mesh[] = [];
  /** @internal scooter/* */
  cargoSlotOccupied: [boolean, boolean, boolean] = [false, false, false];
  /** @internal scooter/* */
  cargoLidTimer = 0;
  /** @internal scooter/* */
  readonly mountedPhone3D = new THREE.Group();
  public readonly mountedPhoneHitMesh: THREE.Mesh;
  public readonly riderMountPoint = new THREE.Group();

  /** Live rear-view side mirrors (render targets, cameras, mirror heads) */
  /** @internal scooter/* */
  readonly mirrors = new SideMirrors();

  // 3D Handlebar Instrument Cluster (Fuel Gauge & Low-Fuel Warning LED)
  private readonly dashCanvas: HTMLCanvasElement;
  private readonly dashCtx: CanvasRenderingContext2D;
  /** @internal scooter/* */
  readonly dashTex: THREE.CanvasTexture;
  /** @internal scooter/* */
  readonly dashFuelWarnLedMat: THREE.MeshStandardMaterial;
  /** @internal scooter/* */
  lastDashDrawTime = -1;

  /** @internal scooter/* */
  readonly headlightSpot: THREE.SpotLight;
  /** @internal scooter/* */
  readonly headlightFill: THREE.PointLight;
  /** @internal scooter/* */
  readonly headlightConeMesh: THREE.Mesh;
  /** @internal scooter/* */
  readonly headlightConeMat: THREE.MeshBasicMaterial;
  /** @internal scooter/* */
  readonly brakeGlowLight: THREE.PointLight;
  /** @internal scooter/* */
  readonly headlightMat: THREE.MeshStandardMaterial;
  /** @internal scooter/* */
  readonly brakeLightMat: THREE.MeshStandardMaterial;
  /** @internal scooter/* */
  readonly leftBlinkerMat: THREE.MeshStandardMaterial;
  /** @internal scooter/* */
  readonly rightBlinkerMat: THREE.MeshStandardMaterial;
  /** @internal scooter/* */
  readonly dashLeftLedMat: THREE.MeshStandardMaterial;
  /** @internal scooter/* */
  readonly dashRightLedMat: THREE.MeshStandardMaterial;
  /** @internal scooter/* */
  readonly leftBlinkerGlow: THREE.PointLight;
  /** @internal scooter/* */
  readonly rightBlinkerGlow: THREE.PointLight;

  // Dynamic bike model & custom paint materials / trim groups (PCX / Super Cub / Electric EV-PRO)
  private readonly bodyPaintMat: THREE.MeshStandardMaterial;
  private readonly accentPaintMat: THREE.MeshStandardMaterial;
  /** @internal scooter/* */
  readonly seatMat: THREE.MeshStandardMaterial;
  private readonly boxMat: THREE.MeshStandardMaterial;
  /** @internal scooter/* */
  readonly exhaustMesh: THREE.Mesh;
  /** @internal scooter/* */
  readonly pcxTrimGroup = new THREE.Group();
  /** @internal scooter/* */
  readonly cubTrimGroup = new THREE.Group();
  /** @internal scooter/* */
  readonly evTrimGroup = new THREE.Group();

  /**
   * The body is built from ~50 boxes and cylinders: merge the ones that never move on their own into one mesh per
   * material (~32 -> ~half the draw calls for the scooter in view). Everything the scooter keeps a reference to -
   * wheels, steering, kickstand, model trims (toggled per model), cargo box, lights, mirrors, the phone - stays as it
   * is, with all of its children. Materials are shared, so paint changes and glowing lights keep working.
   */
  private mergeStaticParts(): void {
    const keep = new Set<THREE.Object3D>();
    for (const v of Object.values(this) as unknown[]) {
      const list = Array.isArray(v) ? v : [v];
      for (const o of list) if (o instanceof THREE.Object3D) keep.add(o);
    }
    keep.delete(this.root);
    keep.delete(this.bodyTiltGroup);
    // lights hang off meshes in places: keep a light's parent too
    this.bodyTiltGroup.traverse((o) => {
      if ((o as THREE.Light).isLight && o.parent && o.parent !== this.bodyTiltGroup) keep.add(o.parent);
    });
    mergeStaticByMaterial(this.bodyTiltGroup, (o) => keep.has(o));
    // groups that move as a whole (steering, trims, cargo box...) still merge their own static parts
    for (const g of keep) {
      if (g instanceof THREE.Group && g.children.length > 1) mergeStaticByMaterial(g, (o) => o !== g && keep.has(o));
    }
  }

  constructor(scene: THREE.Scene, phoneScreenTexture: THREE.CanvasTexture) {
    this.headlightMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      emissive: 0xfffbeb,
      emissiveIntensity: 0.2,
    });
    this.brakeLightMat = new THREE.MeshStandardMaterial({
      color: 0x7f1d1d,
      emissive: 0xef4444,
      emissiveIntensity: 0.2,
    });
    this.leftBlinkerMat = new THREE.MeshStandardMaterial({
      color: 0x78350f,
      emissive: 0xf59e0b,
      emissiveIntensity: 0,
    });
    this.rightBlinkerMat = new THREE.MeshStandardMaterial({
      color: 0x78350f,
      emissive: 0xf59e0b,
      emissiveIntensity: 0,
    });
    this.dashLeftLedMat = new THREE.MeshStandardMaterial({
      color: 0x14532d,
      emissive: 0x22c55e,
      emissiveIntensity: 0.08,
    });
    this.dashRightLedMat = new THREE.MeshStandardMaterial({
      color: 0x14532d,
      emissive: 0x22c55e,
      emissiveIntensity: 0.08,
    });
    this.dashFuelWarnLedMat = new THREE.MeshStandardMaterial({
      color: 0x450a0a,
      emissive: 0xef4444,
      emissiveIntensity: 0.05,
    });

    this.dashCanvas = document.createElement('canvas');
    this.dashCanvas.width = 256;
    this.dashCanvas.height = 96;
    this.dashCtx = this.dashCanvas.getContext('2d')!;
    this.dashTex = new THREE.CanvasTexture(this.dashCanvas);
    this.dashTex.colorSpace = THREE.SRGBColorSpace;
    this.dashTex.minFilter = THREE.LinearFilter;
    this.dashTex.magFilter = THREE.LinearFilter;
    for (let i = 0; i < 3; i++) {
      this.cargoSlotLedMats.push(
        new THREE.MeshStandardMaterial({
          color: 0x0f172a,
          emissive: 0x10b981,
          emissiveIntensity: 0,
        })
      );
    }

    this.root.add(this.bodyTiltGroup);

    this.bodyPaintMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.3,
      metalness: 0.25,
    });
    const bodyPaint = this.bodyPaintMat;
    this.accentPaintMat = new THREE.MeshStandardMaterial({
      color: 0x0ea5e9,
      roughness: 0.35,
      metalness: 0.2,
    });
    const accentPaint = this.accentPaintMat;
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x1e242c,
      roughness: 0.72,
      metalness: 0.2,
    });
    this.seatMat = new THREE.MeshStandardMaterial({
      color: 0x1e242c,
      roughness: 0.72,
      metalness: 0.15,
    });
    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      roughness: 0.22,
      metalness: 0.85,
    });
    this.boxMat = new THREE.MeshStandardMaterial({
      color: 0x14b8a6,
      roughness: 0.42,
      metalness: 0.1,
    });
    const boxMat = this.boxMat;
    const mats: ScooterBuildMats = { bodyPaint, accentPaint, darkMat, chromeMat, boxMat };

    const rear = buildRearBody(this, mats);
    this.rearWheel = rear.rearWheel;
    this.exhaustMesh = rear.exhaustMesh;
    const front = buildFrontLights(this, mats);
    this.brakeGlowLight = front.brakeGlowLight;
    this.headlightSpot = front.headlightSpot;
    this.headlightFill = front.headlightFill;
    this.headlightConeMat = front.headlightConeMat;
    this.headlightConeMesh = front.headlightConeMesh;
    const steer = buildSteeringAssembly(this, mats, phoneScreenTexture);
    this.frontWheel = steer.frontWheel;
    this.leftBlinkerGlow = steer.leftBlinkerGlow;
    this.rightBlinkerGlow = steer.rightBlinkerGlow;
    this.mountedPhoneHitMesh = steer.mountedPhoneHitMesh;
    // Kickstand
    this.kickstandGroup.position.set(0.2, 0.28, 0.45);
    const standLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.34, 6), darkMat);
    standLeg.position.set(0.06, -0.15, -0.02);
    standLeg.rotation.z = 0.35;
    this.kickstandGroup.add(standLeg);
    this.bodyTiltGroup.add(this.kickstandGroup);

    this.riderMountPoint.position.set(0, 0.86, 0.28);
    this.bodyTiltGroup.add(this.riderMountPoint);

    this.mergeStaticParts();
    scene.add(this.root);
  }

  public setPhoneMounted(mounted: boolean): void {
    this.mountedPhone3D.visible = mounted;
  }

  public triggerCargoBoxOpen(): void {
    this.cargoLidTimer = 1.15;
  }

  public setCargoSlotsVisual(occupied: [boolean, boolean, boolean]): void {
    this.cargoSlotOccupied = occupied;
    for (let i = 0; i < 3; i++) {
      this.cargoSlotLedMats[i].emissiveIntensity = occupied[i] ? 2.5 : 0;
    }
  }

  public getCargoBoxWorldPosition(out: THREE.Vector3): THREE.Vector3 {
    // Trigger spot right behind the rear delivery top-box
    out.set(0, 0.8, -0.95);
    return this.root.localToWorld(out);
  }

  public sync(
    state: ScooterState,
    elapsedTime: number,
    dt = 0.016,
    isNight = false,
    rainIntensity = 0
  ): void {
    syncFn(this, state, elapsedTime, dt, isNight, rainIntensity);
  }

  public applyCustomization(modelId: ScooterModelId, paintId: ScooterPaintId): void {
    const paint = SCOOTER_PAINTS[paintId];
    this.bodyPaintMat.color.setHex(paint.bodyHex);
    this.accentPaintMat.color.setHex(paint.accentHex);
    this.boxMat.color.setHex(paint.boxHex);

    // Classic Super Cub gets warm saddle-brown leather seat; PCX/EV get matte charcoal
    this.seatMat.color.setHex(modelId === 'cub' ? 0x7c3f1d : 0x1e242c);
    this.exhaustMesh.visible = modelId !== 'electric';

    this.pcxTrimGroup.visible = modelId === 'pcx';
    this.cubTrimGroup.visible = modelId === 'cub';
    this.evTrimGroup.visible = modelId === 'electric';
  }

  /** @internal scooter/* */
  renderDashboardCluster(state: ScooterState, elapsedTime: number): void {
    drawDashboardCluster(this.dashCtx, this.dashCanvas.width, this.dashCanvas.height, state, elapsedTime);
    this.dashTex.needsUpdate = true;
  }

  /**
   * Renders live rear views into both left & right handlebar side mirror textures!
   * Only runs while mounted on the scooter so on-foot performance is untouched.
   */
  public renderMirrors(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    state: ScooterState
  ): void {
    if (!state.mounted || state.crashed) return;

    this.root.updateMatrixWorld(true);
    this.mirrors.render(renderer, scene, state);
  }

  public getFirstPersonEyeWorld(out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 1.56, 0.45);
    return this.bodyTiltGroup.localToWorld(out);
  }
}
