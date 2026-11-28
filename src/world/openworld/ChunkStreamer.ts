import * as THREE from 'three';
import type { OsmBuildingData } from '../../data/suwonTypes';
import { activeRoadProximity } from '../roadProximity';
import { ObstacleBox } from '../../types';
import { OsmGraphEdge } from '../../data/suwonTypes';
import { chunkCoordOf, chunkDistance, chunkKey, parseChunkKey, planStreaming } from './ChunkGrid';
import { ChunkBuildResult, ChunkMaterials, ChunkRoads, buildChunkMeshes } from './ChunkMeshBuilder';
import { ChunkData, ChunkGridSpec, OpenWorldData, gridSpecOf } from './OpenWorldTypes';

/**
 * Streams the unified Suwon open world around the player (like open-world games do):
 *  - only chunks within `loadRadius` (Chebyshev, 2 = 5x5 = 1km x 1km) are fetched & built
 *  - chunks farther than `unloadRadius` are released: pending fetches aborted, geometries disposed
 *  - network fetches are concurrency-limited, mesh builds are time-sliced (ms budget per update) to avoid hitches
 *  - colliders are only exposed for the 3x3 chunks around the player (physics never scans the whole city)
 *
 * The road graph comes from the always-loaded world.json; road meshes are bucketed per chunk here.
 */

export type ChunkFetcher = (url: string, signal: AbortSignal) => Promise<ChunkData>;

export interface ChunkStreamerOptions {
  /** URL prefix of the chunk folder, e.g. './map/suwon/chunks/' */
  chunkBaseUrl: string;
  loadRadius?: number;
  unloadRadius?: number;
  maxConcurrentFetches?: number;
  maxBuildsPerUpdate?: number;
  /** Keep building ready chunks this frame until this many ms are spent (always at least one) */
  buildBudgetMs?: number;
  /** Chunks around the player whose buildings are returned as colliders */
  collisionRadius?: number;
  /** Seconds before a failed chunk is retried */
  retryDelaySec?: number;
  fetcher?: ChunkFetcher;
  now?: () => number;
}

export interface ChunkStreamerStats {
  resident: number;
  fetching: number;
  awaitingBuild: number;
  built: number;
  buildings: number;
  triangles: number;
  drawCalls: number;
  totalLoaded: number;
  totalUnloaded: number;
  totalAborted: number;
  fetchErrors: number;
  colliders: number;
  playerChunk: string;
}

type ChunkState =
  | { kind: 'fetching'; abort: AbortController }
  | { kind: 'ready'; data: ChunkData }
  | { kind: 'built'; result: ChunkBuildResult; data: ChunkData };

const defaultFetcher: ChunkFetcher = async (url, signal) => {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`chunk ${url}: HTTP ${res.status}`);
  return (await res.json()) as ChunkData;
};

export class ChunkStreamer {
  public readonly root = new THREE.Group();
  private readonly spec: ChunkGridSpec;
  private readonly existing: Set<string>;
  private readonly states = new Map<string, ChunkState>();
  private readonly failedAt = new Map<string, number>();
  private readonly buildQueue: string[] = [];
  private readonly edgesByChunk = new Map<string, OsmGraphEdge[]>();
  private readonly discsByChunk = new Map<string, number[]>();
  private readonly nodeMaxWidth: Float32Array;
  private readonly opts: Required<Omit<ChunkStreamerOptions, 'fetcher' | 'now'>> & {
    fetcher: ChunkFetcher;
    now: () => number;
  };

  private playerX = 0;
  private playerZ = 0;
  private colliderCache: ObstacleBox[] = [];
  private colliderKey = '';
  private totalLoaded = 0;
  private totalUnloaded = 0;
  private totalAborted = 0;
  private fetchErrors = 0;
  private disposed = false;
  /** Increments whenever a chunk is built or released (lets consumers refresh derived data lazily) */
  public version = 0;

  /** Street-facing test for shopfronts (road edges of the whole map) */
  private readonly curbOffset = (x: number, z: number) => activeRoadProximity().curbOffset(x, z);

