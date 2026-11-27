/** Touching the in-world 3D phone: the hover hand, tap ripple and what a tap at a screen UV does */
import type { PhoneMap } from '../PhoneMap';
import { clamp } from '../../types';
import { hitCallBanner } from './callBanner3D';

/**
 * Drives the 1st-person touching hand when hovering over the in-world 3D phone
 * (mounted on scooter handlebar or held in 3D hand) without zooming!
 */
export function setExternal3DHandHover(host: PhoneMap, active: boolean, clientX: number, clientY: number): void {
  if (host.isZoomed) return;
  if (active) {
    host.touchHandEl.style.transform = `translate3d(${clientX}px, ${clientY}px, 0)`;
    host.touchHandEl.classList.add('active');
    document.body.classList.add('phone-3d-hover');
  } else {
    host.touchHandEl.classList.remove('active', 'tapping');
    document.body.classList.remove('phone-3d-hover');
  }
}

/** Triggers a brief tap-down press on the 1st-person touching hand over the 3D phone */
export function triggerExternal3DHandTap(host: PhoneMap, clientX: number, clientY: number): void {
  host.touchHandEl.style.transform = `translate3d(${clientX}px, ${clientY}px, 0)`;
  host.touchHandEl.classList.add('active', 'tapping');
  if (host.touchState.tapTimer !== null) {
    window.clearTimeout(host.touchState.tapTimer);
  }
  host.touchState.tapTimer = window.setTimeout(() => {
    host.touchHandEl.classList.remove('tapping');
    host.touchState.tapTimer = null;
  }, 170);
}

/**
 * Direct in-world UV touch hit-testing on the 360x680 3D phone screen canvas!
 * Allows riders to tap [👆 콜 수락] / [거절] right on the 3D handlebar or handheld phone
 * without opening the full-screen zoom modal.
 */
export function handle3DScreenTouch(
  host: PhoneMap,
  u: number,
  v: number,
  activeOfferId: string | null,
): 'accept_offer' | 'reject_offer' | 'expand_offer' | 'zoom' {
  const hasActiveOffer = activeOfferId !== null;
  const cx = clamp(u, 0, 1) * host.texCanvas.width;
  const cy = clamp(1 - v, 0, 1) * host.texCanvas.height;

  // Show expanding touch ripple directly on the 3D phone canvas texture!
  host.ripple3D.current = { x: cx, y: cy, bornAt: host.lastElapsed };
  host.last3DRenderTime = -1;
  host.lastZoomMapRenderTime = -1;
  host.callbacks.onScreenTap?.();

  if (hasActiveOffer && host.dispatchState.expandedOfferId !== activeOfferId) {
    // Compact banner: 수락 / ✕, or the banner body opens the full card (in this view and the zoomed one)
    const hit = hitCallBanner(cx, cy, host.texCanvas.width);
    if (hit === 'expand_offer') {
      host.dispatchState.expandedOfferId = activeOfferId;
      host.last3DRenderTime = -1;
    }
    if (hit) return hit;
  } else if (hasActiveOffer) {
    // Match split CTA button row drawn in render3DDispatchCallCard (y = 452..502, padded slightly for touch)
    if (cy >= 438 && cy <= 518) {
      if (cx >= 134 && cx <= 336) {
        return 'accept_offer';
      }
      if (cx >= 24 && cx < 134) {
        return 'reject_offer';
      }
    }
  }
  return 'zoom';
}
