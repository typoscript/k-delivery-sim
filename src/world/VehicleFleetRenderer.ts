import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mergeColoredParts } from './instancing';

/**
 * Draws every AI car and bus with a handful of InstancedMeshes (one per part type) instead of
 * ~9 meshes per vehicle: 24 vehicles went from ~200 draw calls to ~13.
 *
 * Per-vehicle look is kept through per-instance colours:
 *  - body paint (white sedans, taxis, blue/red cars...)
 *  - brake lights (dim / night / braking), headlights (day / night), taxi roof cap, bus hazards
 * Lights use unlit MeshBasicMaterial with instance colours above 1.0, which read as glowing
 * after tone mapping (they were emissive MeshStandardMaterials before).
 */

/** Light colours (linear, >1 = glow) */
const BRAKE_DAY = new THREE.Color(0.45, 0.08, 0.08);
const BRAKE_NIGHT = new THREE.Color(1.1, 0.16, 0.16);
const BRAKE_ON = new THREE.Color(2.6, 0.36, 0.36);
const HEAD_DAY = new THREE.Color(1.0, 0.95, 0.62);
const HEAD_NIGHT = new THREE.Color(3.0, 2.8, 1.7);
const TAXI_DAY = new THREE.Color(1.1, 0.95, 0.35);
const TAXI_NIGHT = new THREE.Color(2.5, 2.1, 0.6);
const HAZARD_ON = new THREE.Color(2.7, 1.45, 0.2);
const HAZARD_OFF = new THREE.Color(0.45, 0.22, 0.05);

const box = (w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry =>
  new THREE.BoxGeometry(w, h, d).translate(x, y, z);

/** Merges same-material parts (already positioned in vehicle space) into one geometry */
function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('VehicleFleetRenderer: merge failed');
  return g;
}

interface PartLayer {
  mesh: THREE.InstancedMesh;
  /** Copies per vehicle (2 headlights, 4 wheels...) baked into the geometry, or per-instance? */
  perVehicle: number;
}

export interface VehicleRenderState {
  x: number;
  z: number;
  heading: number;
  braking: boolean;
  /** Accumulated wheel rotation (rad) */
  wheelSpin: number;
  /** Bus only: hazard lights currently lit */
  hazardOn?: boolean;
}

