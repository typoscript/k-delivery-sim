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

  it('a lazy prop that is not ready yet is retried every update until it builds (and dropped when out of range)', () => {
    const c = new ProximityCuller(SPEC, 1);
    const parent = new THREE.Group();
    let ready = false;
    let attempts = 0;
    c.registerLazy(parent, 100, 100, () => {
      attempts++;
      return ready ? { object: new THREE.Object3D(), dispose: () => {} } : null;
    }, 1, 3);
    c.update(0, 0);
    c.update(0, 0); // same chunk: retried anyway
    expect(attempts).toBe(2);
    expect(parent.children).toHaveLength(0);
    ready = true;
    c.update(10, 10);
    expect(parent.children).toHaveLength(1);
    c.update(10, 10);
    expect(attempts).toBe(3); // built: no more retries
    // a waiting entry that goes out of range stops being retried
    let waiting = 0;
    c.registerLazy(parent, 150, 150, () => (waiting++, null), 1, 3);
    c.update(0, 0);
    c.update(850, 850); // far away
    const before = waiting;
    c.update(850, 850);
    expect(waiting).toBe(before);
  });

  it('rebuildLazy drops the live props of one parent so the next update builds them again', () => {
    const c = new ProximityCuller(SPEC, 1);
    const a = new THREE.Group();
    const b = new THREE.Group();
    let builtA = 0;
    let disposedA = 0;
    let builtB = 0;
    c.registerLazy(a, 100, 100, () => (builtA++, { object: new THREE.Object3D(), dispose: () => disposedA++ }), 1, 3);
    c.registerLazy(b, 100, 100, () => (builtB++, { object: new THREE.Object3D(), dispose: () => {} }), 1, 3);
    c.update(0, 0);
    expect([builtA, builtB, c.liveLazyCount]).toEqual([1, 1, 2]);
    c.rebuildLazy(a);
    expect([disposedA, a.children.length, c.liveLazyCount]).toEqual([1, 0, 1]);
    c.update(0, 0); // same chunk: still rebuilt
    expect([builtA, builtB, a.children.length, c.liveLazyCount]).toEqual([2, 1, 1, 2]);
  });
});
