import { describe, expect, it } from 'vitest';
import { ALERT_COOLDOWN_SEC, RiderAlertMonitor, pedestrianAhead, redLightAhead, warnDistance } from './riderAlerts';

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
