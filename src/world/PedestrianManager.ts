import * as THREE from 'three';
import type { WeatherMode } from '../types';

import { excludeFromMirrors } from './renderLayers';
import { SignalStateSnapshot } from './TrafficSystem';
import { PedestrianFactory, setPedestrianDetail, setPedestrianWeather, PedestrianRig } from './PedestrianFactory';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import { CrosswalkAxis, PedestrianEdge, PedestrianGraph } from './PedestrianGraph';
import { VehicleBody } from './vehicleBodies';
import { AgentFrame, PedFrame, stepNavigation } from './pedestrians/pedestrianWalking';
import { checkScooterContact, stepFallen, stepStartle } from './pedestrians/pedestrianReactions';
import {
  BLINK_THRESHOLD_SEC,
  CULL_DISTANCE,
  CULL_DISTANCE_SQ,
  DETAIL_DISTANCE_SQ,
  MAX_RECYCLES_PER_TICK,
  PEDESTRIAN_COLLISION_MIN_KMH,
  PEDESTRIAN_RAIN_PACE,
  PEDESTRIAN_SNOW_PACE,
  PEDESTRIAN_INITIAL_SPAWN_RADIUS,
  PEDESTRIAN_RECYCLE_DISTANCE,
  PEDESTRIAN_RESPAWN_MAX_RADIUS,
  PEDESTRIAN_RESPAWN_MIN_RADIUS,
  RECYCLE_INTERVAL_SEC,
  RESPAWN_PREFERRED_MIN_RADIUS,
  SIDEWALK_Y,
} from './pedestrians/pedestrianTuning';
export {
  PEDESTRIAN_COLLISION_MIN_KMH,
  PEDESTRIAN_DETAIL_DISTANCE,
  PEDESTRIAN_INITIAL_SPAWN_RADIUS,
  PEDESTRIAN_RECYCLE_DISTANCE,
  PEDESTRIAN_RESPAWN_MAX_RADIUS,
  PEDESTRIAN_RESPAWN_MIN_RADIUS,
  PEDESTRIAN_STARTLE_RADIUS,
} from './pedestrians/pedestrianTuning';

export type PedestrianFSMState =
  | 'WALKING'
  | 'WAITING_CROSSWALK'
  | 'CROSSING'
  | 'STARTLED'
  | 'FALLEN';
export type PedestrianSignalPhase = 'green' | 'blinking' | 'red';

export interface ScooterProximityInfo {
  x: number;
  z: number;
  heading: number;
  speedMps: number;
  isRiding: boolean;
  crashed: boolean;
}

export interface PedestrianCollisionEvent {
  pedestrianId: number;
  pedX: number;
  pedZ: number;
  impactSpeedKmh: number;
  hitSide: number;
}

export interface PedestrianAgent {
  id: number;
  rig: PedestrianRig;
  fsm: PedestrianFSMState;
  resumeFsm: 'WALKING' | 'WAITING_CROSSWALK' | 'CROSSING';
  fromNodeId: number;
  toNodeId: number;
  prevNodeId: number;
  activeEdge: PedestrianEdge;
  x: number;
  y: number;
  z: number;
  heading: number;
  walkSpeed: number; // 1.0 ~ 1.3 m/s
  currentSpeed: number;
  visible: boolean;
  // Sidewalk scooter avoidance & fall reaction state
  reactionTimer: number;
  reactPhase: number;
  fallSide: number;
  evadeRemaining: number;
  evadeDirX: number;
  evadeDirZ: number;
  hitCooldown: number;
  /** Seconds spent politely waiting for a player / parked scooter blocking the sidewalk ahead */
  yieldTimer: number;
  /** After recovering from a startle, ignore the same scooter for a while (prevents startle loops) */
  startleCooldown: number;
  /** Seconds waited at an unsignalized road crossing for a gap in traffic */
  crossWaitTimer: number;
}

export interface PedestrianManagerOptions {
  /** Centre for the initial crowd (default: ACTIVE_MAP_DATA.meta.playerSpawn) */
  spawnCenter?: { x: number; z: number };
}

