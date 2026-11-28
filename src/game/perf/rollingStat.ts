/** Rolling average / max / percentile over the last WINDOW frames (profiler statistics) */
export const WINDOW = 180; // rolling window (frames)

export class RollingStat {
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
