import { describe, expect, it } from 'vitest';
import { BlackIceField, blackIceActive, planBlackIce } from './blackIce';
import type { OsmGraphEdge, OsmGraphNode } from '../data/suwonTypes';

// 400 parallel 100 m streets of each kind
const nodes: OsmGraphNode[] = [];
const edges: OsmGraphEdge[] = [];
for (const [k, highway] of ['living_street', 'residential', 'primary', 'secondary_link'].entries()) {
  for (let i = 0; i < 400; i++) {
    const a = nodes.length;
    nodes.push({ id: a, x: i * 30, z: k * 1000, isSignal: false } as OsmGraphNode);
    nodes.push({ id: a + 1, x: i * 30, z: k * 1000 + 100, isSignal: false } as OsmGraphNode);
    edges.push({ a, b: a + 1, dist: 100, width: 6, highway, name: '', isMajor: highway === 'primary' });
  }
}

describe('black ice', () => {
  it('freezes a few shaded side streets and ramps (never main roads), different spots each day', () => {
    const day1 = planBlackIce(nodes, edges, 1);
    const kinds = (list: typeof day1) => list.map((p) => edges[p.id].highway);
    expect(kinds(day1)).not.toContain('primary');
    const count = (h: string) => kinds(day1).filter((k) => k === h).length;
    expect(count('living_street')).toBeGreaterThan(count('residential'));
    expect(count('secondary_link')).toBeGreaterThan(count('residential'));
    expect(day1.length).toBeLessThan(edges.length * 0.1);
    expect(planBlackIce(nodes, edges, 1)).toEqual(day1);
    expect(planBlackIce(nodes, edges, 2).map((p) => p.id)).not.toEqual(day1.map((p) => p.id));
    // the patch sits on its street, away from the junctions
    for (const p of day1) {
      expect(p.z % 1000).toBeGreaterThanOrEqual(25);
      expect(p.z % 1000).toBeLessThanOrEqual(75);
    }
  });

  it('only on winter nights and mornings before 9:00', () => {
    expect(blackIceActive('winter', true, 22 * 60)).toBe(true);
    expect(blackIceActive('winter', false, 7 * 60)).toBe(true);
    expect(blackIceActive('winter', false, 13 * 60)).toBe(false);
    expect(blackIceActive('autumn', true, 2 * 60)).toBe(false);
  });

  it('the field finds the patch under the rider and the next one ahead; nothing while inactive', () => {
    const field = new BlackIceField(nodes, edges);
    field.set(3, false);
    expect(field.patches).toHaveLength(0);
    field.set(3, true);
    const p = field.patches[0];
    expect(field.patchAt(p.x, p.z)).toBe(p);
    expect(field.patchAt(p.x, p.z + p.radius + 0.5)).toBeNull();
    expect(field.nearest(p.x, p.z + p.radius + 20, 25)).toBe(p);
    expect(field.nearest(p.x, p.z + p.radius + 40, 25)).toBeNull();
    field.set(3, false);
    expect(field.patchAt(p.x, p.z)).toBeNull();
    expect(field.patches).toHaveLength(0);
  });
});
