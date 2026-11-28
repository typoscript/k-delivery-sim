import { WeatherMode } from '../types';

/**
 * Weather that changes on its own with the game clock: clear -> cloudy -> (rain, snow or clear again) -> ...
 * Each weather lasts a random stretch of game time; rain and snow always clear through cloudy.
 * Roughly 15-20% of the day is rainy. A manual change (U key) is kept for at least an hour of game time.
 * Pure logic driven by elapsed game minutes (clock jumps with N do not skip weather), unit tested.
 */

/** Game minutes each weather lasts: [min, max] */
export const WEATHER_DURATION_MIN: Record<WeatherMode, [number, number]> = {
  clear: [90, 200],
  cloudy: [40, 90],
  rain: [30, 80],
  snow: [30, 70],
};
/** Chance that clouds turn into rain (otherwise they clear up) */
export const CLOUDY_TO_RAIN_CHANCE = 0.45;
/** Chance that clouds turn into snow instead (checked after rain) */
export const CLOUDY_TO_SNOW_CHANCE = 0.15;
/** A manual weather choice holds at least this long */
export const MANUAL_HOLD_MIN = 60;

export class WeatherSchedule {
  public mode: WeatherMode;
  /** Game minutes until the next change */
  public remainingMin: number;

  constructor(
    initial: WeatherMode = 'clear',
    private readonly rand: () => number = Math.random
  ) {
    this.mode = initial;
    this.remainingMin = this.durationFor(initial);
  }

  private durationFor(mode: WeatherMode): number {
    const [lo, hi] = WEATHER_DURATION_MIN[mode];
    return lo + this.rand() * (hi - lo);
  }

  private nextMode(): WeatherMode {
    if (this.mode === 'clear') return 'cloudy';
    if (this.mode === 'rain' || this.mode === 'snow') return 'cloudy';
    const r = this.rand();
    if (r < CLOUDY_TO_RAIN_CHANCE) return 'rain';
    return r < CLOUDY_TO_RAIN_CHANCE + CLOUDY_TO_SNOW_CHANCE ? 'snow' : 'clear';
  }

  /** Advances by `dtMin` game minutes; returns the new weather when it changes, otherwise null */
  public step(dtMin: number): WeatherMode | null {
    this.remainingMin -= Math.max(0, dtMin);
    if (this.remainingMin > 0) return null;
    this.mode = this.nextMode();
    this.remainingMin = this.durationFor(this.mode);
    return this.mode;
  }

  /** The player picked a weather (U key): keep it for a while before the schedule takes over again */
  public override(mode: WeatherMode): void {
    this.mode = mode;
    this.remainingMin = Math.max(MANUAL_HOLD_MIN, this.durationFor(mode));
  }
}
