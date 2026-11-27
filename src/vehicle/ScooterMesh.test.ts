import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { installCanvasStub, sceneFingerprint } from '../test/sceneFingerprint';
import { SCOOTER_MODEL_LIST, SCOOTER_PAINT_LIST } from './ScooterModels';

installCanvasStub();
const { ScooterMesh } = await import('./ScooterMesh');

/** Scooter model per bike / paint (trim kits are toggled, paint recolours materials) */
function build(modelIdx: number, paintIdx: number) {
  const scene = new THREE.Scene();
  const mesh = new ScooterMesh(scene, new THREE.CanvasTexture(document.createElement('canvas') as unknown as HTMLCanvasElement));
  mesh.applyCustomization(SCOOTER_MODEL_LIST[modelIdx].id, SCOOTER_PAINT_LIST[paintIdx].id);
  let visible = 0;
  mesh.root.traverseVisible((o) => {
    if ((o as THREE.Mesh).isMesh) visible++;
  });
  const colors: string[] = [];
  mesh.root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if ((o as THREE.Mesh).isMesh && m?.color) colors.push(m.color.getHexString());
  });
  return { ...sceneFingerprint(mesh.root), visible, colorHash: [...colors.join(',')].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 0), sceneChildren: scene.children.length };
}

/** The scooter (body, trims, cargo box, mirrors, dashboard, phone mount) is deterministic; the snapshot catches changes */
describe('ScooterMesh', () => {
  SCOOTER_MODEL_LIST.forEach((m, i) => {
    it(`builds the same ${m.id} scooter every time`, () => {
      const a = build(i, i % SCOOTER_PAINT_LIST.length);
      expect(build(i, i % SCOOTER_PAINT_LIST.length)).toEqual(a);
      expect(a.meshes).toBeGreaterThan(40);
      expect(a).toMatchSnapshot();
    });
  });
});
