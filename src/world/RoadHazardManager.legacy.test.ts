import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

// Run this file against a legacy ~0.8km district map (the `?map=legacy` mode)
vi.mock('../data/suwonDistricts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../data/suwonDistricts')>();
  return { ...mod, ACTIVE_MAP_DATA: mod.SUWON_DISTRICTS[0].data, IS_UNIFIED_MAP: false, MAP_MODE: 'legacy' };
});

const { RoadHazardManager } = await import('./RoadHazardManager');
const { PedestrianManager } = await import('./PedestrianManager');

/** Minimal `document.createElement('canvas')` stub so canvas-texture builders run under Vitest's node env */
function installCanvasStub(): void {
  const g = globalThis as unknown as { document?: unknown };
  if (g.document) return;
  const ctx = new Proxy(
    {},
    {
      get: () => () => undefined,
      set: () => true,
    }
  );
  g.document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  };
}

installCanvasStub();

describe('legacy district map', () => {
  it('keeps the original hazard counts', () => {
    const mgr = new RoadHazardManager(new THREE.Group());
    expect(mgr.isLargeMap).toBe(false);
    expect(mgr.placementCounts).toEqual({ cameras: 6, parked: 6, construction: 3 });
    expect(mgr.movingUnitPositions).toHaveLength(6);
  });

  it('still builds pedestrians on the small map', () => {
    const mgr = new PedestrianManager(new THREE.Group());
    expect(mgr.agents).toHaveLength(56);
    expect(mgr.graph.nodes.length).toBeGreaterThan(100);
  });
});
