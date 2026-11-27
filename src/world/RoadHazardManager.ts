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
import { buildSpeedCameras, stepSpeedCameras } from './hazards/speedCameras';
import { buildParkedHazards, stepParkedHazards } from './hazards/parkedHazards';
import { buildPolicePatrols, stepPolicePatrols } from './hazards/policePatrols';
import { buildConstructionZones, stepConstructionZones } from './hazards/constructionZones';
import { buildRivalRiders, stepRivalRiders } from './hazards/rivalRiders';

import { RED_LIGHT_TICKET_FINE, SIDEWALK_TICKET_FINE, findWitness } from '../game/trafficViolations';

export * from './hazards/hazardTypes';
import {
  HazardFrame,
  SpeedCameraTriggerEvent,
  PopOutWarningEvent,
  OsmAdjEdge,
  PolicePatrolUnit,
  ConstructionZoneUnit,
  RivalRiderUnit,
  SpeedCameraUnit,
  ParkedHazardUnit,
  LARGE_MAP_COVERAGE_KM2,
  HAZARD_RECYCLE_DISTANCE,
  HAZARD_RESPAWN_MIN_RADIUS,
  HAZARD_RESPAWN_MAX_RADIUS,
  HAZARD_RECYCLE_INTERVAL_SEC,
  STATIC_PROP_VISIBLE_DIST,
  STATIC_VISIBILITY_INTERVAL_SEC,
  PlacementRule,
} from './hazards/hazardTypes';

/** Max distance a respawned unit ends up from its picked start node (15m progress + lane offset) */
const SPAWN_SLACK_M = 18;

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
    // The unit moves up to 15m along the edge plus its lane offset: keep that slack inside maxR
    const pick = this.pickSpawnEdge(x, z, minR, Math.max(minR, maxR - SPAWN_SLACK_M), preferMajor, u);
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
    const frame: HazardFrame = {
      dt: clampedDt,
      elapsedTime,
      scooter,
      signalState,
      speedKmh,
      scFwdX,
      scFwdZ,
      blinkOn,
    };
    stepSpeedCameras(this, frame, onSpeedCameraTriggered, onCameraApproachBeep);
    stepPolicePatrols(this, frame, onPolicePatrolCite);
    stepConstructionZones(this, frame);
    stepRivalRiders(this, frame);
    stepParkedHazards(this, frame, onPopOutWarning, onPopOutPedestrianHit);
  }
}
