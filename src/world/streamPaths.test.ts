import { describe, expect, it } from 'vitest';
import { STONE_ROW_SPACING_M, STONE_STEP_M, isWadingAt, steppingStoneRows } from './streamPaths';

// a 10 m wide stream running north for 300 m
const stream = {
  name: '수원천',
  width: 10,
  pts: [
    [0, 0],
    [0, 150],
    [0, 300],
  ] as Array<[number, number]>,
};

describe('stream walkways and stepping stones', () => {
  it('puts a row of stones across the water every spacing, across the whole width', () => {
    const rows = steppingStoneRows(stream);
    expect(rows.map((r) => r.stones[0][1])).toEqual([60, 180]);
    expect(rows).toHaveLength(
      Math.floor((300 - STONE_ROW_SPACING_M / 4 - STONE_ROW_SPACING_M / 2) / STONE_ROW_SPACING_M) + 1,
    );
    for (const r of rows) {
      expect(Math.abs(r.ax)).toBeCloseTo(1); // across a north-running stream = along X
      const xs = r.stones.map(([x]) => x);
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(stream.width - 2 * STONE_STEP_M);
      expect(Math.abs(xs[1] - xs[0])).toBeCloseTo(STONE_STEP_M);
    }
  });

  it('wading: in the water yes, on a stepping stone or the bank no', () => {
    expect(isWadingAt([stream], 1, 100)).toBe(true);
    expect(isWadingAt([stream], 0.2, 60)).toBe(false); // stepping stones
    expect(isWadingAt([stream], 6, 100)).toBe(false); // walkway on the bank
    expect(isWadingAt([], 1, 100)).toBe(false);
  });

  it('no stones and no wading on a road or bridge over the stream', () => {
    // a bridge deck across the stream at z = 55..65
    const curb = (_x: number, z: number) => Math.abs(z - 60) - 5;
    expect(steppingStoneRows(stream, curb).map((r) => r.stones[0][1])).toEqual([180]);
    expect(isWadingAt([stream], 1, 60, curb)).toBe(false); // on the bridge
    expect(isWadingAt([stream], 0.2, 62.5 + 3, curb)).toBe(true); // beside it: the row was dropped
  });
});

describe('walking route to a bench', () => {
  it('from the road onto the bench-side walkway, along it, to the bench', async () => {
    const { walkwayPath } = await import('./streamPaths');
    const bench = { x: 6, z: 200 }; // left bank (+X) of the north-running stream
    const path = walkwayPath([stream], { x: 30, z: 120 }, bench)!;
    expect(path[0]).toEqual({ x: 30, z: 120 });
    expect(path.at(-1)).toEqual(bench);
    const middle = path.slice(1, -1);
    expect(middle.length).toBeGreaterThan(5);
    for (const p of middle) expect(p.x).toBeCloseTo(5 + 0.9); // on the left walkway
    expect(middle[0].z).toBeCloseTo(120, -1);
    expect(middle.at(-1)!.z).toBeCloseTo(200, 0);
    // no stream by the target: no walking route
    expect(walkwayPath([stream], { x: 0, z: 0 }, { x: 200, z: 200 })).toBeNull();
  });
});
