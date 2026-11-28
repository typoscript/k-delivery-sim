import { describe, expect, it } from 'vitest';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';

describe('real crosswalks (OSM)', () => {
  it('the open world has its mid-block crosswalks, each on a road and away from the signal junctions', () => {
    const crossings = ACTIVE_MAP_DATA.crossings ?? [];
    expect(crossings.length).toBeGreaterThan(200);
    const signals = ACTIVE_MAP_DATA.nodes.filter((n) => n.isSignal);
    for (const c of crossings) {
      expect(signals.every((s) => Math.hypot(s.x - c.x, s.z - c.z) >= 14)).toBe(true);
      expect(c.w).toBeGreaterThan(3);
      expect(Number.isFinite(c.h)).toBe(true);
    }
    // no two crosswalks on top of each other
    for (let i = 0; i < Math.min(80, crossings.length); i++) {
      for (let j = i + 1; j < crossings.length; j++) {
        expect(Math.hypot(crossings[i].x - crossings[j].x, crossings[i].z - crossings[j].z)).toBeGreaterThanOrEqual(6);
      }
    }
  });
});
