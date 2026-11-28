import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { installCanvasStub } from '../test/sceneFingerprint';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import { SignalStateSnapshot } from './TrafficSystem';

installCanvasStub();
const { RoadHazardManager } = await import('./RoadHazardManager');

/**
 * Behaviour fingerprint: with seeded randomness, building the hazards and riding a fixed path for 90 s (fast past
 * cameras and patrols, then a jump that recycles the moving units) gives the same units, events and props every time.
 * Refactors must keep it; update with `npx vitest -u` only for intended behaviour changes.
 */
function run() {
  let seed = 20240607;
  const origRandom = Math.random;
  Math.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  try {
    const mgr = new RoadHazardManager(new THREE.Group());
    const spawn = ACTIVE_MAP_DATA.meta.playerSpawn;
    const events: string[] = [];
    let hash = 0;
    const mix = (v: number) => {
      hash = (Math.imul(hash, 31) + Math.round(v * 10)) | 0;
    };
    const DT = 1 / 30;
    let x = spawn.x;
    let z = spawn.z;
    let heading = 0.3;
    for (let f = 0; f < 90 * 30; f++) {
      const t = f * DT;
      if (f === 30 * 30) {
        // speed past the speed camera nearest to the spawn (north-bound, 90 km/h)
        const cam = [...mgr.cameraMarkers].sort(
          (a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z),
        )[0];
        x = cam.x;
        z = cam.z - 70;
        heading = 0;
      }
      if (f === 60 * 30) {
        // far jump: moving units recycle around the new spot
        x += 900;
        z -= 600;
      }
      const fast = f >= 30 * 30 && f < 36 * 30;
      if (!fast) heading += Math.sin(t * 0.4) * 0.01;
      const speed = fast ? 25 : 14 + 6 * Math.sin(t * 0.2); // 29~72 km/h, 90 km/h past the camera
      x += Math.sin(heading) * speed * DT;
      z += Math.cos(heading) * speed * DT;
      const signal: SignalStateSnapshot = {
        ns: Math.floor(t / 20) % 2 ? 'red' : 'green',
        ew: Math.floor(t / 20) % 2 ? 'green' : 'red',
        remainingSec: 20 - (t % 20),
      };
      mgr.step(
        DT,
        t,
        false,
        { x, z, heading, speedMps: speed, isRiding: true, crashed: false },
        signal,
        (ev) => events.push(`cam:${ev.cameraId}:${ev.kind}:${Math.round(ev.measuredKmh)}`),
        (ev) => events.push(`pop:${ev.hazardName}`),
        (ev) => events.push(`hit:${ev.pedestrianId}`),
        (over) => events.push(`beep:${over}`),
        (ev) => events.push(`patrol:${ev.cameraId}:${ev.kind}`),
      );
      if (f % 150 === 0)
        for (const u of mgr.movingUnitPositions) {
          mix(u.x);
          mix(u.z);
        }
    }
    for (const e of events) for (let i = 0; i < e.length; i++) hash = (Math.imul(hash, 31) + e.charCodeAt(i)) | 0;
    return {
      events: events.length,
      recycled: mgr.recycledCount,
      placement: mgr.placementCounts,
      obstacles: mgr.getAllObstacleBoxes().length,
      hash,
    };
  } finally {
    Math.random = origRandom;
  }
}

describe('RoadHazardManager behaviour fingerprint', () => {
  it('builds and steps the same way every time', () => {
    const a = run();
    expect(run()).toEqual(a);
    expect(a.recycled).toBeGreaterThan(0);
    expect(a.events).toBeGreaterThan(0); // the camera pass is enforced
    expect(a).toMatchSnapshot();
  });
});
