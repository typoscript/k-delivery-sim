import * as THREE from 'three';
import {
  ConstructionZoneMarker,
  ObstacleBox,
  PolicePatrolMarker,
  RivalRiderMarker,
  SpeedCameraMarker,
  UpcomingCameraAlert,
  clamp,
  wrapAngle,
} from '../types';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import {
  SIGNAL_STOP_LINE_OFFSET,
  edgeDirection,
  getSignalAxis,
  laneBlendDecay,
  signalSpeedCap,
} from './TrafficRules';
import { SignalStateSnapshot } from './TrafficSystem';
import { PedestrianFactory, PedestrianRig } from './PedestrianFactory';
import {
  PEDESTRIAN_COLLISION_MIN_KMH,
  PedestrianCollisionEvent,
  ScooterProximityInfo,
} from './PedestrianManager';
import { PointGrid } from './PedestrianGraph';

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

interface OsmAdjEdge {
  to: number;
  dist: number;
  width: number;
  isMajor: boolean;
}

interface PolicePatrolUnit {
  id: string;
  label: string;
  group: THREE.Group;
  redBarMat: THREE.MeshStandardMaterial;
  blueBarMat: THREE.MeshStandardMaterial;
  fromNode: number;
  toNode: number;
  edgeDist: number;
  edgeWidth: number;
  progress: number;
  x: number;
  z: number;
  heading: number;
  speed: number;
  cruiseSpeed: number;
  sirenTimer: number;
  citeCooldown: number;
  blendX: number;
  blendZ: number;
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
  fromNode: number;
  toNode: number;
  edgeDist: number;
  edgeWidth: number;
  progress: number;
  x: number;
  z: number;
  heading: number;
  speed: number;
  cruiseSpeed: number;
  blendX: number;
  blendZ: number;
}

interface SpeedCameraUnit {
  id: string;
  label: string;
  x: number;
  z: number;
  axis: 'ns' | 'ew';
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
export const SPEED_CAMERA_GRACE_KMH = 2;
export const SPEED_CAMERA_WARN_DIST = 80;
export const SPEED_CAMERA_FINE = 40000;
export const PATROL_ENFORCEMENT_FINE = 50000;
export const PATROL_SPEED_LIMIT_KMH = 60;
const POPOUT_GLOBAL_COOLDOWN_SEC = 18.0;
const POPOUT_COLLISION_RADIUS = 1.14;

// --- Open-world scaling ---
/** Road coverage (km^2 of occupied 100m cells) above which a map counts as the large unified open world */
export const LARGE_MAP_COVERAGE_KM2 = 3.0;
/** Moving units (police, rivals) farther than this from the player get respawned near the player */
export const HAZARD_RECYCLE_DISTANCE = 300;
export const HAZARD_RESPAWN_MIN_RADIUS = 120;
export const HAZARD_RESPAWN_MAX_RADIUS = 250;
const HAZARD_RECYCLE_INTERVAL_SEC = 2.0;
/** Large map only: static props (cameras, parked cars, construction) beyond this are hidden */
const STATIC_PROP_VISIBLE_DIST = 420;
const STATIC_VISIBILITY_INTERVAL_SEC = 0.5;

interface PlacementRule {
  /** Count & minimum spacing on legacy-size (~0.8km) district maps, unchanged from the original game */
  legacyCount: number;
  legacySpacing: number;
  /** Density & spacing on the large unified map */
  perKm2: number;
  largeSpacing: number;
}

const CAMERA_RULE: PlacementRule = { legacyCount: 6, legacySpacing: 95, perKm2: 1.5, largeSpacing: 320 };
const PARKED_RULE: PlacementRule = { legacyCount: 6, legacySpacing: 68, perKm2: 3.0, largeSpacing: 160 };
const CONSTRUCTION_RULE: PlacementRule = { legacyCount: 3, legacySpacing: 110, perKm2: 0.6, largeSpacing: 600 };

/** Underpasses / tunnels / overpasses: no double-parked trucks or road works there */
const GRADE_SEPARATED_NAME = /지하차도|터널|고가/;

/**
 * Suwon Roadside Enforcement, Construction & Urban Delivery Hazards Manager:
 * 1. Fixed Speed Enforcement Cameras (50 km/h, 80m navi warning, ₩40,000 fine)
 * 2. 2 Patrolling Gyeonggi Southern Police Cars ("경기남부경찰 POLICE 112", live >60km/h enforcement)
 * 3. Illegally Double-Parked K-택배 Trucks & Sedans + Blind-Spot Pedestrian Pop-Outs
 * 4. Road Construction Zones (traffic cones, barricade, blinking amber strobe)
 * 5. 4 Rival AI Delivery Scooter Riders roaming real Suwon OSM roads!
 * Legacy district maps keep 6 cameras / 6 parked / 3 construction zones. The large unified map scales the
 * static counts with road coverage (see *_RULE), hides props > 420m away, and recycles police / rivals
 * that drift > 300m from the player onto roads 120~250m away.
 */
export class RoadHazardManager {
  public readonly root = new THREE.Group();
  public readonly obstacles: ObstacleBox[] = [];
  public readonly cameraMarkers: SpeedCameraMarker[] = [];
  public readonly patrolMarkers: PolicePatrolMarker[] = [];
  public readonly constructionMarkers: ConstructionZoneMarker[] = [];
  public readonly rivalRiderMarkers: RivalRiderMarker[] = [];
  public upcomingCamera: UpcomingCameraAlert | null = null;

