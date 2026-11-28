import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TrafficSystem } from './TrafficSystem';
import { PedestrianManager } from './PedestrianManager';
import { DRIVING_WEATHER } from './traffic/trafficTypes';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import type { WeatherMode } from '../types';

/** Mean speed of the traffic over 20 s of driving around the spawn in a weather (Math.random seeded) */
function meanTrafficSpeed(mode: WeatherMode): number {
  let seed = 7;
  const orig = Math.random;
  Math.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  try {
    const traffic = new TrafficSystem(new THREE.Scene(), []);
    traffic.setWeather(mode);
    const s = ACTIVE_MAP_DATA.meta.playerSpawn;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 20 * 60; i++) {
      traffic.step(
        1 / 60,
        i / 60,
        false,
        s.x,
        s.z,
        0,
        false,
        () => {},
        () => {},
      );
      if (i > 300 && i % 20 === 0)
        for (const c of traffic.getCarBodies() as unknown as Array<{ speed: number }>) {
          sum += c.speed;
          n++;
        }
    }
    return sum / n;
  } finally {
    Math.random = orig;
  }
}

describe('the city reacts to the weather', () => {
  it('cars drive slower in the rain and slower still on snow, keeping more distance', () => {
    const dry = meanTrafficSpeed('clear');
    const rain = meanTrafficSpeed('rain');
    const snow = meanTrafficSpeed('snow');
    expect(rain).toBeLessThan(dry);
    expect(snow).toBeLessThan(rain);
    expect(DRIVING_WEATHER.snow.gapExtra).toBeGreaterThan(DRIVING_WEATHER.rain.gapExtra);
  });

  it('umbrellas come out in the rain (most people) and snow (fewer); people hurry in rain, slow down on snow', () => {
    const peds = new PedestrianManager(new THREE.Scene());
    const umbrellas = () => peds.agents.filter((a) => a.rig.umbrella?.visible).length;
    expect(umbrellas()).toBe(0);
    peds.setWeather('rain');
    const rain = umbrellas();
    expect(rain / peds.agents.length).toBeGreaterThan(0.5);
    expect(peds.walkSpeedMul).toBeGreaterThan(1);
    peds.setWeather('snow');
    expect(umbrellas()).toBeLessThan(rain);
    expect(umbrellas()).toBeGreaterThan(0);
    expect(peds.walkSpeedMul).toBeLessThan(1);
    peds.setWeather('clear');
    expect(umbrellas()).toBe(0);
    expect(peds.walkSpeedMul).toBe(1);
  });

  it('a puddle splash soaks the pedestrians close by (they stop and step back); people farther off are left alone', () => {
    const peds = new PedestrianManager(new THREE.Scene());
    const a = peds.agents.find((x) => x.visible && x.fsm === 'WALKING') ?? peds.agents[0];
    a.visible = true;
    a.fsm = 'WALKING';
    const n = peds.splashNear(a.x + 2, a.z, 4.5);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(a.fsm).toBe('STARTLED');
    expect(a.evadeDirX).toBeLessThan(0); // steps away from the splash (it came from +x)
    const far = peds.splashNear(a.x + 5000, a.z, 4.5);
    expect(far).toBe(0);
  });
});
