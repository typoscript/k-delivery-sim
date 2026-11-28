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

/**
 * Merges the static meshes of `group` whose material is one of `plainMats` (opaque, single-colour, untextured) into
 * ONE vertex-coloured mesh with `target` (each part keeps its material's colour). Different materials -> one draw
 * call. Meshes for which `keep(o)` is true, and anything below them, stay as they are. Returns the draw calls saved.
 */
export function mergeByVertexColor(
  group: THREE.Object3D,
  plainMats: ReadonlySet<THREE.Material>,
  target: THREE.Material,
  keep?: (o: THREE.Object3D) => boolean,
): number {
  group.updateMatrixWorld(true);
  const toGroup = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const meshes: THREE.Mesh[] = [];
  const kept = new Set<THREE.Object3D>();
  group.traverse((o) => {
    if ((o.parent && kept.has(o.parent)) || keep?.(o)) {
      kept.add(o);
      return;
    }
    const m = o as THREE.Mesh;
    if (!m.isMesh || (o as THREE.InstancedMesh).isInstancedMesh || !m.visible) return;
    if (Array.isArray(m.material) || !plainMats.has(m.material)) return;
    meshes.push(m);
  });
  if (meshes.length < 2) return 0;
  const materials = new Set(meshes.map((m) => m.material as THREE.Material));
  const parts: ColoredPart[] = meshes.map((m) => ({
    geometry: m.geometry,
    matrix: new THREE.Matrix4().multiplyMatrices(toGroup, m.matrixWorld),
    color: ((m.material as THREE.MeshStandardMaterial).color ?? new THREE.Color(0xffffff)).clone(),
  }));
  const merged = new THREE.Mesh(mergeColoredParts(parts), target);
  merged.castShadow = meshes.some((m) => m.castShadow);
  merged.receiveShadow = meshes.some((m) => m.receiveShadow);
  for (const m of meshes) {
    m.removeFromParent();
    m.geometry.dispose();
  }
  group.add(merged);
  return materials.size - 1;
}

/**
 * City-wide InstancedMeshes (signal gantries, street lamps, park trees, crosswalk stripes) hold thousands of
 * instances, and the GPU draws every one of them each frame: an InstancedMesh is only culled as a whole. This keeps
 * just the instances within a radius of the player in each mesh's instance buffer (re-picked after the player moves
 * REFRESH_M), which cut ~90% of the frame's triangles. Static instances only (matrices are copied at register time).
 */
export class NearbyInstances {
  private readonly groups: Array<{
    mesh: THREE.InstancedMesh;
    all: Float32Array;
    xs: Float32Array;
    zs: Float32Array;
    radiusSq: number;
  }> = [];
  private lastX = Number.POSITIVE_INFINITY;
  private lastZ = Number.POSITIVE_INFINITY;

  constructor(private readonly refreshM = 40) {}

  /** Takes over `mesh`'s current instances; from now on only those within `radius` of the player are drawn */
  public register(mesh: THREE.InstancedMesh, radius: number): void {
    const n = mesh.count;
    const all = new Float32Array((mesh.instanceMatrix.array as Float32Array).subarray(0, n * 16));
    const xs = new Float32Array(n);
    const zs = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = all[i * 16 + 12];
      zs[i] = all[i * 16 + 14];
    }
    this.groups.push({ mesh, all, xs, zs, radiusSq: radius * radius });
    this.lastX = Number.POSITIVE_INFINITY; // re-pick on the next update
  }

  public get registered(): number {
    return this.groups.length;
  }

  /** Re-picks the drawn instances when the player moved far enough (or `force`) */
  public update(px: number, pz: number, force = false): void {
    if (!force && Math.hypot(px - this.lastX, pz - this.lastZ) < this.refreshM) return;
    this.lastX = px;
    this.lastZ = pz;
    for (const g of this.groups) {
      const dst = g.mesh.instanceMatrix.array as Float32Array;
      let k = 0;
      for (let i = 0; i < g.xs.length; i++) {
        const dx = g.xs[i] - px;
        const dz = g.zs[i] - pz;
        if (dx * dx + dz * dz > g.radiusSq) continue;
        dst.set(g.all.subarray(i * 16, i * 16 + 16), k * 16);
        k++;
      }
      g.mesh.count = k;
      g.mesh.instanceMatrix.needsUpdate = true;
      g.mesh.computeBoundingSphere();
    }
  }
}

/** The world's culler (CityWorld.updateStreaming drives it; traffic signals register here too) */
export const NEARBY_INSTANCES = new NearbyInstances();
