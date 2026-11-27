import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ProximityCuller } from './ProximityCuller';

const SPEC = { originX: -1000, originZ: -1000, cols: 10, rows: 10, size: 200 };

describe('ProximityCuller', () => {
  it('shows only props within the chunk radius and re-evaluates on chunk change', () => {
    const c = new ProximityCuller(SPEC, 2);
    const near = new THREE.Object3D();
    const far = new THREE.Object3D();
    c.register(near, 50, 50);
    c.register(far, 900, 900);
    c.update(0, 0);
    expect(near.visible).toBe(true);
    expect(far.visible).toBe(false);
    c.update(850, 850);
    expect(near.visible).toBe(false);
    expect(far.visible).toBe(true);
  });

  it('builds lazy props on approach and disposes them when far away', () => {
    const c = new ProximityCuller(SPEC, 1);
    const parent = new THREE.Group();
    let built = 0;
    let disposed = 0;
    c.registerLazy(parent, 100, 100, () => {
      built++;
      return { object: new THREE.Object3D(), dispose: () => disposed++ };
    }, 1, 3);
    c.update(-900, -900);
    expect(built).toBe(0);
    c.update(100, 100);
    expect(built).toBe(1);
    expect(parent.children).toHaveLength(1);
    c.update(350, 100); // 1-2 chunks away: still alive (hysteresis)
    expect(disposed).toBe(0);
    c.update(900, 900);
    expect(disposed).toBe(1);
    expect(parent.children).toHaveLength(0);
    c.update(100, 100);
    expect(built).toBe(2);
  });
});
