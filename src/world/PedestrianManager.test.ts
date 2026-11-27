import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  PEDESTRIAN_INITIAL_SPAWN_RADIUS,
  PEDESTRIAN_RECYCLE_DISTANCE,
  PEDESTRIAN_RESPAWN_MAX_RADIUS,
  PEDESTRIAN_RESPAWN_MIN_RADIUS,
  PedestrianManager,
  ScooterProximityInfo,
} from './PedestrianManager';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import { SignalStateSnapshot } from './TrafficSystem';

const SIGNAL: SignalStateSnapshot = { ns: 'green', ew: 'red', remainingSec: 30 };
const DT = 1 / 60;

/** Picks a walking pedestrian with a long straight sidewalk stretch ahead of it */
function setup() {
  const mgr = new PedestrianManager(new THREE.Group());
  const a = mgr.agents.find((ag) => {
    if (ag.fsm !== 'WALKING') return false;
    const t = mgr.graph.getNode(ag.toNodeId);
    return Math.hypot(t.x - ag.x, t.z - ag.z) > 12;
  })!;
  expect(a).toBeDefined();
  // Keep only this pedestrian so others can't interfere
  mgr.agents.splice(0, mgr.agents.length, a);
  const t = mgr.graph.getNode(a.toNodeId);
  const len = Math.hypot(t.x - a.x, t.z - a.z);
  const ux = (t.x - a.x) / len;
  const uz = (t.z - a.z) / len;
  a.heading = Math.atan2(ux, uz);
  return { mgr, a, ux, uz };
}

/** Runs the sim, counting how many separate times the pedestrian enters STARTLED */
function run(
  mgr: PedestrianManager,
  seconds: number,
  scooterAt: (t: number) => ScooterProximityInfo
): number {
  const a = mgr.agents[0];
  let entries = 0;
  let prev = a.fsm;
  for (let t = 0; t < seconds; t += DT) {
    const sc = scooterAt(t);
    // Player is seated on the scooter
    mgr.update(DT, SIGNAL, sc.x, sc.z, sc.x, sc.z, false, sc);
    if (a.fsm === 'STARTLED' && prev !== 'STARTLED') entries++;
    prev = a.fsm;
  }
  return entries;
}

describe('PedestrianManager startle reaction', () => {
  it('does not loop startle -> walk -> startle next to a stopped scooter in its path', () => {
    const { mgr, a, ux, uz } = setup();
    const sx = a.x + ux * 3.0;
    const sz = a.z + uz * 3.0;
    const entries = run(mgr, 12, () => ({
      x: sx,
      z: sz,
      heading: Math.atan2(-ux, -uz),
      speedMps: 0,
      isRiding: true,
      crashed: false,
    }));
    expect(entries).toBeLessThanOrEqual(1);
  });

  it('does not keep re-startling while a scooter creeps stop-and-go nearby', () => {
    const { mgr, a, ux, uz } = setup();
    const baseX = a.x + ux * 4.5;
    const baseZ = a.z + uz * 4.5;
    const entries = run(mgr, 12, (t) => {
      // Inch forward 0.8m, pause, back off, repeat (2s period) right around the 3.5m startle radius
      const phase = t % 2;
      const offset = phase < 1 ? phase * 0.8 : (2 - phase) * 0.8;
      return {
        x: baseX - ux * offset,
        z: baseZ - uz * offset,
        heading: Math.atan2(-ux, -uz),
        speedMps: phase < 1 ? 0.8 : -0.8,
        isRiding: true,
        crashed: false,
      };
    });
    expect(entries).toBeLessThanOrEqual(1);
  });

  it('still startles once when a scooter rides straight at the pedestrian', () => {
    const { mgr, a, ux, uz } = setup();
    const startX = a.x + ux * 9;
    const startZ = a.z + uz * 9;
    const speed = 4;
    const entries = run(mgr, 6, (t) => {
      // Ride toward the pedestrian, then stop 2.5m away and wait
      const travelled = Math.min(t * speed, 6.5);
      return {
        x: startX - ux * travelled,
        z: startZ - uz * travelled,
        heading: Math.atan2(-ux, -uz),
        speedMps: travelled < 6.5 ? speed : 0,
        isRiding: true,
        crashed: false,
      };
    });
    expect(entries).toBe(1);
  });
});