/**
 * Evaluates pedestrian crosswalk signal synchronized with TrafficSystem's 3-color cycle.
 * `axis` is the vehicle phase moving parallel to the crossing (PedestrianGraph sets it via getSignalAxis),
 * so pedestrians walk exactly while the traffic they cut across has red:
 * - 'ns' (e.g. walking along Z across an EW road) is safe when the NS vehicle signal is green.
 * - 'ew' (e.g. walking along X across a NS road) is safe when the EW vehicle signal is green.
 */
export function evaluatePedestrianSignal(
  axis: CrosswalkAxis,
  signal: SignalStateSnapshot
): PedestrianSignalPhase {
  const color = axis === 'ns' ? signal.ns : signal.ew;
  if (color === 'green') {
    return signal.remainingSec <= BLINK_THRESHOLD_SEC ? 'blinking' : 'green';
  }
  return 'red';
}

/**
 * Independent Sidewalk & Signalized Crosswalk Pedestrian AI Manager.
 * - Navigates the OSM sidewalk PedestrianGraph using a 3-state FSM:
 *   WALKING (1.0~1.3 m/s) <-> WAITING_CROSSWALK (at yellow tactile pad) -> CROSSING (1.5x run when blinking!)
 * - 80m distance culling: hides 3D mesh beyond 80m while keeping lightweight coordinate updates running.
 * - Open-world streaming: hidden agents > 220m from the player are recycled onto sidewalks 60~180m away.
 * - Immediately pauses tick updates & hides group when player enters underground corridors (y = -500).
 */
export class PedestrianManager {
  /** AI vehicle bodies for this tick (pedestrians avoid them) — @internal pedestrians/* */
  cars: readonly VehicleBody[] = [];
  public readonly root = new THREE.Group();
  public readonly graph = new PedestrianGraph();
  public readonly factory = new PedestrianFactory();
  public readonly agents: PedestrianAgent[] = [];
  /** Walking pace factor of the weather (rain: hurrying, snow: careful steps) */
  public walkSpeedMul = 1;
  private weather: WeatherMode = 'clear';

  private recycleTimer = 0;
  /** Total agents moved back near the player since construction (diagnostics / tests) */
  public recycledCount = 0;

  constructor(parent: THREE.Object3D, totalCount = 56, options: PedestrianManagerOptions = {}) {
    // Spawn the crowd around the player spawn (on the unified map it can be kilometres from (0, 0)),
    // ~35% close enough to be visible right away and the rest spread out to the streaming radius.
    const center = options.spawnCenter ?? ACTIVE_MAP_DATA.meta.playerSpawn;
    let nearPool = this.graph.nodesWithin(center.x, center.z, 0, CULL_DISTANCE);
    let widePool = this.graph.nodesWithin(center.x, center.z, 0, PEDESTRIAN_INITIAL_SPAWN_RADIUS);
    if (widePool.length === 0) {
      // Spawn far off the sidewalk network (shouldn't happen) -> fall back to every connected node
      widePool = this.graph.nodes.filter((n) => this.graph.getEdges(n.id).length > 0).map((n) => n.id);
    }
    if (nearPool.length === 0) nearPool = widePool;

    for (let i = 0; i < totalCount; i++) {
      const pool = i < Math.floor(totalCount * 0.35) ? nearPool : widePool;
      const startNodeId = pool[Math.floor(Math.random() * pool.length)];

      const rig = this.factory.createPedestrian();
      excludeFromMirrors(rig.root);
      setPedestrianWeather(rig, this.weather);
      this.root.add(rig.root);

      const agent: PedestrianAgent = {
        id: i + 1,
        rig,
        fsm: 'WALKING',
        resumeFsm: 'WALKING',
        fromNodeId: startNodeId,
        toNodeId: startNodeId,
        prevNodeId: startNodeId,
        activeEdge: this.graph.getEdges(startNodeId)[0],
        x: 0,
        y: SIDEWALK_Y,
        z: 0,
        heading: 0,
        walkSpeed: 1.0 + Math.random() * 0.3, // 1.0 ~ 1.3 m/s
        currentSpeed: 0,
        visible: true,
        reactionTimer: 0,
        reactPhase: 0,
        fallSide: 1,
        evadeRemaining: 0,
        evadeDirX: 0,
        evadeDirZ: 0,
        hitCooldown: 0,
        yieldTimer: 0,
        startleCooldown: 0,
        crossWaitTimer: 0,
      };
      this.placeAgentOnNode(agent, startNodeId);
      this.agents.push(agent);
    }

    parent.add(this.root);
  }

