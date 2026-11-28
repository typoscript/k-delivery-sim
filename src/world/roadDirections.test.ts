import { describe, expect, it } from 'vitest';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import { drivingLaneOffset, isOneWayAlong, isWrongWay, oneWayCount, wrongWayEdgeAt } from './roadDirections';
import { TrafficSystem } from './TrafficSystem';
import { RoadNavigator } from './RoadNavigator';
import { WRONG_WAY_GRACE_SEC, WrongWayMonitor } from '../game/trafficViolations';
import { laneDividerOffsets } from './openworld/ChunkMeshBuilder';
import * as THREE from 'three';

const { nodes, edges } = ACTIVE_MAP_DATA;
const longOneWay = edges.findIndex((e) => e.oneway && e.dist > 60);

describe('one-way streets', () => {
  it('the map has one-way streets and lane counts', () => {
    expect(oneWayCount()).toBeGreaterThan(1000);
    expect(edges.some((e) => e.lanes)).toBe(true);
    const e = edges[longOneWay];
    expect(isOneWayAlong(e.a, e.b)).toBe(true);
    expect(isWrongWay(e.b, e.a)).toBe(true);
    expect(isWrongWay(e.a, e.b)).toBe(false);
  });

  it('riding against a one-way street in its middle is wrong-way, along it is not', () => {
    const e = edges[longOneWay];
    const a = nodes[e.a];
    const b = nodes[e.b];
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    const along = Math.atan2(b.x - a.x, b.z - a.z);
    expect(wrongWayEdgeAt(mx, mz, along)).toBe(-1);
    expect(wrongWayEdgeAt(mx, mz, along + Math.PI)).toBe(longOneWay);
    // right at the junction nobody is judged
    expect(wrongWayEdgeAt(b.x, b.z, along + Math.PI)).toBe(-1);
  });

  it('the wrong-way warning waits a moment, then fires once per street', () => {
    const m = new WrongWayMonitor();
    const on = { isRiding: true, crashed: false, speedKmh: 25, wrongEdge: 7 };
    expect(m.step(WRONG_WAY_GRACE_SEC / 2, on)).toBe(false);
    expect(m.step(WRONG_WAY_GRACE_SEC, on)).toBe(true);
    expect(m.step(1, on)).toBe(false);
    expect(m.step(0.1, { ...on, wrongEdge: 8 })).toBe(true);
    expect(m.step(1, { ...on, speedKmh: 3 })).toBe(false);
  });

  it('traffic AI only drives one-way streets in their direction', () => {
    const traffic = new TrafficSystem(new THREE.Scene(), []);
    for (let from = 0; from < traffic.adj.length; from++) {
      for (const ed of traffic.adj[from]) expect(isWrongWay(from, ed.to)).toBe(false);
      // every junction can be driven out of
      expect(traffic.adj[from].length).toBeGreaterThan(0);
    }
  });

  it('the navigator routes a one-way street only in its direction', () => {
    const nav = new RoadNavigator();
    for (const [from, list] of nav.baseAdj.entries()) for (const ed of list) expect(isWrongWay(from, ed.to)).toBe(false);
    // from the start of a one-way street back to its start-side: the route cannot just drive back down it
    const e = edges[longOneWay];
    const a = nodes[e.a];
    const b = nodes[e.b];
    const ux = (b.x - a.x) / e.dist;
    const uz = (b.z - a.z) / e.dist;
    const p0 = { x: a.x + ux * (e.dist * 0.8), z: a.z + uz * (e.dist * 0.8) };
    const p1 = { x: a.x + ux * (e.dist * 0.2), z: a.z + uz * (e.dist * 0.2) };
    const route = nav.findShortestPath(p0.x, p0.z, p1.x, p1.z);
    expect(route.distance).toBeGreaterThan(e.dist * 0.6 + 1);
  });

  it('lanes: offsets and dividers', () => {
    expect(drivingLaneOffset(14.5, false)).toBeCloseTo(3.3);
    expect(drivingLaneOffset(7.2, true)).toBeCloseTo(1.0);
    expect(laneDividerOffsets(13, 0, false)).toEqual([-3.25, 3.25]); // two a side, untagged
    expect(laneDividerOffsets(14.2, 4, false)).toEqual([-3.55, 3.55]);
    expect(laneDividerOffsets(8.6, 2, false)).toEqual([]);
    const one = laneDividerOffsets(9.0, 3, true);
    expect(one.map((v) => +v.toFixed(2))).toEqual([-1.5, 1.5]);
  });
});
