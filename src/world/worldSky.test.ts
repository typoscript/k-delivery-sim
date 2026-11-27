import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { skyLookFor } from './worldSky';
import { WeatherMode } from '../types';

const lum = (hex: number) => {
  const c = new THREE.Color(hex);
  return c.r + c.g + c.b;
};

describe('skyLookFor', () => {
  it('night is darker than day and lights the lamps and windows, for every weather', () => {
    for (const w of ['clear', 'cloudy', 'rain'] as WeatherMode[]) {
      const day = skyLookFor(w, false);
      const night = skyLookFor(w, true);
      expect(lum(night.bg)).toBeLessThan(lum(day.bg));
      expect(night.dirI).toBeLessThan(day.dirI);
      expect(night.lampE).toBeGreaterThan(day.lampE);
      expect(night.buildingE).toBeGreaterThan(0);
      expect(day.buildingE).toBe(0);
    }
  });

  it('rain is darker and foggier than a clear day', () => {
    const clear = skyLookFor('clear', false);
    const rain = skyLookFor('rain', false);
    expect(lum(rain.bg)).toBeLessThan(lum(clear.bg));
    expect(rain.fogDensity).toBeGreaterThan(clear.fogDensity);
    expect(rain.dirI).toBeLessThan(clear.dirI);
  });
});
