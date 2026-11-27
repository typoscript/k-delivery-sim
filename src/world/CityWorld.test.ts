import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { installCanvasStub, sceneFingerprint } from '../test/sceneFingerprint';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';

installCanvasStub();
// Streamed chunks load asynchronously over fetch; keep them out of the (synchronous) build being checked
globalThis.fetch = (() => new Promise(() => {})) as typeof fetch;
const { CityWorld } = await import('./CityWorld');

/** Builds the open world and lets the proximity culler build the lazy props around the spawn and a 2nd spot */
function buildAround(): ReturnType<typeof sceneFingerprint> {
  const world = new CityWorld(new THREE.Scene());
  const s = ACTIVE_MAP_DATA.meta.playerSpawn;
  world.updateStreaming(s.x, s.z);
  const stop = world.busStops[Math.floor(world.busStops.length / 2)];
  world.updateStreaming(stop.x, stop.z);
  return sceneFingerprint(world.root);
}

/**
 * The built city is deterministic. The snapshot catches any refactor that changes what gets built (meshes, sizes,
 * positions); after an intended change, update it with `npx vitest -u`.
 */
describe('CityWorld build (open world)', () => {
  it('builds the same scene every time', () => {
    const a = buildAround();
    expect(buildAround()).toEqual(a);
    expect(a.meshes).toBeGreaterThan(100);
    expect(a).toMatchSnapshot();
  });
});