  /** Puts `a` part-way along a (preferably sidewalk) edge leaving `nodeId` and resets its FSM to WALKING */
  private placeAgentOnNode(a: PedestrianAgent, nodeId: number): void {
    const startNode = this.graph.getNode(nodeId);
    const edges = this.graph.getEdges(nodeId);
    // Prefer starting on a sidewalk edge so spawns begin cleanly on raised sidewalks
    const sidewalkEdges = edges.filter((e) => e.kind === 'sidewalk' && !e.crossesRoad);
    const edge =
      sidewalkEdges.length > 0 ? sidewalkEdges[Math.floor(Math.random() * sidewalkEdges.length)] : edges[0];
    const nextNode = this.graph.getNode(edge.to);

    // Start at most ~20m along the edge: OSM sidewalk edges can be ~1km long, and the agent should appear
    // near the chosen node (inside the requested spawn ring), not somewhere down a long avenue
    const t = Math.random() * Math.min(1, 20 / Math.max(1, edge.distance));
    a.x = startNode.x + (nextNode.x - startNode.x) * t;
    a.z = startNode.z + (nextNode.z - startNode.z) * t;
    a.y = SIDEWALK_Y;
    a.heading = Math.atan2(nextNode.x - startNode.x, nextNode.z - startNode.z);
    a.fromNodeId = startNode.id;
    a.prevNodeId = startNode.id;
    a.toNodeId = nextNode.id;
    a.activeEdge = edge;
    a.fsm = 'WALKING';
    a.resumeFsm = 'WALKING';
    a.currentSpeed = 0;
    a.reactionTimer = 0;
    a.reactPhase = 0;
    a.evadeRemaining = 0;
    a.yieldTimer = 0;
    a.crossWaitTimer = 0;
    a.startleCooldown = 0;
    a.hitCooldown = 0;
    a.rig.root.position.set(a.x, a.y, a.z);
    a.rig.root.rotation.y = a.heading;
  }

  /**
   * Open-world streaming: agents that are hidden and more than PEDESTRIAN_RECYCLE_DISTANCE from the player
   * are moved to a random sidewalk node 60~180m away (preferably just outside the 80m visible range),
   * so the crowd follows the player across the unified map. Returns how many agents moved.
   */
  public recycleFarAgents(playerX: number, playerZ: number): number {
    const farSq = PEDESTRIAN_RECYCLE_DISTANCE * PEDESTRIAN_RECYCLE_DISTANCE;
    let moved = 0;
    for (const a of this.agents) {
      if (moved >= MAX_RECYCLES_PER_TICK) break;
      if (a.visible || a.fsm === 'FALLEN') continue;
      const dx = a.x - playerX;
      const dz = a.z - playerZ;
      if (dx * dx + dz * dz <= farSq) continue;

      let nodeId = this.graph.randomNodeWithin(
        playerX,
        playerZ,
        RESPAWN_PREFERRED_MIN_RADIUS,
        PEDESTRIAN_RESPAWN_MAX_RADIUS
      );
      if (nodeId < 0) {
        nodeId = this.graph.randomNodeWithin(
          playerX,
          playerZ,
          PEDESTRIAN_RESPAWN_MIN_RADIUS,
          PEDESTRIAN_RESPAWN_MAX_RADIUS
        );
      }
      if (nodeId < 0) break; // no sidewalks near the player (e.g. open field) -> keep agents where they are
      this.placeAgentOnNode(a, nodeId);
      // Stay hidden until the regular culling pass sees it within range
      const ndx = a.x - playerX;
      const ndz = a.z - playerZ;
      a.visible = ndx * ndx + ndz * ndz <= CULL_DISTANCE_SQ;
      a.rig.root.visible = a.visible;
      moved++;
    }
    this.recycledCount += moved;
    return moved;
  }

