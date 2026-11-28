import { describe, expect, it } from 'vitest';
import { BlackIceField, blackIceStage } from '../world/blackIce';
import { buildWeatherReport } from './weatherReport';
import { WIND_MIN_KMH, WIND_PEAK_MS, bridgeGust, windLevelFor, windRollFor } from './bridgeWind';
import { seasonOfDay } from './seasons';
import type { OsmGraphEdge, OsmGraphNode } from '../data/suwonTypes';

const DUSK = 17 * 60 + 10;

describe('bridges freeze first, thaw last', () => {
  it('stage by time of a winter day', () => {
    expect(blackIceStage('winter', false, 13 * 60, DUSK)).toBe('none');
    expect(blackIceStage('winter', false, DUSK + 5, DUSK)).toBe('bridges'); // sunset: bridges only
    expect(blackIceStage('winter', true, DUSK + 40, DUSK)).toBe('all'); // night: the shaded streets too
    expect(blackIceStage('winter', false, 7 * 60, DUSK)).toBe('all');
    expect(blackIceStage('winter', false, 9 * 60 + 30, DUSK)).toBe('bridges'); // streets thawed, bridges not yet
    expect(blackIceStage('winter', false, 10 * 60 + 5, DUSK)).toBe('none');
    expect(blackIceStage('autumn', true, 2 * 60, DUSK)).toBe('none');
  });

  it("the 'bridges' stage keeps only bridge-deck patches", () => {
    const nodes: OsmGraphNode[] = [];
    const edges: OsmGraphEdge[] = [];
    for (let i = 0; i < 300; i++) {
      const a = nodes.length;
      nodes.push({ id: a, x: i * 30, z: 0, isSignal: false } as OsmGraphNode);
      nodes.push({ id: a + 1, x: i * 30, z: 100, isSignal: false } as OsmGraphNode);
      edges.push({
        a,
        b: a + 1,
        dist: 100,
        width: 6,
        highway: 'living_street',
        name: '',
        isMajor: false,
        ...(i % 3 === 0 ? { bridge: true } : {}),
      });
    }
    const field = new BlackIceField(nodes, edges);
    field.set(5, 'all');
    const all = field.patches.length;
    expect(field.patches.some((p) => !p.onBridge)).toBe(true);
    field.set(5, 'bridges');
    expect(field.patches.length).toBeGreaterThan(0);
    expect(field.patches.length).toBeLessThan(all);
    expect(field.patches.every((p) => p.onBridge)).toBe(true);
    expect(field.currentStage).toBe('bridges');
    field.set(5, false);
    expect(field.isActive).toBe(false);
  });

  it('the weather app says the same', () => {
    let winterDay = 1;
    while (seasonOfDay(winterDay).id !== 'winter') winterDay++;
    const dusk = seasonOfDay(winterDay).sun.duskStart;
    const base = {
      workDay: winterDay,
      mode: 'clear',
      forecast: [],
      heatwave: false,
      puddles: 0,
      night: false,
    } as const;
    const alert = (i: object) =>
      buildWeatherReport({ ...base, minute: 13 * 60, blackIce: false, ...i } as never).alerts.find(
        (a) => a.icon === '🧊',
      );
    const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    expect(alert({})!.detail).toContain(`해가 지면(${hhmm(dusk)}) 다리부터`);
    expect(alert({ minute: dusk + 5, blackIce: true, blackIceBridgesOnly: true })!.title).toBe('다리 위 결빙');
    expect(alert({ minute: 9 * 60 + 30, blackIce: true, blackIceBridgesOnly: true })!.detail).toContain('10시까지');
    expect(alert({ minute: 23 * 60, night: true, blackIce: true })!.title).toBe('도로 결빙 (블랙아이스)');
  });
});

describe('bridge crosswind', () => {
  it('only at speed, stronger in bad weather, within its peak, and changes over time', () => {
    expect(bridgeGust(5, 'clear', WIND_MIN_KMH - 1)).toBe(0);
    const samples = Array.from({ length: 600 }, (_, i) => bridgeGust(i * 0.1, 'clear', 60));
    expect(Math.max(...samples.map(Math.abs))).toBeLessThanOrEqual(WIND_PEAK_MS + 1e-9);
    expect(samples.some((s) => s > 0.1) && samples.some((s) => s < -0.1)).toBe(true); // both ways
    const peak = (w: 'clear' | 'snow') =>
      Math.max(...Array.from({ length: 600 }, (_, i) => Math.abs(bridgeGust(i * 0.1, w, 60))));
    expect(peak('snow')).toBeGreaterThan(peak('clear') * 1.5);
    expect(Math.abs(bridgeGust(12.3, 'clear', 30))).toBeLessThan(Math.abs(bridgeGust(12.3, 'clear', 60)) + 1e-9);
    expect(bridgeGust(12.3, 'clear', 60)).toBe(bridgeGust(12.3, 'clear', 60)); // deterministic
  });
});

describe('crosswind feel', () => {
  it('the rider leans into the wind (gentle, capped) and hears it louder in a gust', () => {
    expect(windRollFor(1)).toBeLessThan(0); // pushed right = wind from the left: lean left
    expect(windRollFor(-1)).toBeGreaterThan(0);
    expect(Math.abs(windRollFor(100))).toBeLessThanOrEqual(0.05);
    expect(Math.abs(windRollFor(0))).toBe(0);
    expect(windLevelFor(0)).toBeCloseTo(0.25);
    expect(windLevelFor(WIND_PEAK_MS)).toBe(1);
  });
});
