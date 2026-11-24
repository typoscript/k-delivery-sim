import * as THREE from 'three';
import {
  CITY_ROAD_LINES,
  ConstructionZoneMarker,
  ObstacleBox,
  PolicePatrolMarker,
  RivalRiderMarker,
  SpeedCameraMarker,
  UpcomingCameraAlert,
} from '../types';
import { SignalStateSnapshot } from './TrafficSystem';
import { PedestrianFactory, PedestrianRig } from './PedestrianFactory';
import {
  PEDESTRIAN_COLLISION_MIN_KMH,
  PedestrianCollisionEvent,
  ScooterProximityInfo,
} from './PedestrianManager';

export interface SpeedCameraTriggerEvent {
  cameraId: string;
  label: string;
  kind: 'speeding' | 'red_light' | 'patrol_speeding';
  measuredKmh: number;
  limitKmh: number;
  fine: number;
}

export interface PopOutWarningEvent {
  hazardName: string;
}

type PatrolDir = 0 | 1 | 2 | 3; // 0:+Z, 1:+X, 2:-Z, 3:-X

interface PolicePatrolUnit {
  id: string;
  label: string;
  group: THREE.Group;
  redBarMat: THREE.MeshStandardMaterial;
  blueBarMat: THREE.MeshStandardMaterial;
  x: number;
  z: number;
  heading: number;
  dir: PatrolDir;
  roadIndex: number;
  speed: number;
  cruiseSpeed: number;
  sirenTimer: number;
  citeCooldown: number;
}

interface ConstructionZoneUnit {
  id: string;
  label: string;
  x: number;
  z: number;
  strobeMat: THREE.MeshStandardMaterial;
}

interface RivalRiderUnit {
  id: string;
  group: THREE.Group;
  color: string;
  x: number;
  z: number;
  heading: number;
  dir: PatrolDir;
  roadIndex: number;
  speed: number;
  cruiseSpeed: number;
  turnCooldown: number;
}

interface SpeedCameraUnit {
  id: string;
  label: string;
  x: number;
  z: number;
  axis: 'ns' | 'ew'; // road travel axis monitored
  limitKmh: number;
  ledMat: THREE.MeshStandardMaterial;
  flashMat: THREE.MeshBasicMaterial;
  flashTimer: number;
  cooldown: number;
  wasInZone: boolean;
}

type PopOutState = 'hidden' | 'popping_out' | 'holding' | 'retreating' | 'fallen';

interface ParkedHazardUnit {
  id: string;
  name: string;
  x: number;
  z: number;
  heading: number;
  isTruck: boolean;
  hazardMat: THREE.MeshStandardMaterial;
  // Blind-spot pop-out pedestrian anchored behind this illegally parked vehicle
  popRig: PedestrianRig;
  popState: PopOutState;
  popStartX: number;
  popStartZ: number;
  popOutX: number;
  popOutZ: number;
  popX: number;
  popZ: number;
  popHeading: number;
  popTimer: number;
  popCooldown: number;
  popFallSide: number;
}

export const SPEED_CAMERA_LIMIT_KMH = 50;
export const SPEED_CAMERA_GRACE_KMH = 2; // triggers at > 52 km/h
export const SPEED_CAMERA_WARN_DIST = 80; // 80m ahead navi warning zone!
export const SPEED_CAMERA_FINE = 40000; // 무인 과속/신호 단속 과태료 ₩40,000
export const PATROL_ENFORCEMENT_FINE = 50000; // 순찰차 현장 단속 과태료 ₩50,000
export const PATROL_SPEED_LIMIT_KMH = 60; // 순찰차 반경 22m 내 60km/h 초과 주행 시 현장 단속!
const POPOUT_GLOBAL_COOLDOWN_SEC = 18.0;
const POPOUT_COLLISION_RADIUS = 1.14;
const PATROL_LANE_OFFSET = 3.5;

function patrolDirVec(dir: PatrolDir): [number, number] {
  if (dir === 0) return [0, 1];
  if (dir === 1) return [1, 0];
  if (dir === 2) return [0, -1];
  return [-1, 0];
}

function patrolDirHeading(dir: PatrolDir): number {
  if (dir === 0) return 0;
  if (dir === 1) return Math.PI / 2;
  if (dir === 2) return Math.PI;
  return -Math.PI / 2;
}

function patrolLaneCoord(roadCoord: number, dir: PatrolDir): number {
  return dir === 0 || dir === 3 ? roadCoord - PATROL_LANE_OFFSET : roadCoord + PATROL_LANE_OFFSET;
}

/**
 * Manages Korean Roadside Enforcement & Urban Delivery Hazards:
 * 1. Fixed Speed & Red-Light Enforcement Cameras (50 km/h limit, 80m navi approach warning, strobe flash, ₩40,000 fine)
 * 2. Patrolling Korean Police Cars ("POLICE 112" with alternating red/blue lightbars & live patrol enforcement)
 * 3. Illegally Double-Parked Hazard Vehicles (blinking 4-way K-택배 parcel trucks & sedans with collision boxes)
 * 4. Blind-Spot Pedestrian Pop-Out Events darting out from behind double-parked trucks!
 * Parented to world.root -> automatically hidden when player enters underground apartment corridors (y = -500).
 */
export class RoadHazardManager {
  public readonly root = new THREE.Group();
  public readonly obstacles: ObstacleBox[] = [];
  public readonly cameraMarkers: SpeedCameraMarker[] = [];
  public readonly patrolMarkers: PolicePatrolMarker[] = [];
  public readonly constructionMarkers: ConstructionZoneMarker[] = [];
  public readonly rivalRiderMarkers: RivalRiderMarker[] = [];
  public upcomingCamera: UpcomingCameraAlert | null = null;

  private readonly cameras: SpeedCameraUnit[] = [];
  private readonly parkedHazards: ParkedHazardUnit[] = [];
  private readonly patrolCars: PolicePatrolUnit[] = [];
  private readonly constructionZones: ConstructionZoneUnit[] = [];
  private readonly rivalRiders: RivalRiderUnit[] = [];
  private readonly pedFactory = new PedestrianFactory();
  private globalPopOutCooldown = 3.0;
  private lastWarnedCameraId: string | null = null;
  private overSpeedBeepTimer = 0;

