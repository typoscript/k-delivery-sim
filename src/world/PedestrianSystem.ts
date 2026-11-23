import * as THREE from 'three';
import { PedestrianFactory, PedestrianRig } from './PedestrianFactory';

interface SidewalkAgent {
  rig: PedestrianRig;
  waypoints: Array<{ x: number; z: number }>;
  wpIndex: number;
  x: number;
  z: number;
  heading: number;
  baseWalkSpeed: number;
  currentSpeed: number;
  idleTimer: number; // pauses naturally at corners/shops -> transitions smoothly to Idle stance
}

const SIDEWALK_Y = 0.16;
const CULL_DISTANCE_SQ = 165 * 165;

/**
 * Manages low-poly Korean sidewalk pedestrians across central & nearby city blocks.
 * Parented to outdoor city root so entering underground corridors occludes them with 0 GPU/CPU cost.
 */
export class PedestrianSystem {
  public readonly root = new THREE.Group();
  public readonly factory = new PedestrianFactory();
  private readonly agents: SidewalkAgent[] = [];

  constructor(parent: THREE.Object3D) {
    // Perimeter sidewalk loops around core commercial, park, and residential blocks (safely on y=0.16 sidewalks!)
    const blockLoops: Array<{ bx: number; bz: number; count: number }> = [
      { bx: -80, bz: 0, count: 8 }, // Main Restaurant Strip (spawn area!)
      { bx: 0, bz: 0, count: 6 }, // Central Park Plaza
      { bx: 80, bz: 0, count: 5 }, // Green Villa Complex
      { bx: 0, bz: -80, count: 5 }, // South Food Alley
      { bx: -80, bz: -80, count: 4 }, // Gas Station / Community Center block
      { bx: 80, bz: 80, count: 4 }, // Haetsal Apartments
      { bx: 0, bz: 80, count: 4 }, // Riverview Apartments
    ];

    for (const blk of blockLoops) {
      const half = 30.2; // cleanly inside the 65.6m sidewalk platform, outside building footprints
      const cwLoop = [
        { x: blk.bx - half, z: blk.bz - half },
        { x: blk.bx + half, z: blk.bz - half },
        { x: blk.bx + half, z: blk.bz + half },
        { x: blk.bx - half, z: blk.bz + half },
      ];

      for (let i = 0; i < blk.count; i++) {
        const reverse = i % 2 === 1;
        const waypoints = reverse ? [...cwLoop].reverse() : cwLoop;
        const wpStart = i % waypoints.length;
        const wpNext = (wpStart + 1) % waypoints.length;
        const t = Math.random();
        const sx = waypoints[wpStart].x + (waypoints[wpNext].x - waypoints[wpStart].x) * t;
        const sz = waypoints[wpStart].z + (waypoints[wpNext].z - waypoints[wpStart].z) * t;

        const rig = this.factory.createPedestrian();
        const dx = waypoints[wpNext].x - sx;
        const dz = waypoints[wpNext].z - sz;
        const heading = Math.atan2(dx, dz);

        rig.root.position.set(sx, SIDEWALK_Y, sz);
        rig.root.rotation.y = heading;
        this.root.add(rig.root);

        this.agents.push({
          rig,
          waypoints,
          wpIndex: wpNext,
          x: sx,
          z: sz,
          heading,
          baseWalkSpeed: 1.15 + Math.random() * 0.55, // natural 4.1 ~ 6.1 km/h walking speed
          currentSpeed: 0,
          idleTimer: Math.random() < 0.2 ? 1.5 + Math.random() * 2.5 : 0,
        });
      }
    }

    parent.add(this.root);
  }

  public get count(): number {
    return this.agents.length;
  }

  /** Steps sidewalk movement, natural corner pauses, yield-to-player stops, and procedural walk animation */
  public update(
    dt: number,
    playerX: number,
    playerZ: number,
    scooterX: number,
    scooterZ: number
  ): void {
    const clampedDt = Math.min(dt, 0.05);

    for (const a of this.agents) {
      const distPlayerSq = (a.x - playerX) * (a.x - playerX) + (a.z - playerZ) * (a.z - playerZ);
      const visible = distPlayerSq <= CULL_DISTANCE_SQ;
      a.rig.root.visible = visible;
      if (!visible) continue;

      const distScooterSq =
        (a.x - scooterX) * (a.x - scooterX) + (a.z - scooterZ) * (a.z - scooterZ);
      const blockedByRider = distPlayerSq < 2.2 * 2.2 || distScooterSq < 2.5 * 2.5;

      let targetSpeed = a.baseWalkSpeed;
      if (blockedByRider) {
        targetSpeed = 0;
      } else if (a.idleTimer > 0) {
        a.idleTimer = Math.max(0, a.idleTimer - clampedDt);
        targetSpeed = 0;
      } else {
        const wp = a.waypoints[a.wpIndex];
        const dx = wp.x - a.x;
        const dz = wp.z - a.z;
        const dist = Math.hypot(dx, dz);

        if (dist < 0.85) {
          a.wpIndex = (a.wpIndex + 1) % a.waypoints.length;
          // ~35% chance to pause briefly at street corner (showcasing Idle stance transition!)
          if (Math.random() < 0.35) {
            a.idleTimer = 2.0 + Math.random() * 2.8;
            targetSpeed = 0;
          }
        } else {
          const desiredHeading = Math.atan2(dx, dz);
          let diff = desiredHeading - a.heading;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          a.heading += diff * Math.min(1, clampedDt * 6.5);
        }
      }

      a.currentSpeed += (targetSpeed - a.currentSpeed) * Math.min(1, clampedDt * 8.0);
      if (a.currentSpeed < 0.03 && targetSpeed === 0) {
        a.currentSpeed = 0;
      }

      if (a.currentSpeed > 0.01) {
        a.x += Math.sin(a.heading) * a.currentSpeed * clampedDt;
        a.z += Math.cos(a.heading) * a.currentSpeed * clampedDt;
        a.rig.root.position.set(a.x, SIDEWALK_Y, a.z);
        a.rig.root.rotation.y = a.heading;
      }

      PedestrianFactory.updateWalkAnimation(a.rig, a.currentSpeed, clampedDt);
    }
  }
}
