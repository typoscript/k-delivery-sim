import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildApartmentGrounds, planApartmentGrounds } from './apartmentGrounds';
import { collidesWithWorld } from '../types';

const identity = (lx: number, lz: number) => ({ x: lx, z: lz });

describe('apartment grounds', () => {
  it('with room on both sides: 2~4 parked cars to the left and a booth + barrier to the right', () => {
    for (const id of ['apt-1', 'apt-2', 'apt-3', 'apt-77']) {
      const p = planApartmentGrounds(id, identity, () => true)!;
      expect(p.cars).toBeGreaterThanOrEqual(2);
      expect(p.cars).toBeLessThanOrEqual(4);
      expect(p.gate).toBe(true);
    }
    // same lobby, same layout
    expect(planApartmentGrounds('apt-1', identity, () => true)!.parts.length).toBe(
      planApartmentGrounds('apt-1', identity, () => true)!.parts.length,
    );
  });

  it('nothing is placed where it would hit a road or a building', () => {
    expect(planApartmentGrounds('apt-1', identity, () => false)!.parts).toHaveLength(0);
    // left side blocked from x < -8: only the first car fits; right side blocked: no gate
    const p = planApartmentGrounds('apt-1', identity, (x) => x > -8 && x < 4)!;
    expect(p.cars).toBe(1);
    expect(p.gate).toBe(false);
  });

  it('checks the footprint in world space (rotated lobby)', () => {
    const seen: Array<[number, number]> = [];
    const rot = (lx: number, lz: number) => ({ x: 100 + lz, z: 50 - lx }); // 90° turned lobby at (100, 50)
    planApartmentGrounds('apt-9', rot, (x, z) => {
      seen.push([x, z]);
      return true;
    });
    expect(seen.every(([x]) => x > 95 && x < 105)).toBe(true); // cars / gate within a few metres of the facade line
  });

  it('builds one merged vertex-coloured mesh, or none', () => {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const built = buildApartmentGrounds('apt-1', identity, () => true, mat);
    if (built === 'wait') throw new Error('should build');
    expect(built.mesh!.geometry.getAttribute('color')).toBeDefined();
    expect(buildApartmentGrounds('apt-1', identity, () => false, mat)).toEqual({ mesh: null, obstacles: [] });
    built.mesh!.geometry.dispose();
  });

  it('every parked car and the guard booth is a world-space collider (rotated with the lobby)', () => {
    const p = planApartmentGrounds('apt-2', identity, () => true)!;
    expect(p.obstacles).toHaveLength(p.cars + 1);
    // the booth at local (5.2, -1.8)
    expect(collidesWithWorld(5.2, -1.8, 0.4, p.obstacles)).toBe(true);
    // a car at local (-5.4, -3.6), nothing on the open path in front of the lobby
    expect(collidesWithWorld(-5.4, -3.6, 0.4, p.obstacles)).toBe(true);
    expect(collidesWithWorld(0, 2, 0.4, p.obstacles)).toBe(false);
    const rot = (lx: number, lz: number) => ({ x: 100 + lz, z: 50 - lx });
    const r = planApartmentGrounds('apt-2', rot, () => true)!;
    expect(collidesWithWorld(100 - 3.6, 50 + 5.4, 0.4, r.obstacles)).toBe(true);
    expect(r.obstacles[0].pts).toHaveLength(4);
  });

  it('waits while a spot is in a chunk that has not loaded yet (nothing gets built into a building)', () => {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    expect(planApartmentGrounds('apt-1', identity, (x) => (x < -10 ? null : true))).toBeNull();
    expect(buildApartmentGrounds('apt-1', identity, () => null, mat)).toBe('wait');
  });
});
