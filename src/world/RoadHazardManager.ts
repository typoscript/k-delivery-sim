import * as THREE from 'three';
import {
  ConstructionZoneMarker,
  ObstacleBox,
  PolicePatrolMarker,
  RivalRiderMarker,
  SpeedCameraMarker,
  UpcomingCameraAlert,
  clamp,
} from '../types';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import { SignalStateSnapshot } from './TrafficSystem';
import { PedestrianFactory } from './PedestrianFactory';
import {
  PedestrianCollisionEvent,
  ScooterProximityInfo,
} from './PedestrianManager';
import { PointGrid } from './PedestrianGraph';
import { buildSpeedCameras } from './hazards/speedCameras';
import { buildParkedHazards } from './hazards/parkedHazards';
import { buildPolicePatrols } from './hazards/policePatrols';
import { buildConstructionZones } from './hazards/constructionZones';
import { buildRivalRiders } from './hazards/rivalRiders';

import { RED_LIGHT_TICKET_FINE, SIDEWALK_TICKET_FINE, findWitness } from '../game/trafficViolations';

export * from './hazards/hazardTypes';
import {
  SpeedCameraTriggerEvent,
  PopOutWarningEvent,
  OsmAdjEdge,
  PolicePatrolUnit,
  ConstructionZoneUnit,
  RivalRiderUnit,
  SpeedCameraUnit,
  ParkedHazardUnit,
  LARGE_MAP_COVERAGE_KM2,
  HAZARD_RESPAWN_MAX_RADIUS,
  STATIC_VISIBILITY_INTERVAL_SEC,
  PlacementRule,
} from './hazards/hazardTypes';


import {
  pickSpawnEdge as pickSpawnEdgeFn,
  respawnMovingUnit as respawnMovingUnitFn,
  recycleMovingUnits as recycleMovingUnitsFn,
  pickNextGraphEdge as pickNextGraphEdgeFn,
  updateStaticPropVisibility as updateStaticPropVisibilityFn,
} from './hazards/hazardSpawning';
import {
  step as stepFn,
} from './hazards/hazardFrame';

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

  /** @internal hazards/* */ readonly adj: OsmAdjEdge[][];
  /** @internal hazards/* */ readonly majorNodeIds: number[] = [];
  /** @internal hazards/* */ readonly cameras: SpeedCameraUnit[] = [];
  /** @internal hazards/* */ readonly parkedHazards: ParkedHazardUnit[] = [];
  /** @internal hazards/* */ readonly patrolCars: PolicePatrolUnit[] = [];
  /** @internal hazards/* */ readonly constructionZones: ConstructionZoneUnit[] = [];
  /** @internal hazards/* */ readonly rivalRiders: RivalRiderUnit[] = [];
  /** @internal hazards/* */ readonly pedFactory = new PedestrianFactory();
  /** @internal hazards/* */
  globalPopOutCooldown = 3.0;
  /** Spatial index of OSM road nodes that have edges (all) and of nodes touching a major road */
  /** @internal hazards/* */
  readonly nodeGrid: PointGrid;
  /** @internal hazards/* */
  readonly majorNodeGrid: PointGrid;
  /** km^2 of 100m cells containing road nodes (legacy districts ~0.35-0.6, unified Suwon ~19) */
  public readonly roadCoverageKm2: number;
  public readonly isLargeMap: boolean;
  /** @internal hazards/* */
  readonly staticProps: Array<{ group: THREE.Object3D; x: number; z: number }> = [];
  /** @internal hazards/* */
  recycleTimer = 0;
  /** @internal hazards/* */
  staticVisTimer = STATIC_VISIBILITY_INTERVAL_SEC;
  /** Total police/rival respawns near the player (diagnostics / tests) */
  public recycledCount = 0;
  /** @internal hazards/* */
  lastWarnedCameraId: string | null = null;
  /** @internal hazards/* */
  overSpeedBeepTimer = 0;

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

    buildSpeedCameras(this);
    buildParkedHazards(this);
    buildPolicePatrols(this);
    buildConstructionZones(this);
    buildRivalRiders(this);

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

  /**
   * A patrol car close enough to see a red-light run / sidewalk riding writes a ticket (siren on, then its
   * usual cooldown). Null when no free patrol is within PATROL_WITNESS_RADIUS_M.
   */
  public witnessTicket(
    kind: 'patrol_red_light' | 'patrol_sidewalk',
    x: number,
    z: number,
    speedKmh: number
  ): SpeedCameraTriggerEvent | null {
    const p = findWitness(this.patrolCars.filter((c) => c.citeCooldown <= 0), x, z);
    if (!p) return null;
    p.citeCooldown = 18.0;
    p.sirenTimer = 4.5;
    return {
      cameraId: p.id,
      label: p.label,
      kind,
      measuredKmh: Math.round(speedKmh),
      limitKmh: 0,
      fine: kind === 'patrol_red_light' ? RED_LIGHT_TICKET_FINE : SIDEWALK_TICKET_FINE,
    };
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

  /** @internal hazards/* */ placementLimits(rule: PlacementRule): { count: number; spacing: number } {
    if (!this.isLargeMap) return { count: rule.legacyCount, spacing: rule.legacySpacing };
    return {
      count: Math.max(rule.legacyCount, Math.round(this.roadCoverageKm2 * rule.perKm2)),
      spacing: rule.largeSpacing,
    };
  }

  /** @internal hazards/* */ registerStaticProp(group: THREE.Object3D, x: number, z: number): void {
    if (this.isLargeMap) this.staticProps.push({ group, x, z });
  }

  /**
   * Picks a road edge whose start node lies minR~maxR from (x, z), away from the other moving units.
   * preferMajor: try nodes on major roads first and leave along a major edge when possible.
   */
  /** @internal hazards/* */
  pickSpawnEdge(
    x: number,
    z: number,
    minR: number,
    maxR: number,
    preferMajor: boolean,
    self: { x: number; z: number }
  ): { from: number; edge: OsmAdjEdge } | null {
    return pickSpawnEdgeFn(this, x, z, minR, maxR, preferMajor, self);
  }

  /** Moves a police car / rival rider onto a fresh edge near (x, z). Returns false when no road qualifies. */
  /** @internal hazards/* */
  respawnMovingUnit(
    u: PolicePatrolUnit | RivalRiderUnit,
    x: number,
    z: number,
    minR: number,
    maxR: number,
    preferMajor: boolean,
    laneFrac: number
  ): boolean {
    return respawnMovingUnitFn(this, u, x, z, minR, maxR, preferMajor, laneFrac);
  }

  /** Respawns police / rivals that drifted > HAZARD_RECYCLE_DISTANCE away to 120~250m from the player */
  public recycleMovingUnits(playerX: number, playerZ: number): number {
    return recycleMovingUnitsFn(this, playerX, playerZ);
  }

  /** @internal hazards/* */
  updateStaticPropVisibility(playerX: number, playerZ: number): void {
    updateStaticPropVisibilityFn(this, playerX, playerZ);
  }

  /** @internal hazards/* */ computeEdgePose(
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

  /** @internal hazards/* */
  pickNextGraphEdge(fromNode: number, toNode: number, preferMajor: boolean): OsmAdjEdge {
    return pickNextGraphEdgeFn(this, fromNode, toNode, preferMajor);
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
    stepFn(this, dt, elapsedTime, inCorridor, scooter, signalState, onSpeedCameraTriggered, onPopOutWarning, onPopOutPedestrianHit, onCameraApproachBeep, onPolicePatrolCite, /** On-foot player position (defaults to the scooter); moving units / prop culling follow it */
    playerPos);
  }
}
