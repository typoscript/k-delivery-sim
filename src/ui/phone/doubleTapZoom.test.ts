import { describe, expect, it } from 'vitest';
import { DOUBLE_TAP_MS, DOUBLE_TAP_ZOOM_STEP, DoubleTapZoomGesture, MAX_MAP_ZOOM, MIN_MAP_ZOOM, zoomForDrag } from './doubleTapZoom';

/** Taps once at (x, y) starting at time t */
function tap(g: DoubleTapZoomGesture, t: number, x = 100, y = 100, zoom = 1.4): void {
  g.down(t, x, y, zoom);
  g.up(t + 80, x, y);
}

describe('double-tap-and-drag map zoom', () => {
  it('drag down zooms in, drag up zooms out, within limits', () => {
    expect(zoomForDrag(1.4, 50)).toBeGreaterThan(1.4);
    expect(zoomForDrag(1.4, -50)).toBeLessThan(1.4);
    expect(zoomForDrag(1.4, 0)).toBe(1.4);
    expect(zoomForDrag(1.4, 5000)).toBe(MAX_MAP_ZOOM);
    expect(zoomForDrag(1.4, -5000)).toBe(MIN_MAP_ZOOM);
  });

  it('tap then press-and-drag zooms instead of panning', () => {
    const g = new DoubleTapZoomGesture();
    tap(g, 0);
    expect(g.down(200, 104, 98, 1.4)).toBe(true);
    const zin = g.move(104, 160)!; // dragged down
    expect(zin).toBeGreaterThan(1.4);
    const zout = g.move(104, 40)!; // then up past the start
    expect(zout).toBeLessThan(1.4);
    expect(g.up(900, 104, 40)).toBeNull(); // a drag, not a tap: zoom already applied
    expect(g.zooming).toBe(false);
  });

  it('a plain double tap zooms in one step', () => {
    const g = new DoubleTapZoomGesture();
    tap(g, 0);
    g.down(200, 100, 100, 1.4);
    expect(g.up(260, 100, 100)).toBeCloseTo(1.4 * DOUBLE_TAP_ZOOM_STEP);
    // ...and a third tap right after starts over instead of zooming again
    expect(g.down(400, 100, 100, 2.2)).toBe(false);
  });

  it('a normal drag, a slow second tap or a far second tap is not a zoom', () => {
    const g = new DoubleTapZoomGesture();
    g.down(0, 100, 100, 1.4);
    expect(g.move(160, 100)).toBeNull(); // panning
    g.up(300, 160, 100);
    expect(g.down(400, 160, 100, 1.4)).toBe(false); // previous press was a drag, not a tap

    const slow = new DoubleTapZoomGesture();
    tap(slow, 0);
    expect(slow.down(80 + DOUBLE_TAP_MS + 50, 100, 100, 1.4)).toBe(false);

    const far = new DoubleTapZoomGesture();
    tap(far, 0);
    expect(far.down(200, 220, 100, 1.4)).toBe(false);
  });
});
