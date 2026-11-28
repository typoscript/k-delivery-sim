/** F9 profiler overlay: CPU sections, GPU passes, renderer totals, memory and scene info */
import type { PerfMonitor } from '../PerfMonitor';

export function renderOverlay(host: PerfMonitor): void {
  if (!host.overlay) return;
  const budget = 1000 / 60;
  const fi = host.frameInterval.avg;
  const lines: string[] = [];
  lines.push(`⏱ 성능 측정 (F9 닫기 · F10 A/B 벤치마크)`);
  lines.push(
    `FPS ${fi > 0 ? (1000 / fi).toFixed(0) : '-'}  프레임 ${fi.toFixed(1)}ms  p95 ${host.frameInterval.percentile(0.95).toFixed(1)}  최악 ${host.frameInterval.max.toFixed(0)}`,
  );
  const cpu = host.cpuTotal.avg;
  lines.push(
    `CPU ${cpu.toFixed(2)}ms (${((cpu / budget) * 100).toFixed(0)}% of 16.7ms)  최악 ${host.cpuTotal.max.toFixed(1)}`,
  );
  const gt = host.gpuTotal();
  lines.push(
    host.gpu.available
      ? `GPU ${gt === null ? '측정 중' : `${gt.toFixed(2)}ms (${((gt / budget) * 100).toFixed(0)}%)`}`
      : 'GPU 타이머 미지원 브라우저',
  );
  for (const [label, s] of host.gpu.stats)
    lines.push(`  gpu:${label.padEnd(10)} ${s.avg.toFixed(2)}ms  max ${s.max.toFixed(1)}`);
  lines.push(
    `드로우콜 ${host.drawCalls.avg.toFixed(0)}  삼각형 ${(host.triangles.avg / 1000).toFixed(0)}k (그림자·미러 포함)`,
  );
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  const info = host.renderer.info.memory;
  lines.push(
    `GPU 지오메트리 ${info.geometries} · 텍스처 ${info.textures}${mem ? ` · JS ${(mem.usedJSHeapSize / 1e6).toFixed(0)}MB` : ''}`,
  );
  lines.push('── CPU 구간별 (평균 / 최악 ms) ──');
  const rows = [...host.sections.entries()].sort((a, b) => b[1].avg - a[1].avg);
  for (const [label, s] of rows) {
    const bar = '█'.repeat(Math.min(20, Math.round((s.avg / budget) * 40)));
    lines.push(`${label.padEnd(12)} ${s.avg.toFixed(2).padStart(6)} / ${s.max.toFixed(1).padStart(5)} ${bar}`);
  }
  const extra = host.sceneInfo();
  const extraStr = Object.entries(extra)
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ');
  if (extraStr) lines.push(extraStr);
  if (host.statusLine) lines.push(`▶ ${host.statusLine}`);
  if (host.lastSuite) {
    lines.push('── 최악 조건 벤치마크 (fps · p95 · cpu · gpu · draws) ──');
    for (const r of host.lastSuite) {
      lines.push(
        `${String(r.scenario).padEnd(16)} ${r.fps} · ${r.frameP95}ms · ${r.cpuMs} · ${r.gpuMs ?? '-'} · ${r.drawCalls}`,
      );
    }
  }
  if (host.lastBenchmark) {
    lines.push('── 마지막 A/B 벤치마크 ──');
    for (const r of host.lastBenchmark) {
      lines.push(
        `${r.scenario.padEnd(14)} ${r.frameMs.toFixed(1)}ms cpu ${r.cpuMs.toFixed(2)} render ${r.renderCpuMs.toFixed(2)} gpu ${r.gpuMs === null ? '-' : r.gpuMs.toFixed(2)} calls ${r.drawCalls}`,
      );
    }
  }
  host.overlay.textContent = lines.join('\n');
}