describe('PedestrianManager open-world streaming', () => {
  const spawn = ACTIVE_MAP_DATA.meta.playerSpawn;

  it('spawns the initial crowd around the player spawn', () => {
    const mgr = new PedestrianManager(new THREE.Group());
    for (const a of mgr.agents) {
      expect(Math.hypot(a.x - spawn.x, a.z - spawn.z)).toBeLessThanOrEqual(PEDESTRIAN_INITIAL_SPAWN_RADIUS + 21); // <= 20m along the first edge
    }
  });

  it('recycles hidden far-away agents to 60~180m around a player who moved far away', () => {
    const mgr = new PedestrianManager(new THREE.Group());
    // Teleport the player ~2km away onto a sidewalk node
    const far = mgr.graph.randomNodeWithin(spawn.x, spawn.z, 1800, 2400);
    expect(far).toBeGreaterThanOrEqual(0);
    const p = mgr.graph.getNode(far);
    const noScooter: ScooterProximityInfo = { x: p.x, z: p.z, heading: 0, speedMps: 0, isRiding: false, crashed: false };
    for (let t = 0; t < 5; t += DT) {
      mgr.update(DT, SIGNAL, p.x, p.z, p.x, p.z, false, noScooter);
    }
    expect(mgr.recycledCount).toBe(mgr.agents.length);
    for (const a of mgr.agents) {
      const d = Math.hypot(a.x - p.x, a.z - p.z);
      // respawned on a node 60~180m away (<= 20m along its edge), then walked for at most ~5s
      expect(d).toBeGreaterThan(PEDESTRIAN_RESPAWN_MIN_RADIUS - 27);
      expect(d).toBeLessThan(PEDESTRIAN_RESPAWN_MAX_RADIUS + 27);
      expect(['WALKING', 'WAITING_CROSSWALK', 'CROSSING']).toContain(a.fsm);
    }
    // Nobody pops in right next to the player (preferred ring starts just outside the 80m view range)
    expect(mgr.visibleCount).toBeLessThanOrEqual(Math.ceil(mgr.agents.length * 0.25));
  });

  it('never recycles visible agents or ones within the keep radius', () => {
    const mgr = new PedestrianManager(new THREE.Group());
    const before = mgr.agents.map((a) => [a.x, a.z]);
    // Player stands at spawn: all agents are within 180m <= keep radius
    mgr.recycleFarAgents(spawn.x, spawn.z);
    expect(mgr.recycledCount).toBe(0);
    mgr.agents.forEach((a, i) => {
      expect(a.x).toBe(before[i][0]);
      expect(a.z).toBe(before[i][1]);
    });
    expect(PEDESTRIAN_RECYCLE_DISTANCE).toBeGreaterThan(PEDESTRIAN_INITIAL_SPAWN_RADIUS);
  });
});

describe('PedestrianManager and cars', () => {
  const car = (x: number, z: number, heading: number, speed: number) => ({
    x,
    z,
    heading,
    halfLength: 2.15,
    halfWidth: 0.96,
    speed,
  });
  const farScooter: ScooterProximityInfo = { x: 1e5, z: 1e5, heading: 0, speedMps: 0, isRiding: false, crashed: false };

  it('stops instead of walking into a car standing across the sidewalk path', () => {
    const { mgr, a, ux, uz } = setup();
    // car parked across the path 3m ahead (heading perpendicular to the walking direction)
    const c = car(a.x + ux * 3, a.z + uz * 3, Math.atan2(-uz, ux), 0);
    for (let t = 0; t < 8; t += DT) {
      mgr.update(DT, SIGNAL, 1e5, 1e5, 1e5, 1e5, false, farScooter, undefined, undefined, [c]);
      const along = (a.x - c.x) * Math.sin(c.heading) + (a.z - c.z) * Math.cos(c.heading);
      const side = -(a.x - c.x) * Math.cos(c.heading) + (a.z - c.z) * Math.sin(c.heading);
      const inside = Math.abs(along) < c.halfLength + 0.2 && Math.abs(side) < c.halfWidth + 0.2;
      expect(inside).toBe(false);
    }
  });

  it('waits at an unsignalized crossing for an approaching car, then crosses', () => {
    const mgr = new PedestrianManager(new THREE.Group());
    // find an unsignalized crossing edge and put one pedestrian at its curb
    let from = -1;
    let edge = null as ReturnType<typeof mgr.graph.getEdges>[number] | null;
    for (const n of mgr.graph.nodes) {
      const e = mgr.graph.getEdges(n.id).find((ed) => ed.crossesRoad && ed.kind === 'sidewalk' && ed.distance > 8);
      if (e) {
        from = n.id;
        edge = e;
        break;
      }
    }
    expect(edge).not.toBeNull();
    const a = mgr.agents[0];
    mgr.agents.splice(0, mgr.agents.length, a);
    const fn = mgr.graph.getNode(from);
    const tn = mgr.graph.getNode(edge!.to);
    Object.assign(a, { x: fn.x, z: fn.z, fromNodeId: from, prevNodeId: from, toNodeId: edge!.to, activeEdge: edge! });
    a.fsm = 'WAITING_CROSSWALK';
    a.crossWaitTimer = 0;
    // a car driving along the road toward the crossing midpoint, 30m away at 8 m/s
    const ux = (tn.x - fn.x) / edge!.distance;
    const uz = (tn.z - fn.z) / edge!.distance;
    const mx = (fn.x + tn.x) / 2;
    const mz = (fn.z + tn.z) / 2;
    const roadDirX = -uz;
    const roadDirZ = ux;
    const c = car(mx - roadDirX * 30, mz - roadDirZ * 30, Math.atan2(roadDirX, roadDirZ), 8);
    let crossedAt = -1;
    for (let t = 0; t < 12; t += DT) {
      c.x += Math.sin(c.heading) * c.speed * DT;
      c.z += Math.cos(c.heading) * c.speed * DT;
      mgr.update(DT, SIGNAL, fn.x, fn.z, 1e5, 1e5, false, farScooter, undefined, undefined, [c]);
      if ((a.fsm as string) === 'CROSSING' && crossedAt < 0) crossedAt = t;
    }
    // car reaches the crossing at ~3.75s and clears it ~1s later: the pedestrian must not step out before
    expect(crossedAt).toBeGreaterThan(4);
    expect(crossedAt).toBeLessThan(8);
  });
});
