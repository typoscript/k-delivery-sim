import { describe, expect, it } from 'vitest';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import { PedestrianGraph, PointGrid } from './PedestrianGraph';
import { getSignalAxis } from './TrafficRules';

const graph = new PedestrianGraph();

function bruteWithin(x: number, z: number, minR: number, maxR: number): number[] {
  const out: number[] = [];
  for (const n of graph.nodes) {
    if (graph.getEdges(n.id).length === 0) continue;
    const d = Math.hypot(n.x - x, n.z - z);
    if (d >= minR && d <= maxR) out.push(n.id);
  }
  return out.sort((a, b) => a - b);
}

describe('PedestrianGraph on the active (unified) map', () => {
  it('builds sidewalks for the whole road graph quickly', () => {
    const t0 = performance.now();
    const g = new PedestrianGraph();
    const ms = performance.now() - t0;
    console.log(
      `[PedestrianGraph] ${ACTIVE_MAP_DATA.edges.length} OSM edges -> ${g.nodes.length} sidewalk nodes in ${ms.toFixed(1)}ms`
    );
    expect(g.nodes.length).toBeGreaterThan(ACTIVE_MAP_DATA.edges.length);
    expect(ms).toBeLessThan(150);
  });

  it('nodesWithin matches a brute-force ring query', () => {
    const spawn = ACTIVE_MAP_DATA.meta.playerSpawn;
    const probes: Array<[number, number, number, number]> = [
      [spawn.x, spawn.z, 0, 180],
      [spawn.x, spawn.z, 60, 180],
      [spawn.x + 37, spawn.z - 211, 15, 95],
      [graph.nodes[100].x, graph.nodes[100].z, 0, 50],
      [99999, 99999, 0, 300],
    ];
    for (const [x, z, minR, maxR] of probes) {
      const got = graph.nodesWithin(x, z, minR, maxR).sort((a, b) => a - b);
      expect(got).toEqual(bruteWithin(x, z, minR, maxR));
    }
  });

  it('randomNodeWithin returns connected nodes inside the ring, or -1 when there are none', () => {
    const spawn = ACTIVE_MAP_DATA.meta.playerSpawn;
    for (let i = 0; i < 200; i++) {
      const id = graph.randomNodeWithin(spawn.x, spawn.z, 60, 180);
      expect(id).toBeGreaterThanOrEqual(0);
      const n = graph.getNode(id);
      const d = Math.hypot(n.x - spawn.x, n.z - spawn.z);
      expect(d).toBeGreaterThanOrEqual(60);
      expect(d).toBeLessThanOrEqual(180);
      expect(graph.getEdges(id).length).toBeGreaterThan(0);
    }
    expect(graph.randomNodeWithin(99999, 99999, 0, 300)).toBe(-1);
    // accept() veto is honoured
    expect(graph.randomNodeWithin(spawn.x, spawn.z, 0, 180, () => false)).toBe(-1);
  });

  it('crosswalk walk phases come from getSignalAxis at the junction, not the world axis', () => {
    const signals = ACTIVE_MAP_DATA.nodes.filter((n) => n.isSignal);
    const signalGrid = new PointGrid(
      signals.map((n) => n.x),
      signals.map((n) => n.z),
      signals.length,
      50
    );
    let crosswalks = 0;
    let differsFromWorldAxis = 0;
    for (const n of graph.nodes) {
      for (const e of graph.getEdges(n.id)) {
        if (e.kind !== 'crosswalk') continue;
        crosswalks++;
        expect(e.crossingAxis).toBeDefined();
        const b = graph.getNode(e.to);
        const dx = b.x - n.x;
        const dz = b.z - n.z;
        const nearby = signalGrid.within((n.x + b.x) / 2, (n.z + b.z) / 2, 0, 40).map((i) => signals[i].id);
        expect(nearby.some((j) => getSignalAxis(j, dx, dz) === e.crossingAxis)).toBe(true);
        const worldAxis = Math.abs(dz) >= Math.abs(dx) ? 'ns' : 'ew';
        if (worldAxis !== e.crossingAxis) differsFromWorldAxis++;
      }
    }
    expect(crosswalks).toBeGreaterThan(500);
    // Oblique OSM junctions exist on the unified map, so some walk phases must differ from the old rule
    expect(differsFromWorldAxis).toBeGreaterThan(0);
  });
});
