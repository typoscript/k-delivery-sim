import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildApartmentGrounds, planApartmentGrounds } from './apartmentGrounds';

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
    const mesh = buildApartmentGrounds('apt-1', identity, () => true, mat) as THREE.Mesh;
    expect(mesh.geometry.getAttribute('color')).toBeDefined();
    expect(buildApartmentGrounds('apt-1', identity, () => false, mat)).toBe('none');
    mesh.geometry.dispose();
  });

  it('waits while a spot is in a chunk that has not loaded yet (nothing gets built into a building)', () => {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    expect(planApartmentGrounds('apt-1', identity, (x) => (x < -10 ? null : true))).toBeNull();
    expect(buildApartmentGrounds('apt-1', identity, () => null, mat)).toBe('wait');
  });
});
