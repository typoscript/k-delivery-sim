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
    // villa walls (low) + apt walls (tall) + 2 roofs + road + lines + park + water
    expect(r.drawCalls).toBe(8);
    // only tall (>= 18m) buildings cast shadows
    const casters = r.group.children.filter((m) => (m as THREE.Mesh).castShadow);
    expect(casters).toHaveLength(2);
  });

  it('builds every triangle front-facing (walls outward, flat surfaces up), whatever the footprint winding', () => {
    const r = buildChunkMeshes(chunk, roads, MATS);
    for (const m of r.group.children) expectFrontFacing((m as THREE.Mesh).geometry);
  });

  it('points wall normals away from the building centre', () => {
    const r = buildChunkMeshes({ ...chunk, buildings: [box(5, 5, 10, 10, 12, true)] }, NO_ROADS, MATS);
    const walls = r.group.children[0] as THREE.Mesh;
    const p = walls.geometry.getAttribute('position');
    const n = walls.geometry.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      const out = (p.getX(i) - 5) * n.getX(i) + (p.getZ(i) - 5) * n.getZ(i);
      expect(out).toBeGreaterThan(0);
    }
  });

  it('extrudes walls to the building height', () => {
    const r = buildChunkMeshes({ ...chunk, buildings: [box(0, 0, 10, 10, 33)] }, NO_ROADS, MATS);
    const bb = (r.group.children[0] as THREE.Mesh).geometry.boundingBox!;
    expect(bb.max.y).toBeCloseTo(33);
    expect(bb.min.y).toBeCloseTo(0);
  });

  it('dispose() frees every chunk geometry and detaches the group, but keeps shared materials', () => {
    const parent = new THREE.Group();
    const r = buildChunkMeshes(chunk, roads, MATS);
    parent.add(r.group);
    let disposed = 0;
    const meshes = [...r.group.children] as THREE.Mesh[];
    meshes.forEach((m) => m.geometry.addEventListener('dispose', () => disposed++));
    let matDisposed = 0;
    MATS.road.addEventListener('dispose', () => matDisposed++);
    r.dispose();
    expect(disposed).toBe(meshes.length);
    expect(parent.children).toHaveLength(0);
    expect(matDisposed).toBe(0);
  });

  it('builds the densest real Suwon chunk within budget', () => {
    const world = JSON.parse(readFileSync('src/data/openworld/suwonWorld.json', 'utf8')) as OpenWorldData;
    const heaviest = [...world.chunks].sort((a, b) => b.buildings - a.buildings)[0];
    const data = JSON.parse(readFileSync(`public/map/suwon/chunks/c_${heaviest.key}.json`, 'utf8')) as ChunkData;
    const t0 = performance.now();
    const r = buildChunkMeshes(data, NO_ROADS, MATS);
    const ms = performance.now() - t0;
    expect(r.buildingCount).toBe(heaviest.buildings);
    expect(r.drawCalls).toBeLessThanOrEqual(12);
    for (const m of r.group.children) expectFrontFacing((m as THREE.Mesh).geometry);
    // Built on the main thread during streaming: must stay well under a frame budget
    expect(ms).toBeLessThan(40);
  });
});
