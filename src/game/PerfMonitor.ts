import * as THREE from 'three';

/**
 * In-game performance profiler (toggle with F9 or ?perf=1, `window.__perf` in the console).
 *
 * - CPU: time of every game-loop section, measured as laps between `lap()` calls
 * - GPU: real GPU time of the main render and mirror passes via EXT_disjoint_timer_query_webgl2
 *   (when the browser exposes it; results arrive a few frames late)
 * - Renderer totals per frame (draw calls / triangles incl. shadow + mirror passes), memory, FPS
 * - A/B benchmark (`__perf.benchmark()` / F10): turns shadows, mirrors and high-DPI rendering off one
 *   at a time at the current spot and reports how much each one costs
 *
 * When the overlay is hidden and no benchmark runs, every call is a cheap early return.
 */

const WINDOW = 180; // rolling window (frames)

class RollingStat {
  private readonly buf = new Float32Array(WINDOW);
  private n = 0;
  private i = 0;

  push(v: number): void {
    this.buf[this.i] = v;
    this.i = (this.i + 1) % WINDOW;
    if (this.n < WINDOW) this.n++;
  }

  reset(): void {
    this.n = 0;
    this.i = 0;
  }

  get count(): number {
    return this.n;
  }

  get avg(): number {
    if (this.n === 0) return 0;
    let s = 0;
    for (let k = 0; k < this.n; k++) s += this.buf[k];
    return s / this.n;
  }

  get max(): number {
    let m = 0;
    for (let k = 0; k < this.n; k++) m = Math.max(m, this.buf[k]);
    return m;
  }

  percentile(p: number): number {
    if (this.n === 0) return 0;
    const arr = Array.from(this.buf.subarray(0, this.n)).sort((a, b) => a - b);
    return arr[Math.min(this.n - 1, Math.floor(this.n * p))];
  }
}

interface PendingQuery {
  label: string;
  query: WebGLQuery;
}

/** GPU pass timing with EXT_disjoint_timer_query_webgl2 (async results, pooled queries) */
class GpuTimer {
  private readonly gl: WebGL2RenderingContext | null;
  private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private readonly pending: PendingQuery[] = [];
  private readonly pool: WebGLQuery[] = [];
  private active: PendingQuery | null = null;
  readonly stats = new Map<string, RollingStat>();
  /** Most recent result per pass label (drives adaptive resolution) */
  readonly latest = new Map<string, number>();

  constructor(renderer: THREE.WebGLRenderer) {
    const gl = renderer.getContext();
    this.gl = gl instanceof WebGL2RenderingContext ? gl : null;
    this.ext = this.gl ? (this.gl.getExtension('EXT_disjoint_timer_query_webgl2') as GpuTimer['ext']) : null;
  }

  get available(): boolean {
    return this.ext !== null;
  }

  begin(label: string): void {
    if (!this.gl || !this.ext || this.active) return;
    const query = this.pool.pop() ?? this.gl.createQuery();
    if (!query) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.active = { label, query };
  }

  end(): void {
    if (!this.gl || !this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  /** Collect finished queries (call once per frame) */
  poll(): void {
    if (!this.gl || !this.ext) return;
    const disjoint = this.gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    while (this.pending.length > 0) {
      const q = this.pending[0];
      if (!this.gl.getQueryParameter(q.query, this.gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      if (!disjoint) {
        const ns = this.gl.getQueryParameter(q.query, this.gl.QUERY_RESULT) as number;
        let st = this.stats.get(q.label);
        if (!st) this.stats.set(q.label, (st = new RollingStat()));
        st.push(ns / 1e6);
        this.latest.set(q.label, ns / 1e6);
      }
      this.pool.push(q.query);
    }
  }
}

export interface PerfFlags {
  /** Benchmark toggles read by the game loop */
  skipMirrors: boolean;
}

export interface BenchmarkRow {
  scenario: string;
  frameMs: number;
  fps: number;
  cpuMs: number;
  renderCpuMs: number;
  gpuMs: number | null;
  drawCalls: number;
  triangles: number;
}

export class PerfMonitor {
  public readonly flags: PerfFlags = { skipMirrors: false };
  private readonly sections = new Map<string, RollingStat>();
  private readonly frameInterval = new RollingStat();
  private readonly cpuTotal = new RollingStat();
  private readonly drawCalls = new RollingStat();
  private readonly triangles = new RollingStat();
  private readonly gpu: GpuTimer;
  private overlay: HTMLDivElement | null = null;
  private overlayTimer = 0;
  private active = false;
  private benchmarking = false;
  private frameStart = 0;
  private lapStart = 0;
  private lastFrameAt = 0;
  private sceneInfo: () => Record<string, string | number> = () => ({});
  public lastBenchmark: BenchmarkRow[] | null = null;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.gpu = new GpuTimer(renderer);
    // Accumulate draw calls / triangles over ALL passes of a frame (shadow map + mirrors + main)
    renderer.info.autoReset = false;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F9') {
        e.preventDefault();
        this.toggleOverlay();
      } else if (e.code === 'F10' && this.active) {
        e.preventDefault();
        void this.benchmark();
      }
    });
    if (new URLSearchParams(window.location.search).get('perf') === '1') this.toggleOverlay(true);
  }

