import * as THREE from 'three';
import { VehicleFleetRenderer } from './VehicleFleetRenderer';
import { BusStopPoint, ObstacleBox, clamp, wrapAngle } from '../types';
import { VehicleBody, vehicleObstacle } from './vehicleBodies';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import { AiVehicle, DRIVING_WEATHER, DrivingWeather, OsmAdjEdge, PASS_SHIFT_SPEED } from './traffic/trafficTypes';
import type { WeatherMode } from '../types';
import { applySignalLamps, buildTrafficSignals, checkPlayerRedLight, signalPhaseAt } from './traffic/trafficSignals';
import { computeVehicleWorldPose, recycleVehicle, spawnTrafficVehicles } from './traffic/trafficSpawn';
import { DriveFrame, driveVehicle } from './traffic/vehicleDriving';
export { PASS_WAIT_SEC } from './traffic/trafficTypes';

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

/**
 * General OpenStreetMap Graph Traffic AI System for Suwon Ingye-dong!
 * - Builds 3-color traffic signal poles at all 24 real Suwon signalized intersections
 * - Drives 24 stylized low-poly sedans, Suwon/Gyeonggi taxis, & Suwon City Buses along real OSM edges
 *   with right-hand lane offsets (`right = (-fz, 0, fx)`), smooth junction transitions,
 *   12m forward collision avoidance raycasting, red-light stopping, and bus-stop dwells!
 */
export class TrafficSystem {
  public readonly root = new THREE.Group();
  /** @internal traffic/* */
  readonly vehicles: AiVehicle[] = [];
  /** @internal traffic/* */
  readonly busStops: BusStopPoint[];
  /** @internal traffic/* */
  readonly adj: OsmAdjEdge[][];
  /** @internal traffic/* */
  readonly majorNodeIds: number[] = [];

  /** @internal traffic/* */
  readonly nsRedMat: THREE.MeshStandardMaterial;
  /** @internal traffic/* */
  readonly nsYellowMat: THREE.MeshStandardMaterial;
  /** @internal traffic/* */
  readonly nsGreenMat: THREE.MeshStandardMaterial;
  /** @internal traffic/* */
  readonly ewRedMat: THREE.MeshStandardMaterial;
  /** @internal traffic/* */
  readonly ewYellowMat: THREE.MeshStandardMaterial;
  /** @internal traffic/* */
  readonly ewGreenMat: THREE.MeshStandardMaterial;

  public signalState: SignalStateSnapshot = {
    ns: 'green',
    ew: 'red',
    remainingSec: 6.5,
  };

  /** @internal traffic/* */
  prevPlayerX = ACTIVE_MAP_DATA.meta.scooterSpawn.x;
  /** @internal traffic/* */
  prevPlayerZ = ACTIVE_MAP_DATA.meta.scooterSpawn.z;
  /** @internal traffic/* */
  violationCooldown = 0;
  /** @internal traffic/* */
  readonly nearSignals: number[] = [];
  private recycleTimer = 0;

  /** @internal traffic/* */
  readonly frontRay = new THREE.Ray();
  /** @internal traffic/* */
  readonly rayHitPoint = new THREE.Vector3();
  /** @internal traffic/* */
  readonly tmpBox = new THREE.Box3();
  /** @internal traffic/* */
  readonly tmpMin = new THREE.Vector3();
  /** @internal traffic/* */
  readonly tmpMax = new THREE.Vector3();

  /** @internal traffic/* */
  fleet!: VehicleFleetRenderer;

  constructor(scene: THREE.Scene, busStops: BusStopPoint[]) {
    this.busStops = busStops;
    scene.add(this.root);

    const nodes = ACTIVE_MAP_DATA.nodes;
    this.adj = Array.from({ length: nodes.length }, () => []);
    for (const e of ACTIVE_MAP_DATA.edges) {
      this.adj[e.a].push({
        to: e.b,
        dist: e.dist,
        width: e.width,
        isMajor: e.isMajor,
      });
      this.adj[e.b].push({
        to: e.a,
        dist: e.dist,
        width: e.width,
        isMajor: e.isMajor,
      });
    }
    for (const n of nodes) {
      if (this.adj[n.id].some((ed) => ed.isMajor)) {
        this.majorNodeIds.push(n.id);
      }
    }

    this.nsRedMat = new THREE.MeshStandardMaterial({
      color: 0x3b0a0a,
      emissive: 0xef4444,
      emissiveIntensity: 0,
    });
    this.nsYellowMat = new THREE.MeshStandardMaterial({
      color: 0x3b2c0a,
      emissive: 0xfacc15,
      emissiveIntensity: 0,
    });
    this.nsGreenMat = new THREE.MeshStandardMaterial({
      color: 0x0a3b20,
      emissive: 0x22c55e,
      emissiveIntensity: 2.5,
    });

    this.ewRedMat = new THREE.MeshStandardMaterial({
      color: 0x3b0a0a,
      emissive: 0xef4444,
      emissiveIntensity: 2.5,
    });
    this.ewYellowMat = new THREE.MeshStandardMaterial({
      color: 0x3b2c0a,
      emissive: 0xfacc15,
      emissiveIntensity: 0,
    });
    this.ewGreenMat = new THREE.MeshStandardMaterial({
      color: 0x0a3b20,
      emissive: 0x22c55e,
      emissiveIntensity: 0,
    });

    buildTrafficSignals(this);
    spawnTrafficVehicles(this);
  }

