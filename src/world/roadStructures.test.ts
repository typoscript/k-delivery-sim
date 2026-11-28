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
});
