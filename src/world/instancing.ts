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

/**
 * Merges every static mesh inside `group` that shares the same material (and shadow flags) into ONE
 * mesh, so a prop built from 6-12 boxes costs one draw call per distinct material instead of one per
 * box. Materials are kept as-is (same objects), so material-driven effects - night glow, blinking
 * LEDs, camera flash opacity - keep working. Meshes for which `keep(mesh)` is true (moving doors,
 * toggled items) and anything below them are left untouched.
 * Returns how many draw calls were saved.
 */
export function mergeStaticByMaterial(group: THREE.Object3D, keep?: (o: THREE.Object3D) => boolean): number {
  group.updateMatrixWorld(true);
  const toGroup = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map<string, { mat: THREE.Material; cast: boolean; receive: boolean; meshes: THREE.Mesh[] }>();
  const kept = new Set<THREE.Object3D>();
  group.traverse((o) => {
    if (o.parent && kept.has(o.parent)) {
      kept.add(o);
      return;
    }
    if (keep?.(o)) {
      kept.add(o);
      return;
    }
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (o as THREE.InstancedMesh).isInstancedMesh || Array.isArray(mesh.material) || !mesh.visible) return;
    const mat = mesh.material as THREE.Material;
    const key = `${mat.uuid}|${mesh.castShadow}|${mesh.receiveShadow}|${mesh.renderOrder}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { mat, cast: mesh.castShadow, receive: mesh.receiveShadow, meshes: [] }));
    b.meshes.push(mesh);
  });

  let saved = 0;
  for (const b of buckets.values()) {
    if (b.meshes.length < 2) continue;
    const wantsColor = (b.mat as THREE.MeshStandardMaterial).vertexColors === true;
    const geos = b.meshes.map((m) => {
      const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()) as THREE.BufferGeometry;
      for (const name of Object.keys(g.attributes)) {
        if (name !== 'position' && name !== 'normal' && name !== 'uv' && !(wantsColor && name === 'color')) g.deleteAttribute(name);
      }
      const n = g.getAttribute('position').count;
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
      if (wantsColor && !g.getAttribute('color')) {
        g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
      }
      g.groups = [];
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toGroup, m.matrixWorld));
      return g;
    });
    const mergedGeo = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!mergedGeo) continue;
    mergedGeo.computeBoundingSphere();
    const mesh = new THREE.Mesh(mergedGeo, b.mat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.receive;
    mesh.layers.mask = b.meshes[0].layers.mask;
    for (const m of b.meshes) m.removeFromParent();
    group.add(mesh);
    saved += b.meshes.length - 1;
  }
  return saved;
}
