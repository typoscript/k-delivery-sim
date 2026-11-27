import * as THREE from 'three';
import { excludeFromMirrors, freezeStatic } from './renderLayers';
import { buildInstanced, mergeColoredParts, placeMatrix } from './instancing';
import { BusStopPoint, ObstacleBox, clamp, wrapAngle } from '../types';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import {
  SIGNAL_STOP_LINE_OFFSET,
  edgeDirection,
  getSignalAxis,
  laneBlendDecay,
  signalSpeedCap,
} from './TrafficRules';

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

interface OsmAdjEdge {
  to: number;
  dist: number;
  width: number;
  isMajor: boolean;
}

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
  fromNode: number;
  toNode: number;
  edgeDist: number;
  edgeWidth: number;
  progress: number; // 0..edgeDist along edge
  x: number;
  z: number;
  heading: number;
  speed: number;
  cruiseSpeed: number;
  braking: boolean;
  busStopWaitTimer: number;
  busStopCooldown: number;
  playerCutInActive: boolean;
  hornCooldown: number;
  colorHex: string;
  halfWidth: number;
  halfLength: number;
  /** Next edge pre-picked on approach so short follow-on edges into a signal can be braked for early */
  nextEdge: OsmAdjEdge | null;
  /** Lateral lane-offset jump at the last node, blended out over distance travelled (no teleport at turns) */
  blendX: number;
  blendZ: number;
  /** Cross-traffic deadlock breaker state */
  stuckTimer: number;
  blockedBy: number;
  ignoreIdx: number;
  ignoreTimer: number;
}

/** Collision circles (as square AABBs of half-size = halfWidth) placed along the body axis */
const CAR_SEGMENTS = [-1.19, 0, 1.19];
const BUS_SEGMENTS = [-3.1, -1.55, 0, 1.55, 3.1];
const STUCK_YIELD_SEC = 2.0;
const IGNORE_BLOCKER_SEC = 3.0;
const PLAYER_COLLISION_PAD = 0.6;
const SIGNAL_LOOKAHEAD = 32;

const CYCLE_DURATION = 18.0;
const FRONT_RAY_RANGE = 12.5;
const SAFE_FOLLOW_GAP = 5.2;
const ACTIVE_SPAWN_RADIUS = 165.0;

/**
 * General OpenStreetMap Graph Traffic AI System for Suwon Ingye-dong!
 * - Builds 3-color traffic signal poles at all 24 real Suwon signalized intersections
 * - Drives 24 stylized low-poly sedans, Suwon/Gyeonggi taxis, & Suwon City Buses along real OSM edges
 *   with right-hand lane offsets (`right = (-fz, 0, fx)`), smooth junction transitions,
 *   12m forward collision avoidance raycasting, red-light stopping, and bus-stop dwells!
 */
export class TrafficSystem {
  public readonly root = new THREE.Group();
  private readonly vehicles: AiVehicle[] = [];
  private readonly busStops: BusStopPoint[];
  private readonly adj: OsmAdjEdge[][];
  private readonly majorNodeIds: number[] = [];

  private readonly nsRedMat: THREE.MeshStandardMaterial;
  private readonly nsYellowMat: THREE.MeshStandardMaterial;
  private readonly nsGreenMat: THREE.MeshStandardMaterial;
  private readonly ewRedMat: THREE.MeshStandardMaterial;
  private readonly ewYellowMat: THREE.MeshStandardMaterial;
  private readonly ewGreenMat: THREE.MeshStandardMaterial;

  public signalState: SignalStateSnapshot = { ns: 'green', ew: 'red', remainingSec: 6.5 };

  private prevPlayerX = ACTIVE_MAP_DATA.meta.scooterSpawn.x;
  private prevPlayerZ = ACTIVE_MAP_DATA.meta.scooterSpawn.z;
  private violationCooldown = 0;
  private recycleTimer = 0;

  private readonly frontRay = new THREE.Ray();
  private readonly rayHitPoint = new THREE.Vector3();
  private readonly tmpBox = new THREE.Box3();
  private readonly tmpMin = new THREE.Vector3();
  private readonly tmpMax = new THREE.Vector3();


