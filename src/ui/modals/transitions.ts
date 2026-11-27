/** Fade transitions for doors and the elevator (the scene swaps at the midpoint) */
import type { ModalUi } from '../ModalUi';

/**
 * Snappy ~0.55s doorway step-in / step-out fade transition (used when walking into a 1F 원룸·빌라 stairwell
 * or stepping into/out of the 1F 3D Apartment Elevator Cabin!).
 */
export function playQuickDoorTransition(
  host: ModalUi,
  caption: string,
  onMidpoint: () => void,
  onDone?: () => void,
): void {
  host.playFadeTransition(caption, 240, 360, 560, onMidpoint, onDone);
}

/**
 * 2-Second Black Fade-Out Elevator Transition.
 * Executes onMidpoint() while the screen is completely black (teleport + toggle scene visibility!).
 */
export function playElevatorTransition(
  host: ModalUi,
  caption: string,
  onMidpoint: () => void,
  onDone?: () => void,
): void {
  host.playFadeTransition(caption, 800, 1450, 2050, onMidpoint, onDone);
}

/** Fade to black, run onMidpoint while black at `midMs`, fade back from `clearMs`, done at `doneMs` */
export function playFadeTransition(
  host: ModalUi,
  caption: string,
  midMs: number,
  clearMs: number,
  doneMs: number,
  onMidpoint: () => void,
  onDone?: () => void,
): void {
  if (host.activeModal === 'transition') return;
  host.closeAll();
  host.activeModal = 'transition';
  host.fadeCaption.textContent = caption;
  host.fadeOverlay.classList.remove('hidden');
  void host.fadeOverlay.offsetWidth;
  host.fadeOverlay.classList.add('opaque');
  window.setTimeout(onMidpoint, midMs);
  window.setTimeout(() => host.fadeOverlay.classList.remove('opaque'), clearMs);
  window.setTimeout(() => {
    host.fadeOverlay.classList.add('hidden');
    host.activeModal = 'none';
    if (onDone) onDone();
  }, doneMs);
}
