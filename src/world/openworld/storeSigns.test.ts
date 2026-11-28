import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SIGN_OUT_M, SIGN_Y0, SIGN_Y1, StoreSigns, signCorners, signGeometry } from './storeSigns';
import type { ChunkData } from './OpenWorldTypes';
import { installCanvasStub } from '../../test/sceneFingerprint';

installCanvasStub();

const sign = { n: 'GS25 매탄점', x: 3, z: 8, h: 0, w: 5 }; // on a wall facing +Z

describe('storefront signs', () => {
  it('sits in front of the wall on the sign band, left to right as seen from the street', () => {
    const { bl, br, tl } = signCorners(sign);
    expect(bl[2]).toBeCloseTo(8 + SIGN_OUT_M);
    expect(bl[1]).toBe(SIGN_Y0);
    expect(tl[1]).toBe(SIGN_Y1);
    // the viewer stands at +Z looking -Z (heading 180°): +X is on their right, so the text runs toward +X
    expect(br[0]).toBeGreaterThan(bl[0]);
    expect(Math.abs(br[0] - bl[0])).toBeCloseTo(5);
  });

  it('one quad per sign, every face toward the street, uv rows into the atlas', () => {
    const g = signGeometry([sign, { ...sign, n: '약국', x: -10 }]);
    expect(g.attributes.position.count).toBe(12);
    const p = g.attributes.position.array;
    const a = new THREE.Vector3(p[0], p[1], p[2]);
    const b = new THREE.Vector3(p[3], p[4], p[5]);
    const c = new THREE.Vector3(p[6], p[7], p[8]);
    const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
    expect(n.z).toBeGreaterThan(0); // front face toward +Z (the street)
    const v = Array.from(g.attributes.uv.array).filter((_, i) => i % 2 === 1);
    expect(Math.max(...v.slice(0, 6))).toBeCloseTo(1); // first sign: top row
    expect(Math.min(...v.slice(6))).toBeCloseTo(0); // second: bottom row
  });

  it('builds the chunks around the player and frees the ones left behind', () => {
    const chunk = (ix: number, iz: number, n = 1): ChunkData =>
      ({ ix, iz, buildings: [], parks: [], waters: [], waterLines: [], pedestrianPlazas: [], signs: Array.from({ length: n }, () => sign) }) as ChunkData;
    const built = [chunk(5, 5), chunk(6, 5, 2), chunk(9, 9)];
    const s = new StoreSigns(new THREE.Group());
    let reads = 0;
    s.update(5, 5, 1, () => (reads++, built));
    expect(s.count).toBe(2);
    s.update(5, 5, 1, () => (reads++, built)); // nothing changed: not even read
    expect(reads).toBe(1);
    s.update(9, 9, 1, () => built);
    expect(s.count).toBe(1);
  });
});
