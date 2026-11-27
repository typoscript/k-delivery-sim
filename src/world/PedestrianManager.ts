import * as THREE from 'three';
import { excludeFromMirrors } from './renderLayers';
import { SignalStateSnapshot } from './TrafficSystem';
import { PedestrianFactory, setPedestrianDetail, PedestrianRig } from './PedestrianFactory';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import { CrosswalkAxis, PedestrianEdge, PedestrianGraph } from './PedestrianGraph';

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
}

const SIDEWALK_Y = 0.16;
const ROAD_Y = 0.04;
const CULL_DISTANCE = 80;
const CULL_DISTANCE_SQ = CULL_DISTANCE * CULL_DISTANCE;
/** Within this distance pedestrians use the full articulated rig, beyond it the merged far-LOD mesh */
export const PEDESTRIAN_DETAIL_DISTANCE = 32;
const DETAIL_DISTANCE_SQ = PEDESTRIAN_DETAIL_DISTANCE * PEDESTRIAN_DETAIL_DISTANCE;
const BLINK_THRESHOLD_SEC = 2.2; // last 2.2s of green = blinking -> 1.5x sprint!
const BLINK_RUN_MULTIPLIER = 1.5;

// Sidewalk scooter avoidance & pedestrian accident constants
export const PEDESTRIAN_STARTLE_RADIUS = 3.5; // 3.5m proximity flinch & evasive sidestep!
export const PEDESTRIAN_COLLISION_MIN_KMH = 5.0; // >= 5 km/h riding required to count as accident!
const PEDESTRIAN_SPHERE_RADIUS = 0.42;
const SCOOTER_SPHERE_RADIUS = 0.72;
const COLLISION_DIST = PEDESTRIAN_SPHERE_RADIUS + SCOOTER_SPHERE_RADIUS; // 1.14m bounding-sphere contact
const FALL_RECOVERY_SEC = 6.0;
const STARTLE_HOLD_SEC = 1.15;
const EVADE_STEP_DIST = 0.62;
const STARTLE_MIN_CLOSING_MPS = 1.2; // scooter must be moving TOWARD the pedestrian faster than a walk to be scary
const STARTLE_RELEASE_RADIUS = PEDESTRIAN_STARTLE_RADIUS + 1.0; // hysteresis: calm down only once clearly away
const STARTLE_COOLDOWN_SEC = 4.0; // no re-startle right after recovering (walk-around logic handles a parked bike)
const STARTLE_PANIC_RADIUS = 1.6; // ...unless the scooter charges in this close at speed
const SIDEWALK_YIELD_SEC = 1.6; // wait this long for a blocker ahead, then walk around it
const DETOUR_SPEED = 1.1; // m/s sideways drift while walking around a blocker

