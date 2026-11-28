/**
 * Scene cost budgets (the Vitest side of the benchmark regression watch, perf/benchBaseline.ts): what the browser
 * suite measures in draw calls and triangles comes from what the builders make, so the builders' output is held to
 * budgets here - every commit, without a browser. The scene fingerprint snapshot catches *any* change; these
 * catch a change that makes the scene *heavier* than the rules allow.
 */
import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ChunkMaterials, ChunkRoads, buildChunkMeshes } from './openworld/ChunkMeshBuilder';
import { ChunkData, OpenWorldData, gridSpecOf } from './openworld/OpenWorldTypes';
import { chunkCoordOf, chunkKey } from './openworld/ChunkGrid';
import { installCanvasStub, sceneFingerprint } from '../test/sceneFingerprint';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';

/** CLAUDE.md rule 10: a chunk draws in about 10 calls (merged by material) */
const CHUNK_DRAW_BUDGET = 12;
/** Spawn + bus-stop scene of the open world (887 meshes, 92k vertices when this budget was set) */
const SPAWN_MESH_BUDGET = 1000;
const SPAWN_VERTEX_BUDGET = 110_000;

const world = JSON.parse(readFileSync('src/data/openworld/suwonWorld.json', 'utf8')) as OpenWorldData;
const spec = gridSpecOf(world);
const mat = () => new THREE.MeshBasicMaterial();
/** Every optional material too: the most draw calls a chunk can make */
const ALL_MATS: ChunkMaterials = {
  walls: { shop: mat(), apt: mat(), villa: mat(), public: mat() },
  roof: mat(),
  road: mat(),
  roadLine: mat(),
  park: mat(),
  water: mat(),
  plaza: mat(),
  farBuildings: mat(),
  roadMarkings: mat(),
  roadText: mat(),
  storefront: mat(),
  stream: mat(),
};

/** The chunk's roads as the streamer hands them over (edges by midpoint, discs by node, bridges 3x3 around) */
function roadsOf(key: string): ChunkRoads {
  const nodeMaxWidth = new Float32Array(world.nodes.length);
  const edges = [];
  const bridges = [];
  const [ix, iz] = key.split('_').map(Number);
  for (const e of world.edges) {
    nodeMaxWidth[e.a] = Math.max(nodeMaxWidth[e.a], e.width);
    nodeMaxWidth[e.b] = Math.max(nodeMaxWidth[e.b], e.width);
    const a = world.nodes[e.a];
    const b = world.nodes[e.b];
    const c = chunkCoordOf(spec, (a.x + b.x) / 2, (a.z + b.z) / 2);
    if (chunkKey(c.ix, c.iz) === key) edges.push(e);
    if (e.bridge && Math.abs(c.ix - ix) <= 1 && Math.abs(c.iz - iz) <= 1) bridges.push(e);
  }
  const discNodeIds = world.nodes
    .filter((n) => chunkKey(chunkCoordOf(spec, n.x, n.z).ix, chunkCoordOf(spec, n.x, n.z).iz) === key)
    .map((n) => n.id);
  return { nodes: world.nodes, edges, discNodeIds, nodeMaxWidth, bridges };
}

const chunkFile = (key: string) => `public/map/suwon/chunks/c_${key}.json`;
const loadChunk = (key: string) => JSON.parse(readFileSync(chunkFile(key), 'utf8')) as ChunkData;

describe('scene cost budgets', () => {
  it('the heaviest chunks and every chunk with a stream stay within the chunk draw-call budget', () => {
    const heaviest = [...world.chunks].sort((a, b) => b.buildings - a.buildings).slice(0, 8).map((c) => c.key);
    const withStreams = world.chunks
      .map((c) => c.key)
      .filter((k) => existsSync(chunkFile(k)) && loadChunk(k).waterLines.length > 0)
      .slice(0, 16);
    expect(withStreams.length).toBeGreaterThan(5);
    let worst = { key: '', draws: 0 };
    for (const key of new Set([...heaviest, ...withStreams])) {
      const r = buildChunkMeshes(loadChunk(key), roadsOf(key), ALL_MATS);
      if (r.drawCalls > worst.draws) worst = { key, draws: r.drawCalls };
      expect(r.drawCalls, `chunk ${key}`).toBeLessThanOrEqual(CHUNK_DRAW_BUDGET);
      r.dispose();
    }
    console.log(`[sceneBudget] worst chunk ${worst.key}: ${worst.draws} draw calls (budget ${CHUNK_DRAW_BUDGET})`);
  });

  it('the spawn scene stays within its mesh and vertex budget', async () => {
    installCanvasStub();
    globalThis.fetch = (() => new Promise(() => {})) as typeof fetch;
    const { CityWorld } = await import('./CityWorld');
    const city = new CityWorld(new THREE.Scene());
    const s = ACTIVE_MAP_DATA.meta.playerSpawn;
    city.updateStreaming(s.x, s.z);
    const stop = city.busStops[Math.floor(city.busStops.length / 2)];
    city.updateStreaming(stop.x, stop.z);
    const f = sceneFingerprint(city.root);
    console.log(`[sceneBudget] spawn scene: ${f.meshes} meshes, ${f.vertices} vertices`);
    expect(f.meshes).toBeLessThanOrEqual(SPAWN_MESH_BUDGET);
    expect(f.vertices).toBeLessThanOrEqual(SPAWN_VERTEX_BUDGET);
  });
});