  constructor(
    parent: THREE.Object3D,
    private readonly world: OpenWorldData,
    private readonly materials: ChunkMaterials,
    options: ChunkStreamerOptions
  ) {
    this.opts = {
      loadRadius: 2,
      unloadRadius: 3,
      maxConcurrentFetches: 4,
      maxBuildsPerUpdate: 8,
      buildBudgetMs: 4,
      collisionRadius: 1,
      retryDelaySec: 5,
      fetcher: defaultFetcher,
      now: () => performance.now() / 1000,
      ...options,
    };
    this.root.name = 'OpenWorldChunks';
    parent.add(this.root);
    this.spec = gridSpecOf(world);
    this.existing = new Set(world.chunks.map((c) => c.key));

    // Bucket the always-loaded road graph into chunks (edges by midpoint, junction discs by node)
    this.nodeMaxWidth = new Float32Array(world.nodes.length);
    for (const e of world.edges) {
      this.nodeMaxWidth[e.a] = Math.max(this.nodeMaxWidth[e.a], e.width);
      this.nodeMaxWidth[e.b] = Math.max(this.nodeMaxWidth[e.b], e.width);
      const a = world.nodes[e.a];
      const b = world.nodes[e.b];
      const c = chunkCoordOf(this.spec, (a.x + b.x) / 2, (a.z + b.z) / 2);
      this.bucket(this.edgesByChunk, chunkKey(c.ix, c.iz)).push(e);
    }
    for (const n of world.nodes) {
      const c = chunkCoordOf(this.spec, n.x, n.z);
      this.bucket(this.discsByChunk, chunkKey(c.ix, c.iz)).push(n.id);
    }
    // Chunks with roads but no buildings/parks still need loading for their road meshes
    for (const key of this.edgesByChunk.keys()) this.existing.add(key);
  }

  private bucket<T>(map: Map<string, T[]>, key: string): T[] {
    let arr = map.get(key);
    if (!arr) map.set(key, (arr = []));
    return arr;
  }

  /**
   * Buildings of the chunk under (x, z): [] where the map has nothing, null while that chunk is not loaded yet
   * (props that must avoid buildings wait for it)
   */
  public buildingsAt(x: number, z: number): readonly OsmBuildingData[] | null {
    const c = chunkCoordOf(this.spec, x, z);
    const key = chunkKey(c.ix, c.iz);
    if (!this.existing.has(key)) return [];
    const st = this.states.get(key);
    return st && (st.kind === 'ready' || st.kind === 'built') ? st.data.buildings : null;
  }

  /** Call every frame (or a few times per second) with the player/camera position */
  public update(x: number, z: number): void {
    if (this.disposed) return;
    this.playerX = x;
    this.playerZ = z;
    const now = this.opts.now();
    const plan = planStreaming(
      this.spec,
      this.existing,
      new Set(this.states.keys()),
      x,
      z,
      this.opts.loadRadius,
      this.opts.unloadRadius
    );

    for (const key of plan.unload) this.unload(key);

    let fetching = this.countState('fetching');
    for (const key of plan.load) {
      if (fetching >= this.opts.maxConcurrentFetches) break;
      const failed = this.failedAt.get(key);
      if (failed !== undefined && now - failed < this.opts.retryDelaySec) continue;
      this.startFetch(key);
      fetching++;
    }

    // Time-sliced building: nearest ready chunk first
    const pc = chunkCoordOf(this.spec, x, z);
    this.buildQueue.sort((a, b) => chunkDistance(parseChunkKey(a), pc) - chunkDistance(parseChunkKey(b), pc));
    let builds = 0;
    const buildStart = performance.now();
    while (
      builds < this.opts.maxBuildsPerUpdate &&
      this.buildQueue.length > 0 &&
      (builds === 0 || performance.now() - buildStart < this.opts.buildBudgetMs)
    ) {
      const key = this.buildQueue.shift()!;
      const st = this.states.get(key);
      if (st?.kind !== 'ready') continue;
      const result = buildChunkMeshes(st.data, this.roadsFor(key), this.materials);
      this.root.add(result.group);
      this.states.set(key, { kind: 'built', result, data: st.data });
      this.version++;
      this.totalLoaded++;
      this.colliderKey = '';
      builds++;
    }
  }

  private roadsFor(key: string): ChunkRoads {
    return {
      nodes: this.world.nodes,
      edges: this.edgesByChunk.get(key) ?? [],
      discNodeIds: this.discsByChunk.get(key) ?? [],
      nodeMaxWidth: this.nodeMaxWidth,
      curbOffset: this.curbOffset,
    };
  }

