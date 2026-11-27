import type { PhoneCallbacks } from './types';
import { MapViewState } from './mapView';

export interface TouchHandEls {
  phoneScreenEl: HTMLElement;
  touchHandEl: HTMLElement;
  touchRippleLayerEl: HTMLElement;
}

export interface TouchHandState {
  tapTimer: number | null;
}

/** Wires realistic 1st-person touching hand & glass tap ripples across the zoomed smartphone screen */
export function setupTouchHandInteraction(
  els: TouchHandEls,
  touch: TouchHandState,
  view: MapViewState,
  isZoomed: () => boolean,
  callbacks: Pick<PhoneCallbacks, 'onScreenTap'>
): void {
  const positionHand = (clientX: number, clientY: number) => {
    els.touchHandEl.style.transform = `translate3d(${clientX}px, ${clientY}px, 0)`;
  };

  els.phoneScreenEl.addEventListener('pointerenter', (e) => {
    if (!isZoomed()) return;
    positionHand(e.clientX, e.clientY);
    els.touchHandEl.classList.add('active');
  });

  els.phoneScreenEl.addEventListener('pointermove', (e) => {
    if (!isZoomed()) return;
    positionHand(e.clientX, e.clientY);
    if (!els.touchHandEl.classList.contains('active')) {
      els.touchHandEl.classList.add('active');
    }
  });

  els.phoneScreenEl.addEventListener('pointerleave', () => {
    els.touchHandEl.classList.remove('active', 'tapping');
  });

  els.phoneScreenEl.addEventListener('pointerdown', (e) => {
    if (!isZoomed()) return;
    positionHand(e.clientX, e.clientY);
    els.touchHandEl.classList.add('active', 'tapping');

    if (touch.tapTimer !== null) {
      window.clearTimeout(touch.tapTimer);
    }
    touch.tapTimer = window.setTimeout(() => {
      if (!view.isMapDragging) {
        els.touchHandEl.classList.remove('tapping');
      }
      touch.tapTimer = null;
    }, 170);

    // Spawn capacitive glass touch ripple at exact fingertip location on screen
    const rect = els.phoneScreenEl.getBoundingClientRect();
    const rx = e.clientX - rect.left;
    const ry = e.clientY - rect.top;
    const ripple = document.createElement('span');
    ripple.className = 'phone-touch-ripple';
    ripple.style.left = `${rx}px`;
    ripple.style.top = `${ry}px`;
    els.touchRippleLayerEl.appendChild(ripple);
    window.setTimeout(() => ripple.remove(), 420);

    callbacks.onScreenTap?.();
  });

  window.addEventListener('pointerup', () => {
    els.touchHandEl.classList.remove('tapping');
  });
}