  constructor(parent: THREE.Object3D) {
    this.buildSpeedCameras();
    this.buildParkedHazards();
    this.buildPolicePatrols();
    this.buildConstructionZones();
    this.buildRivalRiders();
    parent.add(this.root);
  }

  /** Returns static parked/construction obstacles + live moving police & rival rider obstacle boxes */
  public getAllObstacleBoxes(): ObstacleBox[] {
    const list: ObstacleBox[] = [...this.obstacles];
    for (const p of this.patrolCars) {
      const ns = Math.abs(Math.cos(p.heading)) > 0.7;
      const rx = ns ? 1.0 : 2.25;
      const rz = ns ? 2.25 : 1.0;
      list.push({
        minX: p.x - rx,
        maxX: p.x + rx,
        minZ: p.z - rz,
        maxZ: p.z + rz,
      });
    }
    for (const r of this.rivalRiders) {
      list.push({
        minX: r.x - 0.55,
        maxX: r.x + 0.55,
        minZ: r.z - 0.55,
        maxZ: r.z + 0.55,
      });
    }
    return list;
  }

  private createSignTexture(title: string, limit: string): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 160;
    const ctx = c.getContext('2d')!;

    // Korean speed enforcement yellow/white signboard
    ctx.fillStyle = '#facc15';
    ctx.fillRect(0, 0, 256, 160);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, 246, 150);

    // Top banner
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(10, 10, 236, 44);
    ctx.fillStyle = '#fef08a';
    ctx.font = '900 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, 128, 33);

    // Red circle speed limit badge
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(128, 104, 42, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.font = '900 40px sans-serif';
    ctx.fillText(limit, 128, 107);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private createTruckLiveryTexture(label: string): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const ctx = c.getContext('2d')!;

    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#1d4ed8';
    ctx.fillRect(0, 86, 256, 42);
    ctx.fillStyle = '#facc15';
    ctx.fillRect(0, 78, 256, 8);

    ctx.fillStyle = '#0f172a';
    ctx.font = '900 34px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 128, 44);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('신속안전 · 비상등 정차중', 128, 108);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private buildSpeedCameras(): void {
    // 6 strategic Korean arterial speed & red-light enforcement camera gantries
    const specs: Array<{
      id: string;
      label: string;
      x: number;
      z: number;
      axis: 'ns' | 'ew';
      poleSide: number;
    }> = [
      { id: 'cam-central-e', label: '중앙대로 동측 단속', x: 0, z: -40, axis: 'ew', poleSide: 1 },
      { id: 'cam-central-w', label: '상가대로 서측 단속', x: -80, z: 40, axis: 'ew', poleSide: -1 },
      { id: 'cam-park-n', label: '중앙공원 북측 단속', x: 40, z: 0, axis: 'ns', poleSide: 1 },
      { id: 'cam-apt-s', label: '한빛아파트 앞 단속', x: -40, z: 80, axis: 'ns', poleSide: -1 },
      { id: 'cam-dept-e', label: '백화점 사거리 단속', x: 80, z: 40, axis: 'ew', poleSide: 1 },
      { id: 'cam-hosp-n', label: '시립병원 앞 단속', x: -40, z: -80, axis: 'ns', poleSide: 1 },
    ];

    const poleMat = new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.45, metalness: 0.4 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.6 });
    const housingMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.35, metalness: 0.4 });
    const lensMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.1, metalness: 0.8 });
    const signTex = this.createSignTexture('신호·과속 단속', '50');
    const signMat = new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.35 });

    for (const sp of specs) {
      const group = new THREE.Group();
      group.position.set(sp.x, 0, sp.z);
      if (sp.axis === 'ew') {
        group.rotation.y = Math.PI / 2;
      }

      const poleX = sp.poleSide * 8.2;
      // Vertical steel pole with yellow/black hazard bands
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 6.2, 10), poleMat);
      pole.position.set(poleX, 3.1, 0);
      pole.castShadow = true;
      group.add(pole);

      for (let b = 0; b < 4; b++) {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.175, 0.32, 10), stripeMat);
        band.position.set(poleX, 0.9 + b * 0.72, 0);
        group.add(band);
      }

      // Cantilevered horizontal gantry arm spanning above the traffic lanes
      const armLen = 9.2;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(armLen, 0.2, 0.2), poleMat);
      arm.position.set(poleX - sp.poleSide * (armLen * 0.48), 5.85, 0);
      group.add(arm);

      const ledMat = new THREE.MeshStandardMaterial({
        color: 0x7f1d1d,
        emissive: 0xef4444,
        emissiveIntensity: 2.2,
      });
      const flashMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
      });

      // Twin camera housings overlooking both lane directions
      for (const offset of [-2.4, 2.4]) {
        const cx = offset;
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.36, 0.62), housingMat);
        box.position.set(cx, 5.55, 0);
        group.add(box);

        for (const zDir of [-1, 1]) {
          const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.08, 10), lensMat);
          lens.rotation.x = Math.PI / 2;
          lens.position.set(cx, 5.55, zDir * 0.33);
          group.add(lens);

          const led = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), ledMat);
          led.position.set(cx + 0.14, 5.64, zDir * 0.33);
          group.add(led);
        }
      }

      // Overhead strobe flash bulb
      const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 10), flashMat);
      strobe.position.set(0, 5.5, 0);
      group.add(strobe);

      // Double-sided "신호·과속 단속 50" enforcement signboard
      const signBoard = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.96, 0.08), [
        stripeMat,
        stripeMat,
        stripeMat,
        stripeMat,
        signMat,
        signMat,
      ]);
      signBoard.position.set(poleX - sp.poleSide * 2.1, 5.05, 0);
      group.add(signBoard);

      this.root.add(group);

      this.cameras.push({
        id: sp.id,
        label: sp.label,
        x: sp.x,
        z: sp.z,
        axis: sp.axis,
        limitKmh: SPEED_CAMERA_LIMIT_KMH,
        ledMat,
        flashMat,
        flashTimer: 0,
        cooldown: 0,
        wasInZone: false,
      });

      this.cameraMarkers.push({
        id: sp.id,
        x: sp.x,
        z: sp.z,
        limitKmh: SPEED_CAMERA_LIMIT_KMH,
      });
    }
  }

  private buildParkedHazards(): void {
    // 6 illegally double-parked hazard vehicles (4 parcel box trucks + 2 sedans) along commercial street curbs
    const specs: Array<{
      id: string;
      name: string;
      x: number;
      z: number;
      heading: number;
      isTruck: boolean;
      sidewalkSide: number; // +1 = left (+X local), -1 = right (-X local) -> pop-out runs into road!
    }> = [
      { id: 'park-1', name: 'K-택배 불법정차 탑차', x: -16, z: -34.8, heading: Math.PI / 2, isTruck: true, sidewalkSide: -1 },
      { id: 'park-2', name: '번개물류 택배탑차', x: 64, z: -45.2, heading: -Math.PI / 2, isTruck: true, sidewalkSide: -1 },
      { id: 'park-3', name: '상가 앞 비상등 승용차', x: -34.8, z: 16, heading: Math.PI, isTruck: false, sidewalkSide: -1 },
      { id: 'park-4', name: 'K-택배 불법정차 탑차', x: 34.8, z: -18, heading: 0, isTruck: true, sidewalkSide: -1 },
      { id: 'park-5', name: '식자재 납품 탑차', x: 18, z: 45.2, heading: Math.PI / 2, isTruck: true, sidewalkSide: -1 },
      { id: 'park-6', name: '골목 비상등 불법주차', x: -45.2, z: -64, heading: 0, isTruck: false, sidewalkSide: -1 },
    ];

    const truckTex = this.createTruckLiveryTexture('K-택배');
    const cabMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.42 });
    const boxSideMat = new THREE.MeshStandardMaterial({ map: truckTex, roughness: 0.5 });
    const boxPlainMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.55 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.15, metalness: 0.55 });
    const sedanMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.35, metalness: 0.45 });
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x181c22, roughness: 0.9 });
    const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.24, 12);
    wheelGeo.rotateZ(Math.PI / 2);

    for (const sp of specs) {
      const group = new THREE.Group();
      group.position.set(sp.x, 0, sp.z);
      group.rotation.y = sp.heading;

      const hazardMat = new THREE.MeshStandardMaterial({
        color: 0x78350f,
        emissive: 0xf59e0b,
        emissiveIntensity: 2.4,
      });

      let halfW = 1.02;
      let halfL = 2.25;

      if (sp.isTruck) {
        halfW = 1.08;
        halfL = 2.75;
        // White Korean 1-ton parcel delivery box truck ("탑차")
        const cargoBox = new THREE.Mesh(new THREE.BoxGeometry(2.05, 1.95, 3.45), [
          boxSideMat,
          boxSideMat,
          boxPlainMat,
          boxPlainMat,
          boxPlainMat,
          boxPlainMat,
        ]);
        cargoBox.position.set(0, 1.65, -0.78);
        cargoBox.castShadow = true;
        cargoBox.receiveShadow = true;
        group.add(cargoBox);

        const cab = new THREE.Mesh(new THREE.BoxGeometry(1.88, 1.45, 1.55), cabMat);
        cab.position.set(0, 1.28, 1.72);
        cab.castShadow = true;
        group.add(cab);

        const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.72, 0.08), glassMat);
        windshield.position.set(0, 1.54, 2.5);
        group.add(windshield);

        // 4 flashing hazard lamps (front + rear corners)
        for (const sx of [-0.82, 0.82]) {
          const fl = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.08), hazardMat);
          fl.position.set(sx, 0.95, 2.52);
          const rl = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.08), hazardMat);
          rl.position.set(sx, 0.78, -2.52);
          group.add(fl, rl);
        }

        for (const [wx, wz] of [
          [-0.96, 1.62],
          [0.96, 1.62],
          [-0.96, -1.45],
          [0.96, -1.45],
        ]) {
          const w = new THREE.Mesh(wheelGeo, wheelMat);
          w.position.set(wx, 0.35, wz);
          group.add(w);
        }
      } else {
        // Double-parked hazard sedan
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.72, 4.3), sedanMat);
        body.position.set(0, 0.62, 0);
        body.castShadow = true;
        group.add(body);

        const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.58, 2.15), sedanMat);
        cabin.position.set(0, 1.22, -0.15);
        group.add(cabin);

        const win = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.45, 2.2), glassMat);
        win.position.set(0, 1.22, -0.15);
        group.add(win);

        for (const sx of [-0.74, 0.74]) {
          const fl = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.08), hazardMat);
          fl.position.set(sx, 0.68, 2.16);
          const rl = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.08), hazardMat);
          rl.position.set(sx, 0.68, -2.16);
          group.add(fl, rl);
        }

        for (const [wx, wz] of [
          [-0.92, 1.32],
          [0.92, 1.32],
          [-0.92, -1.32],
          [0.92, -1.32],
        ]) {
          const w = new THREE.Mesh(wheelGeo, wheelMat);
          w.position.set(wx, 0.34, wz);
          group.add(w);
        }
      }

      this.root.add(group);

      // Register physical ObstacleBox aligned with world axes
      const ns = Math.abs(Math.cos(sp.heading)) > 0.7;
      const rx = ns ? halfW : halfL;
      const rz = ns ? halfL : halfW;
      this.obstacles.push({
        minX: sp.x - rx,
        maxX: sp.x + rx,
        minZ: sp.z - rz,
        maxZ: sp.z + rz,
      });

      // Prepare blind-spot pop-out pedestrian positioned behind the vehicle's front bumper toward road center
      const fwdX = Math.sin(sp.heading);
      const fwdZ = Math.cos(sp.heading);
      const leftX = Math.cos(sp.heading);
      const leftZ = -Math.sin(sp.heading);
      // Road center is opposite the curb/sidewalk side
      const intoRoad = -sp.sidewalkSide;
      const startX = sp.x + fwdX * (halfL + 0.7) + leftX * (sp.sidewalkSide * 0.4);
      const startZ = sp.z + fwdZ * (halfL + 0.7) + leftZ * (sp.sidewalkSide * 0.4);
      const outX = startX + leftX * (intoRoad * 2.15);
      const outZ = startZ + leftZ * (intoRoad * 2.15);

      const popRig = this.pedFactory.createPedestrian();
      popRig.root.position.set(startX, 0.04, startZ);
      popRig.root.visible = false;
      this.root.add(popRig.root);

      this.parkedHazards.push({
        id: sp.id,
        name: sp.name,
        x: sp.x,
        z: sp.z,
        heading: sp.heading,
        isTruck: sp.isTruck,
        hazardMat,
        popRig,
        popState: 'hidden',
        popStartX: startX,
        popStartZ: startZ,
        popOutX: outX,
        popOutZ: outZ,
        popX: startX,
        popZ: startZ,
        popHeading: Math.atan2(outX - startX, outZ - startZ),
        popTimer: 0,
        popCooldown: 0,
        popFallSide: 1,
      });
    }
  }

  private createPoliceDoorTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 96;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, 256, 96);
    // Korean Police blue + yellow diagonal livery stripes
    ctx.fillStyle = '#1d4ed8';
    ctx.fillRect(0, 58, 256, 26);
    ctx.fillStyle = '#facc15';
    ctx.fillRect(0, 50, 256, 8);
    ctx.fillStyle = '#1e3a8a';
    ctx.font = '900 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('경찰 POLICE', 128, 28);
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 18px sans-serif';
    ctx.fillText('112 순찰차', 128, 72);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private buildPolicePatrols(): void {
    const specs: Array<{ id: string; label: string; dir: PatrolDir; roadIdx: number; along: number }> = [
      { id: 'patrol-1', label: '중앙지구대 112 순찰차', dir: 1, roadIdx: 2, along: -92 },
      { id: 'patrol-2', label: '강남지구대 112 순찰차', dir: 0, roadIdx: 3, along: -95 },
    ];

    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.28, metalness: 0.25 });
    const blueAccentMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.32, metalness: 0.35 });
    const doorTex = this.createPoliceDoorTexture();
    const doorMat = new THREE.MeshStandardMaterial({ map: doorTex, roughness: 0.35 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.14, metalness: 0.6 });
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x181c22, roughness: 0.9 });
    const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.22, 12);
    wheelGeo.rotateZ(Math.PI / 2);

    for (const sp of specs) {
      const group = new THREE.Group();

      // Lower chassis with Korean police side livery
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.68, 4.32), [
        doorMat,
        doorMat,
        whiteMat,
        whiteMat,
        blueAccentMat,
        blueAccentMat,
      ]);
      body.position.set(0, 0.62, 0);
      body.castShadow = true;
      group.add(body);

      // Cabin & windows
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.58, 2.2), whiteMat);
      cabin.position.set(0, 1.21, -0.14);
      cabin.castShadow = true;
      group.add(cabin);

      const glass = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.44, 2.24), glassMat);
      glass.position.set(0, 1.22, -0.14);
      group.add(glass);

      // Roof Red / Blue Alternating Police Lightbar
      const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.08, 0.28), glassMat);
      barBase.position.set(0, 1.54, -0.08);
      group.add(barBase);

      const redBarMat = new THREE.MeshStandardMaterial({
        color: 0x991b1b,
        emissive: 0xef4444,
        emissiveIntensity: 3.0,
      });
      const blueBarMat = new THREE.MeshStandardMaterial({
        color: 0x1e3a8a,
        emissive: 0x3b82f6,
        emissiveIntensity: 3.0,
      });

      const redLed = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.24), redBarMat);
      redLed.position.set(0.3, 1.62, -0.08);
      const blueLed = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.24), blueBarMat);
      blueLed.position.set(-0.3, 1.62, -0.08);
      group.add(redLed, blueLed);

      for (const [wx, wz] of [
        [-0.92, 1.32],
        [0.92, 1.32],
        [-0.92, -1.32],
        [0.92, -1.32],
      ]) {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.position.set(wx, 0.34, wz);
        group.add(w);
      }

      const roadCoord = CITY_ROAD_LINES[sp.roadIdx];
      const lane = patrolLaneCoord(roadCoord, sp.dir);
      const isNS = sp.dir === 0 || sp.dir === 2;
      const x = isNS ? lane : sp.along;
      const z = isNS ? sp.along : lane;
      const heading = patrolDirHeading(sp.dir);

      group.position.set(x, 0, z);
      group.rotation.y = heading;
      this.root.add(group);

      this.patrolCars.push({
        id: sp.id,
        label: sp.label,
        group,
        redBarMat,
        blueBarMat,
        x,
        z,
        heading,
        dir: sp.dir,
        roadIndex: sp.roadIdx,
        speed: 8.5,
        cruiseSpeed: 9.8,
        sirenTimer: 0,
        citeCooldown: 0,
      });

      this.patrolMarkers.push({
        id: sp.id,
        x,
        z,
        heading,
        sirenActive: false,
      });
    }
  }

  public step(
    dt: number,
    elapsedTime: number,
    inCorridor: boolean,
    scooter: ScooterProximityInfo,
    signalState: SignalStateSnapshot,
    onSpeedCameraTrigger?: (ev: SpeedCameraTriggerEvent) => void,
    onPopOutWarning?: (ev: PopOutWarningEvent) => void,
    onPopOutPedestrianHit?: (ev: PedestrianCollisionEvent) => void,
    onCameraApproachBeep?: (overSpeed: boolean) => void,
    onPolicePatrolCite?: (ev: SpeedCameraTriggerEvent) => void
  ): void {
    if (inCorridor) {
      this.upcomingCamera = null;
      return;
    }

    const clampedDt = Math.min(dt, 0.05);
    const speedKmh = Math.abs(scooter.speedMps) * 3.6;
    const blinkOn = Math.floor(elapsedTime * 2.6) % 2 === 0;
    const scFwdX = Math.sin(scooter.heading);
    const scFwdZ = Math.cos(scooter.heading);

    // --- 1. Update Speed & Red-Light Enforcement Cameras + 80m Navi Approach Warning ---
    let nearestAhead: UpcomingCameraAlert | null = null;
    for (const cam of this.cameras) {
      if (cam.cooldown > 0) cam.cooldown = Math.max(0, cam.cooldown - clampedDt);
      if (cam.flashTimer > 0) {
        cam.flashTimer = Math.max(0, cam.flashTimer - clampedDt);
        cam.flashMat.opacity = Math.min(0.95, cam.flashTimer * 4.5);
      } else {
        cam.flashMat.opacity = 0;
      }
      cam.ledMat.emissiveIntensity = blinkOn ? 2.8 : 0.7;

      // 80m forward approach detection along player travel corridor
      if (scooter.isRiding && !scooter.crashed && speedKmh >= 6) {
        const toCamX = cam.x - scooter.x;
        const toCamZ = cam.z - scooter.z;
        const dist = Math.hypot(toCamX, toCamZ);
        if (dist >= 7 && dist <= SPEED_CAMERA_WARN_DIST) {
          const alignment = (toCamX * scFwdX + toCamZ * scFwdZ) / dist;
          const lateral = Math.abs(toCamX * -scFwdZ + toCamZ * scFwdX);
          if (alignment > 0.65 && lateral < 13) {
            if (!nearestAhead || dist < nearestAhead.distanceMeters) {
              nearestAhead = {
                cameraId: cam.id,
                label: cam.label,
                distanceMeters: Math.round(dist),
                limitKmh: cam.limitKmh,
                isOverSpeed: speedKmh > cam.limitKmh,
              };
            }
          }
        }
      }

      const dx = Math.abs(scooter.x - cam.x);
      const dz = Math.abs(scooter.z - cam.z);
      const inZone =
        cam.axis === 'ns' ? dx <= 7.2 && dz <= 4.5 : dz <= 7.2 && dx <= 4.5;

      if (inZone && !cam.wasInZone && scooter.isRiding && !scooter.crashed && cam.cooldown <= 0) {
        const axisSignal = cam.axis === 'ns' ? signalState.ns : signalState.ew;
        const isSpeeding = speedKmh > cam.limitKmh + SPEED_CAMERA_GRACE_KMH;
        const isRedLight = axisSignal === 'red' && speedKmh >= 15;

        if (isSpeeding || isRedLight) {
          cam.cooldown = 12.0;
          cam.flashTimer = 0.25;
          cam.flashMat.opacity = 0.95;

          onSpeedCameraTrigger?.({
            cameraId: cam.id,
            label: cam.label,
            kind: isSpeeding ? 'speeding' : 'red_light',
            measuredKmh: Math.round(speedKmh),
            limitKmh: cam.limitKmh,
            fine: SPEED_CAMERA_FINE,
          });
        }
      }
      cam.wasInZone = inZone;
    }

    this.upcomingCamera = nearestAhead;
    if (nearestAhead) {
      if (this.lastWarnedCameraId !== nearestAhead.cameraId) {
        this.lastWarnedCameraId = nearestAhead.cameraId;
        this.overSpeedBeepTimer = 0.55;
        onCameraApproachBeep?.(nearestAhead.isOverSpeed);
      } else if (nearestAhead.isOverSpeed) {
        this.overSpeedBeepTimer -= clampedDt;
        if (this.overSpeedBeepTimer <= 0) {
          this.overSpeedBeepTimer = 0.55;
          onCameraApproachBeep?.(true);
        }
      }
    } else {
      this.lastWarnedCameraId = null;
      this.overSpeedBeepTimer = 0;
    }

    // --- 1.5. Update Patrolling Korean Police Cars ("POLICE 112") & Live Enforcement ---
    for (let pi = 0; pi < this.patrolCars.length; pi++) {
      const p = this.patrolCars[pi];
      if (p.citeCooldown > 0) p.citeCooldown = Math.max(0, p.citeCooldown - clampedDt);
      if (p.sirenTimer > 0) p.sirenTimer = Math.max(0, p.sirenTimer - clampedDt);

      // Alternating red/blue roof LED lightbar (faster strobe during active enforcement!)
      const strobeHz = p.sirenTimer > 0 ? 9.5 : 3.2;
      const redPhase = Math.floor(elapsedTime * strobeHz) % 2 === 0;
      p.redBarMat.emissiveIntensity = redPhase ? 3.8 : 0.25;
      p.blueBarMat.emissiveIntensity = redPhase ? 0.25 : 3.8;

      // Cruise along city arterial roads, stopping smoothly at red lights & turning cleanly at edges
      const [fx, fz] = patrolDirVec(p.dir);
      const isNS = p.dir === 0 || p.dir === 2;
      const along = isNS ? p.z : p.x;
      const stepSign = isNS ? fz : fx;
      const sig = isNS ? signalState.ns : signalState.ew;

      let mustStop = false;
      for (let r = 0; r < CITY_ROAD_LINES.length; r++) {
        const diff = (CITY_ROAD_LINES[r] - along) * stepSign;
        if (diff > 9.5 && diff < 16.5 && sig !== 'green') {
          mustStop = true;
          break;
        }
      }

      // Stop if rider is directly in front of patrol car
      const toRiderX = scooter.x - p.x;
      const toRiderZ = scooter.z - p.z;
      const distRider = Math.hypot(toRiderX, toRiderZ);
      const aheadDot = distRider > 0.1 ? (toRiderX * fx + toRiderZ * fz) / distRider : 0;
      if (distRider < 7.0 && aheadDot > 0.72) {
        mustStop = true;
      }

      const targetSpd = mustStop ? 0 : p.cruiseSpeed;
      p.speed += (targetSpd - p.speed) * Math.min(1, clampedDt * (mustStop ? 8 : 3.5));
      p.x += fx * p.speed * clampedDt;
      p.z += fz * p.speed * clampedDt;

      // Turn 90° smoothly at outer city road perimeter to keep patrolling endlessly
      const nextAlong = isNS ? p.z : p.x;
      if ((stepSign > 0 && nextAlong >= 198) || (stepSign < 0 && nextAlong <= -198)) {
        const nextDir = ((p.dir + 1) % 4) as PatrolDir;
        const clampedEdgeIdx = stepSign > 0 ? CITY_ROAD_LINES.length - 1 : 0;
        p.dir = nextDir;
        p.roadIndex = clampedEdgeIdx;
        p.heading = patrolDirHeading(nextDir);
        const newLane = patrolLaneCoord(CITY_ROAD_LINES[p.roadIndex], nextDir);
        if (nextDir === 0 || nextDir === 2) p.x = newLane;
        else p.z = newLane;
      }

      p.group.position.set(p.x, 0, p.z);
      p.group.rotation.y = p.heading;

      // Live Patrol Enforcement: speeding > 60 km/h within 22m of a police patrol car!
      if (
        scooter.isRiding &&
        !scooter.crashed &&
        p.citeCooldown <= 0 &&
        distRider <= 22.0 &&
        speedKmh > PATROL_SPEED_LIMIT_KMH
      ) {
        p.citeCooldown = 18.0;
        p.sirenTimer = 4.5;
        onPolicePatrolCite?.({
          cameraId: p.id,
          label: p.label,
          kind: 'patrol_speeding',
          measuredKmh: Math.round(speedKmh),
          limitKmh: PATROL_SPEED_LIMIT_KMH,
          fine: PATROL_ENFORCEMENT_FINE,
        });
      }

      // Sync GPS marker for smartphone map (after citation so sirenActive reflects immediately!)
      this.patrolMarkers[pi].x = p.x;
      this.patrolMarkers[pi].z = p.z;
      this.patrolMarkers[pi].heading = p.heading;
      this.patrolMarkers[pi].sirenActive = p.sirenTimer > 0;
    }

    // --- 2. Update Double-Parked Hazard Blinkers & Blind-Spot Pop-Out Pedestrians ---
    // Also blink road construction amber strobes & drive rival AI delivery scooters!
    for (const cz of this.constructionZones) {
      cz.strobeMat.emissiveIntensity = blinkOn ? 3.8 : 0.25;
    }

    for (let ri = 0; ri < this.rivalRiders.length; ri++) {
      const r = this.rivalRiders[ri];
      if (r.turnCooldown > 0) r.turnCooldown = Math.max(0, r.turnCooldown - clampedDt);

      const [fx, fz] = patrolDirVec(r.dir);
      const isNS = r.dir === 0 || r.dir === 2;
      const axisSig = isNS ? signalState.ns : signalState.ew;
      const stepSign = isNS ? fz : fx;
      const posAlong = isNS ? r.z : r.x;

      let mustStop = false;
      if (axisSig === 'red' || axisSig === 'yellow') {
        for (const rc of CITY_ROAD_LINES) {
          const stopLine = rc - stepSign * 10.5;
          const distToStop = (stopLine - posAlong) * stepSign;
          if (distToStop >= -0.4 && distToStop <= 9.5) {
            mustStop = true;
            break;
          }
        }
      }

      // Yield cleanly if player scooter is directly ahead
      const toPlX = scooter.x - r.x;
      const toPlZ = scooter.z - r.z;
      const distPl = Math.hypot(toPlX, toPlZ);
      const aheadDot = distPl > 0.1 ? (toPlX * fx + toPlZ * fz) / distPl : 0;
      if (distPl < 5.2 && aheadDot > 0.72) {
        mustStop = true;
      }

      const targetSpd = mustStop ? 0 : r.cruiseSpeed;
      r.speed += (targetSpd - r.speed) * Math.min(1, clampedDt * (mustStop ? 9 : 4.2));
      r.x += fx * r.speed * clampedDt;
      r.z += fz * r.speed * clampedDt;

      // Turn at outer perimeter or occasionally at an interior intersection
      const nextAlong = isNS ? r.z : r.x;
      const hitPerimeter =
        (stepSign > 0 && nextAlong >= 198) || (stepSign < 0 && nextAlong <= -198);
      if (hitPerimeter) {
        const nextDir = ((r.dir + 1) % 4) as PatrolDir;
        const clampedEdgeIdx = stepSign > 0 ? CITY_ROAD_LINES.length - 1 : 0;
        r.dir = nextDir;
        r.roadIndex = clampedEdgeIdx;
        r.heading = patrolDirHeading(nextDir);
        const laneC = patrolLaneCoord(CITY_ROAD_LINES[r.roadIndex], nextDir);
        if (nextDir === 0 || nextDir === 2) r.x = laneC;
        else r.z = laneC;
        r.turnCooldown = 2.0;
      } else if (r.turnCooldown <= 0 && r.speed > 3) {
        for (let idx = 1; idx < CITY_ROAD_LINES.length - 1; idx++) {
          const rc = CITY_ROAD_LINES[idx];
          if (Math.abs(nextAlong - rc) < 0.75 && Math.random() < 0.25) {
            const turnDelta = Math.random() < 0.5 ? 1 : 3;
            const nextDir = ((r.dir + turnDelta) % 4) as PatrolDir;
            r.dir = nextDir;
            r.roadIndex = idx;
            r.heading = patrolDirHeading(nextDir);
            const laneC = patrolLaneCoord(CITY_ROAD_LINES[r.roadIndex], nextDir);
            if (nextDir === 0 || nextDir === 2) r.x = laneC;
            else r.z = laneC;
            r.turnCooldown = 4.0;
            break;
          }
        }
      }

      r.group.position.set(r.x, 0, r.z);
      r.group.rotation.y = r.heading;

      this.rivalRiderMarkers[ri].x = r.x;
      this.rivalRiderMarkers[ri].z = r.z;
      this.rivalRiderMarkers[ri].heading = r.heading;
    }

    if (this.globalPopOutCooldown > 0) {
      this.globalPopOutCooldown = Math.max(0, this.globalPopOutCooldown - clampedDt);
    }

    const canHitPopOut =
      scooter.isRiding && !scooter.crashed && speedKmh >= PEDESTRIAN_COLLISION_MIN_KMH;

    for (const h of this.parkedHazards) {
      h.hazardMat.emissiveIntensity = blinkOn ? 2.8 : 0.12;
      if (h.popCooldown > 0) h.popCooldown = Math.max(0, h.popCooldown - clampedDt);

      // Check trigger for blind-spot pedestrian darting out from behind parked hazard vehicle
      if (
        h.popState === 'hidden' &&
        h.popCooldown <= 0 &&
        this.globalPopOutCooldown <= 0 &&
        scooter.isRiding &&
        !scooter.crashed &&
        speedKmh >= 18
      ) {
        const toHazX = h.popStartX - scooter.x;
        const toHazZ = h.popStartZ - scooter.z;
        const dist = Math.hypot(toHazX, toHazZ);
        if (dist >= 10 && dist <= 23) {
          const alignment = (toHazX * scFwdX + toHazZ * scFwdZ) / dist;
          if (alignment > 0.58) {
            h.popState = 'popping_out';
            h.popX = h.popStartX;
            h.popZ = h.popStartZ;
            h.popHeading = Math.atan2(h.popOutX - h.popStartX, h.popOutZ - h.popStartZ);
            h.popTimer = 0;
            h.popCooldown = 32.0;
            this.globalPopOutCooldown = POPOUT_GLOBAL_COOLDOWN_SEC;
            h.popRig.root.visible = true;
            onPopOutWarning?.({ hazardName: h.name });
          }
        }
      }

      if (h.popState === 'hidden') continue;

      // Check direct collision (>= 5 km/h riding only!)
      if (canHitPopOut && h.popState !== 'fallen') {
        const dHit = Math.hypot(h.popX - scooter.x, h.popZ - scooter.z);
        if (dHit <= POPOUT_COLLISION_RADIUS) {
          h.popState = 'fallen';
          h.popTimer = 5.5;
          const leftX = Math.cos(scooter.heading);
          const leftZ = -Math.sin(scooter.heading);
          const sideDot = (h.popX - scooter.x) * leftX + (h.popZ - scooter.z) * leftZ;
          h.popFallSide = sideDot >= 0 ? 1 : -1;

          onPopOutPedestrianHit?.({
            pedestrianId: 900 + this.parkedHazards.indexOf(h),
            pedX: h.popX,
            pedZ: h.popZ,
            impactSpeedKmh: speedKmh,
            hitSide: h.popFallSide,
          });
        }
      }

      if (h.popState === 'popping_out') {
        const dx = h.popOutX - h.popX;
        const dz = h.popOutZ - h.popZ;
        const rem = Math.hypot(dx, dz);
        const runSpeed = 2.6;
        if (rem <= 0.08) {
          h.popX = h.popOutX;
          h.popZ = h.popOutZ;
          h.popState = 'holding';
          h.popTimer = 1.65;
        } else {
          const step = Math.min(rem, runSpeed * clampedDt);
          h.popX += (dx / rem) * step;
          h.popZ += (dz / rem) * step;
        }
        h.popRig.root.position.set(h.popX, 0.04, h.popZ);
        h.popRig.root.rotation.y = h.popHeading;
        PedestrianFactory.updateWalkAnimation(h.popRig, runSpeed, clampedDt);
      } else if (h.popState === 'holding') {
        h.popTimer -= clampedDt;
        const faceRider = Math.atan2(scooter.x - h.popX, scooter.z - h.popZ);
        h.popRig.root.position.set(h.popX, 0.04, h.popZ);
        h.popRig.root.rotation.y = faceRider;
        PedestrianFactory.updateStartledAnimation(h.popRig, elapsedTime, clampedDt);
        if (h.popTimer <= 0) {
          h.popState = 'retreating';
          h.popHeading = Math.atan2(h.popStartX - h.popX, h.popStartZ - h.popZ);
        }
      } else if (h.popState === 'retreating') {
        const dx = h.popStartX - h.popX;
        const dz = h.popStartZ - h.popZ;
        const rem = Math.hypot(dx, dz);
        const speed = 2.1;
        if (rem <= 0.1) {
          h.popState = 'hidden';
          h.popRig.root.visible = false;
        } else {
          const step = Math.min(rem, speed * clampedDt);
          h.popX += (dx / rem) * step;
          h.popZ += (dz / rem) * step;
          h.popRig.root.position.set(h.popX, 0.04, h.popZ);
          h.popRig.root.rotation.y = h.popHeading;
          PedestrianFactory.updateWalkAnimation(h.popRig, speed, clampedDt);
        }
      } else if (h.popState === 'fallen') {
        h.popTimer -= clampedDt;
        h.popRig.root.position.set(h.popX, 0.04, h.popZ);
        PedestrianFactory.updateFallenAnimation(h.popRig, h.popFallSide, clampedDt);
        if (h.popTimer <= 0) {
          h.popState = 'hidden';
          h.popRig.root.visible = false;
        }
      }
    }
  }

  /** Creates a Korean "🚧 도로 공사 중 · 서행" barricade canvas texture */
  private createConstructionSignTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#f97316';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#0f172a';
    for (let x = -40; x < 300; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 128);
      ctx.lineTo(x + 18, 128);
      ctx.lineTo(x + 36, 98);
      ctx.lineTo(x + 18, 98);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 4;
    ctx.fillRect(14, 14, 228, 76);
    ctx.strokeRect(14, 14, 228, 76);
    ctx.fillStyle = '#0f172a';
    ctx.font = '900 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🚧 도로 공사 중', 128, 42);
    ctx.font = 'bold 20px sans-serif';
    ctx.fillStyle = '#dc2626';
    ctx.fillText('1차선 통제 · 서행', 128, 72);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** Builds 3 Korean 1-lane road construction zones with traffic cones, A-frame barricade & strobe */
  private buildConstructionZones(): void {
    const specs: Array<{ id: string; label: string; x: number; z: number; axis: 'ew' | 'ns' }> = [
      { id: 'const-1', label: '중앙로 동측 공사구간', x: 80, z: -36.5, axis: 'ew' },
      { id: 'const-2', label: '리버뷰 서측 공사구간', x: -36.5, z: 0, axis: 'ns' },
      { id: 'const-3', label: '남부 간선도로 공사구간', x: -80, z: 123.5, axis: 'ew' },
    ];

    const coneOrangeMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.45 });
    const coneStripeMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      emissive: 0xffffff,
      emissiveIntensity: 0.25,
      roughness: 0.35,
    });
    const coneBaseMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });
    const dirtMat = new THREE.MeshStandardMaterial({ color: 0x5c4738, roughness: 0.96 });
    const signMat = new THREE.MeshBasicMaterial({ map: this.createConstructionSignTexture() });
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.5, roughness: 0.5 });

    const coneGeo = new THREE.ConeGeometry(0.22, 0.72, 10);
    const bandGeo = new THREE.CylinderGeometry(0.11, 0.16, 0.14, 10);
    const baseGeo = new THREE.BoxGeometry(0.46, 0.06, 0.46);

    for (const sp of specs) {
      const g = new THREE.Group();
      g.position.set(sp.x, 0, sp.z);
      if (sp.axis === 'ns') {
        g.rotation.y = Math.PI / 2;
      }

      // Excavated asphalt / gravel work patch (7.5m x 2.6m inside right lane)
      const patch = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.08, 2.5), dirtMat);
      patch.position.set(0, 0.04, 0);
      patch.receiveShadow = true;
      g.add(patch);

      // 6 Orange/White Reflective Traffic Cones tapering traffic cleanly into the open lane
      const coneOffsets: Array<[number, number]> = [
        [-4.8, 0.65],
        [-3.2, 1.35],
        [-0.8, 1.35],
        [1.6, 1.35],
        [3.6, 1.35],
        [5.0, 0.65],
      ];
      for (const [cx, cz] of coneOffsets) {
        const cBase = new THREE.Mesh(baseGeo, coneBaseMat);
        cBase.position.set(cx, 0.04, cz);
        const cone = new THREE.Mesh(coneGeo, coneOrangeMat);
        cone.position.set(cx, 0.41, cz);
        cone.castShadow = true;
        const band = new THREE.Mesh(bandGeo, coneStripeMat);
        band.position.set(cx, 0.48, cz);
        g.add(cBase, cone, band);
      }

      // Two-sided A-Frame Construction Warning Signboard + Amber Blinking Strobe Lamp
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.95, 1.85), signMat);
      board.position.set(-3.9, 0.72, 0);
      board.castShadow = true;
      const legL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.15, 0.08), poleMat);
      legL.position.set(-3.9, 0.58, -0.78);
      const legR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.15, 0.08), poleMat);
      legR.position.set(-3.9, 0.58, 0.78);

      const strobeMat = new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        emissive: 0xf59e0b,
        emissiveIntensity: 3.0,
      });
      const strobe = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.22, 10), strobeMat);
      strobe.position.set(-3.9, 1.32, 0);
      g.add(board, legL, legR, strobe);

      this.root.add(g);

      // Physical collision box blocking the closed lane so player must steer around cones
      const halfX = sp.axis === 'ew' ? 4.2 : 1.45;
      const halfZ = sp.axis === 'ew' ? 1.45 : 4.2;
      this.obstacles.push({
        minX: sp.x - halfX,
        maxX: sp.x + halfX,
        minZ: sp.z - halfZ,
        maxZ: sp.z + halfZ,
      });

      this.constructionZones.push({ id: sp.id, label: sp.label, x: sp.x, z: sp.z, strobeMat });
      this.constructionMarkers.push({ id: sp.id, x: sp.x, z: sp.z, label: sp.label });
    }
  }

  /** Builds 4 Rival AI Korean Delivery Scooter Riders roaming the 6x6 road grid */
  private buildRivalRiders(): void {
    const configs: Array<{
      id: string;
      colorHex: number;
      colorCss: string;
      jacketHex: number;
      dir: PatrolDir;
      roadIndex: number;
      along: number;
      cruiseSpeed: number;
    }> = [
      { id: 'rival-1', colorHex: 0x14b8a6, colorCss: '#14b8a6', jacketHex: 0x0f766e, dir: 1, roadIndex: 2, along: -95, cruiseSpeed: 11.4 },
      { id: 'rival-2', colorHex: 0xf97316, colorCss: '#f97316', jacketHex: 0xc2410c, dir: 0, roadIndex: 3, along: -65, cruiseSpeed: 12.2 },
      { id: 'rival-3', colorHex: 0x3b82f6, colorCss: '#3b82f6', jacketHex: 0x1d4ed8, dir: 3, roadIndex: 3, along: 90, cruiseSpeed: 10.8 },
      { id: 'rival-4', colorHex: 0xeab308, colorCss: '#eab308', jacketHex: 0x334155, dir: 2, roadIndex: 1, along: 85, cruiseSpeed: 11.8 },
    ];

    const tireMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4, metalness: 0.3 });
    const helmetMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.25 });
    const visorMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.15, metalness: 0.6 });
    const headLightMat = new THREE.MeshStandardMaterial({
      color: 0xfef9c3,
      emissive: 0xfef08a,
      emissiveIntensity: 2.2,
    });
    const tailLightMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xef4444,
      emissiveIntensity: 1.8,
    });

    for (const cfg of configs) {
      const g = new THREE.Group();
      const boxMat = new THREE.MeshStandardMaterial({ color: cfg.colorHex, roughness: 0.4 });
      const jacketMat = new THREE.MeshStandardMaterial({ color: cfg.jacketHex, roughness: 0.78 });

      // Wheels
      for (const wz of [-0.62, 0.62]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.14, 10), tireMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(0, 0.26, wz);
        g.add(wheel);
      }

      // Scooter body & front shield
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.42, 1.38), frameMat);
      body.position.set(0, 0.56, 0);
      body.castShadow = true;
      const frontFairing = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.28), frameMat);
      frontFairing.position.set(0, 0.84, 0.55);
      const handlebar = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.07, 0.08), tireMat);
      handlebar.position.set(0, 1.12, 0.48);

      // Colorful Korean delivery top-box on rear rack!
      const topBox = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.5, 0.52), boxMat);
      topBox.position.set(0, 1.05, -0.58);
      topBox.castShadow = true;

      // Headlight & Taillight
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.05), headLightMat);
      hl.position.set(0, 0.94, 0.7);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.05), tailLightMat);
      tl.position.set(0, 0.74, -0.72);

      // Stylized seated rider + white helmet
      const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.54, 0.28), jacketMat);
      torso.position.set(0, 1.15, -0.02);
      torso.rotation.x = 0.14;
      const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), helmetMat);
      helmet.position.set(0, 1.56, 0.04);
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, 0.12), visorMat);
      visor.position.set(0, 1.56, 0.16);

      g.add(body, frontFairing, handlebar, topBox, hl, tl, torso, helmet, visor);

      const isNS = cfg.dir === 0 || cfg.dir === 2;
      const laneC = patrolLaneCoord(CITY_ROAD_LINES[cfg.roadIndex], cfg.dir);
      const sx = isNS ? laneC : cfg.along;
      const sz = isNS ? cfg.along : laneC;
      const heading = patrolDirHeading(cfg.dir);

      g.position.set(sx, 0, sz);
      g.rotation.y = heading;
      this.root.add(g);

      this.rivalRiders.push({
        id: cfg.id,
        group: g,
        color: cfg.colorCss,
        x: sx,
        z: sz,
        heading,
        dir: cfg.dir,
        roadIndex: cfg.roadIndex,
        speed: cfg.cruiseSpeed,
        cruiseSpeed: cfg.cruiseSpeed,
        turnCooldown: 1.5,
      });

      this.rivalRiderMarkers.push({
        id: cfg.id,
        x: sx,
        z: sz,
        heading,
        color: cfg.colorCss,
      });
    }
  }
}
