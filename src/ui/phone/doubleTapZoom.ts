/**
 * One-finger zoom like phone map apps: tap, then press again and drag — down zooms in, up zooms out.
 * A quick double tap without dragging zooms in one step. Pure gesture state (no DOM), unit tested.
 */

/** Second press must come this soon after the first tap ends ... */
export const DOUBLE_TAP_MS = 320;
/** ... and this close to it (px) */
export const DOUBLE_TAP_SLOP_PX = 36;
/** A press that moves less than this (px) is a tap */
export const TAP_MOVE_PX = 8;
/** Zoom factor per pixel dragged (down = in) */
export const DRAG_ZOOM_PER_PX = 0.009;
/** Zoom step of a plain double tap */
export const DOUBLE_TAP_ZOOM_STEP = 1.6;

export const MIN_MAP_ZOOM = 0.42;
export const MAX_MAP_ZOOM = 3.2;

const clampZoom = (z: number) => Math.min(MAX_MAP_ZOOM, Math.max(MIN_MAP_ZOOM, z));

/** Zoom after dragging `dy` px (down positive) since the second press started at `startZoom` */
export function zoomForDrag(startZoom: number, dy: number): number {
  return clampZoom(startZoom * Math.exp(dy * DRAG_ZOOM_PER_PX));
}

export class DoubleTapZoomGesture {
  private lastTapAt = -Infinity;
  private lastTapX = 0;
  private lastTapY = 0;
  private downAt = 0;
  private downX = 0;
  private downY = 0;
  private moved = false;
  /** Second press of a double tap is held: vertical drag zooms instead of panning */
  public zooming = false;
  private startZoom = 1;

  /** Pointer pressed; returns true when this press starts a zoom gesture (don't pan) */
  public down(t: number, x: number, y: number, currentZoom: number): boolean {
    this.downAt = t;
    this.downX = x;
    this.downY = y;
    this.moved = false;
    this.zooming =
      t - this.lastTapAt <= DOUBLE_TAP_MS && Math.hypot(x - this.lastTapX, y - this.lastTapY) <= DOUBLE_TAP_SLOP_PX;
    this.startZoom = currentZoom;
    return this.zooming;
  }

  /** Pointer moved while pressed; returns the new zoom while zooming, else null (let the map pan) */
  public move(x: number, y: number): number | null {
    if (Math.hypot(x - this.downX, y - this.downY) > TAP_MOVE_PX) this.moved = true;
    if (!this.zooming) return null;
    return zoomForDrag(this.startZoom, y - this.downY);
  }

  /** Pointer released; returns the zoom for a plain double tap (zoom in one step), else null */
  public up(t: number, x: number, y: number): number | null {
    const wasZooming = this.zooming;
    this.zooming = false;
    const isTap = !this.moved && t - this.downAt < DOUBLE_TAP_MS * 1.5;
    if (wasZooming) {
      // The double tap is used up either way
      this.lastTapAt = -Infinity;
      return isTap ? clampZoom(this.startZoom * DOUBLE_TAP_ZOOM_STEP) : null;
    }
    if (isTap) {
      this.lastTapAt = t;
      this.lastTapX = x;
      this.lastTapY = y;
    } else {
      this.lastTapAt = -Infinity;
    }
    return null;
  }
}
