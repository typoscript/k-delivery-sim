import { describe, expect, it } from 'vitest';
import { drivingComponents, relaxOneWays, roadWidthOf } from './roadLanes.mjs';

describe('roadLanes', () => {
  it('one-way streets that would trap a driver go two-way, a one-way loop stays', () => {
    // square loop 0->1->2->3->0 one-way, plus a one-way dead end 2->4
    const edges = [
      { a: 0, b: 1, oneway: true },
      { a: 1, b: 2, oneway: true },
      { a: 2, b: 3, oneway: true },
      { a: 3, b: 0, oneway: true },
      { a: 2, b: 4, oneway: true },
    ];
    expect(relaxOneWays(edges)).toBe(1);
    expect(edges.map((e) => e.oneway)).toEqual([true, true, true, true, false]);
    expect(new Set(drivingComponents(5, edges)).size).toBe(1);
  });

  it('road width from the lane count, capped near the class width', () => {
    const primary = { width: 14.5, major: true };
    const residential = { width: 8.6, major: false };
    expect(roadWidthOf(primary, false, 0)).toBe(14.5);
    expect(roadWidthOf(primary, false, 4)).toBe(14.2);
    expect(roadWidthOf(primary, false, 8)).toBe(18.9); // capped at 1.3x
    expect(roadWidthOf(primary, true, 0)).toBe(10.1); // one half of a dual carriageway
    expect(roadWidthOf(residential, true, 0)).toBe(8.6);
    expect(roadWidthOf(residential, false, 1)).toBe(5.6);
  });
});
