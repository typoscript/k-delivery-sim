/**
 * Accessibility settings (설정 `O` → ♿ 접근성): less camera motion (walk bob, speed-bump bounce, horizon lean and
 * crosswind sway), larger HUD text, and a colour-safe palette for the traffic signals (3D lamps and the phone map)
 * that keeps red and green apart for red-green colour blindness. Pure values, unit tested; the game applies them.
 */

export interface AccessibilityPrefs {
  reduceMotion: boolean;
  largeText: boolean;
  colorSafe: boolean;
}

export const DEFAULT_ACCESSIBILITY: AccessibilityPrefs = { reduceMotion: false, largeText: false, colorSafe: false };

/** Share of the camera motion kept with 화면 흔들림 줄이기 (walk bob, bump bounce, horizon roll) */
export const REDUCED_MOTION_SCALE = 0.25;

export function motionScale(p: AccessibilityPrefs): number {
  return p.reduceMotion ? REDUCED_MOTION_SCALE : 1;
}

export type SignalColor = 'red' | 'yellow' | 'green';

/** Signal colours: the usual ones, or a red-green safe set (vermilion / amber / blue-green, as Okabe-Ito) */
export const SIGNAL_PALETTE: Record<'normal' | 'colorSafe', Record<SignalColor, number>> = {
  normal: { red: 0xef4444, yellow: 0xfacc15, green: 0x22c55e },
  colorSafe: { red: 0xd55e00, yellow: 0xf0e442, green: 0x009e9e },
};

let colorSafeNow = false;

/** The game sets this from the settings; the phone map reads it while drawing */
export function setColorSafe(on: boolean): void {
  colorSafeNow = on;
}

export function signalColor(c: SignalColor, colorSafe = colorSafeNow): number {
  return SIGNAL_PALETTE[colorSafe ? 'colorSafe' : 'normal'][c];
}

/** "#rrggbb" of a signal colour (canvas drawing) */
export function signalHex(c: SignalColor, colorSafe = colorSafeNow): string {
  return `#${signalColor(c, colorSafe).toString(16).padStart(6, '0')}`;
}

/** Validates saved accessibility settings (missing / wrong fields fall back to the defaults) */
export function parseAccessibility(raw: unknown): AccessibilityPrefs {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const pick = (k: keyof AccessibilityPrefs) => (typeof r[k] === 'boolean' ? (r[k] as boolean) : DEFAULT_ACCESSIBILITY[k]);
  return { reduceMotion: pick('reduceMotion'), largeText: pick('largeText'), colorSafe: pick('colorSafe') };
}
