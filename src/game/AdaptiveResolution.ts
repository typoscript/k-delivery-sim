/**
 * Dynamic resolution controller (like console games / FSR-style "dynamic resolution").
 *
 * Fed with the real GPU time per frame (resolution only changes GPU cost - lowering it can't help a
 * CPU-bound frame) instead of the frame interval, so a browser that throttles rAF to 30Hz for power
 * saving does NOT make it drop resolution. When the smoothed cost stays above the budget it lowers the
 * render pixel ratio quickly; when there is comfortable headroom for a while it raises it again.
 * An increase that is immediately followed by a decrease doubles the wait before the next increase,
 * so it settles instead of oscillating.
 */

export interface AdaptiveResolutionOptions {
  min: number;
  max: number;
  /** Pixel-ratio step per adjustment */
  step?: number;
  /** Smoothed cost above this (ms) -> lower resolution */
  downMs?: number;
  /** Smoothed cost below this (ms) for `upStableSec` -> raise resolution */
  upMs?: number;
  upStableSec?: number;
  /** Minimum time between two adjustments */
  cooldownSec?: number;
}

export class AdaptiveResolution {
  public current: number;
  public min: number;
  public max: number;
  private readonly step: number;
  private readonly downMs: number;
  private readonly upMs: number;
  private readonly baseUpStableSec: number;
  private upStableSec: number;
  private readonly cooldownSec: number;
  private ema = -1;
  private stableFor = 0;
  private cooldown = 0;
  private sinceLastIncrease = Infinity;
  public adjustments = 0;

  constructor(opts: AdaptiveResolutionOptions) {
    this.min = opts.min;
    this.max = opts.max;
    this.current = opts.max;
    this.step = opts.step ?? 0.125;
    this.downMs = opts.downMs ?? 13.5;
    this.upMs = opts.upMs ?? 8.5;
    this.baseUpStableSec = opts.upStableSec ?? 4;
    this.upStableSec = this.baseUpStableSec;
    this.cooldownSec = opts.cooldownSec ?? 1.2;
  }

  /** Change the allowed range (graphics quality changed); clamps the current ratio */
  public setRange(min: number, max: number): void {
    this.min = Math.min(min, max);
    this.max = max;
    this.current = Math.min(this.max, Math.max(this.min, this.current));
    this.ema = -1;
    this.stableFor = 0;
    this.upStableSec = this.baseUpStableSec;
  }

  /** Smoothed frame cost (ms), -1 before the first sample */
  public get smoothedCostMs(): number {
    return this.ema;
  }

  /**
   * Feed one frame. `costMs` = GPU time of that frame (or a frame-interval estimate without a GPU timer).
   * Returns the new pixel ratio when it changed, otherwise null.
   */
  public update(costMs: number, dtSec: number): number | null {
    if (!Number.isFinite(costMs) || costMs < 0) return null;
    this.ema = this.ema < 0 ? costMs : this.ema + (costMs - this.ema) * 0.08;
    this.cooldown = Math.max(0, this.cooldown - dtSec);
    this.sinceLastIncrease += dtSec;
    if (this.cooldown > 0) return null;

    if (this.ema > this.downMs && this.current > this.min) {
      // Overloaded: drop faster when far over budget
      const factor = this.ema > this.downMs * 1.4 ? 2 : 1;
      const next = Math.max(this.min, round3(this.current - this.step * factor));
      if (this.sinceLastIncrease < this.upStableSec + 3) {
        // The last increase didn't hold -> wait longer before trying again (max 60s)
        this.upStableSec = Math.min(60, this.upStableSec * 2);
      }
      return this.apply(next);
    }

    if (this.ema < this.upMs && this.current < this.max) {
      this.stableFor += dtSec;
      if (this.stableFor >= this.upStableSec) {
        this.sinceLastIncrease = 0;
        return this.apply(Math.min(this.max, round3(this.current + this.step)));
      }
    } else {
      this.stableFor = 0;
    }
    return null;
  }

  private apply(next: number): number | null {
    this.stableFor = 0;
    this.cooldown = this.cooldownSec;
    if (next === this.current) return null;
    this.current = next;
    this.adjustments++;
    // Cost changes with resolution: let the average re-converge from the new level
    return next;
  }
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;
