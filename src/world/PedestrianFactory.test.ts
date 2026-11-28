import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PedestrianFactory } from './PedestrianFactory';

describe('pedestrian rig', () => {
  it('a near pedestrian is 5 draw calls (body + 4 limbs) and its limbs still swing on their pivots', () => {
    const f = new PedestrianFactory();
    for (const g of ['male', 'female'] as const) {
      const rig = f.createPedestrian(g);
      let meshes = 0;
      rig.bodyGroup.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshes++;
      });
      expect(meshes).toBe(5);
      for (const p of [rig.leftArmPivot, rig.rightArmPivot, rig.leftLegPivot, rig.rightLegPivot]) {
        expect(p.children).toHaveLength(1);
        expect((p.children[0] as THREE.Mesh).geometry.getAttribute('color')).toBeDefined();
      }
    }
  });
});
