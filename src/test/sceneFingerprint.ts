import * as THREE from 'three';

/** Minimal `document.createElement('canvas')` stub so canvas-texture builders run under Vitest's node env */
export function installCanvasStub(): void {
  const g = globalThis as unknown as { document?: unknown };
  if (g.document) return;
  // Every property is a function returning the same chainable stub (gradients, measureText(), patterns ...)
  const stub: unknown = new Proxy(function () {}, {
    get: (_t, key) => (key === 'width' || key === 'height' ? 0 : stub),
    set: () => true,
    apply: () => stub,
  });
  g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => stub }) };
}

export interface SceneFingerprint {
  meshes: number;
  vertices: number;
  instances: number;
  /** Hash of every mesh's geometry size, first / last vertex and world position (cm) */
  hash: number;
}

/** Order-sensitive summary of a built scene graph: equal fingerprints mean the same meshes in the same places */
export function sceneFingerprint(root: THREE.Object3D): SceneFingerprint {
  root.updateMatrixWorld(true);
  const p = new THREE.Vector3();
  let meshes = 0;
  let vertices = 0;
  let instances = 0;
  let hash = 0;
  const mix = (x: number) => {
    hash = (Math.imul(hash, 31) + (Math.round(x) | 0)) | 0;
  };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshes++;
    const pos = mesh.geometry.attributes.position;
    const n = pos?.count ?? 0;
    vertices += n;
    mix(n);
    if (pos && n > 0) {
      mix(pos.getX(0) * 100);
      mix(pos.getY(0) * 100);
      mix(pos.getZ(n - 1) * 100);
    }
    mesh.getWorldPosition(p);
    mix(p.x * 100);
    mix(p.y * 100);
    mix(p.z * 100);
    const inst = o as THREE.InstancedMesh;
    if (inst.isInstancedMesh) {
      instances += inst.count;
      mix(inst.count);
      if (inst.count > 0) {
        mix(inst.instanceMatrix.array[12] * 100);
        mix(inst.instanceMatrix.array[(inst.count - 1) * 16 + 14] * 100);
      }
    }
  });
  return { meshes, vertices, instances, hash };
}
