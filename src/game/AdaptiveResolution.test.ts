import { describe, expect, it } from 'vitest';
import { AdaptiveResolution } from './AdaptiveResolution';

const DT = 1 / 60;

/** Simulated GPU: cost scales with pixel count (ratio^2) */
function simulate(ctrl: AdaptiveResolution, costAtRatio1: number, seconds: number): void {
  for (let t = 0; t < seconds; t += DT) {
    // The controller is fed GPU time only: CPU cost does not change with resolution
    ctrl.update(costAtRatio1 * ctrl.current * ctrl.current, DT);
  }
}

describe('AdaptiveResolution', () => {
  it('stays at max resolution when there is plenty of headroom', () => {
    const c = new AdaptiveResolution({ min: 1, max: 2 });
    simulate(c, 1.5, 20); // 6ms at 2x
    expect(c.current).toBe(2);
    expect(c.adjustments).toBe(0);
  });

  it('lowers resolution until the frame cost fits the budget', () => {
    const c = new AdaptiveResolution({ min: 1, max: 2 });
    simulate(c, 5, 30); // 20ms at 2x -> must drop toward ~1.5x
    expect(c.current).toBeLessThan(2);
    expect(5 * c.current * c.current).toBeLessThanOrEqual(13.5 + 1);
    expect(c.current).toBeGreaterThanOrEqual(1);
  });

  it('never goes below the minimum even when hopelessly overloaded', () => {
    const c = new AdaptiveResolution({ min: 1, max: 2 });
    simulate(c, 40, 20);
    expect(c.current).toBe(1);
  });

  it('raises resolution again after the load goes away', () => {
    const c = new AdaptiveResolution({ min: 1, max: 2 });
    simulate(c, 6, 20); // heavy scene
    const low = c.current;
    expect(low).toBeLessThan(2);
    simulate(c, 1, 40); // light scene
    expect(c.current).toBe(2);
  });

  it('settles instead of oscillating around the budget', () => {
    const c = new AdaptiveResolution({ min: 1, max: 2 });
    simulate(c, 4.2, 10); // converge first
    const before = c.adjustments;
    simulate(c, 4.2, 120); // 2 more minutes at the same load
    // backoff doubles the wait after a failed increase -> only a handful of changes
    expect(c.adjustments - before).toBeLessThanOrEqual(6);
    expect(4.2 * c.current * c.current).toBeLessThan(13.5 + 2);
  });

  it('clamps into a new range when the quality setting changes', () => {
    const c = new AdaptiveResolution({ min: 1, max: 2 });
    c.setRange(0.75, 1.35);
    expect(c.current).toBe(1.35);
    c.setRange(0.7, 1);
    expect(c.current).toBe(1);
  });
});

describe('GraphicsRuntime quality switching', () => {
  it('starts each newly selected quality level at its full resolution', async () => {
    const { GraphicsRuntime } = await import('./GraphicsRuntime');
    let pr = 2;
    const renderer = {
      shadowMap: { enabled: true, autoUpdate: true, needsUpdate: false },
      setPixelRatio: (v: number) => (pr = v),
      getPixelRatio: () => pr,
    };
    const sun = { castShadow: true, shadow: { mapSize: { x: 2048, set: () => {} }, map: null } };
    (globalThis as unknown as { window: unknown }).window = { devicePixelRatio: 2 };
    const g = new GraphicsRuntime(renderer as never, sun as never);
    g.apply({ graphicsQuality: 'high', autoResolution: true });
    expect(pr).toBe(2);
    g.apply({ graphicsQuality: 'low', autoResolution: true });
    expect(pr).toBe(1);
    expect(sun.castShadow).toBe(false);
    g.apply({ graphicsQuality: 'high', autoResolution: true });
    expect(pr).toBe(2);
    expect(sun.castShadow).toBe(true);
    // shadow map refreshed every 2nd frame on high
    let refreshes = 0;
    for (let i = 0; i < 10; i++) {
      renderer.shadowMap.needsUpdate = false;
      g.frame(1 / 60, 3, 16.7);
      if (renderer.shadowMap.needsUpdate) refreshes++;
    }
    expect(refreshes).toBe(5);
    delete (globalThis as unknown as { window?: unknown }).window;
  });
});