  /** Extra live context shown in the overlay (streaming stats, position...) */
  public setSceneInfo(fn: () => Record<string, string | number>): void {
    this.sceneInfo = fn;
  }

  /** True while the A/B benchmark is toggling render settings (adaptive systems should hold still) */
  public get isBenchmarking(): boolean {
    return this.benchmarking;
  }

  public get enabled(): boolean {
    return this.active || this.benchmarking || this.collecting;
  }

  private collecting = false;
  /** Status line shown in the overlay while an external suite runs */
  public statusLine = '';
  /** Last benchmark-suite result table (shown in the overlay) */
  public lastSuite: Array<Record<string, string | number | null>> | null = null;

  /** Collect stats without the overlay (benchmark suite) */
  public setCollecting(on: boolean): void {
    this.collecting = on;
    if (on) this.resetStats();
  }

  public toggleOverlay(force?: boolean): void {
    this.active = force ?? !this.active;
    if (this.active && !this.overlay) {
      const el = document.createElement('div');
      el.id = 'perf-overlay';
      el.style.cssText =
        'position:fixed;right:8px;top:8px;z-index:50;background:rgba(2,6,23,.86);color:#e2e8f0;' +
        'font:11px/1.45 ui-monospace,Menlo,monospace;padding:8px 10px;border-radius:8px;white-space:pre;' +
        'pointer-events:none;max-width:calc(100vw - 16px);overflow:hidden';
      document.body.appendChild(el);
      this.overlay = el;
    }
    if (this.overlay) this.overlay.style.display = this.active ? 'block' : 'none';
    this.resetStats();
  }

  public resetStats(): void {
    for (const s of this.sections.values()) s.reset();
    for (const s of this.gpu.stats.values()) s.reset();
    this.frameInterval.reset();
    this.cpuTotal.reset();
    this.drawCalls.reset();
    this.triangles.reset();
  }

  public beginFrame(now: number): void {
    this.renderer.info.reset();
    // GPU pass timing runs always (cheap) - adaptive resolution needs it even with the overlay hidden
    this.gpu.poll();
    if (!this.enabled) return;
    if (this.lastFrameAt > 0) this.frameInterval.push(now - this.lastFrameAt);
    this.lastFrameAt = now;
    this.frameStart = performance.now();
    this.lapStart = this.frameStart;
  }

  /** Attributes the time since the previous lap to `label` */
  public lap(label: string): void {
    if (!this.enabled) return;
    const t = performance.now();
    let st = this.sections.get(label);
    if (!st) this.sections.set(label, (st = new RollingStat()));
    st.push(t - this.lapStart);
    this.lapStart = t;
  }

  public gpuBegin(label: string): void {
    this.gpu.begin(label);
  }

  public gpuEnd(): void {
    this.gpu.end();
  }

  /** True when the browser exposes GPU timer queries (Chrome/Edge desktop) */
  public get gpuAvailable(): boolean {
    return this.gpu.available;
  }

  /** Latest measured GPU time of one frame (main + mirror passes), or null if unknown */
  public get gpuFrameMs(): number | null {
    if (!this.gpu.available || this.gpu.latest.size === 0) return null;
    let t = 0;
    for (const v of this.gpu.latest.values()) t += v;
    return t;
  }

