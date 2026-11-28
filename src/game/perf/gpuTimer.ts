import * as THREE from 'three';
import { RollingStat } from './rollingStat';

interface PendingQuery {
  label: string;
  query: WebGLQuery;
}

/** GPU pass timing with EXT_disjoint_timer_query_webgl2 (async results, pooled queries) */
export class GpuTimer {
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
