import { describe, expect, it } from 'vitest';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import { ROADWORK_DETOUR_METERS, RoadNavigator, RoutePoint } from './RoadNavigator';

/** Shortest distance from a point to a polyline */
function distToPolyline(pts: RoutePoint[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2));
    best = Math.min(best, Math.hypot(a.x + dx * t - x, a.z + dz * t - z));
  }
  return best;
}

describe('RoadNavigator roadworks', () => {
  const { nodes, edges } = ACTIVE_MAP_DATA;
  const neighbors = new Map<number, number[]>();
  for (const e of edges) {
    if (!neighbors.has(e.a)) neighbors.set(e.a, []);
    if (!neighbors.has(e.b)) neighbors.set(e.b, []);
    neighbors.get(e.a)!.push(e.b);
    neighbors.get(e.b)!.push(e.a);
  }

  it('detours around a construction segment when a way around exists', () => {
    const nav = new RoadNavigator();
    let detoured = 0;
    // Long segments with a road on each side: route p -> a -> b -> q, then close a-b
    for (const e of edges.filter((x) => x.dist >= 60).slice(0, 60)) {
      const p = (neighbors.get(e.a) ?? []).find((n) => n !== e.b);
      const q = (neighbors.get(e.b) ?? []).find((n) => n !== e.a);
      if (p === undefined || q === undefined) continue;
      const from = nodes[p];
      const to = nodes[q];
      const mid = { x: (nodes[e.a].x + nodes[e.b].x) / 2, z: (nodes[e.a].z + nodes[e.b].z) / 2 };

      nav.setRoadworks([]);
      const open = nav.findShortestPath(from.x, from.z, to.x, to.z);
      if (distToPolyline(open.points, mid.x, mid.z) > 2) continue; // shortest path didn't use a-b anyway

      nav.setRoadworks([{ edgeA: e.a, edgeB: e.b }]);
      const closed = nav.findShortestPath(from.x, from.z, to.x, to.z);
      if (closed.roadworks) {
        // Kept going through: only when the way around costs more than the penalty
        expect(closed.distance).toBeLessThanOrEqual(open.distance + ROADWORK_DETOUR_METERS + 1);
        expect(closed.roadworkPoints).toHaveLength(closed.roadworks);
        expect(closed.avoidedRoadworks).toBeUndefined();
        continue;
      }
      expect(distToPolyline(closed.points, mid.x, mid.z)).toBeGreaterThan(2);
      // ...and it knows it detoured
      expect(closed.avoidedRoadworks).toBe(1);
      detoured++;
    }
    expect(detoured).toBeGreaterThan(3);
  });

  it('reports a construction segment the route cannot avoid', () => {
    const nav = new RoadNavigator();
    const e = edges.find((x) => x.dist >= 80)!;
    const a = nodes[e.a];
    const b = nodes[e.b];
    nav.setRoadworks([{ edgeA: e.a, edgeB: e.b }]);
    // Both ends on the closed segment itself
    const res = nav.findShortestPath(a.x + (b.x - a.x) * 0.2, a.z + (b.z - a.z) * 0.2, a.x + (b.x - a.x) * 0.8, a.z + (b.z - a.z) * 0.8);
    expect(res.roadworks).toBe(1);
    expect(res.roadworkPoints).toEqual([{ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }]);
    nav.setRoadworks([]);
    expect(nav.isRoadwork(e.a, e.b)).toBe(false);
  });

  it('a route with no construction near it reports no detour', () => {
    const nav = new RoadNavigator();
    const e = edges.find((x) => x.dist >= 80)!;
    nav.setRoadworks([{ edgeA: e.a, edgeB: e.b }]);
    const far = nodes.reduce((best, n) => (Math.hypot(n.x - nodes[e.a].x, n.z - nodes[e.a].z) > Math.hypot(best.x - nodes[e.a].x, best.z - nodes[e.a].z) ? n : best));
    const near = nodes.find((n) => Math.hypot(n.x - far.x, n.z - far.z) > 150 && Math.hypot(n.x - far.x, n.z - far.z) < 400)!;
    const res = nav.findShortestPath(far.x, far.z, near.x, near.z);
    expect(res.roadworks).toBeUndefined();
    expect(res.avoidedRoadworks).toBeUndefined();
  });
});
