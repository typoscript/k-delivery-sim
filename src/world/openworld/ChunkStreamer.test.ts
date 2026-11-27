import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ChunkMaterials } from './ChunkMeshBuilder';
import { ChunkFetcher, ChunkStreamer } from './ChunkStreamer';
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

/** 10x10 grid of 200m chunks (origin -1000,-1000), one 10m building in the middle of each chunk */
function makeWorld(): OpenWorldData {
  const chunks = [];
  for (let ix = 0; ix < 10; ix++)
    for (let iz = 0; iz < 10; iz++) chunks.push({ key: `${ix}_${iz}`, ix, iz, buildings: 1, bytes: 100 });
  return {
    meta: {
      name: 'test',
      attribution: '',
      osmTimestamp: '',
      origin: { lat: 0, lon: 0 },
      bounds: { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 },
      chunkSize: 200,
      chunkGrid: { originX: -1000, originZ: -1000, cols: 10, rows: 10 },
    },
    nodes: [],
    edges: [],
    busStops: [],
    legacyDistricts: [],
    chunks,
  };
}

function chunkFor(url: string): ChunkData {
  const [ix, iz] = url.match(/c_(\d+)_(\d+)\.json/)!.slice(1).map(Number);
  const cx = -1000 + ix * 200 + 100;
  const cz = -1000 + iz * 200 + 100;
  return {
    ix,
    iz,
    buildings: [
      {
        name: '',
        kind: 'residential',
        height: 10,
        area: 100,
        cx,
        cz,
        w: 10,
        d: 10,
        minX: cx - 5,
        maxX: cx + 5,
        minZ: cz - 5,
        maxZ: cz + 5,
        pts: [
          [cx - 5, cz - 5],
          [cx + 5, cz - 5],
          [cx + 5, cz + 5],
          [cx - 5, cz + 5],
        ],
      },
    ],
    parks: [],
    waters: [],
    waterLines: [],
    pedestrianPlazas: [],
  };
}

/** Fetcher whose requests stay pending until resolved manually */
function controllableFetcher() {
  const pending = new Map<string, { resolve: () => void; signal: AbortSignal }>();
  const requested: string[] = [];
  const fetcher: ChunkFetcher = (url, signal) =>
    new Promise((resolve, reject) => {
      requested.push(url);
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      pending.set(url, { resolve: () => resolve(chunkFor(url)), signal });
    });
  const resolveAll = async () => {
    for (const [url, p] of [...pending]) {
      pending.delete(url);
      if (!p.signal.aborted) p.resolve();
    }
    await new Promise((r) => setTimeout(r, 0));
  };
  return { fetcher, pending, requested, resolveAll };
}

describe('ChunkStreamer', () => {
  it('limits concurrent fetches and builds at most one chunk per update', async () => {
    const f = controllableFetcher();
    const s = new ChunkStreamer(new THREE.Group(), makeWorld(), MATS, {
      chunkBaseUrl: 'chunks/',
      fetcher: f.fetcher,
      maxConcurrentFetches: 4,
      maxBuildsPerUpdate: 1,
    });
    s.update(100, 100); // chunk 5_5
    expect(f.requested).toHaveLength(4);
    expect(f.requested[0]).toBe('chunks/c_5_5.json');
    await f.resolveAll();
    expect(s.stats.awaitingBuild).toBe(4);
    s.update(100, 100);
    expect(s.stats.built).toBe(1);
  });

  it('streams the full 5x5 window and exposes colliders only for the 3x3 around the player', async () => {
    const f = controllableFetcher();
    const s = new ChunkStreamer(new THREE.Group(), makeWorld(), MATS, { chunkBaseUrl: '', fetcher: f.fetcher });
    for (let i = 0; i < 40; i++) {
      s.update(100, 100);
      await f.resolveAll();
    }
    expect(s.stats.built).toBe(25);
    expect(s.stats.buildings).toBe(25);
    expect(s.collisionObstacles).toHaveLength(9);
    expect(s.isReadyAt(100, 100)).toBe(true);
  });

  it('releases far chunks: disposes built geometry and aborts in-flight requests', async () => {
    const f = controllableFetcher();
    const parent = new THREE.Group();
    const s = new ChunkStreamer(parent, makeWorld(), MATS, { chunkBaseUrl: '', fetcher: f.fetcher });
    for (let i = 0; i < 40; i++) {
      s.update(-900, -900); // corner chunk 0_0 -> 3x3 window
      await f.resolveAll();
    }
    expect(s.stats.built).toBe(9);
    let disposed = 0;
    s.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.addEventListener('dispose', () => disposed++);
    });
    // Jump to the opposite corner: everything resident is now far away
    s.update(900, 900);
    expect(s.stats.totalUnloaded).toBe(9);
    expect(disposed).toBeGreaterThan(0);
    expect(s.root.children).toHaveLength(0);
    // New requests started there; moving away again aborts them and late responses are ignored
    expect(f.pending.size).toBeGreaterThan(0);
    s.update(-900, -900);
    expect(s.stats.totalAborted).toBeGreaterThan(0);
    await f.resolveAll();
    expect(s.stats.resident).toBeLessThanOrEqual(9);
  });

  it('keeps memory bounded over a long drive across the whole map', async () => {
    const f = controllableFetcher();
    const s = new ChunkStreamer(new THREE.Group(), makeWorld(), MATS, {
      chunkBaseUrl: '',
      fetcher: f.fetcher,
      maxBuildsPerUpdate: 4,
    });
    let maxResident = 0;
    // Zig-zag across the map 3 times in 10m steps
    for (let lap = 0; lap < 3; lap++) {
      for (let t = 0; t <= 1; t += 0.005) {
        const x = -950 + t * 1900;
        const z = lap % 2 === 0 ? -950 + t * 1900 : 950 - t * 1900;
        s.update(x, z);
        await f.resolveAll();
        maxResident = Math.max(maxResident, s.stats.resident);
      }
    }
    // never more than the 7x7 unload window
    expect(maxResident).toBeLessThanOrEqual(49);
    expect(s.stats.totalUnloaded).toBeGreaterThan(20);
  });

  it('retries a failed chunk after the retry delay', async () => {
    let clock = 0;
    let calls = 0;
    const fetcher: ChunkFetcher = async (url) => {
      calls++;
      if (calls === 1) throw new Error('network');
      return chunkFor(url);
    };
    const world = makeWorld();
    world.chunks = world.chunks.filter((c) => c.key === '5_5');
    const s = new ChunkStreamer(new THREE.Group(), world, MATS, {
      chunkBaseUrl: '',
      fetcher,
      now: () => clock,
      retryDelaySec: 5,
    });
    const origWarn = console.warn;
    console.warn = () => {};
    s.update(100, 100);
    await new Promise((r) => setTimeout(r, 0));
    expect(s.stats.fetchErrors).toBe(1);
    clock = 2;
    s.update(100, 100);
    expect(calls).toBe(1); // still within retry delay
    clock = 6;
    s.update(100, 100);
    await new Promise((r) => setTimeout(r, 0));
    s.update(100, 100);
    console.warn = origWarn;
    expect(calls).toBe(2);
    expect(s.stats.built).toBe(1);
  });
});