  private emptyChunk(key: string): ChunkData {
    const { ix, iz } = parseChunkKey(key);
    return { ix, iz, buildings: [], parks: [], waters: [], waterLines: [], pedestrianPlazas: [] };
  }

  private startFetch(key: string): void {
    const abort = new AbortController();
    this.states.set(key, { kind: 'fetching', abort });
    const hasFile = this.world.chunks.some((c) => c.key === key);
    const request = hasFile
      ? this.opts.fetcher(`${this.opts.chunkBaseUrl}c_${key}.json`, abort.signal)
      : Promise.resolve(this.emptyChunk(key)); // road-only chunk
    request.then(
      (data) => {
        const st = this.states.get(key);
        // Ignore results for chunks that were unloaded (or re-requested) meanwhile
        if (this.disposed || st?.kind !== 'fetching' || st.abort !== abort) return;
        this.failedAt.delete(key);
        this.states.set(key, { kind: 'ready', data });
        this.buildQueue.push(key);
      },
      (err: unknown) => {
        const st = this.states.get(key);
        if (st?.kind === 'fetching' && st.abort === abort) this.states.delete(key);
        if (abort.signal.aborted) return;
        this.fetchErrors++;
        this.failedAt.set(key, this.opts.now());
        console.warn('[ChunkStreamer] chunk load failed', key, err);
      }
    );
  }

  private unload(key: string): void {
    const st = this.states.get(key);
    if (!st) return;
    this.states.delete(key);
    if (st.kind === 'fetching') {
      st.abort.abort();
      this.totalAborted++;
    } else if (st.kind === 'built') {
      st.result.dispose();
      this.totalUnloaded++;
      this.version++;
      this.colliderKey = '';
    } else {
      const qi = this.buildQueue.indexOf(key);
      if (qi >= 0) this.buildQueue.splice(qi, 1);
    }
  }

  private countState(kind: ChunkState['kind']): number {
    let n = 0;
    for (const st of this.states.values()) if (st.kind === kind) n++;
    return n;
  }

  /** Building colliders of the built chunks within `collisionRadius` of the player (cached) */
  public get collisionObstacles(): ObstacleBox[] {
    const pc = chunkCoordOf(this.spec, this.playerX, this.playerZ);
    const key = chunkKey(pc.ix, pc.iz);
    if (this.colliderKey === key) return this.colliderCache;
    const out: ObstacleBox[] = [];
    for (const [k, st] of this.states) {
      if (st.kind !== 'built') continue;
      if (chunkDistance(parseChunkKey(k), pc) <= this.opts.collisionRadius) out.push(...st.result.obstacles);
    }
    this.colliderCache = out;
    this.colliderKey = key;
    return out;
  }

  /** Raw data of every currently built chunk (for map overlays: footprints, parks, water...) */
  public getBuiltChunkData(): ChunkData[] {
    const out: ChunkData[] = [];
    for (const st of this.states.values()) if (st.kind === 'built') out.push(st.data);
    return out;
  }

  /** True once the chunk under (x, z) is built (e.g. hold a spawn/teleport until the ground exists) */
  public isReadyAt(x: number, z: number): boolean {
    const c = chunkCoordOf(this.spec, x, z);
    const key = chunkKey(c.ix, c.iz);
    if (!this.existing.has(key)) return true;
    return this.states.get(key)?.kind === 'built';
  }

  public get stats(): ChunkStreamerStats {
    let buildings = 0;
    let triangles = 0;
    let drawCalls = 0;
    let built = 0;
    for (const st of this.states.values()) {
      if (st.kind !== 'built') continue;
      built++;
      buildings += st.result.buildingCount;
      triangles += st.result.triangleCount;
      drawCalls += st.result.drawCalls;
    }
    const pc = chunkCoordOf(this.spec, this.playerX, this.playerZ);
    return {
      resident: this.states.size,
      fetching: this.countState('fetching'),
      awaitingBuild: this.countState('ready'),
      built,
      buildings,
      triangles,
      drawCalls,
      totalLoaded: this.totalLoaded,
      totalUnloaded: this.totalUnloaded,
      totalAborted: this.totalAborted,
      fetchErrors: this.fetchErrors,
      colliders: this.collisionObstacles.length,
      playerChunk: chunkKey(pc.ix, pc.iz),
    };
  }

  public dispose(): void {
    for (const key of [...this.states.keys()]) this.unload(key);
    this.disposed = true;
    this.root.removeFromParent();
  }
}