  public getCarSnapshots(): TrafficCarSnapshot[] {
    return this.vehicles.map((v) => ({
      x: v.x,
      z: v.z,
      heading: v.heading,
      color: v.colorHex,
    }));
  }

  /** Exact heading-aligned body rectangles (cars 4.3 x 1.92m, buses 8.7 x 2.5m) for scooter / player collision */
  public getCarObstacleBoxes(): ObstacleBox[] {
    return this.vehicles.map((v) => vehicleObstacle(v));
  }

  /** Live vehicle bodies (position, heading, size, speed) for pedestrians and push-out (do not mutate) */
  public getCarBodies(): readonly VehicleBody[] {
    return this.vehicles;
  }

  /** Driving behaviour of the weather (see DRIVING_WEATHER) */
  public drivingWeather: DrivingWeather = DRIVING_WEATHER.dry;

  /** Rain / snow: cars cruise slower and keep more distance */
  public setWeather(mode: WeatherMode): void {
    this.drivingWeather = DRIVING_WEATHER[mode === 'rain' || mode === 'snow' ? mode : 'dry'];
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
    pedestrians?: ReadonlyArray<{
      x: number;
      z: number;
      fsm: string;
      resumeFsm?: string;
    }>,
    /** Scooter standing on its own (player on foot): cars must stop for it instead of driving through */
    parkedScooter?: { x: number; z: number } | null,
  ): void {
    const clampedDt = Math.min(dt, 0.05);

    // 1. Signal phase (shared by every road user) and the player's red-light check
    this.signalState = signalPhaseAt(elapsedTime);
    const { ns, ew } = this.signalState;
    applySignalLamps(this, ns, ew);
    checkPlayerRedLight(this, clampedDt, playerX, playerZ, playerSpeedMps, isRiding, ns, ew, onRedLightViolation);

    this.fleet.setNight(isNight);

    // 3. Step all 24 AI vehicles along the real Suwon OSM road graph
    const blinkOn = Math.floor(elapsedTime * 3.2) % 2 === 0;
    this.recycleTimer += clampedDt;

    const frame: DriveFrame = {
      clampedDt,
      blinkOn,
      ns,
      ew,
      playerX,
      playerZ,
      playerSpeedMps,
      isRiding,
      onVehicleCollision,
      onAiCarHorn,
      pedestrians,
      parkedScooter,
    };
    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      if (v.hornCooldown > 0) v.hornCooldown = Math.max(0, v.hornCooldown - clampedDt);
      if (v.busStopCooldown > 0) v.busStopCooldown = Math.max(0, v.busStopCooldown - clampedDt);

      // Recycle vehicles that wandered far from player back onto nearby Suwon major roads
      if (this.recycleTimer > 2.5) recycleVehicle(this, v, playerX, playerZ);
      driveVehicle(this, v, i, frame);

      const pose = computeVehicleWorldPose(v.fromNode, v.toNode, v.progress, v.edgeDist, v.edgeWidth);
      // Pull out to / back in from the passing offset (left of travel = (cos h, -sin h))
      v.passOffset += clamp(v.passTarget - v.passOffset, -PASS_SHIFT_SPEED * clampedDt, PASS_SHIFT_SPEED * clampedDt);
      v.x = pose.x + v.blendX + Math.cos(pose.heading) * v.passOffset;
      v.z = pose.z + v.blendZ - Math.sin(pose.heading) * v.passOffset;
      const dHead = wrapAngle(pose.heading - v.heading);
      v.heading = wrapAngle(v.heading + dHead * Math.min(1, clampedDt * 8));

      v.wheelSpin += (v.speed * clampedDt) / 0.34;
      if (v.isBus) this.fleet.setBus(v.renderIndex, v);
      else this.fleet.setCar(v.renderIndex, v);
    }
    this.fleet.commit();

    if (this.recycleTimer > 2.5) this.recycleTimer = 0;
  }
}
