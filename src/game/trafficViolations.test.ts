import { describe, expect, it } from 'vitest';
import {
  PATROL_WITNESS_RADIUS_M,
  SIDEWALK_COOLDOWN_SEC,
  SIDEWALK_GRACE_SEC,
  SidewalkRidingMonitor,
  findWitness,
  isSidewalkOffset,
} from './trafficViolations';
import { RoadProximityGrid } from '../world/roadProximity';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import { activeRoadProximity } from '../world/roadProximity';

const onSidewalk = { isRiding: true, crashed: false, speedKmh: 25, curbOffset: 2 };

/** Steps the monitor for `sec` seconds at 60fps, returning how many times it fired */
function run(m: SidewalkRidingMonitor, sec: number, input = onSidewalk): number {
  let fired = 0;
  for (let t = 0; t < sec; t += 1 / 60) if (m.step(1 / 60, input)) fired++;
  return fired;
}

describe('sidewalk riding', () => {
  it('classifies the strip beside the road as sidewalk', () => {
    expect(isSidewalkOffset(-2)).toBe(false); // on the road
    expect(isSidewalkOffset(0.5)).toBe(false); // kerb / parking margin
    expect(isSidewalkOffset(3)).toBe(true);
    expect(isSidewalkOffset(20)).toBe(false); // open square / lot
    expect(isSidewalkOffset(Infinity)).toBe(false);
  });

  it('fires once after the grace period, then waits for the cooldown', () => {
    const m = new SidewalkRidingMonitor();
    expect(run(m, SIDEWALK_GRACE_SEC - 0.2)).toBe(0);
    expect(run(m, 0.4)).toBe(1);
    expect(run(m, 5)).toBe(0); // same stretch: no repeat
    // back on the road, then onto the sidewalk again before the cooldown ends
    run(m, 1, { ...onSidewalk, curbOffset: -1 });
    expect(run(m, 3)).toBe(0);
    run(m, SIDEWALK_COOLDOWN_SEC, { ...onSidewalk, curbOffset: -1 });
    expect(run(m, 3)).toBe(1);
  });

  it('ignores slow rolling, walking, crashes and exempt forecourts', () => {
    for (const input of [
      { ...onSidewalk, speedKmh: 8 },
      { ...onSidewalk, isRiding: false },
      { ...onSidewalk, crashed: true },
      { ...onSidewalk, exempt: true },
    ]) {
      expect(run(new SidewalkRidingMonitor(), 5, input)).toBe(0);
    }
  });

  it('a patrol witnesses only within its radius (nearest one)', () => {
    const patrols = [
      { id: 'far', x: PATROL_WITNESS_RADIUS_M + 5, z: 0 },
      { id: 'near', x: 0, z: 20 },
      { id: 'nearer', x: 10, z: 0 },
    ];
    expect(findWitness(patrols, 0, 0)?.id).toBe('nearer');
    expect(findWitness([patrols[0]], 0, 0)).toBeNull();
  });
});

describe('RoadProximityGrid', () => {
  it('measures distance from the road surface edge', () => {
    const g = new RoadProximityGrid([{ ax: 0, az: 0, bx: 100, bz: 0, width: 8 }]);
    expect(g.curbOffset(50, 0)).toBeCloseTo(-4);
    expect(g.curbOffset(50, 6)).toBeCloseTo(2);
    expect(g.curbOffset(50, -6)).toBeCloseTo(2);
    expect(g.curbOffset(106, 0)).toBeCloseTo(2); // round junction end
    expect(g.curbOffset(500, 500)).toBe(Infinity);
  });

  it('matches a brute-force scan on the active map', () => {
    const grid = activeRoadProximity();
    const { nodes, edges } = ACTIVE_MAP_DATA;
    let checked = 0;
    for (let i = 0; i < edges.length; i += Math.max(1, Math.floor(edges.length / 40))) {
      const e = edges[i];
      const a = nodes[e.a];
      const b = nodes[e.b];
      // a point 3m beyond the road edge at the segment's middle
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const nx = -(b.z - a.z) / len;
      const nz = (b.x - a.x) / len;
      const px = (a.x + b.x) / 2 + nx * (e.width / 2 + 3);
      const pz = (a.z + b.z) / 2 + nz * (e.width / 2 + 3);
      let brute = Infinity;
      for (const s of edges) {
        const sa = nodes[s.a];
        const sb = nodes[s.b];
        const dx = sb.x - sa.x;
        const dz = sb.z - sa.z;
        const l2 = dx * dx + dz * dz;
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - sa.x) * dx + (pz - sa.z) * dz) / l2)) : 0;
        brute = Math.min(brute, Math.hypot(sa.x + dx * t - px, sa.z + dz * t - pz) - s.width / 2);
      }
      expect(grid.curbOffset(px, pz)).toBeCloseTo(brute, 5);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  });
});
