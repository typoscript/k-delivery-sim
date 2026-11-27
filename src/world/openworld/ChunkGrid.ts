import { ChunkGridSpec } from './OpenWorldTypes';

/**
 * Pure chunk-window math for open-world streaming (no THREE / DOM, unit tested).
 * Distances between chunks are Chebyshev (square rings): radius 2 = a 5x5 window.
 */

export const chunkKey = (ix: number, iz: number): string => `${ix}_${iz}`;

export function parseChunkKey(key: string): { ix: number; iz: number } {
  const [ix, iz] = key.split('_').map(Number);
  return { ix, iz };
}

/** Chunk cell containing world point (x, z); may lie outside the grid */
export function chunkCoordOf(spec: ChunkGridSpec, x: number, z: number): { ix: number; iz: number } {
  return {
    ix: Math.floor((x - spec.originX) / spec.size),
    iz: Math.floor((z - spec.originZ) / spec.size),
  };
}

export function chunkDistance(a: { ix: number; iz: number }, b: { ix: number; iz: number }): number {
  return Math.max(Math.abs(a.ix - b.ix), Math.abs(a.iz - b.iz));
}

/** World-space centre of a chunk cell */
export function chunkCenter(spec: ChunkGridSpec, ix: number, iz: number): { x: number; z: number } {
  return { x: spec.originX + (ix + 0.5) * spec.size, z: spec.originZ + (iz + 0.5) * spec.size };
}

export interface StreamingPlan {
  /** Chunks to start loading, nearest first */
  load: string[];
  /** Loaded (or pending) chunks to release */
  unload: string[];
}

/**
 * Decides which chunks to load / unload around (x, z).
 * - load: existing chunks within `loadRadius` that are not resident yet, nearest first
 * - unload: resident chunks farther than `unloadRadius` (> loadRadius gives hysteresis so
 *   driving back and forth along a chunk border doesn't thrash load/unload)
 */
export function planStreaming(
  spec: ChunkGridSpec,
  existing: ReadonlySet<string>,
  resident: ReadonlySet<string>,
  x: number,
  z: number,
  loadRadius: number,
  unloadRadius: number
): StreamingPlan {
  const c = chunkCoordOf(spec, x, z);
  const load: Array<{ key: string; d: number; e: number }> = [];
  for (let dz = -loadRadius; dz <= loadRadius; dz++) {
    for (let dx = -loadRadius; dx <= loadRadius; dx++) {
      const ix = c.ix + dx;
      const iz = c.iz + dz;
      if (ix < 0 || iz < 0 || ix >= spec.cols || iz >= spec.rows) continue;
      const key = chunkKey(ix, iz);
      if (!existing.has(key) || resident.has(key)) continue;
      // Euclidean tiebreak so the ring loads roughly in a circle around the player
      load.push({ key, d: Math.max(Math.abs(dx), Math.abs(dz)), e: dx * dx + dz * dz });
    }
  }
  load.sort((a, b) => a.d - b.d || a.e - b.e);

  const unload: string[] = [];
  for (const key of resident) {
    if (chunkDistance(parseChunkKey(key), c) > unloadRadius) unload.push(key);
  }
  return { load: load.map((l) => l.key), unload };
}
