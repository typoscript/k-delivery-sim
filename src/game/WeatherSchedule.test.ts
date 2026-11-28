import { describe, expect, it } from 'vitest';
import { MANUAL_HOLD_MIN, WeatherSchedule } from './WeatherSchedule';
import { WeatherMode } from '../types';

/** Small deterministic PRNG (mulberry32) */
const seeded = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe('WeatherSchedule', () => {
  it('only moves clear <-> cloudy <-> rain (rain never jumps straight to clear)', () => {
    const w = new WeatherSchedule('clear', seeded(7));
    let prev: WeatherMode = 'clear';
    for (let m = 0; m < 30 * 1440; m++) {
      const next = w.step(1);
      if (!next) continue;
      if (prev === 'clear') expect(next).toBe('cloudy');
      if (prev === 'rain' || prev === 'snow') expect(next).toBe('cloudy');
      prev = next;
    }
  });

  it('rains for a modest share of the time and changes several times a day', () => {
    const w = new WeatherSchedule('clear', seeded(42));
    const minutes: Record<WeatherMode, number> = { clear: 0, cloudy: 0, rain: 0, snow: 0 };
    let changes = 0;
    const days = 60;
    for (let m = 0; m < days * 1440; m++) {
      if (w.step(1)) changes++;
      minutes[w.mode]++;
    }
    const rainShare = minutes.rain / (days * 1440);
    expect(rainShare).toBeGreaterThan(0.08);
    expect(rainShare).toBeLessThan(0.3);
    // snow is rarer than rain, but it does come
    const snowShare = minutes.snow / (days * 1440);
    expect(snowShare).toBeGreaterThan(0.02);
    expect(snowShare).toBeLessThan(rainShare);
    expect(changes / days).toBeGreaterThan(5);
  });

  it('a manual choice holds for at least an hour of game time', () => {
    const w = new WeatherSchedule('clear', () => 0); // shortest durations
    w.override('rain');
    expect(w.mode).toBe('rain');
    expect(w.step(MANUAL_HOLD_MIN - 1)).toBeNull();
    expect(w.step(2)).toBe('cloudy');
  });

  it('a seeded schedule forecasts exactly: the weather app sees what will happen', () => {
    const w = new WeatherSchedule('clear', 12345);
    const fc = w.forecast(12);
    expect(fc).toHaveLength(12);
    for (let h = 0; h < 12; h++) {
      for (let m = 0; m < 60; m++) w.step(1);
      expect(w.mode).toBe(fc[h]);
    }
    // forecasting does not disturb the schedule itself
    const a = new WeatherSchedule('cloudy', 99);
    const b = new WeatherSchedule('cloudy', 99);
    a.forecast(24);
    for (let m = 0; m < 600; m++) expect(a.step(1)).toBe(b.step(1));
  });
});