  private readonly carWheelGeo: THREE.CylinderGeometry;
  private readonly carRimGeo: THREE.CylinderGeometry;
  private readonly carWheelMergedGeo: THREE.BufferGeometry;
  private readonly carWheelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.25 });

  constructor(scene: THREE.Scene, busStops: BusStopPoint[]) {
    this.busStops = busStops;
    scene.add(this.root);

    const nodes = ACTIVE_MAP_DATA.nodes;
    this.adj = Array.from({ length: nodes.length }, () => []);
    for (const e of ACTIVE_MAP_DATA.edges) {
      this.adj[e.a].push({ to: e.b, dist: e.dist, width: e.width, isMajor: e.isMajor });
      this.adj[e.b].push({ to: e.a, dist: e.dist, width: e.width, isMajor: e.isMajor });
    }
    for (const n of nodes) {
      if (this.adj[n.id].some((ed) => ed.isMajor)) {
        this.majorNodeIds.push(n.id);
      }
    }

    this.carWheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.22, 10);
    this.carWheelGeo.rotateZ(Math.PI / 2);
    this.carRimGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.24, 8);
    this.carRimGeo.rotateZ(Math.PI / 2);
    const identity = new THREE.Matrix4();
    this.carWheelMergedGeo = mergeColoredParts([
      { geometry: this.carWheelGeo, matrix: identity, color: 0x111827 },
      { geometry: this.carRimGeo, matrix: identity, color: 0xcbd5e1 },
    ]);

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
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.45, metalness: 0.65 });
    const housingMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.55 });
    const poleGeo = new THREE.CylinderGeometry(0.1, 0.13, 5.4, 7);
    const armGeo = new THREE.BoxGeometry(0.12, 0.12, 3.6);
    const boxGeo = new THREE.BoxGeometry(1.5, 0.48, 0.26);
    const lampGeo = new THREE.CircleGeometry(0.14, 10);

    // Every gantry part is ONE InstancedMesh for the whole city (was ~11 meshes per gantry,
    // 940 gantries): pole, arm, housing and the 3 lamp colours per signal phase.
    const poleM: THREE.Matrix4[] = [];
    const armM: THREE.Matrix4[] = [];
    const boxM: THREE.Matrix4[] = [];
    const lampM = { ns: [[], [], []] as THREE.Matrix4[][], ew: [[], [], []] as THREE.Matrix4[][] };
    const flip = new THREE.Matrix4().makeRotationY(Math.PI);
    for (const n of ACTIVE_MAP_DATA.nodes) {
      if (!n.isSignal) continue;
      // Place 2 diagonal corner signal gantries at each signalized Suwon intersection
      const corners: Array<[number, number, number, boolean]> = [
        [n.x + 7.2, n.z + 7.2, 0, true],
        [n.x - 7.2, n.z - 7.2, Math.PI / 2, false],
      ];
      for (const [cx, cz, rotY, isNS] of corners) {
        const base = placeMatrix(cx, 0, cz, rotY);
        poleM.push(base.clone().multiply(new THREE.Matrix4().makeTranslation(0, 2.7, 0)));
        armM.push(base.clone().multiply(new THREE.Matrix4().makeTranslation(0, 5.2, -1.7)));
        boxM.push(base.clone().multiply(new THREE.Matrix4().makeTranslation(0, 5.15, -3.1)));
        const lamps = isNS ? lampM.ns : lampM.ew;
        for (const faceDir of [-1, 1]) {
          const zOff = -3.1 + faceDir * 0.14;
          [-0.46, 0, 0.46].forEach((lx, ci) => {
            const local = new THREE.Matrix4().makeTranslation(lx, 5.15, zOff);
            if (faceDir < 0) local.multiply(flip);
            lamps[ci].push(base.clone().multiply(local));
          });
        }
      }
    }
    const parts: THREE.InstancedMesh[] = [
      buildInstanced(poleGeo, poleMat, poleM),
      buildInstanced(armGeo, poleMat, armM),
      buildInstanced(boxGeo, housingMat, boxM),
      buildInstanced(lampGeo, this.nsRedMat, lampM.ns[0]),
      buildInstanced(lampGeo, this.nsYellowMat, lampM.ns[1]),
      buildInstanced(lampGeo, this.nsGreenMat, lampM.ns[2]),
      buildInstanced(lampGeo, this.ewRedMat, lampM.ew[0]),
      buildInstanced(lampGeo, this.ewYellowMat, lampM.ew[1]),
      buildInstanced(lampGeo, this.ewGreenMat, lampM.ew[2]),
    ];
    parts[0].castShadow = true;
    for (const m of parts) {
      excludeFromMirrors(m);
      this.root.add(m);
      freezeStatic(m);
    }
  }

  private createVehicleMesh(
    bodyHex: number,
    isBus: boolean,
    isTaxi: boolean
  ): {
    group: THREE.Group;
    wheels: THREE.Object3D[];
    brakeMat: THREE.MeshStandardMaterial;
    headlightMat: THREE.MeshStandardMaterial;
    hazardMat?: THREE.MeshStandardMaterial;
    taxiCapMat?: THREE.MeshStandardMaterial;
  } {
    const group = new THREE.Group();
    const wheels: THREE.Object3D[] = [];
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.15, metalness: 0.55 });
    const brakeMat = new THREE.MeshStandardMaterial({
      color: 0x991b1b,
      emissive: 0xef4444,
      emissiveIntensity: 0.4,
    });
    const headlightMat = new THREE.MeshStandardMaterial({
      color: 0xfef9c3,
      emissive: 0xfef08a,
      emissiveIntensity: 1.0,
    });

    if (isBus) {
      // Classic Gyeonggi/Suwon Green-Blue City Bus!
      const busMat = new THREE.MeshStandardMaterial({ color: 0x059669, roughness: 0.42, metalness: 0.18 });
      const stripeMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.48, 2.55, 8.6), busMat);
      body.position.y = 1.62;
      body.castShadow = true;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.52, 0.34, 8.64), stripeMat);
      stripe.position.y = 1.25;
      const win = new THREE.Mesh(new THREE.BoxGeometry(2.51, 0.95, 7.6), glassMat);
      win.position.y = 2.15;
      const hl = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.24, 0.08), headlightMat);
      hl.position.set(0, 0.85, 4.32);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.28, 0.08), brakeMat);
      tl.position.set(0, 0.95, -4.32);

      const hazardMat = new THREE.MeshStandardMaterial({
        color: 0xd97706,
        emissive: 0xf59e0b,
        emissiveIntensity: 0.1,
      });
      for (const sx of [-1.05, 1.05]) {
        const hz = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.22, 0.09), hazardMat);
        hz.position.set(sx, 0.95, -4.33);
        group.add(hz);
      }

      for (const [wx, wz] of [
        [-1.18, 2.7],
        [1.18, 2.7],
        [-1.18, -2.6],
        [1.18, -2.6],
      ]) {
        const wg = new THREE.Group();
        wg.position.set(wx, 0.42, wz);
        const w = new THREE.Mesh(this.carWheelGeo, tireMat);
        w.scale.set(1.2, 1.2, 1.2);
        wg.add(w);
        group.add(wg);
        wheels.push(wg);
      }
      group.add(body, stripe, win, hl, tl);
      return { group, wheels, brakeMat, headlightMat, hazardMat };
    }

    const bodyMat = new THREE.MeshStandardMaterial({ color: bodyHex, roughness: 0.36, metalness: 0.28 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.68, 4.24), bodyMat);
    body.position.y = 0.68;
    body.castShadow = true;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.58, 2.16), bodyMat);
    cabin.position.set(0, 1.28, -0.14);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.44, 1.98), glassMat);
    glass.position.set(0, 1.28, -0.14);

    const hlL = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.16, 0.06), headlightMat);
    hlL.position.set(-0.62, 0.72, 2.13);
    const hlR = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.16, 0.06), headlightMat);
    hlR.position.set(0.62, 0.72, 2.13);

    const tl = new THREE.Mesh(new THREE.BoxGeometry(1.64, 0.16, 0.06), brakeMat);
    tl.position.set(0, 0.76, -2.13);

    let taxiCapMat: THREE.MeshStandardMaterial | undefined;
    if (isTaxi) {
      taxiCapMat = new THREE.MeshStandardMaterial({
        color: 0xfef08a,
        emissive: 0xfacc15,
        emissiveIntensity: 1.6,
      });
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.2, 0.26), taxiCapMat);
      cap.position.set(0, 1.66, -0.05);
      group.add(cap);
    }

    for (const [wx, wz] of [
      [-0.9, 1.28],
      [0.9, 1.28],
      [-0.9, -1.28],
      [0.9, -1.28],
    ]) {
      const wg = new THREE.Group();
      wg.position.set(wx, 0.34, wz);
      // Tire + rim baked into one vertex-coloured mesh: 1 draw call per wheel instead of 2
      wg.add(new THREE.Mesh(this.carWheelMergedGeo, this.carWheelMat));
      group.add(wg);
      wheels.push(wg);
    }

    group.add(body, cabin, glass, hlL, hlR, tl);
    return { group, wheels, brakeMat, headlightMat, taxiCapMat };
  }

  private computeVehicleWorldPose(
    fromId: number,
    toId: number,
    progress: number,
    edgeDist: number,
    edgeWidth: number
  ): { x: number; z: number; heading: number } {
    const a = ACTIVE_MAP_DATA.nodes[fromId];
    const b = ACTIVE_MAP_DATA.nodes[toId];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.max(0.1, edgeDist);
    const fx = dx / len;
    const fz = dz / len;
    // Right-hand lane offset per AGENTS.md: right = forward x up = (-fz, 0, fx)
    const rx = -fz;
    const rz = fx;
    const laneOffset = clamp(edgeWidth * 0.25, 1.8, 3.3);

    const t = clamp(progress / len, 0, 1);
    return {
      x: a.x + dx * t + rx * laneOffset,
      z: a.z + dz * t + rz * laneOffset,
      heading: Math.atan2(fx, fz),
    };
  }

  private spawnTrafficVehicles(): void {
    const palette: Array<[number, string, boolean]> = [
      [0xf8fafc, '#f8fafc', false],
      [0x94a3b8, '#94a3b8', false],
      [0x1e293b, '#1e293b', false],
      [0x3b82f6, '#3b82f6', false],
      [0xf97316, '#f97316', true], // Taxi!
      [0xe2e8f0, '#e2e8f0', true], // Silver Suwon Taxi!
      [0xef4444, '#ef4444', false],
      [0x64748b, '#64748b', false],
    ];

    let pool = this.majorNodeIds.length > 0 ? this.majorNodeIds : ACTIVE_MAP_DATA.nodes.map((n) => n.id);
    if (ACTIVE_MAP_DATA.meta.unified) {
      // City-sized map: start traffic on the arterials around the spawn instead of scattered over 6km
      const sp = ACTIVE_MAP_DATA.meta.scooterSpawn;
      const nodes = ACTIVE_MAP_DATA.nodes;
      pool = [...pool]
        .sort((a, b) => Math.hypot(nodes[a].x - sp.x, nodes[a].z - sp.z) - Math.hypot(nodes[b].x - sp.x, nodes[b].z - sp.z))
        .slice(0, 60);
    }
    const total = 24;

    for (let i = 0; i < total; i++) {
      const isBus = i < 4;
      const [hex, css, isTaxi] = isBus ? [0x059669, '#059669', false] : palette[i % palette.length];
      const { group, wheels, brakeMat, headlightMat, hazardMat, taxiCapMat } =
        this.createVehicleMesh(hex, isBus, isTaxi);

      const startNode = pool[Math.floor((i * 7) % pool.length)];
      const outs = this.adj[startNode];
      const preferred = isBus ? outs.filter((e) => e.isMajor) : outs;
      const chosen = (preferred.length > 0 ? preferred : outs)[0];
      if (!chosen) continue;

      const prog = Math.random() * chosen.dist * 0.7;
      const pose = this.computeVehicleWorldPose(startNode, chosen.to, prog, chosen.dist, chosen.width);
      group.position.set(pose.x, 0, pose.z);
      group.rotation.y = pose.heading;
      this.root.add(group);

      this.vehicles.push({
        mesh: group,
        wheels,
        brakeMat,
        headlightMat,
        hazardMat,
        taxiCapMat,
        isBus,
        isTaxi,
        driveState: 'CRUISING',
        fromNode: startNode,
        toNode: chosen.to,
        edgeDist: chosen.dist,
        edgeWidth: chosen.width,
        progress: prog,
        x: pose.x,
        z: pose.z,
        heading: pose.heading,
        speed: isBus ? 7.5 : 9.5 + (i % 4) * 1.1,
        cruiseSpeed: isBus ? 8.2 : 10.0 + (i % 4) * 1.2,
        braking: false,
        busStopWaitTimer: 0,
        busStopCooldown: 0,
        playerCutInActive: false,
        hornCooldown: 0,
        colorHex: css,
        halfWidth: isBus ? 1.25 : 0.96,
        halfLength: isBus ? 4.35 : 2.15,
        nextEdge: null,
        blendX: 0,
        blendZ: 0,
        stuckTimer: 0,
        blockedBy: -1,
        ignoreIdx: -1,
        ignoreTimer: 0,
      });
    }
  }

  public getCarSnapshots(): TrafficCarSnapshot[] {
    return this.vehicles.map((v) => ({
      x: v.x,
      z: v.z,
      heading: v.heading,
      color: v.colorHex,
    }));
  }

  /**
   * Heading-aligned collision approximation: a chain of small squares along each body,
   * so the scooter can't clip through car noses/tails or bus overhangs and diagonal cars fit their body.
   */
  public getCarObstacleBoxes(): ObstacleBox[] {
    const boxes: ObstacleBox[] = [];
    for (const v of this.vehicles) {
      const fx = Math.sin(v.heading);
      const fz = Math.cos(v.heading);
      const r = v.halfWidth;
      for (const off of v.isBus ? BUS_SEGMENTS : CAR_SEGMENTS) {
        const cx = v.x + fx * off;
        const cz = v.z + fz * off;
        boxes.push({ minX: cx - r, maxX: cx + r, minZ: cz - r, maxZ: cz + r });
      }
    }
    return boxes;
  }

  /** Forward-ray gap to vehicle `o` using its segment chain (Infinity if the ray misses) */
  private rayGapToVehicle(o: AiVehicle): number {
    const fx = Math.sin(o.heading);
    const fz = Math.cos(o.heading);
    const r = o.halfWidth;
    let best = Infinity;
    for (const off of o.isBus ? BUS_SEGMENTS : CAR_SEGMENTS) {
      const cx = o.x + fx * off;
      const cz = o.z + fz * off;
      this.tmpMin.set(cx - r, 0, cz - r);
      this.tmpMax.set(cx + r, 2.5, cz + r);
      this.tmpBox.set(this.tmpMin, this.tmpMax);
      if (this.frontRay.intersectBox(this.tmpBox, this.rayHitPoint)) {
        const gap = this.frontRay.origin.distanceTo(this.rayHitPoint);
        if (gap < best) best = gap;
      }
    }
    return best;
  }

  /** Speed cap from red/yellow signals on the current edge and (looking ahead) the pre-picked next edge */
  private signalCapFor(v: AiVehicle, distToNode: number, ns: SignalColor, ew: SignalColor): number {
    const nodes = ACTIVE_MAP_DATA.nodes;
    let cap = Infinity;
    if (nodes[v.toNode].isSignal && distToNode - SIGNAL_STOP_LINE_OFFSET < SIGNAL_LOOKAHEAD) {
      const d = edgeDirection(v.fromNode, v.toNode);
      const sig = getSignalAxis(v.toNode, d.fx, d.fz) === 'ns' ? ns : ew;
      cap = Math.min(cap, signalSpeedCap(v.speed, distToNode - SIGNAL_STOP_LINE_OFFSET, sig));
    }
    const ne = v.nextEdge;
    if (ne && nodes[ne.to].isSignal) {
      const stopDist = distToNode + ne.dist - SIGNAL_STOP_LINE_OFFSET;
      if (stopDist < SIGNAL_LOOKAHEAD) {
        const d = edgeDirection(v.toNode, ne.to);
        const sig = getSignalAxis(ne.to, d.fx, d.fz) === 'ns' ? ns : ew;
        cap = Math.min(cap, signalSpeedCap(v.speed, stopDist, sig));
      }
    }
    return cap;
  }

  private pickNextEdge(v: AiVehicle): OsmAdjEdge {
    const outs = this.adj[v.toNode];
    const nodes = ACTIVE_MAP_DATA.nodes;
    const prevA = nodes[v.fromNode];
    const cur = nodes[v.toNode];
    const inDx = cur.x - prevA.x;
    const inDz = cur.z - prevA.z;
    const inLen = Math.hypot(inDx, inDz) || 1;
    const inUx = inDx / inLen;
    const inUz = inDz / inLen;

    let candidates = outs.filter((e) => e.to !== v.fromNode);
    if (v.isBus) {
      const majorOnly = candidates.filter((e) => e.isMajor);
      if (majorOnly.length > 0) candidates = majorOnly;
    }
    if (candidates.length === 0) candidates = outs;

    // Prefer going roughly straight (dot > 0.4) 65% of the time for realistic boulevard flow
    const straight = candidates.filter((e) => {
      const nb = nodes[e.to];
      const dx = nb.x - cur.x;
      const dz = nb.z - cur.z;
      const l = Math.hypot(dx, dz) || 1;
      return (dx / l) * inUx + (dz / l) * inUz > 0.45;
    });
    if (straight.length > 0 && Math.random() < 0.65) {
      return straight[Math.floor(Math.random() * straight.length)];
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  public step(
    dt: number,
    elapsedTime: number,
    isNight: boolean,
    playerX: number,
    playerZ: number,
    playerSpeedMps: number,
    isRiding: boolean,
    onRedLightViolation: () => void,
    onVehicleCollision: (carX: number, carZ: number) => void,
    onAiCarHorn?: () => void,
    pedestrians?: ReadonlyArray<{ x: number; z: number; fsm: string }>
  ): void {
    const clampedDt = Math.min(dt, 0.05);

    // 1. Update 3-color traffic signal cycle
    const t = elapsedTime % CYCLE_DURATION;
    let ns: SignalColor;
    let ew: SignalColor;
    let rem: number;
    if (t < 7.0) {
      ns = 'green';
      ew = 'red';
      rem = 7.0 - t;
    } else if (t < 9.0) {
      ns = 'yellow';
      ew = 'red';
      rem = 9.0 - t;
    } else if (t < 16.0) {
      ns = 'red';
      ew = 'green';
      rem = 16.0 - t;
    } else {
      ns = 'red';
      ew = 'yellow';
      rem = 18.0 - t;
    }
    this.signalState = { ns, ew, remainingSec: rem };

    this.nsRedMat.emissiveIntensity = ns === 'red' ? 2.8 : 0.05;
    this.nsYellowMat.emissiveIntensity = ns === 'yellow' ? 2.8 : 0.05;
    this.nsGreenMat.emissiveIntensity = ns === 'green' ? 2.8 : 0.05;
    this.ewRedMat.emissiveIntensity = ew === 'red' ? 2.8 : 0.05;
    this.ewYellowMat.emissiveIntensity = ew === 'yellow' ? 2.8 : 0.05;
    this.ewGreenMat.emissiveIntensity = ew === 'green' ? 2.8 : 0.05;

    // 2. Check player red-light violation at real Suwon signalized intersections
    if (this.violationCooldown > 0) this.violationCooldown = Math.max(0, this.violationCooldown - clampedDt);
    if (isRiding && Math.abs(playerSpeedMps) > 4.5 && this.violationCooldown <= 0) {
      const moveX = playerX - this.prevPlayerX;
      const moveZ = playerZ - this.prevPlayerZ;
      if (Math.hypot(moveX, moveZ) > 0.05) {
        for (const sn of ACTIVE_MAP_DATA.nodes) {
          if (!sn.isSignal) continue;
          const prevD = Math.hypot(this.prevPlayerX - sn.x, this.prevPlayerZ - sn.z);
          const curD = Math.hypot(playerX - sn.x, playerZ - sn.z);
          if (prevD > 8.0 && curD <= 8.0) {
            const mySig = getSignalAxis(sn.id, moveX, moveZ) === 'ns' ? ns : ew;
            if (mySig === 'red') {
              this.violationCooldown = 5.0;
              onRedLightViolation();
            }
            break;
          }
        }
      }
    }
    this.prevPlayerX = playerX;
    this.prevPlayerZ = playerZ;

    // 3. Step all 24 AI vehicles along the real Suwon OSM road graph
    const nodes = ACTIVE_MAP_DATA.nodes;
    const blinkOn = Math.floor(elapsedTime * 3.2) % 2 === 0;
    this.recycleTimer += clampedDt;

    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      if (v.hornCooldown > 0) v.hornCooldown = Math.max(0, v.hornCooldown - clampedDt);
      if (v.busStopCooldown > 0) v.busStopCooldown = Math.max(0, v.busStopCooldown - clampedDt);

      // Recycle vehicles that wandered far from player back onto nearby Suwon major roads
      if (this.recycleTimer > 2.5) {
        const dPlayer = Math.hypot(v.x - playerX, v.z - playerZ);
        if (dPlayer > ACTIVE_SPAWN_RADIUS) {
          const nearbyNodes = this.majorNodeIds.filter((nid) => {
            const d = Math.hypot(nodes[nid].x - playerX, nodes[nid].z - playerZ);
            return d >= 65 && d <= 145;
          });
          if (nearbyNodes.length > 0) {
            const pick = nearbyNodes[Math.floor(Math.random() * nearbyNodes.length)];
            const outs = this.adj[pick];
            const usable = v.isBus ? outs.filter((e) => e.isMajor) : outs;
            if (usable.length > 0) {
              const ed = usable[Math.floor(Math.random() * usable.length)];
              const spawn = this.computeVehicleWorldPose(pick, ed.to, 2.0, ed.dist, ed.width);
              // Don't drop the car on top of another one already occupying that lane
              const occupied = this.vehicles.some(
                (o) => o !== v && Math.hypot(o.x - spawn.x, o.z - spawn.z) < o.halfLength + v.halfLength + 2
              );
              if (!occupied) {
                v.fromNode = pick;
                v.toNode = ed.to;
                v.edgeDist = ed.dist;
                v.edgeWidth = ed.width;
                v.progress = 2.0;
                v.nextEdge = null;
                v.blendX = 0;
                v.blendZ = 0;
                v.x = spawn.x;
                v.z = spawn.z;
                v.heading = spawn.heading;
                v.stuckTimer = 0;
                v.ignoreIdx = -1;
              }
            }
          }
        }
      }

      // Bus stop dwell check
      if (v.isBus && v.busStopWaitTimer > 0) {
        v.busStopWaitTimer = Math.max(0, v.busStopWaitTimer - clampedDt);
        v.speed = Math.max(0, v.speed - 14 * clampedDt);
        v.braking = true;
        if (v.hazardMat) v.hazardMat.emissiveIntensity = blinkOn ? 2.8 : 0.1;
      } else {
        if (v.hazardMat) v.hazardMat.emissiveIntensity = 0.08;

        if (v.isBus && v.busStopCooldown <= 0) {
          for (const bs of this.busStops) {
            if (Math.hypot(v.x - bs.x, v.z - bs.z) < 4.5) {
              v.busStopWaitTimer = 3.2;
              v.busStopCooldown = 26.0;
              break;
            }
          }
        }

        const fx = Math.sin(v.heading);
        const fz = Math.cos(v.heading);
        const distToNode = Math.max(0, v.edgeDist - v.progress);

        let targetSpd = v.cruiseSpeed;
        let emergency = false;

        // Pre-pick the next edge on approach so a short follow-on edge into a signal is braked for in time
        if (!v.nextEdge && distToNode < SIGNAL_LOOKAHEAD) {
          v.nextEdge = this.pickNextEdge(v);
        }

        // Traffic light: smooth braking profile to the stop line (works on short approach edges too)
        targetSpd = Math.min(targetSpd, this.signalCapFor(v, distToNode, ns, ew));

        // Forward 12m raycast against other AI vehicles & player scooter
        this.frontRay.origin.set(v.x + fx * (v.halfLength + 0.2), 0.7, v.z + fz * (v.halfLength + 0.2));
        this.frontRay.direction.set(fx, 0, fz);

        if (v.ignoreTimer > 0) {
          v.ignoreTimer = Math.max(0, v.ignoreTimer - clampedDt);
          if (v.ignoreTimer === 0) v.ignoreIdx = -1;
        }

        let minGap = Infinity;
        let blocker = -1;
        for (let j = 0; j < this.vehicles.length; j++) {
          if (i === j || j === v.ignoreIdx) continue;
          const o = this.vehicles[j];
          const dSq = (o.x - v.x) ** 2 + (o.z - v.z) ** 2;
          if (dSq > 625) continue;
          const gap = this.rayGapToVehicle(o);
          if (gap < minGap) {
            minGap = gap;
            blocker = j;
          }
        }
        const aiGap = minGap;

        // Check player scooter ahead
        const toPlX = playerX - v.x;
        const toPlZ = playerZ - v.z;
        const distPl = Math.hypot(toPlX, toPlZ);
        if (distPl < FRONT_RAY_RANGE + v.halfLength) {
          const dotAhead = distPl > 0.1 ? (toPlX * fx + toPlZ * fz) / distPl : 0;
          const lateral = Math.abs(toPlX * -fz + toPlZ * fx);
          if (dotAhead > 0.72 && lateral < v.halfWidth + 0.95) {
            const plGap = distPl - v.halfLength - 0.8;
            if (plGap < minGap) {
              minGap = plGap;
              if (plGap < 5.2 && v.speed > 3.0) {
                emergency = true;
                if (!v.playerCutInActive && v.hornCooldown <= 0) {
                  v.playerCutInActive = true;
                  v.hornCooldown = 5.0;
                  onAiCarHorn?.();
                }
              }
            }
          } else {
            v.playerCutInActive = false;
          }

          // Direct physical collision with riding player (heading-aligned body rectangle)
          const along = toPlX * fx + toPlZ * fz;
          const side = toPlX * -fz + toPlZ * fx;
          if (
            isRiding &&
            Math.abs(along) < v.halfLength + PLAYER_COLLISION_PAD &&
            Math.abs(side) < v.halfWidth + PLAYER_COLLISION_PAD &&
            Math.abs(playerSpeedMps) > 3.2
          ) {
            onVehicleCollision(v.x, v.z);
          }
        } else {
          v.playerCutInActive = false;
        }

        // Yield to pedestrians on the crosswalk (or lying fallen in the road) inside our lane ahead
        if (pedestrians) {
          for (const pd of pedestrians) {
            if (pd.fsm !== 'CROSSING' && pd.fsm !== 'FALLEN') continue;
            const px = pd.x - v.x;
            const pz = pd.z - v.z;
            if (px * px + pz * pz > 400) continue;
            const along = px * fx + pz * fz;
            const side = px * -fz + pz * fx;
            if (along > 0 && Math.abs(side) < v.halfWidth + 0.9) {
              const pedGap = along - v.halfLength - 0.6;
              if (pedGap < minGap) minGap = pedGap;
            }
          }
        }

        // Cross-traffic deadlock breaker: two cars nosed into each other at an unsignalized junction.
        // Queues (same direction) never trigger it; the player is never ignored.
        v.blockedBy = aiGap < SAFE_FOLLOW_GAP ? blocker : -1;
        if (v.blockedBy >= 0 && v.speed < 0.3 && minGap === aiGap) {
          const o = this.vehicles[v.blockedBy];
          const sameDir = fx * Math.sin(o.heading) + fz * Math.cos(o.heading) > 0.85;
          v.stuckTimer = sameDir ? 0 : v.stuckTimer + clampedDt;
          // Mutual block -> lower index gets right of way; one-sided block -> go after a wait
          if (v.stuckTimer > STUCK_YIELD_SEC && (o.blockedBy !== i || i < v.blockedBy)) {
            v.ignoreIdx = v.blockedBy;
            v.ignoreTimer = IGNORE_BLOCKER_SEC;
            v.stuckTimer = 0;
          }
        } else {
          v.stuckTimer = 0;
        }

        if (minGap < SAFE_FOLLOW_GAP) {
          targetSpd = 0;
        } else if (minGap < FRONT_RAY_RANGE) {
          targetSpd = Math.min(targetSpd, v.cruiseSpeed * ((minGap - SAFE_FOLLOW_GAP) / (FRONT_RAY_RANGE - SAFE_FOLLOW_GAP)));
        }

        const accelRate = emergency ? 18 : targetSpd < v.speed ? 11 : 4.2;
        v.speed += clamp(targetSpd - v.speed, -accelRate * clampedDt, accelRate * clampedDt);
        v.braking = targetSpd < v.speed - 0.5 || v.speed < 0.2;
        v.driveState = emergency
          ? 'EMERGENCY_BRAKE'
          : v.speed < 0.2
            ? 'STOPPED'
            : v.braking
              ? 'DECELERATING'
              : 'CRUISING';

        const travelled = v.speed * clampedDt;
        v.progress += travelled;
        const decay = laneBlendDecay(travelled);
        v.blendX *= decay;
        v.blendZ *= decay;
        if (v.progress >= v.edgeDist) {
          const nextEdge = v.nextEdge ?? this.pickNextEdge(v);
          v.nextEdge = null;
          const carry = v.progress - v.edgeDist;
          v.fromNode = v.toNode;
          v.toNode = nextEdge.to;
          v.edgeDist = nextEdge.dist;
          v.edgeWidth = nextEdge.width;
          v.progress = Math.min(carry, Math.max(0, v.edgeDist - 0.2));
          // Carry the visible position across the node: the lane-offset jump is blended out while driving
          const np = this.computeVehicleWorldPose(v.fromNode, v.toNode, v.progress, v.edgeDist, v.edgeWidth);
          v.blendX = v.x - np.x;
          v.blendZ = v.z - np.z;
        }
      }

      const pose = this.computeVehicleWorldPose(
        v.fromNode,
        v.toNode,
        v.progress,
        v.edgeDist,
        v.edgeWidth
      );
      v.x = pose.x + v.blendX;
      v.z = pose.z + v.blendZ;
      const dHead = wrapAngle(pose.heading - v.heading);
      v.heading = wrapAngle(v.heading + dHead * Math.min(1, clampedDt * 8));

      v.mesh.position.set(v.x, 0, v.z);
      v.mesh.rotation.y = v.heading;
      v.brakeMat.emissiveIntensity = v.braking ? 3.2 : isNight ? 1.1 : 0.3;
      v.headlightMat.emissiveIntensity = isNight ? 3.2 : 0.75;
      if (v.taxiCapMat) v.taxiCapMat.emissiveIntensity = isNight ? 2.6 : 0.8;

      const wheelStep = (v.speed * clampedDt) / 0.34;
      for (const w of v.wheels) {
        w.rotation.x += wheelStep;
      }
    }

    if (this.recycleTimer > 2.5) this.recycleTimer = 0;
  }
}