  /** Forget the latest GPU samples (e.g. mirrors stopped rendering after dismounting) */
  public clearGpuLatest(label?: string): void {
    if (label) this.gpu.latest.delete(label);
    else this.gpu.latest.clear();
  }

  public endFrame(): void {
    if (!this.enabled) return;
    this.cpuTotal.push(performance.now() - this.frameStart);
    this.drawCalls.push(this.renderer.info.render.calls);
    this.triangles.push(this.renderer.info.render.triangles);
    if (this.active && ++this.overlayTimer % 15 === 0) this.renderOverlay();
  }

  private gpuTotal(): number | null {
    if (!this.gpu.available || this.gpu.stats.size === 0) return null;
    let t = 0;
    for (const s of this.gpu.stats.values()) t += s.avg;
    return t;
  }

  private renderOverlay(): void {
    if (!this.overlay) return;
    const budget = 1000 / 60;
    const fi = this.frameInterval.avg;
    const lines: string[] = [];
    lines.push(`⏱ 성능 측정 (F9 닫기 · F10 A/B 벤치마크)`);
    lines.push(`FPS ${fi > 0 ? (1000 / fi).toFixed(0) : '-'}  프레임 ${fi.toFixed(1)}ms  p95 ${this.frameInterval.percentile(0.95).toFixed(1)}  최악 ${this.frameInterval.max.toFixed(0)}`);
    const cpu = this.cpuTotal.avg;
    lines.push(`CPU ${cpu.toFixed(2)}ms (${((cpu / budget) * 100).toFixed(0)}% of 16.7ms)  최악 ${this.cpuTotal.max.toFixed(1)}`);
    const gt = this.gpuTotal();
    lines.push(this.gpu.available ? `GPU ${gt === null ? '측정 중' : `${gt.toFixed(2)}ms (${((gt / budget) * 100).toFixed(0)}%)`}` : 'GPU 타이머 미지원 브라우저');
    for (const [label, s] of this.gpu.stats) lines.push(`  gpu:${label.padEnd(10)} ${s.avg.toFixed(2)}ms  max ${s.max.toFixed(1)}`);
    lines.push(`드로우콜 ${this.drawCalls.avg.toFixed(0)}  삼각형 ${(this.triangles.avg / 1000).toFixed(0)}k (그림자·미러 포함)`);
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const info = this.renderer.info.memory;
    lines.push(`GPU 지오메트리 ${info.geometries} · 텍스처 ${info.textures}${mem ? ` · JS ${(mem.usedJSHeapSize / 1e6).toFixed(0)}MB` : ''}`);
    lines.push('── CPU 구간별 (평균 / 최악 ms) ──');
    const rows = [...this.sections.entries()].sort((a, b) => b[1].avg - a[1].avg);
    for (const [label, s] of rows) {
      const bar = '█'.repeat(Math.min(20, Math.round((s.avg / budget) * 40)));
      lines.push(`${label.padEnd(12)} ${s.avg.toFixed(2).padStart(6)} / ${s.max.toFixed(1).padStart(5)} ${bar}`);
    }
    const extra = this.sceneInfo();
    const extraStr = Object.entries(extra)
      .map(([k, v]) => `${k} ${v}`)
      .join(' · ');
    if (extraStr) lines.push(extraStr);
    if (this.statusLine) lines.push(`▶ ${this.statusLine}`);
    if (this.lastSuite) {
      lines.push('── 최악 조건 벤치마크 (fps · p95 · cpu · gpu · draws) ──');
      for (const r of this.lastSuite) {
        lines.push(
          `${String(r.scenario).padEnd(16)} ${r.fps} · ${r.frameP95}ms · ${r.cpuMs} · ${r.gpuMs ?? '-'} · ${r.drawCalls}`
        );
      }
    }
    if (this.lastBenchmark) {
      lines.push('── 마지막 A/B 벤치마크 ──');
      for (const r of this.lastBenchmark) {
        lines.push(
          `${r.scenario.padEnd(14)} ${r.frameMs.toFixed(1)}ms cpu ${r.cpuMs.toFixed(2)} render ${r.renderCpuMs.toFixed(2)} gpu ${r.gpuMs === null ? '-' : r.gpuMs.toFixed(2)} calls ${r.drawCalls}`
        );
      }
    }
    this.overlay.textContent = lines.join('\n');
  }