  /** @internal pedestrians/* */
  startleAudioCooldown = 0;

  public get count(): number {
    return this.agents.length;
  }

  public get visibleCount(): number {
    let n = 0;
    for (const a of this.agents) if (a.visible) n++;
    return n;
  }

  /**
   * Advances all pedestrian FSMs, traffic-signal synchronization, 80m culling,
   * 3.5m sidewalk scooter proximity avoidance reactions, and >= 5 km/h pedestrian collision detection.
   * Completely pauses all tick updates while player is inside underground apartment corridors!
   */
  /** Rain / snow: umbrellas come out and the pace changes */
  public setWeather(mode: WeatherMode): void {
    this.weather = mode;
    this.walkSpeedMul = mode === 'rain' ? PEDESTRIAN_RAIN_PACE : mode === 'snow' ? PEDESTRIAN_SNOW_PACE : 1;
    for (const a of this.agents) setPedestrianWeather(a.rig, mode);
  }

  public update(
    dt: number,
    signal: SignalStateSnapshot,
    playerX: number,
    playerZ: number,
    scooterX: number,
    scooterZ: number,
    inCorridor: boolean,
    scooterInfo?: ScooterProximityInfo,
    onPedestrianCollision?: (event: PedestrianCollisionEvent) => void,
    onPedestrianStartled?: () => void,
    cars: readonly VehicleBody[] = []
  ): void {
    this.cars = cars;
    if (inCorridor) {
      // Pause AI ticks immediately when inside apartment corridor (y = -500)
      return;
    }

    const clampedDt = Math.min(dt, 0.05);
    this.recycleTimer += clampedDt;
    if (this.recycleTimer >= RECYCLE_INTERVAL_SEC) {
      this.recycleTimer = 0;
      this.recycleFarAgents(playerX, playerZ);
    }
    if (this.startleAudioCooldown > 0) {
      this.startleAudioCooldown = Math.max(0, this.startleAudioCooldown - clampedDt);
    }

    const scooter: ScooterProximityInfo = scooterInfo ?? {
      x: scooterX,
      z: scooterZ,
      heading: 0,
      speedMps: 0,
      isRiding: false,
      crashed: false,
    };
    const scooterSpeedKmh = Math.abs(scooter.speedMps) * 3.6;
    // CONSTRAINT: Parked / dismounted scooter or speed < 5 km/h NEVER counts as a pedestrian collision!
    const canCollideWithPedestrian =
      scooter.isRiding && !scooter.crashed && scooterSpeedKmh >= PEDESTRIAN_COLLISION_MIN_KMH;
    const frame: PedFrame = {
      dt: clampedDt,
      signal,
      playerX,
      playerZ,
      scooter,
      scooterSpeedKmh,
      canCollide: canCollideWithPedestrian,
      collisionTriggered: false,
      onPedestrianCollision,
      onPedestrianStartled,
      cars,
    };

    for (const a of this.agents) {
      if (a.hitCooldown > 0) {
        a.hitCooldown = Math.max(0, a.hitCooldown - clampedDt);
      }

      const targetNode = this.graph.getNode(a.toNodeId);
      const dx = targetNode.x - a.x;
      const dz = targetNode.z - a.z;
      const distToTarget = Math.hypot(dx, dz);

      // 80m culling check: beyond 80m, set visible = false and update coordinates only!
      const distPlayerSq = (a.x - playerX) * (a.x - playerX) + (a.z - playerZ) * (a.z - playerZ);
      const isVisible = distPlayerSq <= CULL_DISTANCE_SQ;
      a.visible = isVisible;
      a.rig.root.visible = isVisible;
      // LOD: full 12-part animated rig only close to the player; beyond that one merged mesh
      const fullDetail = isVisible && setPedestrianDetail(a.rig, distPlayerSq <= DETAIL_DISTANCE_SQ);

      const g: AgentFrame = { targetNode, dx, dz, distToTarget, isVisible, fullDetail };
      checkScooterContact(a, frame, g);
      if (stepFallen(this, a, frame, g)) continue;
      if (stepStartle(this, a, frame, g)) continue;
      stepNavigation(this, a, frame, g);
    }
  }

}
