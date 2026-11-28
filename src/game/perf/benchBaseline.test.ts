import { describe, expect, it } from 'vitest';
import {
  BENCH_BASELINE,
  DRAW_CALL_REGRESSION,
  baselineFromRuns,
  checkAgainstBaseline,
  formatDelta,
} from './benchBaseline';
import { SCENARIOS } from '../BenchmarkSuite';

describe('benchmark regression watch', () => {
  it('has a baseline for every benchmark scene', () => {
    expect(Object.keys(BENCH_BASELINE).sort()).toEqual(SCENARIOS.map((s) => s.name).sort());
  });

  it('flags only scenes that grew past the thresholds (run-to-run noise passes)', () => {
    const base = { a: { drawCalls: 200, triangles: 40_000 }, b: { drawCalls: 300, triangles: 90_000 } };
    const checks = checkAgainstBaseline(
      [
        { scenario: 'a', drawCalls: 230, triangles: 44_000 }, // +15% / +10%: noise
        { scenario: 'b', drawCalls: 300 * (1 + DRAW_CALL_REGRESSION) + 10, triangles: 90_000 },
        { scenario: 'new', drawCalls: 999, triangles: 1 },
      ],
      base,
    );
    expect(checks.map((c) => c.regressed)).toEqual([false, true, false]);
    expect(checks[0].drawCallsDelta).toBeCloseTo(0.15);
    expect(checks[2].drawCallsDelta).toBeNull();
    expect(checkAgainstBaseline([{ scenario: 'a', drawCalls: 200, triangles: 60_000 }], base)[0].regressed).toBe(true);
  });

  it('formats changes and averages runs into a new baseline', () => {
    expect(formatDelta(0.123)).toBe('+12%');
    expect(formatDelta(-0.05)).toBe('-5%');
    expect(formatDelta(null)).toBe('-');
    expect(
      baselineFromRuns([
        [{ scenario: 'a', drawCalls: 200, triangles: 1000 }],
        [{ scenario: 'a', drawCalls: 221, triangles: 1001 }],
      ]),
    ).toEqual({ a: { drawCalls: 211, triangles: 1001 } });
  });
});
