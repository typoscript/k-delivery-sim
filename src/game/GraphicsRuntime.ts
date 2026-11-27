import * as THREE from 'three';
import { GraphicsQuality } from '../types';
import { AdaptiveResolution } from './AdaptiveResolution';

/**
 * Per-quality render budget + the two runtime systems that keep it:
 *  - dynamic resolution (AdaptiveResolution) within the quality's pixel-ratio range
 *  - shadow scheduling: the shadow map is re-rendered every N frames instead of every frame
 *    (the sun direction is fixed; only nearby moving objects lag by a frame or two)
 */

export interface QualityProfile {
  maxPixelRatio: number;
  minPixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  /** Re-render the shadow map every N frames */
  shadowInterval: number;
}

export function qualityProfile(q: GraphicsQuality, deviceDpr: number): QualityProfile {
  const dpr = Math.max(1, deviceDpr || 1);
  switch (q) {
    case 'high':
      return { maxPixelRatio: Math.min(dpr, 2), minPixelRatio: 1, shadows: true, shadowMapSize: 2048, shadowInterval: 2 };
    case 'medium':
      return { maxPixelRatio: Math.min(dpr, 1.35), minPixelRatio: 0.85, shadows: true, shadowMapSize: 1024, shadowInterval: 3 };
    default:
      return { maxPixelRatio: 1, minPixelRatio: 0.7, shadows: false, shadowMapSize: 512, shadowInterval: 4 };
  }
}

export interface GraphicsSettingsInput {
  graphicsQuality: GraphicsQuality;
  autoResolution: boolean;
}

export class GraphicsRuntime {
  public profile: QualityProfile;
  public readonly adaptive: AdaptiveResolution;
  public autoResolution = true;
  private appliedQuality: GraphicsQuality | null = null;
  private frameIndex = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly sun: THREE.DirectionalLight
  ) {
    this.profile = qualityProfile('high', window.devicePixelRatio);
    this.adaptive = new AdaptiveResolution({ min: this.profile.minPixelRatio, max: this.profile.maxPixelRatio });
    // Shadows are toggled per light (castShadow) so materials recompile correctly at runtime;
    // the map itself is refreshed on our schedule, not automatically every render() call.
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
  }

  public apply(s: GraphicsSettingsInput): void {
    const qualityChanged = s.graphicsQuality !== this.appliedQuality;
    this.appliedQuality = s.graphicsQuality;
    this.profile = qualityProfile(s.graphicsQuality, window.devicePixelRatio);
    this.autoResolution = s.autoResolution;
    this.adaptive.setRange(this.profile.minPixelRatio, this.profile.maxPixelRatio);
    // A new quality level (or manual resolution) starts at that level's full resolution;
    // dynamic resolution then steps down only if the GPU actually can't keep up
    if (qualityChanged || !this.autoResolution) this.adaptive.current = this.profile.maxPixelRatio;
    this.renderer.setPixelRatio(this.adaptive.current);

    this.sun.castShadow = this.profile.shadows;
    const size = this.profile.shadowMapSize;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      // Re-allocate the shadow render target at the new size
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** Current render pixel ratio */
  public get pixelRatio(): number {
    return this.renderer.getPixelRatio();
  }

  /** Force a shadow refresh on the next render (teleport, big scene change) */
  public invalidateShadows(): void {
    this.renderer.shadowMap.needsUpdate = true;
  }

  /**
   * Call once per frame before rendering.
   * `gpuMs`: last measured GPU frame time (null when the browser has no GPU timer),
   * `frameIntervalMs`: time since the previous frame (fallback signal).
   */
  public frame(dtSec: number, gpuMs: number | null, frameIntervalMs: number, holdResolution = false): void {
    this.frameIndex++;
    if (this.profile.shadows && this.frameIndex % this.profile.shadowInterval === 0) {
      this.renderer.shadowMap.needsUpdate = true;
    }
    if (!this.autoResolution || holdResolution) return;
    // Without a GPU timer, only clearly missed frames count as GPU pressure (16.7ms frame -> ~8ms)
    const cost = gpuMs ?? Math.max(0, frameIntervalMs - 9);
    const next = this.adaptive.update(cost, dtSec);
    if (next !== null) this.renderer.setPixelRatio(next);
  }
}
