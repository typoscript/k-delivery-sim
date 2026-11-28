/**
 * Performance regression watch for the worst-case benchmark suite (`?bench=suite`): the scene cost (draw calls and
 * triangles - the same on every machine for the same build) of each scenario is kept here as a baseline, and a new
 * run flags the scenes that grew a lot. FPS and ms are left out: they depend on the machine. Traffic and pedestrians
 * are placed randomly, so a scene varies ~±15% between runs; the thresholds sit above that.
 * Update the baseline after an intended change: run the suite, then copy `__benchBaseline()` from the console here.
 */

export interface BaselineRow {
  drawCalls: number;
  triangles: number;
}

/** Draw calls growing more than this share over the baseline are flagged */
export const DRAW_CALL_REGRESSION = 0.25;
/** Triangles growing more than this share over the baseline are flagged */
export const TRIANGLE_REGRESSION = 0.3;

/** Measured on 2026-11-28 (two runs averaged, after the stream walkways / strollers / flowing water) */
export const BENCH_BASELINE: Record<string, BaselineRow> = {
  '인계동 도보': { drawCalls: 264, triangles: 43047 },
  '수원역 도보 (최고 밀도)': { drawCalls: 220, triangles: 42272 },
  '수원역 주행 정지': { drawCalls: 314, triangles: 70897 },
  '수원역 주행 이동': { drawCalls: 318, triangles: 87368 },
  '수원역 밤 도보': { drawCalls: 233, triangles: 43413 },
  '수원역 비 도보': { drawCalls: 231, triangles: 47807 },
  '수원역 밤+비 주행 이동': { drawCalls: 378, triangles: 100261 },
  '광교 도보 (저밀도)': { drawCalls: 196, triangles: 28635 },
  '수원역 눈 도보 (눈 쌓임)': { drawCalls: 216, triangles: 49370 },
  '수원역 밤+눈 주행 이동': { drawCalls: 333, triangles: 100769 },
  '수원역 도보 · 보통 맵 디테일': { drawCalls: 218, triangles: 40108 },
  '수원역 도보 · 낮음 맵 디테일': { drawCalls: 204, triangles: 27666 },
};

export interface BaselineCheck {
  scenario: string;
  /** Change against the baseline (0.1 = +10%); null when the scene has no baseline */
  drawCallsDelta: number | null;
  trianglesDelta: number | null;
  regressed: boolean;
}

/** Compares one suite run with the baseline: the change per scene and whether it grew past the thresholds */
export function checkAgainstBaseline(
  rows: ReadonlyArray<{ scenario: string; drawCalls: number; triangles: number }>,
  baseline: Readonly<Record<string, BaselineRow>> = BENCH_BASELINE,
): BaselineCheck[] {
  return rows.map((r) => {
    const b = baseline[r.scenario];
    if (!b) return { scenario: r.scenario, drawCallsDelta: null, trianglesDelta: null, regressed: false };
    const dc = b.drawCalls > 0 ? r.drawCalls / b.drawCalls - 1 : 0;
    const tri = b.triangles > 0 ? r.triangles / b.triangles - 1 : 0;
    return {
      scenario: r.scenario,
      drawCallsDelta: dc,
      trianglesDelta: tri,
      regressed: dc > DRAW_CALL_REGRESSION || tri > TRIANGLE_REGRESSION,
    };
  });
}

/** "+12%" / "-3%" / "-" for the overlay table */
export function formatDelta(d: number | null): string {
  if (d === null) return '-';
  const pct = Math.round(d * 100);
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

/** A baseline object from one or more runs (averaged per scene), to paste into BENCH_BASELINE */
export function baselineFromRuns(
  runs: ReadonlyArray<ReadonlyArray<{ scenario: string; drawCalls: number; triangles: number }>>,
): Record<string, BaselineRow> {
  const sums = new Map<string, { dc: number; tri: number; n: number }>();
  for (const run of runs) {
    for (const r of run) {
      const s = sums.get(r.scenario) ?? { dc: 0, tri: 0, n: 0 };
      s.dc += r.drawCalls;
      s.tri += r.triangles;
      s.n++;
      sums.set(r.scenario, s);
    }
  }
  const out: Record<string, BaselineRow> = {};
  for (const [k, s] of sums) out[k] = { drawCalls: Math.round(s.dc / s.n), triangles: Math.round(s.tri / s.n) };
  return out;
}
