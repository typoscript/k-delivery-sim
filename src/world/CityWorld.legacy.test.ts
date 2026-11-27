import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { installCanvasStub, sceneFingerprint } from '../test/sceneFingerprint';

// The `?map=legacy` district map: roads, buildings, parks and props are all built up front (no streaming)
vi.mock('../data/suwonDistricts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../data/suwonDistricts')>();
  return { ...mod, ACTIVE_MAP_DATA: mod.SUWON_DISTRICTS[0].data, IS_UNIFIED_MAP: false, MAP_MODE: 'legacy' };
});

installCanvasStub();
const { CityWorld } = await import('./CityWorld');

describe('CityWorld build (legacy district map)', () => {
  it('builds the same scene every time', () => {
    const a = sceneFingerprint(new CityWorld(new THREE.Scene()).root);
    expect(sceneFingerprint(new CityWorld(new THREE.Scene()).root)).toEqual(a);
    expect(a.meshes).toBeGreaterThan(500);
    expect(a).toMatchSnapshot();
  });
});
