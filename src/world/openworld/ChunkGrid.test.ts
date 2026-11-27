import { describe, expect, it } from 'vitest';
import { chunkCoordOf, chunkKey, planStreaming } from './ChunkGrid';
import { ChunkGridSpec } from './OpenWorldTypes';

const SPEC: ChunkGridSpec = { originX: -1000, originZ: -1000, cols: 10, rows: 10, size: 200 };
const ALL = new Set<string>();
for (let ix = 0; ix < 10; ix++) for (let iz = 0; iz < 10; iz++) ALL.add(chunkKey(ix, iz));

describe('chunkCoordOf', () => {
  it('maps world points to 200m cells from the grid origin', () => {
    expect(chunkCoordOf(SPEC, -1000, -1000)).toEqual({ ix: 0, iz: 0 });
    expect(chunkCoordOf(SPEC, -801, -999)).toEqual({ ix: 0, iz: 0 });
    expect(chunkCoordOf(SPEC, -800, -800)).toEqual({ ix: 1, iz: 1 });
    expect(chunkCoordOf(SPEC, 0, 0)).toEqual({ ix: 5, iz: 5 });
  });
});

describe('planStreaming', () => {
  it('loads a 5x5 window (radius 2), nearest chunk first', () => {
    const plan = planStreaming(SPEC, ALL, new Set(), 50, 50, 2, 3);
    expect(plan.load).toHaveLength(25);
    expect(plan.load[0]).toBe('5_5');
    expect(plan.unload).toEqual([]);
  });

  it('clips the window at the map edge and skips chunks with no data', () => {
    const sparse = new Set(['0_0', '1_1', '9_9']);
    const plan = planStreaming(SPEC, sparse, new Set(), -950, -950, 2, 3);
    expect(plan.load.sort()).toEqual(['0_0', '1_1']);
  });

  it('does not reload resident chunks', () => {
    const resident = new Set(['5_5', '4_4']);
    const plan = planStreaming(SPEC, ALL, resident, 50, 50, 2, 3);
    expect(plan.load).not.toContain('5_5');
    expect(plan.load).toHaveLength(23);
  });

  it('keeps chunks within the unload radius (hysteresis) and drops farther ones', () => {
    // Player moved one chunk east: column ix=3 is now 3 away -> kept (unloadRadius 3)
    const resident = new Set<string>();
    for (let ix = 3; ix <= 7; ix++) for (let iz = 3; iz <= 7; iz++) resident.add(chunkKey(ix, iz));
    const moved = planStreaming(SPEC, ALL, resident, 250, 50, 2, 3);
    expect(moved.unload).toEqual([]);
    // Two chunks east: column ix=3 is 4 away -> unloaded
    const far = planStreaming(SPEC, ALL, resident, 450, 50, 2, 3);
    expect(far.unload.sort()).toEqual(['3_3', '3_4', '3_5', '3_6', '3_7']);
  });

  it('driving back and forth across a chunk border never unloads anything', () => {
    const resident = new Set<string>();
    let unloads = 0;
    for (let step = 0; step < 50; step++) {
      const x = step % 2 === 0 ? 195 : 205; // oscillate around the x=200 border
      const plan = planStreaming(SPEC, ALL, resident, x, 50, 2, 3);
      plan.load.forEach((k) => resident.add(k));
      plan.unload.forEach((k) => resident.delete(k));
      unloads += plan.unload.length;
    }
    expect(unloads).toBe(0);
  });
});
