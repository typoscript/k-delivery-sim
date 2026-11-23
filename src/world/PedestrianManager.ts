import * as THREE from 'three';
import { SignalStateSnapshot } from './TrafficSystem';
import { PedestrianFactory, PedestrianRig } from './PedestrianFactory';
import { CrosswalkAxis, PedestrianEdge, PedestrianGraph } from './PedestrianGraph';

export type PedestrianFSMState = 'WALKING' | 'WAITING_CROSSWALK' | 'CROSSING';
export type PedestrianSignalPhase = 'green' | 'blinking' | 'red';

export interface PedestrianAgent {
  id: number;
  rig: PedestrianRig;
  fsm: PedestrianFSMState;
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
}

const SIDEWALK_Y = 0.16;
const ROAD_Y = 0.04;
const CULL_DISTANCE = 80;
const CULL_DISTANCE_SQ = CULL_DISTANCE * CULL_DISTANCE;
const BLINK_THRESHOLD_SEC = 2.2; // last 2.2s of green = blinking -> 1.5x sprint!
const BLINK_RUN_MULTIPLIER = 1.5;

/**
 * Evaluates pedestrian crosswalk signal synchronized with TrafficSystem's 3-color cycle.
 * - Crossing along 'ns' (across EW road) is safe when NS vehicle signal is green.
 * - Crossing along 'ew' (across NS road) is safe when EW vehicle signal is green.
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
 * - Navigates the 25-block PedestrianGraph using a 3-state FSM:
 *   WALKING (1.0~1.3 m/s) <-> WAITING_CROSSWALK (at yellow tactile pad) -> CROSSING (1.5x run when blinking!)
 * - 80m distance culling: hides 3D mesh beyond 80m while keeping lightweight coordinate updates running.
 * - Immediately pauses tick updates & hides group when player enters underground corridors (y = -500).
 */
export class PedestrianManager {
  public readonly root = new THREE.Group();
  public readonly graph = new PedestrianGraph();
  public readonly factory = new PedestrianFactory();
  public readonly agents: PedestrianAgent[] = [];

  constructor(parent: THREE.Object3D, totalCount = 56) {
    // Weight initial spawns slightly toward central blocks while covering all 25 blocks
    const centralNodes = this.graph.nodes.filter(
      (n) => Math.abs(n.x) <= 125 && Math.abs(n.z) <= 125
    );
    const allNodes = this.graph.nodes;

    for (let i = 0; i < totalCount; i++) {
      const pool = i < Math.floor(totalCount * 0.65) ? centralNodes : allNodes;
      const startNode = pool[Math.floor(Math.random() * pool.length)];
      const edges = this.graph.getEdges(startNode.id);
      // Prefer starting on a sidewalk edge so spawns begin cleanly on raised sidewalks
      const sidewalkEdges = edges.filter((e) => e.kind === 'sidewalk');
      const edge =
        sidewalkEdges.length > 0
          ? sidewalkEdges[Math.floor(Math.random() * sidewalkEdges.length)]
          : edges[0];
      const nextNode = this.graph.getNode(edge.to);

      const t = Math.random();
      const sx = startNode.x + (nextNode.x - startNode.x) * t;
      const sz = startNode.z + (nextNode.z - startNode.z) * t;
      const heading = Math.atan2(nextNode.x - startNode.x, nextNode.z - startNode.z);

      const rig = this.factory.createPedestrian();
      rig.root.position.set(sx, SIDEWALK_Y, sz);
      rig.root.rotation.y = heading;
      this.root.add(rig.root);

      this.agents.push({
        id: i + 1,
        rig,
        fsm: 'WALKING',
        fromNodeId: startNode.id,
        toNodeId: nextNode.id,
        prevNodeId: startNode.id,
        activeEdge: edge,
        x: sx,
        y: SIDEWALK_Y,
        z: sz,
        heading,
        walkSpeed: 1.0 + Math.random() * 0.3, // 1.0 ~ 1.3 m/s
        currentSpeed: 0,
        visible: true,
      });
    }

    parent.add(this.root);
  }

  public get count(): number {
    return this.agents.length;
  }

  public get visibleCount(): number {
    let n = 0;
    for (const a of this.agents) if (a.visible) n++;
    return n;
  }

  /**
   * Advances all pedestrian FSMs, traffic-signal synchronization, and 80m culling.
   * Completely pauses all tick updates while player is inside underground apartment corridors!
   */
  public update(
    dt: number,
    signal: SignalStateSnapshot,
    playerX: number,
    playerZ: number,
    scooterX: number,
    scooterZ: number,
    inCorridor: boolean
  ): void {
    if (inCorridor) {
      // Pause AI ticks immediately when inside apartment corridor (y = -500)
      return;
    }

    const clampedDt = Math.min(dt, 0.05);

    for (const a of this.agents) {
      const targetNode = this.graph.getNode(a.toNodeId);
      const dx = targetNode.x - a.x;
      const dz = targetNode.z - a.z;
      const distToTarget = Math.hypot(dx, dz);

      // 80m culling check: beyond 80m, set visible = false and update coordinates only!
      const distPlayerSq = (a.x - playerX) * (a.x - playerX) + (a.z - playerZ) * (a.z - playerZ);
      const isVisible = distPlayerSq <= CULL_DISTANCE_SQ;
      a.visible = isVisible;
      a.rig.root.visible = isVisible;

      // Determine desired FSM speed
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
        // WALKING along sidewalk centerlines
        // Politely pause if rider/scooter is right in front on the sidewalk
        if (isVisible) {
          const distScooterSq =
            (a.x - scooterX) * (a.x - scooterX) + (a.z - scooterZ) * (a.z - scooterZ);
          if (distPlayerSq < 1.9 * 1.9 || distScooterSq < 2.2 * 2.2) {
            desiredSpeed = 0;
          }
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
        PedestrianFactory.updateWalkAnimation(a.rig, a.currentSpeed, clampedDt);
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
