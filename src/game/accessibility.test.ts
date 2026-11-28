import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ACCESSIBILITY,
  REDUCED_MOTION_SCALE,
  SIGNAL_PALETTE,
  motionScale,
  parseAccessibility,
  setColorSafe,
  signalHex,
} from './accessibility';

/** Relative luminance-free check: how far apart two colours are in the red / green channels */
const rgb = (hex: number) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];

describe('accessibility', () => {
  it('reduced motion keeps a quarter of the camera motion', () => {
    expect(motionScale(DEFAULT_ACCESSIBILITY)).toBe(1);
    expect(motionScale({ ...DEFAULT_ACCESSIBILITY, reduceMotion: true })).toBe(REDUCED_MOTION_SCALE);
  });

  it('the colour-safe signals differ in blue / brightness, not only red vs green', () => {
    const { red, green } = SIGNAL_PALETTE.colorSafe;
    const [rr, rg, rb] = rgb(red);
    const [gr, gg, gb] = rgb(green);
    // a red-green colour blind eye mostly sees blue and brightness: the safe green carries blue, the red none
    expect(gb - rb).toBeGreaterThan(100);
    expect(rr).toBeGreaterThan(gr);
    expect(rg + gg).toBeGreaterThan(0);
    // the usual palette is what the game always used
    expect(SIGNAL_PALETTE.normal).toEqual({ red: 0xef4444, yellow: 0xfacc15, green: 0x22c55e });
  });

  it('the phone map reads the current palette', () => {
    setColorSafe(false);
    expect(signalHex('green')).toBe('#22c55e');
    setColorSafe(true);
    expect(signalHex('green')).toBe('#009e9e');
    setColorSafe(false);
  });

  it('saved settings fall back to the defaults', () => {
    expect(parseAccessibility(undefined)).toEqual(DEFAULT_ACCESSIBILITY);
    expect(parseAccessibility({ largeText: true, colorSafe: 'yes' })).toEqual({ ...DEFAULT_ACCESSIBILITY, largeText: true });
  });
});
