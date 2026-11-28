import { describe, expect, it } from 'vitest';
import { ALERT_COOLDOWN_SEC, RiderAlertMonitor, SafeStopTracker, pedestrianAhead, redLightAhead, warnDistance } from './riderAlerts';

// Riding north (+Z) at 30 km/h from the origin
const pose = { x: 0, z: 0, heading: 0, speed: 30 / 3.6 };

describe('rider alerts', () => {
  it('warns farther ahead the faster you ride', () => {
    expect(warnDistance(0)).toBe(8);
    expect(warnDistance(30 / 3.6)).toBeGreaterThan(warnDistance(15 / 3.6));
    expect(warnDistance(100)).toBe(45);
  });

  it('red / yellow junctions ahead on our road count, green / behind / off to the side do not', () => {
    const sig = (z: number, x = 0, color: 'red' | 'yellow' | 'green' = 'red') => ({ id: 1, x, z, color });
    expect(redLightAhead(pose, [sig(12)])).toBe(12);
    expect(redLightAhead(pose, [sig(12, 0, 'yellow')])).toBe(12);
    expect(redLightAhead(pose, [sig(12, 0, 'green')])).toBeNull();
    expect(redLightAhead(pose, [sig(-10)])).toBeNull(); // behind
    expect(redLightAhead(pose, [sig(12, 20)])).toBeNull(); // another road
    expect(redLightAhead(pose, [sig(40)])).toBeNull(); // beyond stopping distance at 30 km/h
    expect(redLightAhead(pose, [sig(30), sig(14)])).toBe(14); // nearest
  });

  it('pedestrians in our path count, beside it or behind do not', () => {
    expect(pedestrianAhead(pose, [{ x: 0.5, z: 10 }])).toBe(10);
    expect(pedestrianAhead(pose, [{ x: 3, z: 10 }])).toBeNull();
    expect(pedestrianAhead(pose, [{ x: 0, z: -5 }])).toBeNull();
    expect(pedestrianAhead(pose, [{ x: 0, z: 10, visible: false }])).toBeNull();
  });

  it('alerts once per cooldown, pedestrians first, and not when slow or walking', () => {
    const m = new RiderAlertMonitor();
    const signals = [{ id: 1, x: 0, z: 12, color: 'red' as const }];
    const peds = [{ x: 0, z: 8 }];
    expect(m.step(0.1, true, { ...pose, speed: 1 }, signals, peds)).toBeNull();
    expect(m.step(0.1, false, pose, signals, peds)).toBeNull();
    expect(m.step(0.1, true, pose, signals, peds)).toEqual({ kind: 'pedestrian', distance: 8 });
    expect(m.step(0.1, true, pose, signals, peds)).toEqual({ kind: 'red_light', distance: 12 });
    expect(m.step(0.1, true, pose, signals, peds)).toBeNull();
    expect(m.step(ALERT_COOLDOWN_SEC, true, pose, signals, peds)?.kind).toBe('pedestrian');
  });
});

describe('SafeStopTracker', () => {
  const pose = (z: number, kmh: number) => ({ x: 0, z, heading: 0, speed: kmh / 3.6 });
  /** Brakes from 40 km/h at `decel` m/s² after a red-light warning `dist` m ahead; returns the result */
  const brake = (t: SafeStopTracker, dist: number, decel: number, z0 = 0, kind: 'red_light' | 'pedestrian' = 'red_light') => {
    let z = z0;
    let v = 40 / 3.6;
    t.onAlert({ kind, distance: dist }, pose(z, 40));
    for (let i = 0; i < 600; i++) {
      v = Math.max(0, v - decel * 0.016);
      z += v * 0.016;
      const r = t.step(0.016, { x: 0, z, heading: 0, speed: v }, false);
      if (r) return r;
    }
    return null;
  };

  it('counts stopping before the red-light junction', () => {
    expect(brake(new SafeStopTracker(), 30, 5)).toBe('safe_stop');
  });

  it('does not count riding through the junction', () => {
    expect(brake(new SafeStopTracker(), 10, 2)).toBeNull();
  });

  it('a pedestrian warning only needs slowing below 10 km/h', () => {
    expect(brake(new SafeStopTracker(), 20, 5, 0, 'pedestrian')).toBe('safe_yield');
  });

  it('a crash ends the warning without a reward', () => {
    const t = new SafeStopTracker();
    t.onAlert({ kind: 'red_light', distance: 30 }, pose(0, 40));
    expect(t.step(0.1, pose(1, 30), true)).toBeNull();
    expect(t.step(0.1, pose(1, 0), false)).toBeNull(); // nothing is being followed any more
  });

  it('the same spot counts once (no creep-and-stop farming)', () => {
    const t = new SafeStopTracker();
    expect(brake(t, 30, 5)).toBe('safe_stop');
    expect(brake(t, 30, 5, 2)).toBeNull(); // same junction again right away
    // far away later: counts again
    for (let i = 0; i < 3000; i++) t.step(0.016, pose(0, 0), false);
    expect(brake(t, 30, 5, 500)).toBe('safe_stop');
  });
});
