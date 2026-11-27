import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Draw-call reduction helpers.
 *
 * - `buildInstanced`: one InstancedMesh for every copy of a repeated prop part (signal poles, lamps,
 *   crosswalk stripes...) -> 1 draw call for the whole city instead of one per copy.
 * - `mergeColoredParts`: bakes several differently-coloured parts into ONE geometry with per-vertex
 *   colours, rendered with a single shared `vertexColors` material (car wheels, far pedestrians).
 */

export function buildInstanced(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  matrices: readonly THREE.Matrix4[]
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, matrices.length));
  mesh.count = matrices.length;
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
  return mesh;
}

/** World matrix of a part placed at `pos` (with optional Y rotation / extra local transform) */
export function placeMatrix(x: number, y: number, z: number, rotY = 0, local?: THREE.Matrix4): THREE.Matrix4 {
  const m = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y, z);
  return local ? m.multiply(local) : m;
}

export interface ColoredPart {
  geometry: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
  color: THREE.ColorRepresentation;
}

/**
 * Merges parts into one non-indexed geometry with position / normal / color attributes.
 * The source geometries are not modified.
 */
export function mergeColoredParts(parts: readonly ColoredPart[]): THREE.BufferGeometry {
  const prepared = parts.map((p) => {
    const g = (p.geometry.index ? p.geometry.toNonIndexed() : p.geometry.clone()) as THREE.BufferGeometry;
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    }
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    g.applyMatrix4(p.matrix);
    const c = new THREE.Color(p.color);
    const n = g.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.groups = [];
    return g;
  });
  const merged = mergeGeometries(prepared, false);
  for (const g of prepared) g.dispose();
  if (!merged) throw new Error('mergeColoredParts: incompatible geometries');
  merged.computeBoundingSphere();
  return merged;
}
