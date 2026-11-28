import { describe, expect, it } from 'vitest';
import { planStreetProps, streetPropParts } from './streetProps';
import { mergeColoredParts } from './instancing';
import type { OsmGraphEdge, OsmGraphNode } from '../data/suwonTypes';

const node = (id: number, x: number, z: number, isSignal = false) => ({ id, x, z, isSignal }) as OsmGraphNode;
const edge = (a: number, b: number, width: number, isMajor: boolean, dist: number) =>
  ({ a, b, dist, width, highway: isMajor ? 'secondary' : 'residential', name: '', isMajor }) as OsmGraphEdge;
// a single straight road along +Z; curb = |x| - width/2
const offRoad = (width: number) => (x: number) => Math.abs(x) - width / 2;

describe('street prop placement', () => {
  it('trees line both sides of a major road, on the sidewalk, trimmed back from a signal junction', () => {
    const nodes = [node(0, 0, 0, true), node(1, 0, 200)];
    const props = planStreetProps(nodes, [edge(0, 1, 12, true, 200)], [12, 12], (x) => offRoad(12)(x));
    const trees = props.filter((p) => p.kind === 'tree');
    expect(trees.length).toBeGreaterThan(20);
    expect(new Set(trees.map((t) => Math.sign(t.x)))).toEqual(new Set([-1, 1]));
    for (const t of trees) {
      expect(Math.abs(t.x)).toBeCloseTo(6 + 1.7, 5);
      expect(t.z).toBeGreaterThanOrEqual(12 + 7.2 - 1e-6); // signal trim: crosswalk / stop line kept clear
    }
    // ~12 m apart along one side
    const left = trees
      .filter((t) => t.x < 0)
      .map((t) => t.z)
      .sort((a, b) => a - b);
    for (let i = 1; i < left.length; i++) expect(left[i] - left[i - 1]).toBeLessThanOrEqual(12 + 1e-6);
  });

  it('alleys get poles on one side, wired to the next pole', () => {
    const nodes = [node(0, 0, 0), node(1, 0, 150)];
    const props = planStreetProps(nodes, [edge(0, 1, 5, false, 150)], [5, 5], (x) => offRoad(5)(x));
    const poles = props.filter((p) => p.kind === 'pole');
    expect(poles.length).toBeGreaterThanOrEqual(4);
    expect(new Set(poles.map((p) => Math.sign(p.x))).size).toBe(1);
    expect(poles.slice(0, -1).every((p) => p.next)).toBe(true);
    expect(poles.at(-1)!.next).toBeUndefined();
  });

  it('skips spots that fall on another road, and is the same every time', () => {
    const nodes = [node(0, 0, 0), node(1, 0, 200)];
    const onRoad = (x: number, z: number) => (z > 80 && z < 120 ? -1 : offRoad(12)(x));
    const props = planStreetProps(nodes, [edge(0, 1, 12, true, 200)], [12, 12], onRoad);
    expect(props.some((p) => p.z > 80 && p.z < 120)).toBe(false);
    expect(planStreetProps(nodes, [edge(0, 1, 12, true, 200)], [12, 12], onRoad)).toEqual(props);
  });

  it('builds one merged, vertex-coloured geometry per chunk', () => {
    const nodes = [node(0, 0, 0), node(1, 0, 150), node(2, 40, 0), node(3, 40, 150)];
    const props = planStreetProps(
      nodes,
      [edge(0, 1, 12, true, 150), edge(2, 3, 5, false, 150)],
      [12, 12, 5, 5],
      () => 2,
    );
    const g = mergeColoredParts(streetPropParts(props));
    expect(g.getAttribute('color')).toBeDefined();
    expect(g.getAttribute('position').count).toBeGreaterThan(0);
    g.dispose();
  });
});
