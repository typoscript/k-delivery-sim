/**
 * One-way streets (OSM `oneway`, open world only): edges flagged `oneway` are driven a -> b. Traffic AI, police /
 * rival riders and the navigator only use them that way; the rider gets a wrong-way warning. Pure logic.
 */
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import { clamp } from '../types';

const key = (from: number, to: number) => from * 1_000_000 + to;

let oneWay: Set<number> | null = null;
function oneWaySet(): Set<number> {
  if (!oneWay) {
    oneWay = new Set();
    for (const e of ACTIVE_MAP_DATA.edges) if (e.oneway) oneWay.add(key(e.a, e.b));
  }
  return oneWay;
}

/** Driving from -> to follows a one-way street in its direction */
export function isOneWayAlong(from: number, to: number): boolean {
  return oneWaySet().has(key(from, to));
}

/** Driving from -> to goes against a one-way street (역주행) */
export function isWrongWay(from: number, to: number): boolean {
  return oneWaySet().has(key(to, from));
}

/** How many one-way edges the map has */
export function oneWayCount(): number {
  return oneWaySet().size;
}

/**
 * Lane offset to the right of the centre line (m): on a two-way road the middle of the right half; on a one-way
 * street the whole width is ours, so keep only a little right of centre (a narrow alley drives in the middle).
 */
export function drivingLaneOffset(width: number, oneway: boolean): number {
  return oneway ? clamp(width * 0.5 - 2.6, 0, 2.6) : clamp(width * 0.25, 1.8, 3.3);
}

const CELL_M = 40;
/** Within this many metres of a junction nobody is judged wrong-way (turning across the junction area) */
const JUNCTION_CLEAR_M = 6;
let grid: Map<number, number[]> | null = null;
const cellKey = (cx: number, cz: number) => (cx + 4096) * 8192 + (cz + 4096);

function oneWayGrid(): Map<number, number[]> {
  if (grid) return grid;
  grid = new Map();
  const { nodes, edges } = ACTIVE_MAP_DATA;
  edges.forEach((e, i) => {
    if (!e.oneway) return;
    const a = nodes[e.a];
    const b = nodes[e.b];
    const pad = e.width / 2;
    for (let cx = Math.floor((Math.min(a.x, b.x) - pad) / CELL_M); cx <= Math.floor((Math.max(a.x, b.x) + pad) / CELL_M); cx++) {
      for (let cz = Math.floor((Math.min(a.z, b.z) - pad) / CELL_M); cz <= Math.floor((Math.max(a.z, b.z) + pad) / CELL_M); cz++) {
        const k = cellKey(cx, cz);
        const list = grid!.get(k);
        if (list) list.push(i);
        else grid!.set(k, [i]);
      }
    }
  });
  return grid;
}

/**
 * The one-way street (edge index) the rider at (x, z) heading `heading` rides against, or -1: on its carriageway,
 * clear of the junctions at its ends, facing more than ~60 degrees against its direction.
 */
export function wrongWayEdgeAt(x: number, z: number, heading: number): number {
  const list = oneWayGrid().get(cellKey(Math.floor(x / CELL_M), Math.floor(z / CELL_M)));
  if (!list) return -1;
  const { nodes, edges } = ACTIVE_MAP_DATA;
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  for (const i of list) {
    const e = edges[i];
    const a = nodes[e.a];
    const b = nodes[e.b];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 2 * JUNCTION_CLEAR_M) continue;
    const ux = dx / len;
    const uz = dz / len;
    const along = (x - a.x) * ux + (z - a.z) * uz;
    if (along < JUNCTION_CLEAR_M || along > len - JUNCTION_CLEAR_M) continue;
    const across = Math.abs((x - a.x) * uz - (z - a.z) * ux);
    if (across > e.width / 2) continue;
    if (fx * ux + fz * uz < -0.5) return i;
  }
  return -1;
}