// Open-world population streaming: keep the crowd around the player on the 6km unified map
export const PEDESTRIAN_INITIAL_SPAWN_RADIUS = 180; // initial spawns within this radius of the player spawn
export const PEDESTRIAN_RECYCLE_DISTANCE = 220; // hidden agents farther than this get moved near the player
export const PEDESTRIAN_RESPAWN_MIN_RADIUS = 60;
export const PEDESTRIAN_RESPAWN_MAX_RADIUS = 180;
const RESPAWN_PREFERRED_MIN_RADIUS = CULL_DISTANCE + 6; // prefer popping in just outside the visible range
const RECYCLE_INTERVAL_SEC = 0.5;
const MAX_RECYCLES_PER_TICK = 8;

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
  public readonly root = new THREE.Group();
  public readonly graph = new PedestrianGraph();
  public readonly factory = new PedestrianFactory();
  public readonly agents: PedestrianAgent[] = [];

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
    const sidewalkEdges = edges.filter((e) => e.kind === 'sidewalk');
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

  private startleAudioCooldown = 0;

  public get count(): number {
    return this.agents.length;
  }

  public get visibleCount(): number {
    let n = 0;
    for (const a of this.agents) if (a.visible) n++;
    return n;
  }

  /**
   * Checks oriented AABB + BoundingSphere overlap between a pedestrian cylinder (r=0.42m)
   * and the player's delivery scooter (width=1.04m, length=1.84m, sphere r=0.72m).
   */
  private isScooterTouchingPedestrian(
    pedX: number,
    pedZ: number,
    scooter: ScooterProximityInfo
  ): boolean {
    const dx = pedX - scooter.x;
    const dz = pedZ - scooter.z;
    const distSq = dx * dx + dz * dz;
    // Fast broad-phase BoundingSphere reject (1.5m)
    if (distSq > 2.25) return false;
    // Direct BoundingSphere contact (0.42 + 0.72 = 1.14m)
    if (distSq <= COLLISION_DIST * COLLISION_DIST) return true;

    // Oriented AABB check in scooter local frame (heading=0 -> +Z forward, +X left)
    const fwdX = Math.sin(scooter.heading);
    const fwdZ = Math.cos(scooter.heading);
    const leftX = Math.cos(scooter.heading);
    const leftZ = -Math.sin(scooter.heading);

    const localForward = dx * fwdX + dz * fwdZ;
    const localLeft = dx * leftX + dz * leftZ;
    const halfLen = 0.92 + PEDESTRIAN_SPHERE_RADIUS;
    const halfWid = 0.52 + PEDESTRIAN_SPHERE_RADIUS;
    return Math.abs(localForward) <= halfLen && Math.abs(localLeft) <= halfWid;
  }

  /**
   * Advances all pedestrian FSMs, traffic-signal synchronization, 80m culling,
   * 3.5m sidewalk scooter proximity avoidance reactions, and >= 5 km/h pedestrian collision detection.
   * Completely pauses all tick updates while player is inside underground apartment corridors!
   */
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
    onPedestrianStartled?: () => void
  ): void {
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
    let collisionTriggeredThisStep = false;

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

      // --- A. Direct Contact Collision Detection (BoundingSphere + AABB, ONLY when riding >= 5 km/h!) ---
      if (
        isVisible &&
        canCollideWithPedestrian &&
        !collisionTriggeredThisStep &&
        a.fsm !== 'FALLEN' &&
        a.hitCooldown <= 0 &&
        this.isScooterTouchingPedestrian(a.x, a.z, scooter)
      ) {
        collisionTriggeredThisStep = true;
        if (a.fsm === 'WALKING' || a.fsm === 'WAITING_CROSSWALK' || a.fsm === 'CROSSING') {
          a.resumeFsm = a.fsm;
        }
        a.fsm = 'FALLEN';
        a.currentSpeed = 0;
        a.reactionTimer = FALL_RECOVERY_SEC;
        a.hitCooldown = FALL_RECOVERY_SEC + 1.5;

        const relX = a.x - scooter.x;
        const relZ = a.z - scooter.z;
        const leftX = Math.cos(scooter.heading);
        const leftZ = -Math.sin(scooter.heading);
        const sideDot = relX * leftX + relZ * leftZ;
        const hitSide = sideDot >= 0 ? 1 : -1;
        a.fallSide = hitSide;

        // Nudge fallen pedestrian slightly clear of the scooter impact vector
        const norm = Math.hypot(relX, relZ) || 1;
        a.x += (relX / norm) * 0.55;
        a.z += (relZ / norm) * 0.55;
        a.heading = Math.atan2(scooter.x - a.x, scooter.z - a.z);

        if (onPedestrianCollision) {
          onPedestrianCollision({
            pedestrianId: a.id,
            pedX: a.x,
            pedZ: a.z,
            impactSpeedKmh: scooterSpeedKmh,
            hitSide,
          });
        }
      }

      // --- B. Fallen State Handling ---
      if (a.fsm === 'FALLEN') {
        a.currentSpeed = 0;
        a.reactionTimer -= clampedDt;
        if (a.reactionTimer <= 0) {
          // Knocked down mid-crosswalk -> keep CROSSING so the signal-aware sprint logic finishes the crossing
          a.fsm = a.resumeFsm;
        }
        if (isVisible) {
          a.rig.root.position.set(a.x, a.y, a.z);
          a.rig.root.rotation.y = a.heading;
          PedestrianFactory.updateFallenAnimation(a.rig, a.fallSide, clampedDt);
        }
        continue;
      }

      // --- C. Sidewalk Scooter 3.5m Proximity Startle & Evasive Sidestep Reaction ---
      const sdx = scooter.x - a.x;
      const sdz = scooter.z - a.z;
      const distScooter = Math.hypot(sdx, sdz);

      // Only a scooter actually MOVING TOWARD the pedestrian is a threat. A stopped / idling / departing
      // scooter is not, otherwise the sidestep pushes the pedestrian just outside the radius, it resumes
      // walking back inside, and gets startled again in an endless startle -> walk -> startle loop.
      if (a.startleCooldown > 0) a.startleCooldown = Math.max(0, a.startleCooldown - clampedDt);
      const scVelX = Math.sin(scooter.heading) * scooter.speedMps;
      const scVelZ = Math.cos(scooter.heading) * scooter.speedMps;
      // Component of scooter velocity pointing at the pedestrian (scooter -> ped = -sd)
      const closingSpeed = distScooter > 0.01 ? -(sdx * scVelX + sdz * scVelZ) / distScooter : 0;
      const scooterActive = isVisible && scooter.isRiding && !scooter.crashed;

      // Trigger startled avoidance when a riding scooter approaches within 3.5m (forward or lateral)
      let scooterThreatNear = false;
      if (scooterActive && distScooter <= PEDESTRIAN_STARTLE_RADIUS && closingSpeed >= STARTLE_MIN_CLOSING_MPS) {
        const pedFx = Math.sin(a.heading);
        const pedFz = Math.cos(a.heading);
        const toScooterDot = distScooter > 0.01 ? (sdx * pedFx + sdz * pedFz) / distScooter : 1;
        // Front or lateral hemisphere (dot >= -0.35), or very close from any direction (<= 2.6m)
        if (toScooterDot >= -0.35 || distScooter <= 2.6) {
          scooterThreatNear = true;
        }
      }
      // Right after recovering, only a scooter charging in very close can re-trigger a startle
      if (scooterThreatNear && a.fsm !== 'STARTLED' && a.startleCooldown > 0 && distScooter > STARTLE_PANIC_RADIUS) {
        scooterThreatNear = false;
      }
      // While already startled, stay alert until the scooter is clearly away or no longer approaching
      const scooterStillThreat =
        scooterActive && distScooter <= STARTLE_RELEASE_RADIUS && closingSpeed > STARTLE_MIN_CLOSING_MPS * 0.5;

      if (scooterThreatNear) {
        if (a.fsm !== 'STARTLED') {
          if (a.fsm === 'WALKING' || a.fsm === 'WAITING_CROSSWALK' || a.fsm === 'CROSSING') {
            a.resumeFsm = a.fsm;
          }
          a.fsm = 'STARTLED';
          a.currentSpeed = 0;
          a.reactPhase = 0;
          a.evadeRemaining = EVADE_STEP_DIST;

          // Compute evasive sidestep vector away from the scooter's path
          const awayLen = distScooter > 0.05 ? distScooter : 1;
          a.evadeDirX = -sdx / awayLen;
          a.evadeDirZ = -sdz / awayLen;

          if (onPedestrianStartled && this.startleAudioCooldown <= 0) {
            this.startleAudioCooldown = 1.6;
            onPedestrianStartled();
          }
        }
        a.reactionTimer = STARTLE_HOLD_SEC;
      }

      if (a.fsm === 'STARTLED') {
        a.currentSpeed = 0;
        a.reactPhase += clampedDt;
        a.reactionTimer -= clampedDt;

        // Turn quickly to face the approaching scooter
        if (distScooter > 0.08) {
          const faceScooter = Math.atan2(sdx, sdz);
          a.heading = this.lerpAngle(a.heading, faceScooter, Math.min(1, clampedDt * 14));
        }

        // Quick defensive sidestep back (~0.62m) away from scooter
        if (a.evadeRemaining > 0.01) {
          const step = Math.min(a.evadeRemaining, 2.2 * clampedDt);
          a.x += a.evadeDirX * step;
          a.z += a.evadeDirZ * step;
          a.evadeRemaining -= step;
        }

        if (a.reactionTimer <= 0 && !scooterStillThreat) {
          a.fsm = a.resumeFsm;
          a.startleCooldown = STARTLE_COOLDOWN_SEC;
        }

        if (isVisible) {
          a.rig.root.position.set(a.x, a.y, a.z);
          a.rig.root.rotation.y = a.heading;
          PedestrianFactory.updateStartledAnimation(a.rig, a.reactPhase, clampedDt);
        }
        continue;
      }

      // --- D. Standard FSM Navigation (WALKING / WAITING_CROSSWALK / CROSSING) ---
      let desiredSpeed = a.walkSpeed;

      if (a.fsm === 'WAITING_CROSSWALK') {
        desiredSpeed = 0;
        const axis = a.activeEdge.crossingAxis ?? 'ns';
        const pedSig = evaluatePedestrianSignal(axis, signal);

        // Face across the crosswalk while waiting at the yellow tactile pad
        if (distToTarget > 0.1) {
          a.heading = this.lerpAngle(a.heading, Math.atan2(dx, dz), Math.min(1, clampedDt * 8));
        }

        // Crosswalk light turned solid green -> step off curb and start CROSSING!
        if (pedSig === 'green') {
          a.fsm = 'CROSSING';
          desiredSpeed = a.walkSpeed;
        }
      } else if (a.fsm === 'CROSSING') {
        const axis = a.activeEdge.crossingAxis ?? 'ns';
        const pedSig = evaluatePedestrianSignal(axis, signal);
        // Blinking green (or turning yellow/red while already in road) -> sprint at 1.5x speed!
        desiredSpeed =
          pedSig === 'blinking' || pedSig === 'red'
            ? a.walkSpeed * BLINK_RUN_MULTIPLIER
            : a.walkSpeed;

        if (distToTarget < 0.45) {
          // Reached opposite sidewalk tactile pad -> resume WALKING!
          this.advanceToNextEdge(a, signal);
        }
      } else {
        // WALKING along sidewalk centerlines.
        // Politely pause if the on-foot player or a parked scooter is right IN FRONT (never for ones behind),
        // then walk around it after a short wait instead of freezing forever.
        let detour = 0;
        if (isVisible && distToTarget > 0.05) {
          const ux = dx / distToTarget;
          const uz = dz / distToTarget;
          const blockers: Array<[number, number, number]> = [
            [playerX, playerZ, 1.9],
            [scooter.x, scooter.z, 2.2],
          ];
          for (const [bx, bz, radius] of blockers) {
            const rx = bx - a.x;
            const rz = bz - a.z;
            const ahead = rx * ux + rz * uz;
            const lateral = rx * -uz + rz * ux;
            if (ahead > 0 && ahead < radius && Math.abs(lateral) < 1.0) {
              // (-uz, ux) = forward x up = RIGHT; lateral > 0 -> blocker on the right -> detour to the left
              detour = lateral >= 0 ? 1 : -1;
              break;
            }
          }
        }
        if (detour !== 0) {
          a.yieldTimer += clampedDt;
          if (a.yieldTimer < SIDEWALK_YIELD_SEC) {
            desiredSpeed = 0;
          } else {
            // Walk around: drift sideways (perpendicular to the path) while continuing forward slowly
            desiredSpeed = a.walkSpeed * 0.6;
            const ux = dx / distToTarget;
            const uz = dz / distToTarget;
            const sideX = uz * detour;
            const sideZ = -ux * detour;
            a.x += sideX * DETOUR_SPEED * clampedDt;
            a.z += sideZ * DETOUR_SPEED * clampedDt;
          }
        } else {
          a.yieldTimer = 0;
        }

        if (distToTarget < 0.45) {
          this.advanceToNextEdge(a, signal);
        }
      }

      // Smooth acceleration / deceleration for natural Idle <-> Walk <-> Run transitions
      a.currentSpeed += (desiredSpeed - a.currentSpeed) * Math.min(1, clampedDt * 9);
      if (desiredSpeed === 0 && a.currentSpeed < 0.03) {
        a.currentSpeed = 0;
      }

      // Integrate logical (x, z) coordinates (runs even beyond 80m for seamless city flow!)
      if (a.currentSpeed > 0.01 && distToTarget > 0.05) {
        const moveDist = Math.min(a.currentSpeed * clampedDt, distToTarget);
        const nx = dx / distToTarget;
        const nz = dz / distToTarget;
        a.x += nx * moveDist;
        a.z += nz * moveDist;

        const targetHeading = Math.atan2(nx, nz);
        a.heading = this.lerpAngle(a.heading, targetHeading, Math.min(1, clampedDt * 9));
      }

      // Smooth curb step height (y=0.16 on sidewalks, y=0.04 on crosswalk asphalt)
      const targetY =
        a.fsm === 'CROSSING' && distToTarget > 1.8 && distToTarget < a.activeEdge.distance - 1.8
          ? ROAD_Y
          : SIDEWALK_Y;
      a.y += (targetY - a.y) * Math.min(1, clampedDt * 12);

      // Only update 3D transforms & procedural limb animation for visible pedestrians within 80m!
      if (isVisible) {
        a.rig.root.position.set(a.x, a.y, a.z);
        a.rig.root.rotation.y = a.heading;
        if (fullDetail) PedestrianFactory.updateWalkAnimation(a.rig, a.currentSpeed, clampedDt);
      }
    }
  }

  private advanceToNextEdge(a: PedestrianAgent, signal: SignalStateSnapshot): void {
    const arrivedNode = this.graph.getNode(a.toNodeId);
    a.x = arrivedNode.x;
    a.z = arrivedNode.z;
    a.prevNodeId = a.fromNodeId;
    a.fromNodeId = arrivedNode.id;

    const nextEdge = this.graph.pickNextEdge(arrivedNode.id, a.prevNodeId);
    a.activeEdge = nextEdge;
    a.toNodeId = nextEdge.to;

    if (nextEdge.kind === 'crosswalk') {
      const axis = nextEdge.crossingAxis ?? 'ns';
      const pedSig = evaluatePedestrianSignal(axis, signal);
      if (pedSig === 'green') {
        a.fsm = 'CROSSING';
      } else {
        // Stop cleanly at the yellow tactile block until green light!
        a.fsm = 'WAITING_CROSSWALK';
        a.currentSpeed = 0;
      }
    } else {
      a.fsm = 'WALKING';
    }
  }

  private lerpAngle(cur: number, target: number, alpha: number): number {
    let diff = target - cur;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return cur + diff * alpha;
  }
}
