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
  it('builds sidewalks for the whole road graph within its size budget', () => {
    const t0 = performance.now();
    const g = new PedestrianGraph();
    const ms = performance.now() - t0;
    console.log(
      `[PedestrianGraph] ${ACTIVE_MAP_DATA.edges.length} OSM edges -> ${g.nodes.length} sidewalk nodes in ${ms.toFixed(1)}ms`
    );
    expect(g.nodes.length).toBeGreaterThan(ACTIVE_MAP_DATA.edges.length);
    // Build time (~50ms idle) is only logged: wall-clock limits flake on a busy machine. Bound the work instead
    // (~3.9 sidewalk nodes per road edge when written).
    expect(g.nodes.length).toBeLessThanOrEqual(ACTIVE_MAP_DATA.edges.length * 5);
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

describe('PedestrianGraph road crossings', () => {
  it('flags every road crossing and only crosses at junctions, dead ends or signals', () => {
    const deg = new Array<number>(ACTIVE_MAP_DATA.nodes.length).fill(0);
    for (const e of ACTIVE_MAP_DATA.edges) deg[e.a]++, deg[e.b]++;
    const crossNodes = ACTIVE_MAP_DATA.nodes.filter((n) => deg[n.id] !== 2 || n.isSignal);
    let unsignalized = 0;
    let checked = 0;
    for (const n of graph.nodes) {
      for (const e of graph.getEdges(n.id)) {
        if (e.kind === 'crosswalk') expect(e.crossesRoad).toBe(true);
        if (!e.crossesRoad || e.to < n.id) continue;
        if (e.kind === 'sidewalk') unsignalized++;
        // sample 1 in 7 crossings: its midpoint lies at a crossing-allowed road node (not mid-block)
        if (checked++ % 7 !== 0) continue;
        const b = graph.getNode(e.to);
        const mx = (n.x + b.x) / 2;
        const mz = (n.z + b.z) / 2;
        const near = crossNodes.some((c) => Math.hypot(c.x - mx, c.z - mz) < 16);
        expect(near).toBe(true);
      }
    }
    expect(unsignalized).toBeGreaterThan(100);
  });
});
