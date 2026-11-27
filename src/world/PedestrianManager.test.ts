import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PedestrianManager, ScooterProximityInfo } from './PedestrianManager';
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
