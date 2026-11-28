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
