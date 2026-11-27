import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PedestrianManager, ScooterProximityInfo } from './PedestrianManager';
import { signalPhaseAt } from './traffic/trafficSignals';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';

const DT = 1 / 60;

/**
 * Behaviour fingerprint: with Math.random seeded, 25 simulated seconds of pedestrians (walking, crossing on the
 * signal cycle, a scooter riding through the crowd -> startles / collisions, a parked car in the way, recycling
 * when the rider moves away) must hash the same. After an intended behaviour change: `npx vitest -u`.
 */
function run() {
  let seed = 4242;
  const origRandom = Math.random;
  Math.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  try {
    const mgr = new PedestrianManager(new THREE.Group());
    const spawn = ACTIVE_MAP_DATA.meta.playerSpawn;
    let hash = 0;
    const mix = (x: number) => {
      hash = (Math.imul(hash, 31) + (Math.round(x) | 0)) | 0;
    };
    let collisions = 0;
    let startles = 0;
    const car = { x: spawn.x + 12, z: spawn.z, heading: 0, halfLength: 2.15, halfWidth: 0.96, speed: 0 };
    for (let i = 0; i < 25 * 60; i++) {
      const t = i * DT;
      // the scooter rides back and forth through the spawn crowd, then leaves (recycling)
      const sx = spawn.x + Math.sin(t * 0.7) * 40 + (t > 18 ? (t - 18) * 60 : 0);
      const sz = spawn.z + Math.cos(t * 0.5) * 25;
      const scooter: ScooterProximityInfo = {
        x: sx,
        z: sz,
        heading: t * 0.7,
        speedMps: 8,
        isRiding: true,
        crashed: false,
      };
      mgr.update(DT, signalPhaseAt(t), sx, sz, sx, sz, false, scooter, () => collisions++, () => startles++, [car]);
      if (i % 30 === 0) {
        for (const a of mgr.agents) {
          mix(a.x * 10);
          mix(a.z * 10);
          mix(a.fsm.length * 7 + a.fsm.charCodeAt(0));
        }
      }
    }
    return { hash, collisions, startles, recycled: mgr.recycledCount, visible: mgr.visibleCount };
  } finally {
    Math.random = origRandom;
  }
}

describe('PedestrianManager behaviour', () => {
  it('moves the same way every run', () => {
    const a = run();
    expect(run()).toEqual(a);
    expect(a).toMatchSnapshot();
  });
});