  private readonly adj: OsmAdjEdge[][];
  private readonly majorNodeIds: number[] = [];
  private readonly cameras: SpeedCameraUnit[] = [];
  private readonly parkedHazards: ParkedHazardUnit[] = [];
  private readonly patrolCars: PolicePatrolUnit[] = [];
  private readonly constructionZones: ConstructionZoneUnit[] = [];
  private readonly rivalRiders: RivalRiderUnit[] = [];
  private readonly pedFactory = new PedestrianFactory();
  private globalPopOutCooldown = 3.0;
  /** Spatial index of OSM road nodes that have edges (all) and of nodes touching a major road */
  private readonly nodeGrid: PointGrid;
  private readonly majorNodeGrid: PointGrid;
  /** km^2 of 100m cells containing road nodes (legacy districts ~0.35-0.6, unified Suwon ~19) */
  public readonly roadCoverageKm2: number;
  public readonly isLargeMap: boolean;
  private readonly staticProps: Array<{ group: THREE.Object3D; x: number; z: number }> = [];
  private recycleTimer = 0;
  private staticVisTimer = STATIC_VISIBILITY_INTERVAL_SEC;
  /** Total police/rival respawns near the player (diagnostics / tests) */
  public recycledCount = 0;
  private lastWarnedCameraId: string | null = null;
  private overSpeedBeepTimer = 0;

  constructor(parent: THREE.Object3D) {
    const nodes = ACTIVE_MAP_DATA.nodes;
    this.adj = Array.from({ length: nodes.length }, () => []);
    for (const e of ACTIVE_MAP_DATA.edges) {
      this.adj[e.a].push({ to: e.b, dist: e.dist, width: e.width, isMajor: e.isMajor });
      this.adj[e.b].push({ to: e.a, dist: e.dist, width: e.width, isMajor: e.isMajor });
    }
    const xs = new Float64Array(nodes.length);
    const zs = new Float64Array(nodes.length);
    const isMajorNode = new Uint8Array(nodes.length);
    for (const n of nodes) {
      xs[n.id] = n.x;
      zs[n.id] = n.z;
      if (this.adj[n.id].some((ed) => ed.isMajor)) {
        this.majorNodeIds.push(n.id);
        isMajorNode[n.id] = 1;
      }
    }
    this.nodeGrid = new PointGrid(xs, zs, nodes.length, 100, (id) => this.adj[id].length > 0);
    this.majorNodeGrid = new PointGrid(xs, zs, nodes.length, 100, (id) => isMajorNode[id] === 1);
    this.roadCoverageKm2 = this.nodeGrid.occupiedCellCount * 0.01;
    this.isLargeMap = this.roadCoverageKm2 > LARGE_MAP_COVERAGE_KM2;

    this.buildSpeedCameras();
    this.buildParkedHazards();
    this.buildPolicePatrols();
    this.buildConstructionZones();
    this.buildRivalRiders();

    if (this.isLargeMap) {
      // Unified open world: start the moving units around the player instead of spread over 6km of city
      const spawn = ACTIVE_MAP_DATA.meta.playerSpawn;
      this.patrolCars.forEach((p, i) => {
        if (this.respawnMovingUnit(p, spawn.x, spawn.z, 60, HAZARD_RESPAWN_MAX_RADIUS, true, 0.25)) {
          Object.assign(this.patrolMarkers[i], { x: p.x, z: p.z, heading: p.heading });
        }
      });
      this.rivalRiders.forEach((r, i) => {
        if (this.respawnMovingUnit(r, spawn.x, spawn.z, 40, HAZARD_RESPAWN_MAX_RADIUS, false, 0.22)) {
          Object.assign(this.rivalRiderMarkers[i], { x: r.x, z: r.z, heading: r.heading });
        }
      });
      this.updateStaticPropVisibility(spawn.x, spawn.z);
    }
    parent.add(this.root);
  }

