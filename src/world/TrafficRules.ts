import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';

/**
 * Shared traffic rules used by AI cars (TrafficSystem), police patrols & rival riders (RoadHazardManager)
 * and the player's red-light check, so every road user agrees on which approach has green.
 */

export type SignalAxis = 'ns' | 'ew';

/** Distance (m) before the signal node centre where vehicles stop for red/yellow */
export const SIGNAL_STOP_LINE_OFFSET = 7.0;

/** Distance (m) over which the lateral lane-offset jump at a node is blended out while driving */
export const LANE_BLEND_DISTANCE = 3.5;

const COS_45 = Math.SQRT1_2;

interface SignalReference {
  refX: number;
  refZ: number;
  refAxis: SignalAxis;
}

let signalRefs: Map<number, SignalReference> | null = null;

/**
 * Per signalized node, pick the incident road that is closest to a world axis as the reference.
 * Approaches within 45 deg of that road share its phase and the rest get the other phase.
 * This keeps orthogonal grid junctions identical to the old world-axis rule while making
 * oblique OSM junctions (roads crossing at ~45-60 deg) split into two phases instead of
 * both getting green at once.
 */
function buildSignalRefs(): Map<number, SignalReference> {
  const nodes = ACTIVE_MAP_DATA.nodes;
  const best = new Map<number, { score: number; ux: number; uz: number }>();
  const consider = (nodeId: number, otherId: number) => {
    const n = nodes[nodeId];
    if (!n.isSignal) return;
    const o = nodes[otherId];
    const dx = o.x - n.x;
    const dz = o.z - n.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return;
    const ux = dx / len;
    const uz = dz / len;
    const score = Math.max(Math.abs(ux), Math.abs(uz));
    const cur = best.get(nodeId);
    if (!cur || score > cur.score) best.set(nodeId, { score, ux, uz });
  };
  for (const e of ACTIVE_MAP_DATA.edges) {
    consider(e.a, e.b);
    consider(e.b, e.a);
  }
  const refs = new Map<number, SignalReference>();
  for (const [id, b] of best) {
    refs.set(id, {
      refX: b.ux,
      refZ: b.uz,
      refAxis: Math.abs(b.uz) >= Math.abs(b.ux) ? 'ns' : 'ew',
    });
  }
  return refs;
}

/** Which signal phase governs travel in direction (dirX, dirZ) through signalized node `nodeId` */
export function getSignalAxis(nodeId: number, dirX: number, dirZ: number): SignalAxis {
  if (!signalRefs) signalRefs = buildSignalRefs();
  const len = Math.hypot(dirX, dirZ) || 1;
  const ref = signalRefs.get(nodeId);
  if (!ref) return Math.abs(dirZ) >= Math.abs(dirX) ? 'ns' : 'ew';
  const dot = Math.abs((dirX / len) * ref.refX + (dirZ / len) * ref.refZ);
  if (dot >= COS_45) return ref.refAxis;
  return ref.refAxis === 'ns' ? 'ew' : 'ns';
}

/**
 * Speed cap (m/s) for a vehicle approaching a stop line `stopDist` metres ahead under signal `sig`.
 * Returns Infinity when the vehicle may proceed: green, already past the line, or unable to stop
 * in time (yellow dilemma zone / committed on red). Otherwise it returns a smooth braking profile
 * that reaches 0 at the line, so even very short approach edges are respected.
 */
export function signalSpeedCap(
  speed: number,
  stopDist: number,
  sig: 'green' | 'yellow' | 'red',
  comfortDecel = 5.5
): number {
  if (sig === 'green') return Infinity;
  if (stopDist < -0.5) return Infinity; // already inside the junction -> clear it
  if (stopDist <= 0.4) return speed > 1.5 ? Infinity : 0; // at the line: hold if stopped, else committed
  const needDecel = (speed * speed) / (2 * stopDist);
  const maxDecel = sig === 'yellow' ? 7.0 : 14.0;
  if (needDecel > maxDecel) return Infinity; // cannot stop safely -> proceed through
  return Math.sqrt(2 * comfortDecel * Math.max(0, stopDist - 0.4));
}

const SIGNAL_CELL = 64;
let signalCells: Map<number, number[]> | null = null;
const signalCellKey = (ix: number, iz: number) => (ix + 32768) * 65536 + (iz + 32768);

/**
 * Ids of signalized nodes within `radius` of (x, z), appended to `out`. Uses a lazily built grid so
 * per-frame checks don't scan every node of the (multi-km) open world.
 */
export function signalNodesNear(x: number, z: number, radius: number, out: number[] = []): number[] {
  const nodes = ACTIVE_MAP_DATA.nodes;
  if (!signalCells) {
    signalCells = new Map();
    for (const n of nodes) {
      if (!n.isSignal) continue;
      const k = signalCellKey(Math.floor(n.x / SIGNAL_CELL), Math.floor(n.z / SIGNAL_CELL));
      let list = signalCells.get(k);
      if (!list) signalCells.set(k, (list = []));
      list.push(n.id);
    }
  }
  const r2 = radius * radius;
  const ix0 = Math.floor((x - radius) / SIGNAL_CELL);
  const ix1 = Math.floor((x + radius) / SIGNAL_CELL);
  const iz0 = Math.floor((z - radius) / SIGNAL_CELL);
  const iz1 = Math.floor((z + radius) / SIGNAL_CELL);
  for (let ix = ix0; ix <= ix1; ix++) {
    for (let iz = iz0; iz <= iz1; iz++) {
      const list = signalCells.get(signalCellKey(ix, iz));
      if (!list) continue;
      for (const id of list) {
        const n = nodes[id];
        const dx = n.x - x;
        const dz = n.z - z;
        if (dx * dx + dz * dz <= r2) out.push(id);
      }
    }
  }
  return out;
}

/** Unit direction of graph edge from -> to */
export function edgeDirection(fromId: number, toId: number): { fx: number; fz: number } {
  const a = ACTIVE_MAP_DATA.nodes[fromId];
  const b = ACTIVE_MAP_DATA.nodes[toId];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  return { fx: dx / len, fz: dz / len };
}

/** Exponential decay factor for the lane blend offset after travelling `distance` metres */
export function laneBlendDecay(distance: number): number {
  return Math.exp(-Math.abs(distance) / LANE_BLEND_DISTANCE);
}
