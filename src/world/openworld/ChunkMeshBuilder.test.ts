import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { OsmBuildingData } from '../../data/suwonTypes';
import { ChunkMaterials, buildChunkMeshes } from './ChunkMeshBuilder';
import { ChunkData, OpenWorldData } from './OpenWorldTypes';

const mat = () => new THREE.MeshBasicMaterial();
const MATS: ChunkMaterials = {
  walls: { shop: mat(), apt: mat(), villa: mat(), public: mat() },
  roof: mat(),
  road: mat(),
  roadLine: mat(),
  park: mat(),
  water: mat(),
  plaza: mat(),
  farBuildings: mat(),
};

const box = (cx: number, cz: number, w: number, d: number, height: number, clockwise = false): OsmBuildingData => {
  let pts: Array<[number, number]> = [
    [cx - w / 2, cz - d / 2],
    [cx + w / 2, cz - d / 2],
    [cx + w / 2, cz + d / 2],
    [cx - w / 2, cz + d / 2],
  ];
  if (clockwise) pts = pts.reverse();
  return {
    name: '',
    kind: 'residential',
    height,
    area: w * d,
    cx,
    cz,
    w,
    d,
    minX: cx - w / 2,
    maxX: cx + w / 2,
    minZ: cz - d / 2,
    maxZ: cz + d / 2,
    pts,
  };
};

/** All meshes in the chunk group, including both LOD levels */
const meshesOf = (g: THREE.Object3D): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
};

const NO_ROADS = { nodes: [], edges: [], discNodeIds: [], nodeMaxWidth: new Float32Array(0) };

/** Every triangle's CCW winding normal must agree with its stored vertex normal (else it renders back-faced) */
function expectFrontFacing(geo: THREE.BufferGeometry): void {
  const p = geo.getAttribute('position');
  const n = geo.getAttribute('normal');
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const stored = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    const geomN = b.clone().sub(a).cross(c.clone().sub(a));
    if (geomN.lengthSq() < 1e-10) continue;
    stored.fromBufferAttribute(n, i);
    expect(geomN.dot(stored)).toBeGreaterThan(0);
  }
}

