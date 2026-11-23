import * as THREE from 'three';
import { BusStopPoint, CITY_ROAD_LINES, ObstacleBox, clamp, wrapAngle } from '../types';

export type SignalColor = 'green' | 'yellow' | 'red';
export type VehicleDriveState = 'CRUISING' | 'DECELERATING' | 'STOPPED' | 'EMERGENCY_BRAKE';

export interface SignalStateSnapshot {
  ns: SignalColor;
  ew: SignalColor;
  remainingSec: number;
}

export interface TrafficCarSnapshot {
  x: number;
  z: number;
  heading: number;
  color: string;
}

type CardinalDir = 0 | 1 | 2 | 3; // 0: +Z (N), 1: +X (E), 2: -Z (S), 3: -X (W)

const ROAD_LINES = CITY_ROAD_LINES;
const LANE_OFFSET = 3.5;
const STOP_LINE_DIST = 11.2;
const SIGNAL_STOP_MARGIN = 3.0; // Stop smoothly 3m before intersection stop line on RED/YELLOW!
const FRONT_RAY_RANGE = 12.0; // 12m forward bumper raycast distance sensor
const SAFE_FOLLOW_GAP = 5.0; // Full brake when ahead vehicle is within 5m
const ACTIVE_SPAWN_RADIUS = 120.0; // Maintain 20~25 vehicle density within 120m of player
const CYCLE_DURATION = 18.0;

interface AiVehicle {
  mesh: THREE.Group;
  wheels: THREE.Object3D[];
  brakeMat: THREE.MeshStandardMaterial;
  headlightMat: THREE.MeshStandardMaterial;
  hazardMat?: THREE.MeshStandardMaterial;
  taxiCapMat?: THREE.MeshStandardMaterial;
  isBus: boolean;
  isTaxi: boolean;
  driveState: VehicleDriveState;
  x: number;
  z: number;
  heading: number;
  speed: number;
  cruiseSpeed: number;
  braking: boolean;
  turning: boolean;
  turnTargetX: number;
  turnTargetZ: number;
  turnTargetDir: CardinalDir;
  turnTargetRoadIndex: number;
  // Bus stop dwell state
  busStopWaitTimer: number;
  busStopCooldown: number;
  // Cut-in single-honk state
  playerCutInActive: boolean;
  hornCooldown: number;
  colorHex: string;
  halfWidth: number;
  halfLength: number;
  dir: CardinalDir;
  roadIndex: number;
}

function dirVector(dir: CardinalDir): [number, number] {
  switch (dir) {
    case 0:
      return [0, 1];
    case 1:
      return [1, 0];
    case 2:
      return [0, -1];
    case 3:
      return [-1, 0];
  }
}

function dirHeading(dir: CardinalDir): number {
  switch (dir) {
    case 0:
      return 0;
    case 1:
      return Math.PI / 2;
    case 2:
      return Math.PI;
    case 3:
      return -Math.PI / 2;
  }
}

function laneCoordForDir(roadCoord: number, dir: CardinalDir): number {
  if (dir === 0 || dir === 3) return roadCoord - LANE_OFFSET;
  return roadCoord + LANE_OFFSET;
}

function isAxisNS(dir: CardinalDir): boolean {
  return dir === 0 || dir === 2;
}

export class TrafficSystem {
  public readonly root = new THREE.Group();
  private readonly vehicles: AiVehicle[] = [];
  private readonly busStops: BusStopPoint[];

  private readonly nsRedMat: THREE.MeshStandardMaterial;
  private readonly nsYellowMat: THREE.MeshStandardMaterial;
  private readonly nsGreenMat: THREE.MeshStandardMaterial;
  private readonly ewRedMat: THREE.MeshStandardMaterial;
  private readonly ewYellowMat: THREE.MeshStandardMaterial;
  private readonly ewGreenMat: THREE.MeshStandardMaterial;

  public signalState: SignalStateSnapshot = { ns: 'green', ew: 'red', remainingSec: 6.5 };

  private prevPlayerX = -62;
  private prevPlayerZ = -34.2;
  private violationCooldown = 0;
  private recycleTimer = 0;

  // Shared beveled low-poly car geometries & reusable raycast scratch objects (zero per-frame GC!)
  private readonly beveledSedanBodyGeo: THREE.BufferGeometry;
  private readonly beveledSedanCabinGeo: THREE.BufferGeometry;
  private readonly beveledVanCabinGeo: THREE.BufferGeometry;
  private readonly carWheelGeo: THREE.CylinderGeometry;
  private readonly carRimGeo: THREE.CylinderGeometry;

  private readonly frontRay = new THREE.Ray();
  private readonly rayHitPoint = new THREE.Vector3();
  private readonly tmpBox = new THREE.Box3();
  private readonly tmpMin = new THREE.Vector3();
  private readonly tmpMax = new THREE.Vector3();

