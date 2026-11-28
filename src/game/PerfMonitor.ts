import * as THREE from 'three';
import { RollingStat } from './perf/rollingStat';
import { GpuTimer } from './perf/gpuTimer';

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

import {
  renderOverlay as renderOverlayFn,
} from './perf/perfOverlay';
import {
  snapshot as snapshotFn,
  benchmark as benchmarkFn,
} from './perf/perfBenchmark';

export class PerfMonitor {
  public readonly flags: PerfFlags = { skipMirrors: false };
  /** @internal perf/* */
  readonly sections = new Map<string, RollingStat>();
  /** @internal perf/* */
  readonly frameInterval = new RollingStat();
  /** @internal perf/* */
  readonly cpuTotal = new RollingStat();
  /** @internal perf/* */
  readonly drawCalls = new RollingStat();
  /** @internal perf/* */
  readonly triangles = new RollingStat();
  /** @internal perf/* */
  readonly gpu: GpuTimer;
  /** @internal perf/* */
  overlay: HTMLDivElement | null = null;
  private overlayTimer = 0;
  private active = false;
  /** @internal perf/* */
  benchmarking = false;
  private frameStart = 0;
  private lapStart = 0;
  private lastFrameAt = 0;
  /** @internal perf/* */
  sceneInfo: () => Record<string, string | number> = () => ({});
  public lastBenchmark: BenchmarkRow[] | null = null;

  /** @param renderer read by perf/* too */
  constructor(readonly renderer: THREE.WebGLRenderer) {
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

  /** True while any benchmark is measuring (power saving must not throttle the frame rate) */
  public get isMeasuring(): boolean {
    return this.benchmarking || this.collecting;
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

  /** @internal perf/* */
  gpuTotal(): number | null {
    if (!this.gpu.available || this.gpu.stats.size === 0) return null;
    let t = 0;
    for (const s of this.gpu.stats.values()) t += s.avg;
    return t;
  }

  private renderOverlay(): void {
    renderOverlayFn(this);
  }

  /** @internal perf/* */
  snapshot(scenario: string): BenchmarkRow {
    return snapshotFn(this, scenario);
  }

  /**
   * A/B benchmark at the current spot: each scenario runs `secs` (first second discarded for shader
   * recompiles), everything is restored afterwards. Ride the scooter first to include the mirror passes.
   */
  public async benchmark(
    ctx: { sun?: THREE.DirectionalLight } = {},
    secs = 4
  ): Promise<BenchmarkRow[]> {
    return benchmarkFn(this, ctx, secs);
  }

  private sunRef: THREE.DirectionalLight | null = null;

  /** The scene's shadow-casting sun (registered by the game) */
  public setSun(sun: THREE.DirectionalLight): void {
    this.sunRef = sun;
  }

  /** @internal perf/* */
  findSun(): THREE.DirectionalLight | null {
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