export class VehicleFleetRenderer {
  private readonly carLayers: Record<'body' | 'glass' | 'head' | 'brake' | 'cap' | 'wheels', PartLayer>;
  private readonly busLayers: Record<'body' | 'stripe' | 'glass' | 'head' | 'brake' | 'hazard' | 'wheels', PartLayer>;
  private readonly carIsTaxi: boolean[];
  private readonly m = new THREE.Matrix4();
  private readonly base = new THREE.Matrix4();
  private readonly local = new THREE.Matrix4();
  private readonly spin = new THREE.Matrix4();
  private readonly zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);
  private isNight = false;

  /** Wheel hub offsets in vehicle space */
  private static readonly CAR_WHEELS: Array<[number, number, number]> = [
    [-0.9, 0.34, 1.28],
    [0.9, 0.34, 1.28],
    [-0.9, 0.34, -1.28],
    [0.9, 0.34, -1.28],
  ];
  private static readonly BUS_WHEELS: Array<[number, number, number]> = [
    [-1.18, 0.42, 2.7],
    [1.18, 0.42, 2.7],
    [-1.18, 0.42, -2.6],
    [1.18, 0.42, -2.6],
  ];

  constructor(
    root: THREE.Object3D,
    carColors: readonly number[],
    carIsTaxi: readonly boolean[],
    busCount: number
  ) {
    this.carIsTaxi = [...carIsTaxi];
    const cars = carColors.length;
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.15, metalness: 0.55 });
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    const layer = (geo: THREE.BufferGeometry, mat: THREE.Material, count: number, perVehicle = 1, cast = false): PartLayer => {
      const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, count * perVehicle));
      mesh.count = count * perVehicle;
      mesh.castShadow = cast;
      mesh.receiveShadow = !cast ? false : true;
      // Vehicles move every frame: skip per-mesh bounds culling (they are always around the player)
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      root.add(mesh);
      return { mesh, perVehicle };
    };

    // --- sedans / taxis
    const tire = new THREE.CylinderGeometry(0.34, 0.34, 0.22, 10).rotateZ(Math.PI / 2);
    const rim = new THREE.CylinderGeometry(0.19, 0.19, 0.24, 8).rotateZ(Math.PI / 2);
    const identity = new THREE.Matrix4();
    const wheelGeo = mergeColoredParts([
      { geometry: tire, matrix: identity, color: 0x111827 },
      { geometry: rim, matrix: identity, color: 0xcbd5e1 },
    ]);
    this.carLayers = {
      body: layer(
        merged([box(1.88, 0.68, 4.24, 0, 0.68, 0), box(1.66, 0.58, 2.16, 0, 1.28, -0.14)]),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.36, metalness: 0.28 }),
        cars,
        1,
        true
      ),
      glass: layer(box(1.7, 0.44, 1.98, 0, 1.28, -0.14), glassMat, cars),
      head: layer(merged([box(0.38, 0.16, 0.06, -0.62, 0.72, 2.13), box(0.38, 0.16, 0.06, 0.62, 0.72, 2.13)]), lightMat, cars),
      brake: layer(box(1.64, 0.16, 0.06, 0, 0.76, -2.13), lightMat, cars),
      cap: layer(box(0.56, 0.2, 0.26, 0, 1.66, -0.05), lightMat, cars),
      wheels: layer(wheelGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.25 }), cars, 4),
    };
    carColors.forEach((hex, i) => this.carLayers.body.mesh.setColorAt(i, new THREE.Color(hex)));

    // --- Suwon city buses
    const busTire = new THREE.CylinderGeometry(0.34, 0.34, 0.22, 10).rotateZ(Math.PI / 2).scale(1.2, 1.2, 1.2);
    this.busLayers = {
      body: layer(
        box(2.48, 2.55, 8.6, 0, 1.62, 0),
        new THREE.MeshStandardMaterial({ color: 0x059669, roughness: 0.42, metalness: 0.18 }),
        busCount,
        1,
        true
      ),
      stripe: layer(box(2.52, 0.34, 8.64, 0, 1.25, 0), new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 }), busCount),
      glass: layer(box(2.51, 0.95, 7.6, 0, 2.15, 0), glassMat, busCount),
      head: layer(box(1.9, 0.24, 0.08, 0, 0.85, 4.32), lightMat, busCount),
      brake: layer(box(2.0, 0.28, 0.08, 0, 0.95, -4.32), lightMat, busCount),
      hazard: layer(merged([box(0.24, 0.22, 0.09, -1.05, 0.95, -4.33), box(0.24, 0.22, 0.09, 1.05, 0.95, -4.33)]), lightMat, busCount),
      wheels: layer(busTire, new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9 }), busCount, 4),
    };
  }

  public get drawCalls(): number {
    return Object.keys(this.carLayers).length + Object.keys(this.busLayers).length;
  }

  public setNight(night: boolean): void {
    this.isNight = night;
  }

  private place(layer: PartLayer, vehicle: number): void {
    layer.mesh.setMatrixAt(vehicle * layer.perVehicle, this.base);
  }

  private placeWheels(layer: PartLayer, vehicle: number, hubs: ReadonlyArray<[number, number, number]>, spin: number): void {
    this.spin.makeRotationX(spin);
    hubs.forEach(([x, y, z], w) => {
      this.local.makeTranslation(x, y, z).multiply(this.spin);
      this.m.multiplyMatrices(this.base, this.local);
      layer.mesh.setMatrixAt(vehicle * 4 + w, this.m);
    });
  }

  public setCar(index: number, s: VehicleRenderState): void {
    this.base.makeRotationY(s.heading).setPosition(s.x, 0, s.z);
    const L = this.carLayers;
    this.place(L.body, index);
    this.place(L.glass, index);
    this.place(L.head, index);
    this.place(L.brake, index);
    if (this.carIsTaxi[index]) this.place(L.cap, index);
    else L.cap.mesh.setMatrixAt(index, this.zeroScale);
    this.placeWheels(L.wheels, index, VehicleFleetRenderer.CAR_WHEELS, s.wheelSpin);
    L.brake.mesh.setColorAt(index, s.braking ? BRAKE_ON : this.isNight ? BRAKE_NIGHT : BRAKE_DAY);
    L.head.mesh.setColorAt(index, this.isNight ? HEAD_NIGHT : HEAD_DAY);
    L.cap.mesh.setColorAt(index, this.isNight ? TAXI_NIGHT : TAXI_DAY);
  }

  public setBus(index: number, s: VehicleRenderState): void {
    this.base.makeRotationY(s.heading).setPosition(s.x, 0, s.z);
    const L = this.busLayers;
    this.place(L.body, index);
    this.place(L.stripe, index);
    this.place(L.glass, index);
    this.place(L.head, index);
    this.place(L.brake, index);
    this.place(L.hazard, index);
    this.placeWheels(L.wheels, index, VehicleFleetRenderer.BUS_WHEELS, s.wheelSpin);
    L.brake.mesh.setColorAt(index, s.braking ? BRAKE_ON : this.isNight ? BRAKE_NIGHT : BRAKE_DAY);
    L.head.mesh.setColorAt(index, this.isNight ? HEAD_NIGHT : HEAD_DAY);
    L.hazard.mesh.setColorAt(index, s.hazardOn ? HAZARD_ON : HAZARD_OFF);
  }

  /** Upload this frame's instance matrices / colours */
  public commit(): void {
    for (const l of [...Object.values(this.carLayers), ...Object.values(this.busLayers)]) {
      l.mesh.instanceMatrix.needsUpdate = true;
      if (l.mesh.instanceColor) l.mesh.instanceColor.needsUpdate = true;
    }
  }
}
