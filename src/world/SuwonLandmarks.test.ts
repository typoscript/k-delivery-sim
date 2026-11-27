import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { installCanvasStub, sceneFingerprint } from '../test/sceneFingerprint';
import { SUWON_OPEN_WORLD } from '../data/suwonUnified';
import { SuwonDistrictId } from '../data/suwonTypes';
import { CityZoneMarker, LandmarkMarker } from '../types';
import { createSignTexture } from './cityTextures';

installCanvasStub();
const { SuwonLandmarksBuilder } = await import('./SuwonLandmarks');

/** Builds one district's landmarks the way the open world does (district-local data) */
function buildDistrict(id: string) {
  const d = SUWON_OPEN_WORLD.legacyDistricts.find((x) => x.id === id)!;
  const root = new THREE.Group();
  const zones: CityZoneMarker[] = [];
  const landmarks: LandmarkMarker[] = [];
  new SuwonLandmarksBuilder({
    root,
    districtId: d.id as SuwonDistrictId,
    mapData: { meta: { station: d.localStation }, buildings: d.namedBuildings },
    zones,
    landmarks,
    createSignTexture,
  });
  return { ...sceneFingerprint(root), zones: zones.length, landmarks: landmarks.map((l) => l.name) };
}

/** Every district's hand-built landmarks are deterministic; the snapshot catches unintended changes */
describe('Suwon landmarks', () => {
  for (const id of SUWON_OPEN_WORLD.legacyDistricts.map((d) => d.id)) {
    it(`builds the same ${id} landmarks every time`, () => {
      const a = buildDistrict(id);
      expect(buildDistrict(id)).toEqual(a);
      expect(a.meshes).toBeGreaterThan(20);
      expect(a).toMatchSnapshot();
    });
  }
});
