import { describe, expect, it } from 'vitest';
import { PuddleField, planPuddles } from './puddles';
import { isMonsoonDay, weatherOddsOfDay, seasonOfDay } from '../game/seasons';
import { WeatherSchedule } from '../game/WeatherSchedule';
import type { OsmGraphEdge, OsmGraphNode } from '../data/suwonTypes';

const nodes: OsmGraphNode[] = [];
const edges: OsmGraphEdge[] = [];
for (let i = 0; i < 600; i++) {
  nodes.push({ id: 2 * i, x: i * 30, z: 0, isSignal: false } as OsmGraphNode);
  nodes.push({ id: 2 * i + 1, x: i * 30, z: 100, isSignal: false } as OsmGraphNode);
  edges.push({
    a: 2 * i,
    b: 2 * i + 1,
    dist: 100,
    width: 12,
    highway: 'tertiary',
    name: '',
    isMajor: true,
    tunnel: i % 10 === 0,
  });
}

describe('장마 and puddles', () => {
  it('장마 is summer days 3~5: clouds almost always rain, and long', () => {
    const summerStart = [1, 8, 15, 22].find((d) => seasonOfDay(d).id === 'summer')!;
    expect([0, 1, 2, 3, 4, 5, 6].map((k) => isMonsoonDay(summerStart + k))).toEqual([
      false,
      false,
      true,
      true,
      true,
      false,
      false,
    ]);
    expect(isMonsoonDay(10)).toBe(false); // winter
    const odds = weatherOddsOfDay(summerStart + 3);
    expect(odds.rainChance).toBeGreaterThan(0.8);
    let seed = 5;
    const w = new WeatherSchedule('clear', () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646);
    w.setSeason(odds);
    let rain = 0;
    for (let m = 0; m < 30 * 1440; m++) {
      w.step(1);
      if (w.mode === 'rain') rain++;
    }
    expect(rain / (30 * 1440)).toBeGreaterThan(0.4); // most of the time it rains
  });

  it('puddles sit by the curb of a lane, never in underpasses, and there are many more during 장마', () => {
    const normal = planPuddles(nodes, edges, 4, false);
    const monsoon = planPuddles(nodes, edges, 4, true);
    expect(monsoon.length).toBeGreaterThan(normal.length * 2);
    for (const p of monsoon) {
      const e = edges[p.id];
      expect(e.tunnel).toBe(false);
      expect(Math.abs(Math.abs(p.x - nodes[e.a].x) - (e.width / 2 - 1.4))).toBeLessThan(0.01); // 1.4 m off the curb
      expect(p.z).toBeGreaterThan(15);
      expect(p.z).toBeLessThan(85);
    }
    expect(planPuddles(nodes, edges, 4, true)).toEqual(monsoon);
  });

  it('the field holds puddles only while it rains', () => {
    const f = new PuddleField(nodes, edges);
    f.set(4, false, true);
    expect(f.puddles).toHaveLength(0);
    f.set(4, true, true);
    const p = f.puddles[0];
    expect(f.puddleAt(p.x, p.z)).toBe(p);
    expect(f.near(p.x, p.z, 10)).toContain(p);
    const v = f.version;
    f.set(4, true, true);
    expect(f.version).toBe(v); // unchanged
    f.set(4, false, true);
    expect(f.puddleAt(p.x, p.z)).toBeNull();
  });
});