  public getAllObstacleBoxes(): ObstacleBox[] {
    const list: ObstacleBox[] = [...this.obstacles];
    for (const p of this.patrolCars) {
      list.push({
        minX: p.x - 1.5,
        maxX: p.x + 1.5,
        minZ: p.z - 1.5,
        maxZ: p.z + 1.5,
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

  /** Static hazard counts on the active map (for diagnostics / tests) */
  public get placementCounts(): { cameras: number; parked: number; construction: number } {
    return {
      cameras: this.cameras.length,
      parked: this.parkedHazards.length,
      construction: this.constructionZones.length,
    };
  }

  /** Current positions of the moving units (police first, then rivals) */
  public get movingUnitPositions(): Array<{ id: string; x: number; z: number }> {
    return [
      ...this.patrolCars.map((p) => ({ id: p.id, x: p.x, z: p.z })),
      ...this.rivalRiders.map((r) => ({ id: r.id, x: r.x, z: r.z })),
    ];
  }

  private placementLimits(rule: PlacementRule): { count: number; spacing: number } {
    if (!this.isLargeMap) return { count: rule.legacyCount, spacing: rule.legacySpacing };
    return {
      count: Math.max(rule.legacyCount, Math.round(this.roadCoverageKm2 * rule.perKm2)),
      spacing: rule.largeSpacing,
    };
  }

  private registerStaticProp(group: THREE.Object3D, x: number, z: number): void {
    if (this.isLargeMap) this.staticProps.push({ group, x, z });
  }

  /**
   * Picks a road edge whose start node lies minR~maxR from (x, z), away from the other moving units.
   * preferMajor: try nodes on major roads first and leave along a major edge when possible.
   */
  private pickSpawnEdge(
    x: number,
    z: number,
    minR: number,
    maxR: number,
    preferMajor: boolean,
    self: { x: number; z: number }
  ): { from: number; edge: OsmAdjEdge } | null {
    const others = [...this.patrolCars, ...this.rivalRiders].filter((u) => u !== self);
    const nodes = ACTIVE_MAP_DATA.nodes;
    const clear = (id: number) => {
      const n = nodes[id];
      return !others.some((o) => Math.abs(o.x - n.x) < 14 && Math.abs(o.z - n.z) < 14);
    };
    const grids = preferMajor ? [this.majorNodeGrid, this.nodeGrid] : [this.nodeGrid];
    for (const grid of grids) {
      const id = grid.randomWithin(x, z, minR, maxR, (nid) => this.adj[nid].some((e) => e.dist >= 8) && clear(nid));
      if (id < 0) continue;
      let outs = this.adj[id].filter((e) => e.dist >= 8);
      if (preferMajor) {
        const maj = outs.filter((e) => e.isMajor);
        if (maj.length > 0) outs = maj;
      }
      return { from: id, edge: outs[Math.floor(Math.random() * outs.length)] };
    }
    return null;
  }

  /** Moves a police car / rival rider onto a fresh edge near (x, z). Returns false when no road qualifies. */
  private respawnMovingUnit(
    u: PolicePatrolUnit | RivalRiderUnit,
    x: number,
    z: number,
    minR: number,
    maxR: number,
    preferMajor: boolean,
    laneFrac: number
  ): boolean {
    const pick = this.pickSpawnEdge(x, z, minR, maxR, preferMajor, u);
    if (!pick) return false;
    const { from, edge } = pick;
    u.fromNode = from;
    u.toNode = edge.to;
    u.edgeDist = edge.dist;
    u.edgeWidth = edge.width;
    // Stay close to the picked start node (<= 15m) so the unit really lands inside the requested ring
    u.progress = Math.min(edge.dist * 0.25, 15, Math.max(0, edge.dist - 0.2));
    u.blendX = 0;
    u.blendZ = 0;
    u.speed = u.cruiseSpeed * 0.7;
    const pose = this.computeEdgePose(from, edge.to, u.progress, edge.dist, edge.width, laneFrac);
    u.x = pose.x;
    u.z = pose.z;
    u.heading = pose.heading;
    u.group.position.set(u.x, 0, u.z);
    u.group.rotation.y = u.heading;
    return true;
  }

  /** Respawns police / rivals that drifted > HAZARD_RECYCLE_DISTANCE away to 120~250m from the player */
  public recycleMovingUnits(playerX: number, playerZ: number): number {
    const farSq = HAZARD_RECYCLE_DISTANCE * HAZARD_RECYCLE_DISTANCE;
    let moved = 0;
    const isFar = (u: { x: number; z: number }) =>
      (u.x - playerX) * (u.x - playerX) + (u.z - playerZ) * (u.z - playerZ) > farSq;
    this.patrolCars.forEach((p, i) => {
      if (!isFar(p)) return;
      if (this.respawnMovingUnit(p, playerX, playerZ, HAZARD_RESPAWN_MIN_RADIUS, HAZARD_RESPAWN_MAX_RADIUS, true, 0.25)) {
        p.sirenTimer = 0;
        this.patrolMarkers[i].x = p.x;
        this.patrolMarkers[i].z = p.z;
        this.patrolMarkers[i].heading = p.heading;
        this.patrolMarkers[i].sirenActive = false;
        moved++;
      }
    });
    this.rivalRiders.forEach((r, i) => {
      if (!isFar(r)) return;
      if (this.respawnMovingUnit(r, playerX, playerZ, HAZARD_RESPAWN_MIN_RADIUS, HAZARD_RESPAWN_MAX_RADIUS, false, 0.22)) {
        this.rivalRiderMarkers[i].x = r.x;
        this.rivalRiderMarkers[i].z = r.z;
        this.rivalRiderMarkers[i].heading = r.heading;
        moved++;
      }
    });
    this.recycledCount += moved;
    return moved;
  }

  private updateStaticPropVisibility(playerX: number, playerZ: number): void {
    const maxSq = STATIC_PROP_VISIBLE_DIST * STATIC_PROP_VISIBLE_DIST;
    for (const p of this.staticProps) {
      const dx = p.x - playerX;
      const dz = p.z - playerZ;
      p.group.visible = dx * dx + dz * dz <= maxSq;
    }
  }

  private computeEdgePose(
    fromId: number,
    toId: number,
    progress: number,
    edgeDist: number,
    edgeWidth: number,
    laneFrac = 0.25
  ): { x: number; z: number; heading: number } {
    const a = ACTIVE_MAP_DATA.nodes[fromId];
    const b = ACTIVE_MAP_DATA.nodes[toId];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.max(0.1, edgeDist);
    const fx = dx / len;
    const fz = dz / len;
    const rx = -fz;
    const rz = fx;
    const off = clamp(edgeWidth * laneFrac, 1.6, 3.3);
    const t = clamp(progress / len, 0, 1);
    return {
      x: a.x + dx * t + rx * off,
      z: a.z + dz * t + rz * off,
      heading: Math.atan2(fx, fz),
    };
  }

  private pickNextGraphEdge(fromNode: number, toNode: number, preferMajor: boolean): OsmAdjEdge {
    const outs = this.adj[toNode];
    const nodes = ACTIVE_MAP_DATA.nodes;
    const prev = nodes[fromNode];
    const cur = nodes[toNode];
    const inDx = cur.x - prev.x;
    const inDz = cur.z - prev.z;
    const inLen = Math.hypot(inDx, inDz) || 1;
    const inUx = inDx / inLen;
    const inUz = inDz / inLen;

    let cands = outs.filter((e) => e.to !== fromNode);
    if (preferMajor) {
      const maj = cands.filter((e) => e.isMajor);
      if (maj.length > 0) cands = maj;
    }
    if (cands.length === 0) cands = outs;

    const straight = cands.filter((e) => {
      const nb = nodes[e.to];
      const dx = nb.x - cur.x;
      const dz = nb.z - cur.z;
      const l = Math.hypot(dx, dz) || 1;
      return (dx / l) * inUx + (dz / l) * inUz > 0.4;
    });
    if (straight.length > 0 && Math.random() < 0.65) {
      return straight[Math.floor(Math.random() * straight.length)];
    }
    return cands[Math.floor(Math.random() * cands.length)];
  }

  private createCameraSignTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fef08a';
    ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, 246, 118);

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(62, 64, 40, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.font = '900 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('50', 62, 66);

    ctx.font = '900 26px sans-serif';
    ctx.fillStyle = '#b91c1c';
    ctx.fillText('과속·신호', 175, 48);
    ctx.fillStyle = '#0f172a';
    ctx.fillText('단속 중', 175, 84);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private buildSpeedCameras(): void {
    const nodes = ACTIVE_MAP_DATA.nodes;
    const majorEdges = ACTIVE_MAP_DATA.edges
      .filter((e) => e.isMajor && e.dist >= 26)
      .sort((a, b) => b.dist - a.dist);

    const poleMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.65, roughness: 0.35 });
    const housingMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.45 });
    const signMat = new THREE.MeshBasicMaterial({ map: this.createCameraSignTexture() });

    const { count: maxCameras, spacing: cameraSpacing } = this.placementLimits(CAMERA_RULE);
    for (const e of majorEdges) {
      if (this.cameras.length >= maxCameras) break;
      const na = nodes[e.a];
      const nb = nodes[e.b];
      const mx = (na.x + nb.x) * 0.5;
      const mz = (na.z + nb.z) * 0.5;
      if (this.cameras.some((c) => Math.hypot(c.x - mx, c.z - mz) < cameraSpacing)) continue;

      const angle = Math.atan2(nb.x - na.x, nb.z - na.z);
      const axis: 'ns' | 'ew' = Math.abs(Math.cos(angle)) >= Math.abs(Math.sin(angle)) ? 'ns' : 'ew';
      const id = `cam-${this.cameras.length + 1}`;
      const label = e.name ? `${e.name} 단속 구간` : `인계동 간선도로 단속 ${this.cameras.length + 1}`;

      const g = new THREE.Group();
      const rx = -Math.cos(angle);
      const rz = Math.sin(angle);
      const poleX = mx + rx * (e.width * 0.5 + 1.2);
      const poleZ = mz + rz * (e.width * 0.5 + 1.2);
      g.position.set(poleX, 0, poleZ);
      g.rotation.y = angle;

      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 6.1, 8), poleMat);
      pole.position.y = 3.05;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.14, 0.14), poleMat);
      arm.position.set(-2.1, 5.85, 0);
      const camBox = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.38, 0.68), housingMat);
      camBox.position.set(-3.4, 5.55, 0);
      const sign = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.7, 0.08), signMat);
      sign.position.set(-1.6, 5.42, 0);

      const ledMat = new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0xef4444,
        emissiveIntensity: 1.5,
      });
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), ledMat);
      led.position.set(-3.4, 5.55, 0.38);

      const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
      const flash = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), flashMat);
      flash.position.set(-3.4, 5.55, 0.4);

      g.add(pole, arm, camBox, sign, led, flash);
      this.root.add(g);
      this.registerStaticProp(g, mx, mz);

      this.cameras.push({
        id,
        label,
        x: mx,
        z: mz,
        axis,
        limitKmh: SPEED_CAMERA_LIMIT_KMH,
        ledMat,
        flashMat,
        flashTimer: 0,
        cooldown: 0,
        wasInZone: false,
      });
      this.cameraMarkers.push({ id, x: mx, z: mz, limitKmh: SPEED_CAMERA_LIMIT_KMH });
    }
  }

  private createParcelLogoTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#0ea5e9';
    ctx.fillRect(0, 0, 256, 30);
    ctx.fillStyle = '#0f172a';
    ctx.font = '900 38px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('K-택배', 128, 76);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private buildParkedHazards(): void {
    const nodes = ACTIVE_MAP_DATA.nodes;
    const spawn = ACTIVE_MAP_DATA.meta.scooterSpawn;
    const logoTex = this.createParcelLogoTexture();
    const cargoMat = new THREE.MeshStandardMaterial({ map: logoTex, roughness: 0.55 });
    const cabMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.42 });
    const sedanMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.4 });
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9 });

    const candidates = ACTIVE_MAP_DATA.edges
      .filter((e) => e.width >= 8.4 && e.dist >= 24)
      .sort((a, b) => b.dist - a.dist);

    const { count: maxParked, spacing: parkedSpacing } = this.placementLimits(PARKED_RULE);
    for (const e of candidates) {
      if (this.parkedHazards.length >= maxParked) break;
      if (this.isLargeMap && GRADE_SEPARATED_NAME.test(e.name)) continue;
      const na = nodes[e.a];
      const nb = nodes[e.b];
      const dx = nb.x - na.x;
      const dz = nb.z - na.z;
      const len = Math.hypot(dx, dz) || 1;
      const fx = dx / len;
      const fz = dz / len;
      const rx = -fz;
      const rz = fx;
      const heading = Math.atan2(fx, fz);

      const mx = (na.x + nb.x) * 0.5 + rx * (e.width * 0.5 - 1.35);
      const mz = (na.z + nb.z) * 0.5 + rz * (e.width * 0.5 - 1.35);

      if (Math.hypot(mx - spawn.x, mz - spawn.z) < 42) continue;
      if (this.cameras.some((c) => Math.hypot(c.x - mx, c.z - mz) < 28)) continue;
      if (this.parkedHazards.some((h) => Math.hypot(h.x - mx, h.z - mz) < parkedSpacing)) continue;

      const isTruck = this.parkedHazards.length % 2 === 0;
      const name = isTruck ? '불법주정차 K-택배 탑차' : '비상등 불법주정차 승용차';
      const g = new THREE.Group();
      g.position.set(mx, 0, mz);
      g.rotation.y = heading;

      const hazardMat = new THREE.MeshStandardMaterial({
        color: 0xd97706,
        emissive: 0xf59e0b,
        emissiveIntensity: 2.4,
      });

      if (isTruck) {
        const box = new THREE.Mesh(new THREE.BoxGeometry(2.05, 1.95, 3.35), cargoMat);
        box.position.set(0, 1.62, -0.55);
        box.castShadow = true;
        const cab = new THREE.Mesh(new THREE.BoxGeometry(1.92, 1.4, 1.45), cabMat);
        cab.position.set(0, 1.15, 1.78);
        g.add(box, cab);
      } else {
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.72, 4.2), sedanMat);
        body.position.set(0, 0.7, 0);
        body.castShadow = true;
        const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.58, 2.1), sedanMat);
        cabin.position.set(0, 1.3, -0.15);
        g.add(body, cabin);
      }

      for (const [wx, wz] of [
        [-0.92, 1.4],
        [0.92, 1.4],
        [-0.92, -1.4],
        [0.92, -1.4],
      ]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 10), tireMat);
        w.rotation.z = Math.PI / 2;
        w.position.set(wx, 0.34, wz);
        g.add(w);
      }

      for (const sx of [-0.82, 0.82]) {
        for (const sz of [-2.18, 2.2]) {
          const hz = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.08), hazardMat);
          hz.position.set(sx, 0.85, sz);
          g.add(hz);
        }
      }
      this.root.add(g);
      this.registerStaticProp(g, mx, mz);

      // Collision box
      this.obstacles.push({
        minX: mx - 1.35,
        maxX: mx + 1.35,
        minZ: mz - 1.35,
        maxZ: mz + 1.35,
      });

      // Blind-spot pop-out pedestrian darting into open lane from front of parked vehicle
      const popStartX = mx + fx * 2.6 + rx * 0.6;
      const popStartZ = mz + fz * 2.6 + rz * 0.6;
      const popOutX = popStartX - rx * 2.75;
      const popOutZ = popStartZ - rz * 2.75;
      const popRig = this.pedFactory.createPedestrian();
      popRig.root.visible = false;
      this.root.add(popRig.root);

      this.parkedHazards.push({
        id: `park-${this.parkedHazards.length + 1}`,
        name,
        x: mx,
        z: mz,
        heading,
        isTruck,
        hazardMat,
        popRig,
        popState: 'hidden',
        popStartX,
        popStartZ,
        popOutX,
        popOutZ,
        popX: popStartX,
        popZ: popStartZ,
        popHeading: 0,
        popTimer: 0,
        popCooldown: 0,
        popFallSide: 1,
      });
    }
  }

  private createPoliceSideTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 96;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 256, 96);
    ctx.fillStyle = '#1d4ed8';
    ctx.fillRect(0, 52, 256, 44);
    ctx.fillStyle = '#facc15';
    ctx.fillRect(0, 48, 256, 6);
    ctx.fillStyle = '#0f172a';
    ctx.font = '900 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('경기남부경찰', 128, 30);
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 26px sans-serif';
    ctx.fillText('POLICE 112', 128, 82);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private buildPolicePatrols(): void {
    const sideTex = this.createPoliceSideTexture();
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35, metalness: 0.2 });
    const sideMat = new THREE.MeshStandardMaterial({ map: sideTex, roughness: 0.35 });
    const blueHoodMat = new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.35 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.15, metalness: 0.6 });
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9 });

    const pool = this.majorNodeIds.length > 0 ? this.majorNodeIds : ACTIVE_MAP_DATA.nodes.map((n) => n.id);
    const labels = ['경기남부청 인계지구대 1호차', '수원남부서 효원로 순찰차'];

    for (let i = 0; i < 2; i++) {
      const startNode = pool[Math.floor((i * pool.length) / 2) % pool.length];
      const outs = this.adj[startNode];
      const chosen = outs.find((e) => e.isMajor) ?? outs[0];
      if (!chosen) continue;

      const g = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(1.92, 0.72, 4.32),
        [sideMat, sideMat, whiteMat, whiteMat, blueHoodMat, blueHoodMat]
      );
      body.position.y = 0.7;
      body.castShadow = true;
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.58, 2.2), whiteMat);
      cabin.position.set(0, 1.32, -0.14);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.44, 2.0), glassMat);
      glass.position.set(0, 1.32, -0.14);

      const redBarMat = new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0xef4444,
        emissiveIntensity: 2.5,
      });
      const blueBarMat = new THREE.MeshStandardMaterial({
        color: 0x3b82f6,
        emissive: 0x3b82f6,
        emissiveIntensity: 0.2,
      });
      const redBar = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.16, 0.28), redBarMat);
      redBar.position.set(-0.32, 1.7, -0.1);
      const blueBar = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.16, 0.28), blueBarMat);
      blueBar.position.set(0.32, 1.7, -0.1);

      for (const [wx, wz] of [
        [-0.92, 1.3],
        [0.92, 1.3],
        [-0.92, -1.3],
        [0.92, -1.3],
      ]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 10), tireMat);
        w.rotation.z = Math.PI / 2;
        w.position.set(wx, 0.34, wz);
        g.add(w);
      }
      g.add(body, cabin, glass, redBar, blueBar);

      const pose = this.computeEdgePose(startNode, chosen.to, chosen.dist * 0.4, chosen.dist, chosen.width);
      g.position.set(pose.x, 0, pose.z);
      g.rotation.y = pose.heading;
      this.root.add(g);

      const id = `patrol-${i + 1}`;
      this.patrolCars.push({
        id,
        label: labels[i],
        group: g,
        redBarMat,
        blueBarMat,
        fromNode: startNode,
        toNode: chosen.to,
        edgeDist: chosen.dist,
        edgeWidth: chosen.width,
        progress: chosen.dist * 0.4,
        x: pose.x,
        z: pose.z,
        heading: pose.heading,
        speed: 9.2,
        cruiseSpeed: 9.6,
        sirenTimer: 0,
        citeCooldown: 0,
        blendX: 0,
        blendZ: 0,
      });
      this.patrolMarkers.push({
        id,
        x: pose.x,
        z: pose.z,
        heading: pose.heading,
        sirenActive: false,
      });
    }
  }

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
    ctx.fillRect(14, 14, 228, 76);
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

  private buildConstructionZones(): void {
    const nodes = ACTIVE_MAP_DATA.nodes;
    const spawn = ACTIVE_MAP_DATA.meta.scooterSpawn;
    const coneOrangeMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.45 });
    const coneStripeMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, emissive: 0xffffff, emissiveIntensity: 0.2 });
    const coneBaseMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });
    const dirtMat = new THREE.MeshStandardMaterial({ color: 0x5c4738, roughness: 0.96 });
    const signMat = new THREE.MeshBasicMaterial({ map: this.createConstructionSignTexture() });

    const coneGeo = new THREE.ConeGeometry(0.22, 0.72, 10);
    const bandGeo = new THREE.CylinderGeometry(0.11, 0.16, 0.14, 10);
    const baseGeo = new THREE.BoxGeometry(0.46, 0.06, 0.46);

    const candidates = ACTIVE_MAP_DATA.edges
      .filter((e) => e.isMajor && e.dist >= 32)
      .sort((a, b) => b.dist - a.dist);

    const { count: maxZones, spacing: zoneSpacing } = this.placementLimits(CONSTRUCTION_RULE);
    for (const e of candidates) {
      if (this.constructionZones.length >= maxZones) break;
      if (this.isLargeMap && GRADE_SEPARATED_NAME.test(e.name)) continue;
      const na = nodes[e.a];
      const nb = nodes[e.b];
      const dx = nb.x - na.x;
      const dz = nb.z - na.z;
      const len = Math.hypot(dx, dz) || 1;
      const rx = -dz / len;
      const rz = dx / len;
      const heading = Math.atan2(dx, dz);

      const cx = (na.x + nb.x) * 0.5 + rx * (e.width * 0.5 - 1.5);
      const cz = (na.z + nb.z) * 0.5 + rz * (e.width * 0.5 - 1.5);

      if (Math.hypot(cx - spawn.x, cz - spawn.z) < 55) continue;
      if (this.cameras.some((c) => Math.hypot(c.x - cx, c.z - cz) < 35)) continue;
      if (this.parkedHazards.some((h) => Math.hypot(h.x - cx, h.z - cz) < 35)) continue;
      if (this.constructionZones.some((z) => Math.hypot(z.x - cx, z.z - cz) < zoneSpacing)) continue;

      const g = new THREE.Group();
      g.position.set(cx, 0, cz);
      g.rotation.y = heading;

      const patch = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 6.2), dirtMat);
      patch.position.set(0, 0.04, 0);
      g.add(patch);

      for (const [ox, oz] of [
        [-0.7, -4.4],
        [-1.3, -2.4],
        [-1.3, 0],
        [-1.3, 2.4],
        [-0.7, 4.4],
      ]) {
        const b = new THREE.Mesh(baseGeo, coneBaseMat);
        b.position.set(ox, 0.04, oz);
        const c = new THREE.Mesh(coneGeo, coneOrangeMat);
        c.position.set(ox, 0.41, oz);
        const bd = new THREE.Mesh(bandGeo, coneStripeMat);
        bd.position.set(ox, 0.48, oz);
        g.add(b, c, bd);
      }

      const board = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.92, 0.12), signMat);
      board.position.set(0, 0.72, -3.5);
      const strobeMat = new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        emissive: 0xf59e0b,
        emissiveIntensity: 3.0,
      });
      const strobe = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.22, 10), strobeMat);
      strobe.position.set(0, 1.32, -3.5);
      g.add(board, strobe);
      this.root.add(g);
      this.registerStaticProp(g, cx, cz);

      this.obstacles.push({
        minX: cx - 1.5,
        maxX: cx + 1.5,
        minZ: cz - 1.5,
        maxZ: cz + 1.5,
      });

      const id = `const-${this.constructionZones.length + 1}`;
      const label = e.name ? `${e.name} 공사구간` : `인계동 도로 공사구간 ${this.constructionZones.length + 1}`;
      this.constructionZones.push({ id, label, x: cx, z: cz, strobeMat });
      this.constructionMarkers.push({ id, x: cx, z: cz, label });
    }
  }

  private buildRivalRiders(): void {
    const styles: Array<[number, string, number, number]> = [
      [0x14b8a6, '#14b8a6', 0x0f766e, 11.4],
      [0xf97316, '#f97316', 0xc2410c, 12.1],
      [0x3b82f6, '#3b82f6', 0x1d4ed8, 10.9],
      [0xeab308, '#eab308', 0x334155, 11.7],
    ];

    const tireMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4, metalness: 0.3 });
    const helmetMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.25 });
    const visorMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.15, metalness: 0.6 });
    const headLightMat = new THREE.MeshStandardMaterial({ color: 0xfef9c3, emissive: 0xfef08a, emissiveIntensity: 2.2 });
    const tailLightMat = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 1.8 });

    const pool = this.majorNodeIds.length > 0 ? this.majorNodeIds : ACTIVE_MAP_DATA.nodes.map((n) => n.id);

    styles.forEach(([boxHex, colorCss, jacketHex, cruiseSpeed], idx) => {
      const startNode = pool[Math.floor((idx * pool.length) / styles.length + 3) % pool.length];
      const outs = this.adj[startNode];
      const chosen = outs[0];
      if (!chosen) return;

      const g = new THREE.Group();
      const boxMat = new THREE.MeshStandardMaterial({ color: boxHex, roughness: 0.4 });
      const jacketMat = new THREE.MeshStandardMaterial({ color: jacketHex, roughness: 0.78 });

      for (const wz of [-0.62, 0.62]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.14, 10), tireMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(0, 0.26, wz);
        g.add(wheel);
      }
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.42, 1.38), frameMat);
      body.position.set(0, 0.56, 0);
      const front = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.28), frameMat);
      front.position.set(0, 0.84, 0.55);
      const topBox = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.5, 0.52), boxMat);
      topBox.position.set(0, 1.05, -0.58);
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.05), headLightMat);
      hl.position.set(0, 0.94, 0.7);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.05), tailLightMat);
      tl.position.set(0, 0.74, -0.72);
      const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.54, 0.28), jacketMat);
      torso.position.set(0, 1.15, -0.02);
      const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), helmetMat);
      helmet.position.set(0, 1.56, 0.04);
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, 0.12), visorMat);
      visor.position.set(0, 1.56, 0.16);
      g.add(body, front, topBox, hl, tl, torso, helmet, visor);

      const pose = this.computeEdgePose(startNode, chosen.to, chosen.dist * 0.3, chosen.dist, chosen.width, 0.22);
      g.position.set(pose.x, 0, pose.z);
      g.rotation.y = pose.heading;
      this.root.add(g);

      const id = `rival-${idx + 1}`;
      this.rivalRiders.push({
        id,
        group: g,
        color: colorCss,
        fromNode: startNode,
        toNode: chosen.to,
        edgeDist: chosen.dist,
        edgeWidth: chosen.width,
        progress: chosen.dist * 0.3,
        x: pose.x,
        z: pose.z,
        heading: pose.heading,
        speed: cruiseSpeed,
        cruiseSpeed,
        blendX: 0,
        blendZ: 0,
      });
      this.rivalRiderMarkers.push({
        id,
        x: pose.x,
        z: pose.z,
        heading: pose.heading,
        color: colorCss,
      });
    });
  }

  public step(
    dt: number,
    elapsedTime: number,
    inCorridor: boolean,
    scooter: ScooterProximityInfo,
    signalState: SignalStateSnapshot,
    onSpeedCameraTriggered?: (ev: SpeedCameraTriggerEvent) => void,
    onPopOutWarning?: (ev: PopOutWarningEvent) => void,
    onPopOutPedestrianHit?: (ev: PedestrianCollisionEvent) => void,
    onCameraApproachBeep?: (isOverSpeed: boolean) => void,
    onPolicePatrolCite?: (ev: SpeedCameraTriggerEvent) => void,
    /** On-foot player position (defaults to the scooter); moving units / prop culling follow it */
    playerPos?: { x: number; z: number }
  ): void {
    if (inCorridor) {
      this.upcomingCamera = null;
      return;
    }

    const clampedDt = Math.min(dt, 0.05);
    const playerX = playerPos?.x ?? scooter.x;
    const playerZ = playerPos?.z ?? scooter.z;

    // Open world: keep police / rivals around the player and hide far-away static props
    this.recycleTimer += clampedDt;
    if (this.recycleTimer >= HAZARD_RECYCLE_INTERVAL_SEC) {
      this.recycleTimer = 0;
      this.recycleMovingUnits(playerX, playerZ);
    }
    if (this.staticProps.length > 0) {
      this.staticVisTimer += clampedDt;
      if (this.staticVisTimer >= STATIC_VISIBILITY_INTERVAL_SEC) {
        this.staticVisTimer = 0;
        this.updateStaticPropVisibility(playerX, playerZ);
      }
    }
    const speedKmh = Math.abs(scooter.speedMps) * 3.6;
    const scFwdX = Math.sin(scooter.heading);
    const scFwdZ = Math.cos(scooter.heading);
    const blinkOn = Math.floor(elapsedTime * 3.2) % 2 === 0;
    const nodes = ACTIVE_MAP_DATA.nodes;

    // --- 1. Fixed Speed & Red-Light Enforcement Cameras + 80m Navi Warning ---
    let closestCam: UpcomingCameraAlert | null = null;
    let closestCamDist = SPEED_CAMERA_WARN_DIST;

    for (const cam of this.cameras) {
      if (cam.cooldown > 0) cam.cooldown = Math.max(0, cam.cooldown - clampedDt);
      if (cam.flashTimer > 0) {
        cam.flashTimer = Math.max(0, cam.flashTimer - clampedDt);
        cam.flashMat.opacity = clamp(cam.flashTimer / 0.25, 0, 1);
      }
      cam.ledMat.emissiveIntensity = blinkOn ? 2.8 : 0.6;

      const toCamX = cam.x - scooter.x;
      const toCamZ = cam.z - scooter.z;
      const dist = Math.hypot(toCamX, toCamZ);

      if (scooter.isRiding && !scooter.crashed && dist > 6 && dist <= closestCamDist) {
        const align = (toCamX * scFwdX + toCamZ * scFwdZ) / dist;
        if (align > 0.62) {
          closestCamDist = dist;
          closestCam = {
            cameraId: cam.id,
            label: cam.label,
            distanceMeters: Math.round(dist),
            limitKmh: cam.limitKmh,
            isOverSpeed: speedKmh > cam.limitKmh + SPEED_CAMERA_GRACE_KMH,
          };
        }
      }

      const inZone = dist <= 8.5;
      if (inZone && !cam.wasInZone && cam.cooldown <= 0 && scooter.isRiding && !scooter.crashed) {
        // Speed cameras sit mid-block on major edges (never at a stop line), so they only enforce speed.
        // Red-light violations are judged at the intersection itself by TrafficSystem.
        const isSpeeding = speedKmh > cam.limitKmh + SPEED_CAMERA_GRACE_KMH;
        if (isSpeeding) {
          cam.cooldown = 14.0;
          cam.flashTimer = 0.28;
          onSpeedCameraTriggered?.({
            cameraId: cam.id,
            label: cam.label,
            kind: 'speeding',
            measuredKmh: Math.round(speedKmh),
            limitKmh: cam.limitKmh,
            fine: SPEED_CAMERA_FINE,
          });
        }
      }
      cam.wasInZone = inZone;
    }

    this.upcomingCamera = closestCam;
    if (this.overSpeedBeepTimer > 0) this.overSpeedBeepTimer = Math.max(0, this.overSpeedBeepTimer - clampedDt);
    if (closestCam) {
      if (closestCam.cameraId !== this.lastWarnedCameraId) {
        this.lastWarnedCameraId = closestCam.cameraId;
        onCameraApproachBeep?.(closestCam.isOverSpeed);
        this.overSpeedBeepTimer = 1.6;
      } else if (closestCam.isOverSpeed && this.overSpeedBeepTimer <= 0) {
        onCameraApproachBeep?.(true);
        this.overSpeedBeepTimer = 1.4;
      }
    } else {
      this.lastWarnedCameraId = null;
    }

    // --- 2. Patrolling Police Cars (Graph Walking + Live >60km/h Enforcement!) ---
    const policeBlink = Math.floor(elapsedTime * 7.0) % 2 === 0;
    for (let pi = 0; pi < this.patrolCars.length; pi++) {
      const p = this.patrolCars[pi];
      if (p.citeCooldown > 0) p.citeCooldown = Math.max(0, p.citeCooldown - clampedDt);
      if (p.sirenTimer > 0) p.sirenTimer = Math.max(0, p.sirenTimer - clampedDt);

      p.redBarMat.emissiveIntensity = policeBlink ? (p.sirenTimer > 0 ? 4.5 : 2.6) : 0.15;
      p.blueBarMat.emissiveIntensity = !policeBlink ? (p.sirenTimer > 0 ? 4.5 : 2.6) : 0.15;

      const fx = Math.sin(p.heading);
      const fz = Math.cos(p.heading);
      const targetNode = nodes[p.toNode];
      const distToNode = Math.max(0, p.edgeDist - p.progress);

      let mustStop = false;
      let signalCap = Infinity;
      if (targetNode.isSignal) {
        const d = edgeDirection(p.fromNode, p.toNode);
        const sig = getSignalAxis(p.toNode, d.fx, d.fz) === 'ns' ? signalState.ns : signalState.ew;
        signalCap = signalSpeedCap(p.speed, distToNode - SIGNAL_STOP_LINE_OFFSET, sig);
      }

      const toRiderX = scooter.x - p.x;
      const toRiderZ = scooter.z - p.z;
      const distRider = Math.hypot(toRiderX, toRiderZ);
      const aheadDot = distRider > 0.1 ? (toRiderX * fx + toRiderZ * fz) / distRider : 0;
      if (distRider < 6.8 && aheadDot > 0.72) mustStop = true;

      const targetSpd = mustStop ? 0 : Math.min(p.cruiseSpeed, signalCap);
      const braking = targetSpd < p.speed;
      p.speed += (targetSpd - p.speed) * Math.min(1, clampedDt * (braking ? 8 : 3.5));
      const pTravel = p.speed * clampedDt;
      p.progress += pTravel;
      const pDecay = laneBlendDecay(pTravel);
      p.blendX *= pDecay;
      p.blendZ *= pDecay;

      if (p.progress >= p.edgeDist) {
        const nextEd = this.pickNextGraphEdge(p.fromNode, p.toNode, true);
        const carry = p.progress - p.edgeDist;
        p.fromNode = p.toNode;
        p.toNode = nextEd.to;
        p.edgeDist = nextEd.dist;
        p.edgeWidth = nextEd.width;
        p.progress = Math.min(carry, Math.max(0, p.edgeDist - 0.2));
        const np = this.computeEdgePose(p.fromNode, p.toNode, p.progress, p.edgeDist, p.edgeWidth);
        p.blendX = p.x - np.x;
        p.blendZ = p.z - np.z;
      }

      const pose = this.computeEdgePose(p.fromNode, p.toNode, p.progress, p.edgeDist, p.edgeWidth);
      p.x = pose.x + p.blendX;
      p.z = pose.z + p.blendZ;
      p.heading = wrapAngle(p.heading + wrapAngle(pose.heading - p.heading) * Math.min(1, clampedDt * 8));
      p.group.position.set(p.x, 0, p.z);
      p.group.rotation.y = p.heading;

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

      this.patrolMarkers[pi].x = p.x;
      this.patrolMarkers[pi].z = p.z;
      this.patrolMarkers[pi].heading = p.heading;
      this.patrolMarkers[pi].sirenActive = p.sirenTimer > 0;
    }

    // --- 3. Construction Strobes & Rival AI Delivery Scooters ---
    for (const cz of this.constructionZones) {
      cz.strobeMat.emissiveIntensity = blinkOn ? 3.8 : 0.25;
    }

    for (let ri = 0; ri < this.rivalRiders.length; ri++) {
      const r = this.rivalRiders[ri];
      const fx = Math.sin(r.heading);
      const fz = Math.cos(r.heading);
      const targetNode = nodes[r.toNode];
      const distToNode = Math.max(0, r.edgeDist - r.progress);

      let mustStop = false;
      let signalCap = Infinity;
      if (targetNode.isSignal) {
        const d = edgeDirection(r.fromNode, r.toNode);
        const sig = getSignalAxis(r.toNode, d.fx, d.fz) === 'ns' ? signalState.ns : signalState.ew;
        signalCap = signalSpeedCap(r.speed, distToNode - SIGNAL_STOP_LINE_OFFSET, sig);
      }

      const toPlX = scooter.x - r.x;
      const toPlZ = scooter.z - r.z;
      const distPl = Math.hypot(toPlX, toPlZ);
      const aheadDot = distPl > 0.1 ? (toPlX * fx + toPlZ * fz) / distPl : 0;
      if (distPl < 5.2 && aheadDot > 0.72) mustStop = true;

      const targetSpd = mustStop ? 0 : Math.min(r.cruiseSpeed, signalCap);
      const rBraking = targetSpd < r.speed;
      r.speed += (targetSpd - r.speed) * Math.min(1, clampedDt * (rBraking ? 9 : 4.2));
      const rTravel = r.speed * clampedDt;
      r.progress += rTravel;
      const rDecay = laneBlendDecay(rTravel);
      r.blendX *= rDecay;
      r.blendZ *= rDecay;

      if (r.progress >= r.edgeDist) {
        const nextEd = this.pickNextGraphEdge(r.fromNode, r.toNode, false);
        const carry = r.progress - r.edgeDist;
        r.fromNode = r.toNode;
        r.toNode = nextEd.to;
        r.edgeDist = nextEd.dist;
        r.edgeWidth = nextEd.width;
        r.progress = Math.min(carry, Math.max(0, r.edgeDist - 0.2));
        const np = this.computeEdgePose(r.fromNode, r.toNode, r.progress, r.edgeDist, r.edgeWidth, 0.22);
        r.blendX = r.x - np.x;
        r.blendZ = r.z - np.z;
      }

      const pose = this.computeEdgePose(r.fromNode, r.toNode, r.progress, r.edgeDist, r.edgeWidth, 0.22);
      r.x = pose.x + r.blendX;
      r.z = pose.z + r.blendZ;
      r.heading = wrapAngle(r.heading + wrapAngle(pose.heading - r.heading) * Math.min(1, clampedDt * 9));
      r.group.position.set(r.x, 0, r.z);
      r.group.rotation.y = r.heading;

      this.rivalRiderMarkers[ri].x = r.x;
      this.rivalRiderMarkers[ri].z = r.z;
      this.rivalRiderMarkers[ri].heading = r.heading;
    }

    // --- 4. Double-Parked Hazard Blinkers & Blind-Spot Pop-Out Pedestrians ---
    if (this.globalPopOutCooldown > 0) {
      this.globalPopOutCooldown = Math.max(0, this.globalPopOutCooldown - clampedDt);
    }

    const canHitPopOut =
      scooter.isRiding && !scooter.crashed && speedKmh >= PEDESTRIAN_COLLISION_MIN_KMH;

    for (const h of this.parkedHazards) {
      h.hazardMat.emissiveIntensity = blinkOn ? 2.8 : 0.12;
      if (h.popCooldown > 0) h.popCooldown = Math.max(0, h.popCooldown - clampedDt);

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
}
