import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TrafficSystem } from './TrafficSystem';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import { signalPhaseAt } from './traffic/trafficSignals';

const DT = 1 / 60;

interface Car {
  x: number;
  z: number;
  heading: number;
  speed: number;
}

/**
 * Behaviour fingerprint: with Math.random seeded, 30 simulated seconds of traffic (signals, following, recycling
 * around a moving rider, a red-light run, pedestrians) must hash the same. Catches refactors that change driving;
 * after an intended behaviour change, update the snapshot with `npx vitest -u`.
 */
function run(): { hash: number; redLights: number; collisions: number; signal: string } {
  let seed = 20261127;
  const origRandom = Math.random;
  Math.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  try {
    const traffic = new TrafficSystem(new THREE.Scene(), []);
    const spawn = ACTIVE_MAP_DATA.meta.playerSpawn;
    let hash = 0;
    const mix = (x: number) => {
      hash = (Math.imul(hash, 31) + (Math.round(x) | 0)) | 0;
    };
    let redLights = 0;
    let collisions = 0;
    const pedestrians = [{ x: spawn.x + 8, z: spawn.z + 3, fsm: 'CROSSING' }];
    for (let i = 0; i < 30 * 60; i++) {
      const t = i * DT;
      // the rider drives a slow circle around the spawn (recycling, player avoidance, red-light checks)
      const px = spawn.x + Math.sin(t * 0.2) * 120;
      const pz = spawn.z + Math.cos(t * 0.2) * 120;
      traffic.step(
        DT,
        t,
        i > 900,
        px,
        pz,
        8,
        true,
        () => redLights++,
        () => collisions++,
        undefined,
        pedestrians
      );
      if (i % 30 === 0) {
        for (const c of traffic.getCarBodies() as unknown as Car[]) {
          mix(c.x * 10);
          mix(c.z * 10);
          mix(c.heading * 100);
          mix(c.speed * 10);
        }
      }
    }
    const s = traffic.signalState;
    return { hash, redLights, collisions, signal: `${s.ns}/${s.ew}` };
  } finally {
    Math.random = origRandom;
  }
}

describe('TrafficSystem behaviour', () => {
  it('drives the same way every run', () => {
    const a = run();
    expect(run()).toEqual(a);
    expect(a).toMatchSnapshot();
  });
});

describe('signalPhaseAt', () => {
  it('cycles NS green -> yellow -> EW green -> yellow every 18s', () => {
    expect(signalPhaseAt(0)).toEqual({ ns: 'green', ew: 'red', remainingSec: 7 });
    expect(signalPhaseAt(8)).toMatchObject({ ns: 'yellow', ew: 'red' });
    expect(signalPhaseAt(10)).toMatchObject({ ns: 'red', ew: 'green', remainingSec: 6 });
    expect(signalPhaseAt(17)).toMatchObject({ ns: 'red', ew: 'yellow' });
    expect(signalPhaseAt(18 + 3)).toEqual(signalPhaseAt(3));
  });
});
