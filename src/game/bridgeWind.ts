/**
 * Crosswind on bridges (다리 위 옆바람): riding over a bridge at speed, gusts push the scooter sideways a little - more
 * in rain / snow. Pure function of the game time (no wall clock), unit tested; the world frame applies it.
 */
import type { WeatherMode } from '../types';

/** Below this speed the wind is not felt (pushing / crawling over the bridge) */
export const WIND_MIN_KMH = 20;
/** Peak sideways push (m/s) on a clear day */
export const WIND_PEAK_MS = 1.1;
const WEATHER_MUL: Record<WeatherMode, number> = { clear: 1, cloudy: 1.25, rain: 1.7, snow: 1.9 };

/**
 * Sideways push (m/s, + = to the rider's right) at game time `t` seconds: a slow swell with quicker gusts on top,
 * fading in with speed above WIND_MIN_KMH (full from 40 km/h). 0 below the threshold.
 */
export function bridgeGust(t: number, weather: WeatherMode, speedKmh: number): number {
  if (speedKmh < WIND_MIN_KMH) return 0;
  const speedMul = Math.min(1, (speedKmh - WIND_MIN_KMH) / 20);
  const swell = 0.6 + 0.4 * Math.sin(t * 0.37);
  const gusts = Math.sin(t * 1.3) * 0.7 + Math.sin(t * 2.9 + 1.1) * 0.3;
  return WIND_PEAK_MS * WEATHER_MUL[weather] * speedMul * swell * gusts;
}

/**
 * Horizon roll (radians) for a sideways push of `gust` m/s: the rider leans into the wind a little. A push to the
 * right (+) means wind from the left, so the lean is to the left (negative roll = left, as `leanAngle`).
 */
export function windRollFor(gust: number): number {
  return Math.max(-0.05, Math.min(0.05, -gust * 0.035));
}

/** Loudness 0..1 of the wind rushing past for a push of `gust` m/s */
export function windLevelFor(gust: number): number {
  return Math.min(1, 0.25 + Math.abs(gust) / WIND_PEAK_MS);
}
