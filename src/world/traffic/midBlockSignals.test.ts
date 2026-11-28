import { describe, expect, it } from 'vitest';
import {
  MID_BLOCK_CROSSINGS,
  MID_CAR_GREEN_SEC,
  MID_CAR_YELLOW_SEC,
  MID_CYCLE_SEC,
  MID_STOP_OFFSET_M,
  midBlockAhead,
  midBlockAt,
  midBlockPhase,
} from './midBlockSignals';
import { ACTIVE_MAP_DATA } from '../../data/suwonDistricts';
import { PedestrianGraph } from '../PedestrianGraph';

describe('mid-block crosswalk signals', () => {
  it('cars green, yellow, then red while people walk; offsets spread the crossings', () => {
    expect(midBlockPhase(0, 0)).toMatchObject({ car: 'green', walk: false });
    expect(midBlockPhase(MID_CAR_GREEN_SEC + 1, 0)).toMatchObject({ car: 'yellow', walk: false });
    expect(midBlockPhase(MID_CAR_GREEN_SEC + MID_CAR_YELLOW_SEC + 1, 0)).toMatchObject({ car: 'red', walk: true });
    expect(midBlockPhase(MID_CYCLE_SEC + 1, 0).car).toBe('green');
    const offsets = new Set(MID_BLOCK_CROSSINGS.map((c) => Math.round(c.offset)));
    expect(offsets.size).toBeGreaterThan(10);
  });

  it('the signalized OSM crossings, found on their road for the cars ahead of them', () => {
    expect(MID_BLOCK_CROSSINGS.length).toBe((ACTIVE_MAP_DATA.crossings ?? []).filter((c) => c.sig).length);
    expect(MID_BLOCK_CROSSINGS.length).toBeGreaterThan(100);
    const c = MID_BLOCK_CROSSINGS[0];
    expect(midBlockAt(c.x + 0.5, c.z)).toBe(0);
    // a car on that crossing's road, 20 m before it, sees its stop line ~20 m - offset ahead (either direction)
    const nodes = ACTIVE_MAP_DATA.nodes;
    const e = ACTIVE_MAP_DATA.edges.find((ed) => {
      const a = nodes[ed.a];
      const b = nodes[ed.b];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const t = ((c.x - a.x) * dx + (c.z - a.z) * dz) / (dx * dx + dz * dz);
      return t > 0 && t < 1 && Math.hypot(c.x - (a.x + dx * t), c.z - (a.z + dz * t)) < 1.5;
    })!;
    const a = nodes[e.a];
    const s = Math.hypot(c.x - a.x, c.z - a.z);
    const len = Math.hypot(nodes[e.b].x - a.x, nodes[e.b].z - a.z);
    const fwd = midBlockAhead(e.a, e.b, len, Math.max(0, s - 20));
    expect(fwd.find((m) => m.index === 0)!.stopDist).toBeCloseTo(Math.min(20, s) - MID_STOP_OFFSET_M, 0);
    // already past it: nothing ahead
    expect(midBlockAhead(e.a, e.b, len, s + 5).some((m) => m.index === 0)).toBe(false);
    // the other way round
    const back = midBlockAhead(e.b, e.a, len, Math.max(0, len - s - 20));
    expect(back.some((m) => m.index === 0)).toBe(true);
  });

  it('pedestrians wait for the walk light on these crosswalks', () => {
    const g = new PedestrianGraph();
    let withLights = 0;
    for (const n of g.nodes) for (const e of g.getEdges(n.id)) if (e.midSignal !== undefined) withLights++;
    expect(withLights).toBeGreaterThan(100);
  });
});
