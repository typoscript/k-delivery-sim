/** F10 A/B benchmark: shadows / mirrors / resolution turned off one at a time at the current spot */
import type { BenchmarkRow, PerfMonitor } from '../PerfMonitor';
import * as THREE from 'three';

export function snapshot(host: PerfMonitor, scenario: string): BenchmarkRow {
  const render = host.sections.get('render')?.avg ?? 0;
  const mirrors = host.sections.get('mirrors')?.avg ?? 0;
  const fi = host.frameInterval.avg;
  return {
    scenario,
    frameMs: +fi.toFixed(2),
    fps: fi > 0 ? Math.round(1000 / fi) : 0,
    cpuMs: +host.cpuTotal.avg.toFixed(2),
    renderCpuMs: +(render + mirrors).toFixed(2),
    gpuMs: host.gpuTotal() === null ? null : +host.gpuTotal()!.toFixed(2),
    drawCalls: Math.round(host.drawCalls.avg),
    triangles: Math.round(host.triangles.avg),
  };
}

/**
 * A/B benchmark at the current spot: each scenario runs `secs` (first second discarded for shader
 * recompiles), everything is restored afterwards. Ride the scooter first to include the mirror passes.
 */
export async function benchmark(
  host: PerfMonitor,
  ctx: { sun?: THREE.DirectionalLight } = {},
  secs = 4,
): Promise<BenchmarkRow[]> {
  if (host.benchmarking) return host.lastBenchmark ?? [];
  host.benchmarking = true;
  const r = host.renderer;
  const origPR = r.getPixelRatio();
  const sun = ctx.sun ?? host.findSun();
  const origCast = sun?.castShadow ?? false;
  const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
  const run = async (name: string, apply: () => void, restore: () => void) => {
    apply();
    await wait(1000);
    host.resetStats();
    await wait(secs * 1000);
    const row = host.snapshot(name);
    restore();
    return row;
  };
  const rows: BenchmarkRow[] = [];
  try {
    rows.push(
      await run(
        '기준(현재)',
        () => {},
        () => {},
      ),
    );
    rows.push(
      await run(
        '그림자 끔',
        () => sun && (sun.castShadow = false),
        () => sun && (sun.castShadow = origCast),
      ),
    );
    rows.push(
      await run(
        '미러 끔',
        () => (host.flags.skipMirrors = true),
        () => (host.flags.skipMirrors = false),
      ),
    );
    rows.push(
      await run(
        '해상도 1x',
        () => r.setPixelRatio(1),
        () => r.setPixelRatio(origPR),
      ),
    );
    rows.push(
      await run(
        '전부 끔',
        () => {
          if (sun) sun.castShadow = false;
          host.flags.skipMirrors = true;
          r.setPixelRatio(1);
        },
        () => {
          if (sun) sun.castShadow = origCast;
          host.flags.skipMirrors = false;
          r.setPixelRatio(origPR);
        },
      ),
    );
  } finally {
    host.benchmarking = false;
    host.resetStats();
  }
  host.lastBenchmark = rows;
  console.table(rows);
  return rows;
}