  constructor(scene: THREE.Scene, busStops: BusStopPoint[]) {
    this.busStops = busStops;
    scene.add(this.root);

    this.beveledSedanBodyGeo = this.createBeveledBoxGeometry(1.88, 0.68, 4.24, 0.08);
    this.beveledSedanCabinGeo = this.createBeveledBoxGeometry(1.68, 0.6, 2.18, 0.08);
    this.beveledVanCabinGeo = this.createBeveledBoxGeometry(1.74, 0.9, 3.16, 0.08);
    this.carWheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.22, 12);
    this.carWheelGeo.rotateZ(Math.PI / 2);
    this.carRimGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.24, 10);
    this.carRimGeo.rotateZ(Math.PI / 2);

    this.nsRedMat = new THREE.MeshStandardMaterial({ color: 0x3b0a0a, emissive: 0xef4444, emissiveIntensity: 0 });
    this.nsYellowMat = new THREE.MeshStandardMaterial({ color: 0x3b2c0a, emissive: 0xfacc15, emissiveIntensity: 0 });
    this.nsGreenMat = new THREE.MeshStandardMaterial({ color: 0x0a3b20, emissive: 0x22c55e, emissiveIntensity: 2.5 });

    this.ewRedMat = new THREE.MeshStandardMaterial({ color: 0x3b0a0a, emissive: 0xef4444, emissiveIntensity: 2.5 });
    this.ewYellowMat = new THREE.MeshStandardMaterial({ color: 0x3b2c0a, emissive: 0xfacc15, emissiveIntensity: 0 });
    this.ewGreenMat = new THREE.MeshStandardMaterial({ color: 0x0a3b20, emissive: 0x22c55e, emissiveIntensity: 0 });

    this.buildTrafficSignals();
    this.spawnTrafficVehicles();
  }

  private buildTrafficSignals(): void {
    const poleMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.45,
      metalness: 0.65,
    });
    const housingMat = new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.6,
    });

    const poleGeo = new THREE.CylinderGeometry(0.11, 0.14, 5.4, 6);
    const armGeo = new THREE.CylinderGeometry(0.08, 0.09, 5.2, 6);
    armGeo.rotateZ(Math.PI / 2);
    const housingGeo = new THREE.BoxGeometry(1.75, 0.56, 0.34);
    const lampGeo = new THREE.SphereGeometry(0.17, 8, 6);

    for (const ix of ROAD_LINES) {
      for (const iz of ROAD_LINES) {
        const configs: Array<{ px: number; pz: number; rotY: number; axis: 'ns' | 'ew' }> = [
          { px: ix - 8.2, pz: iz + 8.2, rotY: 0, axis: 'ns' },
          { px: ix + 8.2, pz: iz - 8.2, rotY: Math.PI, axis: 'ns' },
          { px: ix + 8.2, pz: iz + 8.2, rotY: Math.PI / 2, axis: 'ew' },
          { px: ix - 8.2, pz: iz - 8.2, rotY: -Math.PI / 2, axis: 'ew' },
        ];

        for (const cfg of configs) {
          const g = new THREE.Group();
          g.position.set(cfg.px, 0, cfg.pz);
          g.rotation.y = cfg.rotY;

          const pole = new THREE.Mesh(poleGeo, poleMat);
          pole.position.y = 2.7;
          const arm = new THREE.Mesh(armGeo, poleMat);
          arm.position.set(2.5, 5.15, 0);
          const housing = new THREE.Mesh(housingGeo, housingMat);
          housing.position.set(4.1, 5.05, 0);

          const rMat = cfg.axis === 'ns' ? this.nsRedMat : this.ewRedMat;
          const yMat = cfg.axis === 'ns' ? this.nsYellowMat : this.ewYellowMat;
          const gMat = cfg.axis === 'ns' ? this.nsGreenMat : this.ewGreenMat;

          const redLamp = new THREE.Mesh(lampGeo, rMat);
          redLamp.position.set(4.6, 5.05, -0.15);
          const yelLamp = new THREE.Mesh(lampGeo, yMat);
          yelLamp.position.set(4.1, 5.05, -0.15);
          const grnLamp = new THREE.Mesh(lampGeo, gMat);
          grnLamp.position.set(3.6, 5.05, -0.15);

          g.add(pole, arm, housing, redLamp, yelLamp, grnLamp);
          this.root.add(g);
        }
      }
    }
  }

  private createBusDisplayTexture(routeLabel: string): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#f97316';
    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(routeLabel, 128, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  /** Builds a detailed Korean Blue/Green City Bus (시내버스) */
  private createBusMesh(
    bodyColor: number,
    routeLabel: string
  ): {
    group: THREE.Group;
    brakeMat: THREE.MeshStandardMaterial;
    headlightMat: THREE.MeshStandardMaterial;
    hazardMat: THREE.MeshStandardMaterial;
  } {
    const group = new THREE.Group();
    const length = 9.4;
    const width = 2.45;
    const height = 2.85;

    const paintMat = new THREE.MeshStandardMaterial({
      color: bodyColor,
      roughness: 0.35,
      metalness: 0.2,
    });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.14,
      metalness: 0.5,
    });
    const roofAcMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.5 });
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x181c22, roughness: 0.9 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.65, roughness: 0.3 });

    const brakeMat = new THREE.MeshStandardMaterial({
      color: 0x7f1d1d,
      emissive: 0xef4444,
      emissiveIntensity: 0.3,
    });
    const headlightMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      emissive: 0xfffbeb,
      emissiveIntensity: 0.4,
    });
    const hazardMat = new THREE.MeshStandardMaterial({
      color: 0x78350f,
      emissive: 0xf59e0b,
      emissiveIntensity: 0,
    });

    // Main bus body
    const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, length), paintMat);
    body.position.set(0, 0.45 + height / 2, 0);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Classic Korean city bus lower white livery stripe
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(width + 0.03, 0.36, length - 0.1), stripeMat);
    stripe.position.set(0, 1.05, 0);
    group.add(stripe);

    // Panoramic front windshield & side passenger window bands
    const frontGlass = new THREE.Mesh(new THREE.BoxGeometry(width - 0.22, 1.32, 0.08), glassMat);
    frontGlass.position.set(0, 2.02, length / 2 + 0.02);
    group.add(frontGlass);

    for (const side of [-1, 1]) {
      const sideGlass = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.12, length - 1.1), glassMat);
      sideGlass.position.set(side * (width / 2 + 0.01), 2.15, -0.1);
      group.add(sideGlass);
    }

    // Glowing LED front route sign (e.g. "101 중앙공원")
    const ledSign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.75, 0.34),
      new THREE.MeshBasicMaterial({ map: this.createBusDisplayTexture(routeLabel) })
    );
    ledSign.position.set(0, 2.95, length / 2 + 0.04);
    group.add(ledSign);

    // Roof A/C pod
    const acUnit = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.32, 3.2), roofAcMat);
    acUnit.position.set(0, 0.45 + height + 0.16, -0.3);
    group.add(acUnit);

    // Front headlights, rear brake lights & hazard blinkers
    for (const side of [-1, 1]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.2, 0.08), headlightMat);
      hl.position.set(side * 0.85, 0.86, length / 2 + 0.03);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.26, 0.08), brakeMat);
      tl.position.set(side * 0.85, 1.0, -length / 2 - 0.03);
      const hzFront = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.08), hazardMat);
      hzFront.position.set(side * 1.1, 1.12, length / 2 + 0.03);
      const hzRear = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.2, 0.08), hazardMat);
      hzRear.position.set(side * 1.05, 1.32, -length / 2 - 0.03);
      group.add(hl, tl, hzFront, hzRear);
    }

    // 4 large bus wheels
    const wheelGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.28, 14);
    wheelGeo.rotateZ(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(0.27, 0.27, 0.3, 10);
    rimGeo.rotateZ(Math.PI / 2);
    for (const wz of [-2.8, 2.8]) {
      for (const side of [-1, 1]) {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.position.set(side * 1.16, 0.48, wz);
        const r = new THREE.Mesh(rimGeo, rimMat);
        r.position.set(side * 1.16, 0.48, wz);
        group.add(w, r);
      }
    }

    return { group, brakeMat, headlightMat, hazardMat };
  }

  /** Creates a crisp low-poly chamfered/beveled box geometry centered at origin */
  private createBeveledBoxGeometry(
    w: number,
    h: number,
    d: number,
    bevel: number
  ): THREE.BufferGeometry {
    const bw = Math.max(0.1, w - bevel * 2);
    const bh = Math.max(0.1, h - bevel * 2);
    const bd = Math.max(0.1, d - bevel * 2);

    const shape = new THREE.Shape();
    const hw = bw / 2;
    const hh = bh / 2;
    const r = Math.min(bevel * 0.9, hw * 0.3, hh * 0.3);
    shape.moveTo(-hw + r, -hh);
    shape.lineTo(hw - r, -hh);
    shape.quadraticCurveTo(hw, -hh, hw, -hh + r);
    shape.lineTo(hw, hh - r);
    shape.quadraticCurveTo(hw, hh, hw - r, hh);
    shape.lineTo(-hw + r, hh);
    shape.quadraticCurveTo(-hw, hh, -hw, hh - r);
    shape.lineTo(-hw, -hh + r);
    shape.quadraticCurveTo(-hw, -hh, -hw + r, -hh);

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: bd,
      bevelEnabled: true,
      bevelSegments: 1,
      steps: 1,
      bevelSize: bevel,
      bevelThickness: bevel,
      curveSegments: 2,
    });
    geo.center();
    return geo;
  }

  private createCarMesh(
    bodyColor: number,
    isTaxi: boolean,
    isVan: boolean,
    silverTaxi = false
  ): {
    group: THREE.Group;
    wheels: THREE.Object3D[];
    brakeMat: THREE.MeshStandardMaterial;
    headlightMat: THREE.MeshStandardMaterial;
    taxiCapMat?: THREE.MeshStandardMaterial;
  } {
    const group = new THREE.Group();
    const wheels: THREE.Object3D[] = [];

    const paintMat = new THREE.MeshStandardMaterial({
      color: bodyColor,
      roughness: 0.34,
      metalness: silverTaxi ? 0.5 : 0.25,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.14,
      metalness: 0.52,
    });
    const bumperMat = new THREE.MeshStandardMaterial({ color: 0x1e242c, roughness: 0.72 });
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x181c22, roughness: 0.9 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.62, roughness: 0.32 });
    const brakeMat = new THREE.MeshStandardMaterial({
      color: 0x7f1d1d,
      emissive: 0xef4444,
      emissiveIntensity: 0.3,
    });
    const headlightMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      emissive: 0xfffbeb,
      emissiveIntensity: 0.35,
    });

    const length = isVan ? 4.45 : 4.24;
    const width = 1.88;

    // Beveled low-poly lower chassis
    const body = new THREE.Mesh(this.beveledSedanBodyGeo, paintMat);
    body.position.set(0, 0.66, 0);
    if (isVan) body.scale.set(1, 1.05, 1.05);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Front grille & rear bumper accents
    const grille = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.22, 0.08), bumperMat);
    grille.position.set(0, 0.56, length / 2 + 0.01);
    const rearBumper = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.18, 0.08), bumperMat);
    rearBumper.position.set(0, 0.44, -length / 2 - 0.01);
    group.add(grille, rearBumper);

    // Beveled cabin roof
    const cabinLen = isVan ? 3.16 : 2.18;
    const cabinHeight = isVan ? 0.9 : 0.6;
    const cabinZ = isVan ? -0.35 : -0.18;
    const cabin = new THREE.Mesh(
      isVan ? this.beveledVanCabinGeo : this.beveledSedanCabinGeo,
      paintMat
    );
    cabin.position.set(0, 1.0 + cabinHeight / 2 - 0.04, cabinZ);
    cabin.castShadow = true;
    group.add(cabin);

    // Sloped front/rear windshields & side window bands
    const frontGlass = new THREE.Mesh(new THREE.BoxGeometry(width - 0.32, cabinHeight * 0.66, 0.06), glassMat);
    frontGlass.position.set(0, 0.98 + cabinHeight * 0.44, cabinZ + cabinLen / 2 - 0.02);
    frontGlass.rotation.x = -0.22;
    const rearGlass = new THREE.Mesh(new THREE.BoxGeometry(width - 0.32, cabinHeight * 0.62, 0.06), glassMat);
    rearGlass.position.set(0, 0.98 + cabinHeight * 0.44, cabinZ - cabinLen / 2 + 0.02);
    rearGlass.rotation.x = 0.2;
    const sideGlass = new THREE.Mesh(new THREE.BoxGeometry(width - 0.16, cabinHeight * 0.56, cabinLen - 0.36), glassMat);
    sideGlass.position.set(0, 1.0 + cabinHeight * 0.44, cabinZ);
    group.add(frontGlass, rearGlass, sideGlass);

    // Seoul Taxi (Orange / Silver) glowing roof cab light + side livery stripe + red "빈차" indicator!
    let taxiCapMat: THREE.MeshStandardMaterial | undefined;
    if (isTaxi) {
      taxiCapMat = new THREE.MeshStandardMaterial({
        color: 0xfef08a,
        emissive: 0xfacc15,
        emissiveIntensity: 1.6,
      });
      const capBase = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, 0.28), bumperMat);
      capBase.position.set(0, 1.59, -0.08);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.2, 0.22), taxiCapMat);
      cap.position.set(0, 1.71, -0.08);

      // Classic Seoul Taxi side orange/blue band
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(width + 0.02, 0.14, length - 0.35),
        new THREE.MeshStandardMaterial({ color: silverTaxi ? 0xf97316 : 0xf8fafc, roughness: 0.4 })
      );
      stripe.position.set(0, 0.68, 0);

      // Glowing red "빈차" dash lamp visible on front windshield
      const emptyLamp = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 0.1, 0.04),
        new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 2.2 })
      );
      emptyLamp.position.set(-0.42, 1.08, cabinZ + cabinLen / 2 + 0.02);
      group.add(capBase, cap, stripe, emptyLamp);
    }

    for (const side of [-1, 1]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.08), headlightMat);
      hl.position.set(side * 0.64, 0.68, length / 2 + 0.02);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.08), brakeMat);
      tl.position.set(side * 0.62, 0.72, -length / 2 - 0.02);
      group.add(hl, tl);
    }

    for (const wz of [-1.32, 1.32]) {
      for (const side of [-1, 1]) {
        const wheelGroup = new THREE.Group();
        wheelGroup.position.set(side * 0.9, 0.34, wz);
        const w = new THREE.Mesh(this.carWheelGeo, wheelMat);
        const r = new THREE.Mesh(this.carRimGeo, rimMat);
        wheelGroup.add(w, r);
        group.add(wheelGroup);
        wheels.push(wheelGroup);
      }
    }

    return { group, wheels, brakeMat, headlightMat, taxiCapMat };
  }

  private spawnTrafficVehicles(): void {
    // --- 1. Spawn 6 Korean City Buses (Blue Trunk & Green Branch buses!) ---
    const busSpawns: Array<{
      dir: CardinalDir;
      roadIdx: number;
      along: number;
      color: number;
      label: string;
    }> = [
      { dir: 1, roadIdx: 2, along: -92, color: 0x1d4ed8, label: '101 중앙공원' }, // z=-40 Eastbound (right near spawn!)
      { dir: 3, roadIdx: 2, along: 92, color: 0x15803d, label: '402 상가거리' }, // z=-40 Westbound
      { dir: 1, roadIdx: 3, along: -85, color: 0x1d4ed8, label: '101 햇살아파트' }, // z=+40 Eastbound
      { dir: 3, roadIdx: 3, along: 105, color: 0x15803d, label: '402 리버뷰' }, // z=+40 Westbound
      { dir: 0, roadIdx: 2, along: -95, color: 0x1d4ed8, label: '701 파크뷰' }, // x=-40 Northbound
      { dir: 2, roadIdx: 3, along: 95, color: 0x15803d, label: '702 남부타워' }, // x=+40 Southbound
    ];

    for (const b of busSpawns) {
      const { group, brakeMat, headlightMat, hazardMat } = this.createBusMesh(b.color, b.label);
      const roadCoord = ROAD_LINES[b.roadIdx];
      const lane = laneCoordForDir(roadCoord, b.dir);
      const x = isAxisNS(b.dir) ? lane : b.along;
      const z = isAxisNS(b.dir) ? b.along : lane;
      const heading = dirHeading(b.dir);

      group.position.set(x, 0, z);
      group.rotation.y = heading;
      this.root.add(group);

      this.vehicles.push({
        mesh: group,
        wheels: [],
        brakeMat,
        headlightMat,
        hazardMat,
        isBus: true,
        isTaxi: false,
        driveState: 'CRUISING',
        x,
        z,
        heading,
        dir: b.dir,
        roadIndex: b.roadIdx,
        speed: 6.5,
        cruiseSpeed: 9.2, // ~33 km/h realistic city bus speed
        braking: false,
        turning: false,
        turnTargetX: x,
        turnTargetZ: z,
        turnTargetDir: b.dir,
        turnTargetRoadIndex: b.roadIdx,
        busStopWaitTimer: 0,
        busStopCooldown: 0,
        playerCutInActive: false,
        hornCooldown: 0,
        colorHex: b.color === 0x1d4ed8 ? '#2563eb' : '#16a34a',
        halfWidth: 1.25,
        halfLength: 4.75,
      });
    }

    // --- 2. Spawn 20 Sedans & Seoul Taxis (Orange & Silver Taxis) + 6 Buses (density-capped to 20~25 inside 120m!) ---
    const palette: Array<{ hex: number; css: string; taxi?: boolean; silverTaxi?: boolean; van?: boolean }> = [
      { hex: 0xf97316, css: '#f97316', taxi: true }, // 서울 주황 택시 (꽃담황토색)
      { hex: 0xf8fafc, css: '#f8fafc' }, // 화이트 세단
      { hex: 0xcbd5e1, css: '#cbd5e1', taxi: true, silverTaxi: true }, // 서울 은색 택시
      { hex: 0x1e293b, css: '#334155' }, // 블랙 세단
      { hex: 0x94a3b8, css: '#94a3b8' }, // 실버 세단
      { hex: 0x1e3a8a, css: '#3b82f6' }, // 네이비 세단
      { hex: 0xf97316, css: '#f97316', taxi: true }, // 서울 주황 택시
      { hex: 0xe2e8f0, css: '#e2e8f0', van: true }, // 화이트 밴
      { hex: 0x0f766e, css: '#14b8a6' }, // 청록 세단
    ];

    const carSpawns: Array<{ dir: CardinalDir; roadIdx: number; along: number }> = [
      { dir: 1, roadIdx: 1, along: -95 },
      { dir: 1, roadIdx: 2, along: -12 },
      { dir: 1, roadIdx: 2, along: -135 },
      { dir: 1, roadIdx: 3, along: -72 },
      { dir: 1, roadIdx: 3, along: 15 },
      { dir: 3, roadIdx: 1, along: 12 },
      { dir: 3, roadIdx: 2, along: -15 },
      { dir: 3, roadIdx: 2, along: 55 },
      { dir: 3, roadIdx: 3, along: -18 },
      { dir: 0, roadIdx: 1, along: -82 },
      { dir: 0, roadIdx: 1, along: 12 },
      { dir: 0, roadIdx: 2, along: -68 },
      { dir: 0, roadIdx: 2, along: 18 },
      { dir: 0, roadIdx: 3, along: -65 },
      { dir: 2, roadIdx: 1, along: -10 },
      { dir: 2, roadIdx: 2, along: 58 },
      { dir: 2, roadIdx: 2, along: -88 },
      { dir: 2, roadIdx: 3, along: 15 },
      { dir: 0, roadIdx: 2, along: -152 },
      { dir: 1, roadIdx: 4, along: 145 },
    ];

    carSpawns.forEach((sp, idx) => {
      const style = palette[idx % palette.length];
      const { group, wheels, brakeMat, headlightMat, taxiCapMat } = this.createCarMesh(
        style.hex,
        Boolean(style.taxi),
        Boolean(style.van),
        Boolean(style.silverTaxi)
      );

      const roadCoord = ROAD_LINES[sp.roadIdx];
      const lane = laneCoordForDir(roadCoord, sp.dir);
      const x = isAxisNS(sp.dir) ? lane : sp.along;
      const z = isAxisNS(sp.dir) ? sp.along : lane;
      const heading = dirHeading(sp.dir);

      group.position.set(x, 0, z);
      group.rotation.y = heading;
      this.root.add(group);

      this.vehicles.push({
        mesh: group,
        wheels,
        brakeMat,
        headlightMat,
        taxiCapMat,
        isBus: false,
        isTaxi: Boolean(style.taxi),
        driveState: 'CRUISING',
        x,
        z,
        heading,
        dir: sp.dir,
        roadIndex: sp.roadIdx,
        speed: 7.5,
        cruiseSpeed: 9.4 + (idx % 4) * 1.15,
        braking: false,
        turning: false,
        turnTargetX: x,
        turnTargetZ: z,
        turnTargetDir: sp.dir,
        turnTargetRoadIndex: sp.roadIdx,
        busStopWaitTimer: 0,
        busStopCooldown: 0,
        playerCutInActive: false,
        hornCooldown: 0,
        colorHex: style.css,
        halfWidth: 0.98,
        halfLength: style.van ? 2.28 : 2.16,
      });
    });
  }

  public getCarSnapshots(): TrafficCarSnapshot[] {
    return this.vehicles.map((c) => ({
      x: c.x,
      z: c.z,
      heading: c.heading,
      color: c.colorHex,
    }));
  }

  public getCarObstacleBoxes(): ObstacleBox[] {
    return this.vehicles.map((c) => {
      const ns = Math.abs(Math.cos(c.heading)) > 0.7;
      const rx = ns ? c.halfWidth : c.halfLength;
      const rz = ns ? c.halfLength : c.halfWidth;
      return {
        minX: c.x - rx,
        maxX: c.x + rx,
        minZ: c.z - rz,
        maxZ: c.z + rz,
      };
    });
  }

  public getSignalForDirection(dir: CardinalDir): SignalColor {
    return isAxisNS(dir) ? this.signalState.ns : this.signalState.ew;
  }

  private updateSignals(elapsedTime: number): void {
    const t = elapsedTime % CYCLE_DURATION;
    let ns: SignalColor = 'red';
    let ew: SignalColor = 'red';
    let remaining = 0;

    if (t < 6.5) {
      ns = 'green';
      ew = 'red';
      remaining = 6.5 - t;
    } else if (t < 8.5) {
      ns = 'yellow';
      ew = 'red';
      remaining = 8.5 - t;
    } else if (t < 9.0) {
      ns = 'red';
      ew = 'red';
      remaining = 9.0 - t;
    } else if (t < 15.5) {
      ns = 'red';
      ew = 'green';
      remaining = 15.5 - t;
    } else if (t < 17.5) {
      ns = 'red';
      ew = 'yellow';
      remaining = 17.5 - t;
    } else {
      ns = 'red';
      ew = 'red';
      remaining = 18.0 - t;
    }

    this.signalState = { ns, ew, remainingSec: remaining };

    this.nsRedMat.emissiveIntensity = ns === 'red' ? 3.2 : 0;
    this.nsYellowMat.emissiveIntensity = ns === 'yellow' ? 3.2 : 0;
    this.nsGreenMat.emissiveIntensity = ns === 'green' ? 3.2 : 0;

    this.ewRedMat.emissiveIntensity = ew === 'red' ? 3.2 : 0;
    this.ewYellowMat.emissiveIntensity = ew === 'yellow' ? 3.2 : 0;
    this.ewGreenMat.emissiveIntensity = ew === 'green' ? 3.2 : 0;
  }

  public getActiveCountWithinRadius(px: number, pz: number, radius = ACTIVE_SPAWN_RADIUS): number {
    const rSq = radius * radius;
    let count = 0;
    for (const v of this.vehicles) {
      const dx = v.x - px;
      const dz = v.z - pz;
      if (dx * dx + dz * dz <= rSq) count++;
    }
    return count;
  }

  public step(
    dt: number,
    elapsedTime: number,
    isNight: boolean,
    playerX: number,
    playerZ: number,
    playerSpeed: number,
    isRiding: boolean,
    onRedLightViolation: () => void,
    onCarCollisionCrash: (carX: number, carZ: number) => void,
    onCarHornHonk?: () => void
  ): void {
    const clampedDt = Math.min(dt, 0.05);
    this.updateSignals(elapsedTime);

    if (this.violationCooldown > 0) {
      this.violationCooldown -= clampedDt;
    }

    if (isRiding && Math.abs(playerSpeed) > 4.2 && this.violationCooldown <= 0) {
      this.checkPlayerRedLight(playerX, playerZ, onRedLightViolation);
    }
    this.prevPlayerX = playerX;
    this.prevPlayerZ = playerZ;

    // Maintain 20~25 active vehicle density within 120m radius around player via clean spawn/despawn cycling!
    this.recycleTimer += clampedDt;
    if (this.recycleTimer >= 0.35) {
      this.recycleTimer = 0;
      this.recycleDistantVehicles(playerX, playerZ);
    }

    const blinkOn = Math.floor(elapsedTime * 2.6) % 2 === 0;
    for (let i = 0; i < this.vehicles.length; i++) {
      this.stepVehicle(
        this.vehicles[i],
        i,
        clampedDt,
        isNight,
        blinkOn,
        playerX,
        playerZ,
        playerSpeed,
        isRiding,
        onCarCollisionCrash,
        onCarHornHonk
      );
    }
  }

  /** Despawns vehicles beyond 120m radius and respawns them cleanly onto nearby road lanes to hold 20~25 density */
  private recycleDistantVehicles(playerX: number, playerZ: number): void {
    const maxDistSq = ACTIVE_SPAWN_RADIUS * ACTIVE_SPAWN_RADIUS;
    let activeNear = this.getActiveCountWithinRadius(playerX, playerZ, ACTIVE_SPAWN_RADIUS);
    if (activeNear >= 24) return;

    const nearNSRoads: number[] = [];
    const nearEWRoads: number[] = [];
    for (let r = 0; r < ROAD_LINES.length; r++) {
      if (Math.abs(ROAD_LINES[r] - playerX) <= ACTIVE_SPAWN_RADIUS - 12) nearNSRoads.push(r);
      if (Math.abs(ROAD_LINES[r] - playerZ) <= ACTIVE_SPAWN_RADIUS - 12) nearEWRoads.push(r);
    }

    for (let i = 0; i < this.vehicles.length && activeNear < 24; i++) {
      const car = this.vehicles[i];
      if (car.isBus) continue; // Keep scheduled city buses along their fixed corridors
      const dx = car.x - playerX;
      const dz = car.z - playerZ;
      if (dx * dx + dz * dz <= maxDistSq) continue;

      // Pick a candidate nearby road line within 120m of player and respawn safely outside immediate 45m view
      for (let attempt = 0; attempt < 24; attempt++) {
        const dir = Math.floor(Math.random() * 4) as CardinalDir;
        const ns = isAxisNS(dir);
        const candidates = ns ? nearNSRoads : nearEWRoads;
        if (candidates.length === 0) continue;

        const roadIdx = candidates[Math.floor(Math.random() * candidates.length)];
        const roadCoord = ROAD_LINES[roadIdx];
        const lane = laneCoordForDir(roadCoord, dir);
        const perpDist = Math.abs(lane - (ns ? playerX : playerZ));
        const maxAlong = Math.sqrt(Math.max(0, (ACTIVE_SPAWN_RADIUS - 4) ** 2 - perpDist * perpDist));
        if (maxAlong < 12) continue;

        const alongCenter = ns ? playerZ : playerX;
        const along = clamp(alongCenter + (Math.random() * 2 - 1) * maxAlong, -215, 215);

        // Avoid spawning right inside an intersection box
        if (ROAD_LINES.some((rc) => Math.abs(along - rc) < 15)) continue;

        const cx = ns ? lane : along;
        const cz = ns ? along : lane;
        const distPlayer = Math.hypot(cx - playerX, cz - playerZ);
        if (distPlayer < 45 || distPlayer > ACTIVE_SPAWN_RADIUS - 2) continue;

        // Ensure clear spacing from every other vehicle
        let clear = true;
        for (let j = 0; j < this.vehicles.length; j++) {
          if (j === i) continue;
          if (Math.hypot(this.vehicles[j].x - cx, this.vehicles[j].z - cz) < 13) {
            clear = false;
            break;
          }
        }
        if (!clear) continue;

        car.dir = dir;
        car.roadIndex = roadIdx;
        car.x = cx;
        car.z = cz;
        car.heading = dirHeading(dir);
        car.turning = false;
        car.speed = car.cruiseSpeed * 0.75;
        car.driveState = 'CRUISING';
        car.playerCutInActive = false;
        car.mesh.position.set(cx, 0, cz);
        car.mesh.rotation.y = car.heading;
        activeNear++;
        break;
      }
    }
  }

  private checkPlayerRedLight(x: number, z: number, onViolation: () => void): void {
    const dx = x - this.prevPlayerX;
    const dz = z - this.prevPlayerZ;
    if (Math.hypot(dx, dz) < 0.05) return;

    const movingNS = Math.abs(dz) > Math.abs(dx);

    for (const ix of ROAD_LINES) {
      for (const iz of ROAD_LINES) {
        if (movingNS) {
          if (Math.abs(x - ix) > 6.8) continue;
          const wasOutside = Math.abs(this.prevPlayerZ - iz) >= 7.5;
          const nowInside = Math.abs(z - iz) < 7.5;
          if (wasOutside && nowInside && this.signalState.ns === 'red') {
            this.violationCooldown = 4.5;
            onViolation();
            return;
          }
        } else {
          if (Math.abs(z - iz) > 6.8) continue;
          const wasOutside = Math.abs(this.prevPlayerX - ix) >= 7.5;
          const nowInside = Math.abs(x - ix) < 7.5;
          if (wasOutside && nowInside && this.signalState.ew === 'red') {
            this.violationCooldown = 4.5;
            onViolation();
            return;
          }
        }
      }
    }
  }

  /** Casts a forward 12m THREE.Ray from the vehicle's front bumper against an AABB, returning hit distance or null */
  private castFrontBumperRay(
    originX: number,
    originZ: number,
    dirX: number,
    dirZ: number,
    boxMinX: number,
    boxMaxX: number,
    boxMinZ: number,
    boxMaxZ: number,
    maxDist: number
  ): number | null {
    this.frontRay.origin.set(originX, 0.7, originZ);
    this.frontRay.direction.set(dirX, 0, dirZ);
    this.tmpMin.set(boxMinX, 0, boxMinZ);
    this.tmpMax.set(boxMaxX, 2.5, boxMaxZ);
    this.tmpBox.set(this.tmpMin, this.tmpMax);

    const hit = this.frontRay.intersectBox(this.tmpBox, this.rayHitPoint);
    if (!hit) return null;
    const dist = Math.hypot(this.rayHitPoint.x - originX, this.rayHitPoint.z - originZ);
    return dist <= maxDist ? dist : null;
  }

  private stepVehicle(
    car: AiVehicle,
    index: number,
    dt: number,
    isNight: boolean,
    blinkOn: boolean,
    playerX: number,
    playerZ: number,
    playerSpeed: number,
    isRiding: boolean,
    onCarCollisionCrash: (carX: number, carZ: number) => void,
    onCarHornHonk?: () => void
  ): void {
    const [fx, fz] = dirVector(car.dir);
    let mustStop = false;
    let emergencyBrake = false;
    let decelerating = false;
    let desiredSpeed = car.cruiseSpeed;

    if (car.hornCooldown > 0) car.hornCooldown = Math.max(0, car.hornCooldown - dt);

    // 0. Bus Stop Dwelling Logic (only for City Buses!)
    if (car.isBus) {
      if (car.busStopCooldown > 0) car.busStopCooldown -= dt;

      if (car.busStopWaitTimer > 0) {
        car.busStopWaitTimer -= dt;
        mustStop = true;
      } else if (!car.turning && car.busStopCooldown <= 0) {
        for (const stop of this.busStops) {
          if (stop.dir !== car.dir || stop.roadIndex !== car.roadIndex) continue;
          const distAhead = (stop.x - car.x) * fx + (stop.z - car.z) * fz;
          if (distAhead > -1.5 && distAhead < 14) {
            if (distAhead <= 2.2) {
              car.busStopWaitTimer = 3.4; // stop for 3.4s at bus stop!
              car.busStopCooldown = 14.0;
              mustStop = true;
            } else {
              desiredSpeed = Math.min(desiredSpeed, distAhead * 0.7);
              decelerating = true;
            }
          }
        }
      }
    }

    // 1. Intersection signals (RED/YELLOW -> smoothly DECELERATING -> STOPPED 3m before stop line!) & turning
    if (!car.turning) {
      const along = isAxisNS(car.dir) ? car.z : car.x;
      const stepSign = isAxisNS(car.dir) ? fz : fx;
      const stopTarget = (car.isBus ? STOP_LINE_DIST + 2.4 : STOP_LINE_DIST) + SIGNAL_STOP_MARGIN;

      let nextLineIdx = -1;
      let nextDist = Infinity;
      for (let r = 0; r < ROAD_LINES.length; r++) {
        const diff = (ROAD_LINES[r] - along) * stepSign;
        if (diff > -1.0 && diff < nextDist) {
          nextDist = diff;
          nextLineIdx = r;
        }
      }

      if (nextLineIdx !== -1) {
        const sig = this.getSignalForDirection(car.dir);
        if (sig !== 'green' && nextDist > STOP_LINE_DIST - 1.5 && nextDist < stopTarget + 16) {
          if (nextDist <= stopTarget + 0.8) {
            mustStop = true;
          } else {
            desiredSpeed = Math.min(desiredSpeed, (nextDist - stopTarget) * 0.75);
            decelerating = true;
          }
        }

        const isOuterEdge =
          (stepSign > 0 && nextLineIdx === ROAD_LINES.length - 1) ||
          (stepSign < 0 && nextLineIdx === 0);

        if (nextDist < 7.4 && nextDist > 2.5 && (sig === 'green' || nextDist < 6.2)) {
          const leftDir = ((car.dir + 3) % 4) as CardinalDir;
          const rightDir = ((car.dir + 1) % 4) as CardinalDir;
          const canGoStraight = !isOuterEdge;
          const canTurnDir = (d: CardinalDir) => {
            const [dfx, dfz] = dirVector(d);
            const s = isAxisNS(d) ? dfz : dfx;
            return !((s > 0 && car.roadIndex === ROAD_LINES.length - 1) || (s < 0 && car.roadIndex === 0));
          };

          const options: CardinalDir[] = [];
          if (canGoStraight) {
            options.push(car.dir, car.dir);
            if (car.isBus) options.push(car.dir, car.dir);
          }
          if (canTurnDir(rightDir)) options.push(rightDir);
          if (canTurnDir(leftDir)) options.push(leftDir);

          const chosen = options[Math.floor(Math.random() * options.length)] ?? rightDir;
          if (chosen !== car.dir) {
            car.turning = true;
            car.turnTargetDir = chosen;
            car.turnTargetRoadIndex = nextLineIdx;
            const targetRoadCoord = ROAD_LINES[nextLineIdx];
            const targetLane = laneCoordForDir(targetRoadCoord, chosen);
            const [tfx, tfz] = dirVector(chosen);
            const exitOffset = car.isBus ? 9.8 : 8.2;
            const ix = isAxisNS(car.dir) ? ROAD_LINES[car.roadIndex] : ROAD_LINES[nextLineIdx];
            const iz = isAxisNS(car.dir) ? ROAD_LINES[nextLineIdx] : ROAD_LINES[car.roadIndex];

            car.turnTargetX = isAxisNS(chosen) ? targetLane : ix + tfx * exitOffset;
            car.turnTargetZ = isAxisNS(chosen) ? iz + tfz * exitOffset : targetLane;
          }
        }
      }
    }

    // 2. Front-Bumper 12m Raycast Distance Sensor (prevents rear-ending ahead cars & emergency-brakes + honks for player cut-in!)
    const curFx = Math.sin(car.heading);
    const curFz = Math.cos(car.heading);
    const bumperX = car.x + curFx * car.halfLength;
    const bumperZ = car.z + curFz * car.halfLength;
    const rayRange = car.isBus ? FRONT_RAY_RANGE + 3.0 : FRONT_RAY_RANGE; // 12m for cars/taxis

    // 2a. Raycast against ahead AI vehicles
    for (let j = 0; j < this.vehicles.length; j++) {
      if (j === index) continue;
      const other = this.vehicles[j];
      const oNs = Math.abs(Math.cos(other.heading)) > 0.7;
      const oRx = (oNs ? other.halfWidth : other.halfLength) + 0.45;
      const oRz = (oNs ? other.halfLength : other.halfWidth) + 0.45;

      const hitDist = this.castFrontBumperRay(
        bumperX,
        bumperZ,
        curFx,
        curFz,
        other.x - oRx,
        other.x + oRx,
        other.z - oRz,
        other.z + oRz,
        rayRange
      );
      if (hitDist !== null) {
        if (hitDist <= SAFE_FOLLOW_GAP) {
          mustStop = true;
        } else {
          const factor = (hitDist - SAFE_FOLLOW_GAP) / Math.max(1, rayRange - SAFE_FOLLOW_GAP);
          desiredSpeed = Math.min(desiredSpeed, Math.max(other.speed * 0.9, car.cruiseSpeed * factor));
          decelerating = true;
        }
      }
    }

    // 2b. Raycast against player scooter / rider cutting into lane (<= 12m) -> emergency brake + single horn blast!
    const playerHitDist = this.castFrontBumperRay(
      bumperX,
      bumperZ,
      curFx,
      curFz,
      playerX - 1.35,
      playerX + 1.35,
      playerZ - 1.35,
      playerZ + 1.35,
      rayRange
    );

    if (playerHitDist !== null) {
      if (playerHitDist <= 7.5) {
        mustStop = true;
        emergencyBrake = true;
        // Honk ONCE when player cuts in front while vehicle is moving!
        if (!car.playerCutInActive && car.hornCooldown <= 0 && car.speed > 2.2) {
          car.playerCutInActive = true;
          car.hornCooldown = 5.0;
          if (onCarHornHonk) onCarHornHonk();
        }
      } else {
        desiredSpeed = Math.min(desiredSpeed, 2.2);
        decelerating = true;
      }
    } else {
      car.playerCutInActive = false;
    }

    // 3. Smooth Speed & Drive State FSM Update (CRUISING / DECELERATING / STOPPED / EMERGENCY_BRAKE)
    if (mustStop) {
      const decelRate = emergencyBrake ? 22.0 : car.isBus ? 9.5 : 12.5;
      car.speed = Math.max(0, car.speed - decelRate * dt);
      car.braking = true;
      car.driveState =
        emergencyBrake && car.speed > 0.25
          ? 'EMERGENCY_BRAKE'
          : car.speed <= 0.12
            ? 'STOPPED'
            : 'DECELERATING';
    } else if (car.speed < desiredSpeed) {
      car.speed = Math.min(desiredSpeed, car.speed + (car.isBus ? 3.8 : 5.2) * dt);
      car.braking = false;
      car.driveState = 'CRUISING';
    } else {
      car.speed = Math.max(desiredSpeed, car.speed - 6.8 * dt);
      car.braking = car.speed > desiredSpeed + 0.4;
      car.driveState = decelerating || car.braking ? 'DECELERATING' : 'CRUISING';
    }

    // 4. Move along lane or turn smoothly
    if (car.turning) {
      const toTx = car.turnTargetX - car.x;
      const toTz = car.turnTargetZ - car.z;
      const dist = Math.hypot(toTx, toTz);
      const turnSpeed = Math.min(car.speed, car.isBus ? 6.2 : 7.5);
      if (dist < 0.8) {
        car.x = car.turnTargetX;
        car.z = car.turnTargetZ;
        car.dir = car.turnTargetDir;
        car.roadIndex = car.turnTargetRoadIndex;
        car.heading = dirHeading(car.dir);
        car.turning = false;
      } else {
        const targetHeading = Math.atan2(toTx, toTz);
        const hDiff = wrapAngle(targetHeading - car.heading);
        car.heading = wrapAngle(car.heading + hDiff * Math.min(1, dt * (car.isBus ? 5.2 : 6.5)));
        car.x += (toTx / dist) * turnSpeed * dt;
        car.z += (toTz / dist) * turnSpeed * dt;
      }
    } else {
      car.x += fx * car.speed * dt;
      car.z += fz * car.speed * dt;
      const idealLane = laneCoordForDir(ROAD_LINES[car.roadIndex], car.dir);
      if (isAxisNS(car.dir)) {
        car.x += (idealLane - car.x) * Math.min(1, dt * 4);
      } else {
        car.z += (idealLane - car.z) * Math.min(1, dt * 4);
      }
      const targetH = dirHeading(car.dir);
      car.heading = wrapAngle(car.heading + wrapAngle(targetH - car.heading) * Math.min(1, dt * 8));
    }

    car.x = clamp(car.x, -225, 225);
    car.z = clamp(car.z, -225, 225);

    // 5. High-speed collision check with riding player
    if (isRiding && Math.abs(playerSpeed) > 8.5) {
      const hitRadius = car.isBus ? 3.2 : 2.25;
      if (Math.hypot(car.x - playerX, car.z - playerZ) < hitRadius) {
        onCarCollisionCrash(car.x, car.z);
      }
    }

    // 6. Sync mesh, rolling wheels & lights (including illuminated Seoul Taxi roof cap!)
    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.rotation.y = car.heading;
    if (car.wheels.length > 0 && car.speed > 0.05) {
      const spin = (car.speed * dt) / 0.34;
      for (const w of car.wheels) w.rotation.x += spin;
    }
    car.brakeMat.emissiveIntensity =
      car.braking || car.speed < 0.3 ? 3.0 : isNight ? 0.8 : 0.25;
    car.headlightMat.emissiveIntensity = isNight ? 3.0 : 0.45;
    if (car.taxiCapMat) {
      car.taxiCapMat.emissiveIntensity = isNight ? 2.6 : 1.4;
    }
    if (car.hazardMat) {
      car.hazardMat.emissiveIntensity = car.busStopWaitTimer > 0 && blinkOn ? 3.2 : 0;
    }
  }
}
