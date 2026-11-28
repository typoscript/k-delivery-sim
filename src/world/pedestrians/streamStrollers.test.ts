import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DESPAWN_M, MAX_STROLLERS, StreamStrollers, lineLength, stoneRowStations, walkwayPoint } from './streamStrollers';
import { WALKWAY_M } from '../streamPaths';

// a 10 m wide stream running north (+Z) for 300 m
const stream = { name: '수원천', width: 10, pts: [[0, 0], [0, 300]] as Array<[number, number]> };

describe('stream strollers', () => {
  it('walkway points sit on the bank, left / right of the flow', () => {
    expect(lineLength(stream)).toBe(300);
    const left = walkwayPoint(stream, 100, 1);
    const right = walkwayPoint(stream, 100, -1);
    expect(left.z).toBeCloseTo(100);
    expect(left.x).toBeCloseTo(5 + WALKWAY_M / 2); // +X is left of a north heading
    expect(right.x).toBeCloseTo(-(5 + WALKWAY_M / 2));
    expect([left.fx, left.fz]).toEqual([0, 1]);
  });

  it('knows where the stepping-stone rows are along the path', () => {
    expect(stoneRowStations(stream)).toEqual([60, 180]);
  });

  it('keeps a few strollers around the player on the walkways, crossing on the stones now and then', () => {
    const parent = new THREE.Group();
    const s = new StreamStrollers(parent);
    let crossed = false;
    for (let i = 0; i < 30 * 240; i++) {
      s.update(1 / 30, 0, 150, [stream]);
      for (const p of s.positions()) {
        // on a walkway, or on the stone rows while crossing
        if (p.crossing) {
          crossed = true;
          expect(Math.min(Math.abs(p.z - 60), Math.abs(p.z - 180))).toBeLessThan(1.2);
        } else {
          expect(Math.abs(Math.abs(p.x) - (5 + WALKWAY_M / 2))).toBeLessThan(1e-6);
        }
        expect(p.z).toBeGreaterThanOrEqual(-1e-6);
        expect(p.z).toBeLessThanOrEqual(300 + 1e-6);
      }
    }
    expect(s.count).toBeGreaterThan(0);
    expect(s.count).toBeLessThanOrEqual(MAX_STROLLERS);
    expect(crossed).toBe(true);
    // the player leaves: they go away; the stream unloads: too
    s.update(1 / 60, 0, 150 + DESPAWN_M + 400, [stream]);
    expect(s.count).toBe(0);
    s.update(1 / 60, 0, 150, [stream]);
    s.update(1 / 60, 0, 150, []);
    expect(s.count).toBe(0);
  });
});

describe('stream strollers and roads', () => {
  it('turn back where a road crosses the walkway and never start on it', () => {
    const s = new StreamStrollers(new THREE.Group());
    const road = (_x: number, z: number) => Math.abs(z - 150) - 6; // a 12 m road across at z = 150
    for (let i = 0; i < 30 * 120; i++) {
      s.update(1 / 30, 0, 150, [stream], road);
      for (const p of s.positions()) expect(road(p.x, p.z)).toBeGreaterThan(0);
    }
    expect(s.count).toBeGreaterThan(0);
  });
});