  private snapshot(scenario: string): BenchmarkRow {
    const render = this.sections.get('render')?.avg ?? 0;
    const mirrors = this.sections.get('mirrors')?.avg ?? 0;
    const fi = this.frameInterval.avg;
    return {
      scenario,
      frameMs: +fi.toFixed(2),
      fps: fi > 0 ? Math.round(1000 / fi) : 0,
      cpuMs: +this.cpuTotal.avg.toFixed(2),
      renderCpuMs: +(render + mirrors).toFixed(2),
      gpuMs: this.gpuTotal() === null ? null : +this.gpuTotal()!.toFixed(2),
      drawCalls: Math.round(this.drawCalls.avg),
      triangles: Math.round(this.triangles.avg),
    };
  }

  /**
   * A/B benchmark at the current spot: each scenario runs `secs` (first second discarded for shader
   * recompiles), everything is restored afterwards. Ride the scooter first to include the mirror passes.
   */
  public async benchmark(
    ctx: { sun?: THREE.DirectionalLight } = {},
    secs = 4
  ): Promise<BenchmarkRow[]> {
    if (this.benchmarking) return this.lastBenchmark ?? [];
    this.benchmarking = true;
    const r = this.renderer;
    const origPR = r.getPixelRatio();
    const sun = ctx.sun ?? this.findSun();
    const origCast = sun?.castShadow ?? false;
    const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
    const run = async (name: string, apply: () => void, restore: () => void) => {
      apply();
      await wait(1000);
      this.resetStats();
      await wait(secs * 1000);
      const row = this.snapshot(name);
      restore();
      return row;
    };
    const rows: BenchmarkRow[] = [];
    try {
      rows.push(await run('기준(현재)', () => {}, () => {}));
      rows.push(
        await run(
          '그림자 끔',
          () => sun && (sun.castShadow = false),
          () => sun && (sun.castShadow = origCast)
        )
      );
      rows.push(
        await run(
          '미러 끔',
          () => (this.flags.skipMirrors = true),
          () => (this.flags.skipMirrors = false)
        )
      );
      rows.push(
        await run(
          '해상도 1x',
          () => r.setPixelRatio(1),
          () => r.setPixelRatio(origPR)
        )
      );
      rows.push(
        await run(
          '전부 끔',
          () => {
            if (sun) sun.castShadow = false;
            this.flags.skipMirrors = true;
            r.setPixelRatio(1);
          },
          () => {
            if (sun) sun.castShadow = origCast;
            this.flags.skipMirrors = false;
            r.setPixelRatio(origPR);
          }
        )
      );
    } finally {
      this.benchmarking = false;
      this.resetStats();
    }
    this.lastBenchmark = rows;
    console.table(rows);
    return rows;
  }

  private sunRef: THREE.DirectionalLight | null = null;

  /** The scene's shadow-casting sun (registered by the game) */
  public setSun(sun: THREE.DirectionalLight): void {
    this.sunRef = sun;
  }

  private findSun(): THREE.DirectionalLight | null {
    return this.sunRef;
  }

  /** Plain-object snapshot of the current rolling stats (for automated measurements) */
  public report(): Record<string, unknown> {
    const sections: Record<string, { avg: number; max: number }> = {};
    for (const [k, s] of this.sections) sections[k] = { avg: +s.avg.toFixed(3), max: +s.max.toFixed(2) };
    const gpu: Record<string, number> = {};
    for (const [k, s] of this.gpu.stats) gpu[k] = +s.avg.toFixed(3);
    return {
      fps: this.frameInterval.avg > 0 ? Math.round(1000 / this.frameInterval.avg) : 0,
      frameMs: +this.frameInterval.avg.toFixed(2),
      frameP95: +this.frameInterval.percentile(0.95).toFixed(2),
      frameWorst: +this.frameInterval.max.toFixed(1),
      cpuMs: +this.cpuTotal.avg.toFixed(3),
      cpuWorst: +this.cpuTotal.max.toFixed(2),
      gpuAvailable: this.gpu.available,
      gpu,
      drawCalls: Math.round(this.drawCalls.avg),
      triangles: Math.round(this.triangles.avg),
      sections,
      samples: this.frameInterval.count,
      ...this.sceneInfo(),
    };
  }
}