describe('buildChunkMeshes', () => {
  const chunk: ChunkData = {
    ix: 0,
    iz: 0,
    buildings: [box(0, 0, 10, 8, 12), box(30, 0, 12, 12, 40, true)],
    parks: [{ name: 'p', pts: [[50, 50], [70, 50], [70, 70], [50, 70]] }],
    waters: [],
    waterLines: [{ name: 'r', width: 6, pts: [[0, 80], [40, 90], [80, 80]] }],
    pedestrianPlazas: [],
  };
  const roads = {
    nodes: [
      { id: 0, x: -20, z: -20, isSignal: false },
      { id: 1, x: 60, z: -20, isSignal: false },
    ],
    edges: [{ a: 0, b: 1, dist: 80, width: 12, highway: 'tertiary', name: '', isMajor: true }],
    discNodeIds: [0, 1],
    nodeMaxWidth: new Float32Array([12, 12]),
  };

  it('produces one collider per building with its exact footprint', () => {
    const r = buildChunkMeshes(chunk, roads, MATS);
    expect(r.obstacles).toHaveLength(2);
    expect(r.obstacles[1].pts).toEqual(chunk.buildings[1].pts);
    expect(r.buildingCount).toBe(2);
  });

  it('merges by material: a fixed small number of draw calls', () => {
    const r = buildChunkMeshes(chunk, roads, MATS);
    // near level: villa walls (low) + apt walls (tall) + 2 roofs; + road + lines + park + water
    expect(r.drawCalls).toBe(8);
    // only tall (>= 18m) buildings cast shadows (far LOD never does)
    const casters = meshesOf(r.group).filter((m) => m.castShadow);
    expect(casters).toHaveLength(2);
    // far LOD: one merged untextured mesh for all buildings of the chunk
    const lod = r.group.children.find((c) => (c as THREE.LOD).isLOD) as THREE.LOD;
    expect(lod.levels).toHaveLength(2);
    expect(meshesOf(lod.levels[1].object)).toHaveLength(1);
    expect(meshesOf(lod.levels[1].object)[0].material).toBe(MATS.farBuildings);
  });

  it('builds every triangle front-facing (walls outward, flat surfaces up), whatever the footprint winding', () => {
    const r = buildChunkMeshes(chunk, roads, MATS);
    for (const m of meshesOf(r.group)) expectFrontFacing(m.geometry);
  });

  it('keeps LOD levels in world space and switches to the far mesh beyond the LOD distance', () => {
    const r = buildChunkMeshes(chunk, roads, MATS);
    r.group.updateMatrixWorld(true);
    const lod = r.group.children.find((c) => (c as THREE.LOD).isLOD) as THREE.LOD;
    const far = meshesOf(lod.levels[1].object)[0];
    far.geometry.computeBoundingBox();
    const bb = far.geometry.boundingBox!.clone().applyMatrix4(far.matrixWorld);
    // the 12x12 building at x=30 still ends at x=36 in world space
    expect(bb.max.x).toBeCloseTo(36, 3);
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(15, 2, 0);
    cam.updateMatrixWorld();
    lod.update(cam);
    expect(lod.getCurrentLevel()).toBe(0);
    cam.position.set(15, 2, 1000);
    cam.updateMatrixWorld();
    lod.update(cam);
    expect(lod.getCurrentLevel()).toBe(1);
  });

  it('points wall normals away from the building centre', () => {
    const r = buildChunkMeshes({ ...chunk, buildings: [box(5, 5, 10, 10, 12, true)] }, NO_ROADS, MATS);
    const walls = meshesOf(r.group).find((m) => m.material === MATS.walls.villa)!;
    const p = walls.geometry.getAttribute('position');
    const n = walls.geometry.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      const out = (p.getX(i) - 5) * n.getX(i) + (p.getZ(i) - 5) * n.getZ(i);
      expect(out).toBeGreaterThan(0);
    }
  });

  it('extrudes walls to the building height', () => {
    const r = buildChunkMeshes({ ...chunk, buildings: [box(0, 0, 10, 10, 33)] }, NO_ROADS, MATS);
    const bb = meshesOf(r.group).find((m) => m.material === MATS.walls.apt)!.geometry.boundingBox!;
    expect(bb.max.y).toBeCloseTo(33);
    expect(bb.min.y).toBeCloseTo(0);
  });

  it('dispose() frees every chunk geometry and detaches the group, but keeps shared materials', () => {
    const parent = new THREE.Group();
    const r = buildChunkMeshes(chunk, roads, MATS);
    parent.add(r.group);
    let disposed = 0;
    const meshes = meshesOf(r.group);
    meshes.forEach((m) => m.geometry.addEventListener('dispose', () => disposed++));
    let matDisposed = 0;
    MATS.road.addEventListener('dispose', () => matDisposed++);
    r.dispose();
    expect(disposed).toBe(meshes.length);
    expect(parent.children).toHaveLength(0);
    expect(matDisposed).toBe(0);
  });

  it('builds the densest real Suwon chunk within its geometry budget', () => {
    const world = JSON.parse(readFileSync('src/data/openworld/suwonWorld.json', 'utf8')) as OpenWorldData;
    const heaviest = [...world.chunks].sort((a, b) => b.buildings - a.buildings)[0];
    const data = JSON.parse(readFileSync(`public/map/suwon/chunks/c_${heaviest.key}.json`, 'utf8')) as ChunkData;
    const t0 = performance.now();
    const r = buildChunkMeshes(data, NO_ROADS, MATS);
    const ms = performance.now() - t0;
    expect(r.buildingCount).toBe(heaviest.buildings);
    expect(r.drawCalls).toBeLessThanOrEqual(12);
    for (const m of meshesOf(r.group)) expectFrontFacing(m.geometry);
    // Built on the main thread during streaming. Build time follows the geometry it produces, so the test
    // bounds that (deterministic) instead of wall-clock time, which flakes on a busy machine; the time is logged.
    let verts = 0;
    for (const m of meshesOf(r.group)) verts += m.geometry.attributes.position.count;
    console.log(`[ChunkMeshBuilder] chunk ${heaviest.key}: ${heaviest.buildings} buildings -> ${r.drawCalls} draws, ${verts} verts in ${ms.toFixed(1)}ms`);
    expect(verts).toBeLessThanOrEqual(16000); // 12,222 when written
    expect(verts / heaviest.buildings).toBeLessThanOrEqual(100);
  });
});
