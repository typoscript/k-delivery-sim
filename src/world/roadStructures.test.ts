import { describe, expect, it } from 'vitest';
import { RoadStructureIndex } from './roadStructures';
import { planBlackIce } from './blackIce';
import type { OsmGraphEdge, OsmGraphNode } from '../data/suwonTypes';
import { SUWON_OPEN_WORLD } from '../data/suwonUnified';

const node = (id: number, x: number, z: number) => ({ id, x, z, isSignal: false }) as OsmGraphNode;
const nodes = [node(0, 0, 0), node(1, 0, 100), node(2, 50, 0), node(3, 50, 100), node(4, 100, 0), node(5, 100, 100)];
const edge = (a: number, b: number, extra: Partial<OsmGraphEdge> = {}): OsmGraphEdge => ({
  a,
  b,
  dist: 100,
  width: 8,
  highway: 'secondary',
  name: '',
  isMajor: true,
  ...extra,
});
const edges = [edge(0, 1, { bridge: true }), edge(2, 3, { tunnel: true }), edge(4, 5)];

describe('bridges and underpasses', () => {
  it('finds the structure under a point (within the road width)', () => {
    const idx = new RoadStructureIndex(nodes, edges);
    expect(idx.structureAt(1, 50)).toBe('bridge');
    expect(idx.structureAt(52, 30)).toBe('tunnel');
    expect(idx.structureAt(100, 50)).toBeNull(); // ordinary road
    expect(idx.structureAt(20, 50)).toBeNull(); // off the bridge
    expect([idx.bridgeCount, idx.tunnelCount]).toEqual([1, 1]);
  });

  it('with a heading, only riding along the structure counts (a road crossing over the underpass is not in it)', () => {
    const idx = new RoadStructureIndex(nodes, edges);
    expect(idx.structureAt(52, 30, 0)).toBe('tunnel'); // heading +Z, along the underpass
    expect(idx.structureAt(52, 30, Math.PI)).toBe('tunnel'); // the other way along it
    expect(idx.structureAt(52, 30, Math.PI / 2)).toBeNull(); // crossing it at a right angle
    expect(idx.structureAt(52, 30, 0.5)).toBe('tunnel'); // a little off its line
  });

  it('bridges freeze first and underpasses never do', () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      edge(0, 1, { bridge: i % 2 === 0, tunnel: i % 2 === 1, highway: 'residential' }),
    );
    const ice = planBlackIce(nodes, many, 5);
    expect(ice.every((p) => many[p.id].bridge && p.onBridge)).toBe(true);
    expect(ice.length).toBeGreaterThan(30); // about half of the 100 bridge segments
  });

  it('the Suwon map carries real bridges and underpasses (OSM tags kept by the pipeline)', () => {
    const idx = new RoadStructureIndex(SUWON_OPEN_WORLD.nodes, SUWON_OPEN_WORLD.edges);
    expect(idx.bridgeCount).toBeGreaterThan(50);
    expect(idx.tunnelCount).toBeGreaterThan(50);
    expect(SUWON_OPEN_WORLD.edges.some((e) => e.tunnel && e.name.includes('지하차도'))).toBe(true);
  });

  it('bridge ice applies only when riding along the bridge (not on a road crossing under it)', async () => {
    const { BlackIceField } = await import('./blackIce');
    const bridges = Array.from({ length: 40 }, () => edge(0, 1, { bridge: true }));
    const field = new BlackIceField(nodes, bridges);
    field.set(3, true);
    const p = field.patches[0];
    expect(p.onBridge).toBe(true);
    expect(field.patchAt(p.x, p.z, 0)).toBe(p); // along the bridge (+Z)
    expect(field.patchAt(p.x, p.z, Math.PI)).toBe(p); // the other way along it
    expect(field.patchAt(p.x, p.z, Math.PI / 2)).toBeNull(); // crossing under it
    expect(field.patchAt(p.x, p.z)).toBe(p); // no heading: position only
  });
});
