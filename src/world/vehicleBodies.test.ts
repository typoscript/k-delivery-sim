import { describe, expect, it } from 'vitest';
import { collidesWithWorld } from '../types';
import {
  VehicleBody,
  gapAheadOfBody,
  isRoadCrossingClear,
  overlapsBody,
  pushOutOfBodies,
  vehicleObstacle,
} from './vehicleBodies';

const car = (x: number, z: number, heading: number, speed = 0): VehicleBody => ({
  x,
  z,
  heading,
  halfLength: 2.15,
  halfWidth: 0.96,
  speed,
});

describe('vehicle body obstacle', () => {
  it('covers the whole rotated car, corners included, and nothing outside it', () => {
    for (const h of [0, Math.PI / 4, 1.1, -2.4]) {
      const c = car(10, -5, h);
      const box = [vehicleObstacle(c)];
      const fx = Math.sin(h);
      const fz = Math.cos(h);
      // a 0.3m circle right inside each corner collides (the old 3-square chain missed diagonal corners)
      for (const [a, s] of [[2.0, 0.85], [2.0, -0.85], [-2.0, 0.85], [-2.0, -0.85]]) {
        const x = c.x + fx * a - fz * s;
        const z = c.z + fz * a + fx * s;
        expect(collidesWithWorld(x, z, 0.1, box, 1e6)).toBe(true);
      }
      // 0.5m clear of the side / nose: no collision
      expect(collidesWithWorld(c.x - fz * 1.6, c.z + fx * 1.6, 0.1, box, 1e6)).toBe(false);
      expect(collidesWithWorld(c.x + fx * 2.8, c.z + fz * 2.8, 0.1, box, 1e6)).toBe(false);
    }
  });
});

describe('gapAheadOfBody', () => {
  const c = car(0, 0, 0); // facing +Z
  it('measures bumper-to-object gap for things in the swept lane, including the front corners', () => {
    expect(gapAheadOfBody(c, 0, 10, 0.5, 15)).toBeCloseTo(10 - 2.15 - 0.5);
    expect(gapAheadOfBody(c, 1.3, 3, 0.5, 15)).toBeCloseTo(3 - 2.15 - 0.5); // near the front-right corner
    expect(gapAheadOfBody(c, 0.3, 2.3, 0.5, 15)).toBeLessThan(0); // touching the bumper
  });
  it('ignores things beside, behind or beyond range', () => {
    expect(gapAheadOfBody(c, 2.0, 5, 0.5, 15)).toBe(Infinity); // adjacent lane
    expect(gapAheadOfBody(c, 0, -6, 0.5, 15)).toBe(Infinity); // behind
    expect(gapAheadOfBody(c, 0, 30, 0.5, 15)).toBe(Infinity);
  });
});

describe('pushOutOfBodies', () => {
  it('moves a circle the car drove into out through the nearest side', () => {
    const c = car(0, 0, Math.PI / 2); // facing +X
    const out = pushOutOfBodies(0.5, 0.3, 0.4, [c])!;
    expect(out).not.toBeNull();
    expect(overlapsBody(c, out.x, out.z, 0.4)).toBe(false);
    // shallowest exit is sideways (car width), not along its length
    expect(Math.abs(out.x - 0.5)).toBeLessThan(1e-6);
    expect(out.z).toBeGreaterThan(0.96 + 0.4 - 0.01);
  });
  it('returns null when nothing overlaps', () => {
    expect(pushOutOfBodies(0, 5, 0.4, [car(0, 0, 0)])).toBeNull();
  });
});

describe('isRoadCrossingClear (unsignalized crossings)', () => {
  // crossing a road along X from (-5, 0) to (5, 0); cars drive along Z
  const cross = (cars: VehicleBody[]) => isRoadCrossingClear(-5, 0, 5, 0, cars, 1.1);
  it('is clear with no cars, far cars or cars driving away', () => {
    expect(cross([])).toBe(true);
    expect(cross([car(2, -200, 0, 10)])).toBe(true);
    expect(cross([car(2, 8, 0, 8)])).toBe(true); // past the crossing, driving away (+Z)
  });
  it('waits for a car approaching that would arrive while crossing', () => {
    expect(cross([car(2, -40, 0, 8)])).toBe(false); // 40m at 8m/s = 5s < ~10.6s crossing time
    expect(cross([car(-2, 30, Math.PI, 5)])).toBe(false); // other lane, coming from the north
  });
  it('waits while a car stands on the crossing', () => {
    expect(cross([car(2, 1, 0, 0)])).toBe(false);
  });
});
