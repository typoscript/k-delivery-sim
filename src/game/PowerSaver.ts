/**
 * Idle / menu power saving: drop to 30fps when nothing on screen needs 60fps, return to 60fps on the
 * very next input or movement. Halves GPU/CPU work (and laptop heat) while the rider waits for a call,
 * reads the phone or sits in a menu.
 */

export const ACTIVE_FPS = 60;
export const POWER_SAVE_FPS = 30;
/** No input and no movement for this long counts as idle */
export const IDLE_SECONDS = 4;

export interface PowerSaveInputs {
  /** Settings toggle */
  enabled: boolean;
  /** Delivery-proof camera viewfinder needs smooth 60fps aiming */
  photoMode: boolean;
  /** A blocking menu / modal covers the game */
  menuOpen: boolean;
  /** Smartphone map zoomed full-screen */
  phoneZoomed: boolean;
  /** Rider or scooter is moving */
  moving: boolean;
  /** Seconds since the last key / mouse / touch input */
  secondsSinceInput: number;
}

export function targetFps(i: PowerSaveInputs): number {
  if (!i.enabled || i.photoMode) return ACTIVE_FPS;
  if (i.menuOpen) return POWER_SAVE_FPS;
  if (i.moving) return ACTIVE_FPS;
  if (i.phoneZoomed) return POWER_SAVE_FPS;
  return i.secondsSinceInput >= IDLE_SECONDS ? POWER_SAVE_FPS : ACTIVE_FPS;
}

/** Tracks the time of the last user input */
export class InputActivity {
  private lastInputAt = performance.now();

  constructor(target: Window = window) {
    const mark = () => {
      this.lastInputAt = performance.now();
    };
    for (const ev of ['keydown', 'keyup', 'pointerdown', 'pointermove', 'wheel', 'touchstart']) {
      target.addEventListener(ev, mark, { passive: true });
    }
  }

  public secondsSince(now = performance.now()): number {
    return (now - this.lastInputAt) / 1000;
  }
}
