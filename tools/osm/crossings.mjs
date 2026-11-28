// Pedestrian crossings from OSM (highway=crossing nodes, footway=crossing ways) snapped onto the road graph:
// each becomes one crosswalk across the road it sits on - centre, road direction and road width - so the game can
// paint it. Unmarked crossings are skipped, crossings already drawn by the signal crosswalks (near a signalized
// junction) are skipped, and a node and the way drawn over the same crossing are merged.
// Data: © OpenStreetMap contributors, ODbL 1.0

/** A crossing within this distance of a signal node is the junction's own crosswalk (already drawn) */
export const NEAR_SIGNAL_M = 14;
/** A crossing must be this close to a road centre line to be snapped onto it */
export const SNAP_M = 6;
/** Crossings closer than this are the same one (node + way) */
export const MERGE_M = 6;

function nearestEdge(x, z, nodes, edges) {
  let best = null;
  for (const e of edges) {
    const a = nodes[e.a];
    const b = nodes[e.b];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz;
    if (l2 < 1e-6) continue;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (!best || d < best.d) best = { e, d, px, pz, t, heading: Math.atan2(dx, dz), len: Math.sqrt(l2) };
  }
  return best;
}

/** Where a crossing way (its points) cuts the nearest road: the midpoint of the way is close enough */
function wayCentre(pts) {
  if (pts.length === 1) return pts[0];
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  let walked = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    if (walked + seg >= len / 2) {
      const t = seg > 0 ? (len / 2 - walked) / seg : 0;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, z: pts[i - 1].z + (pts[i].z - pts[i - 1].z) * t };
    }
    walked += seg;
  }
  return pts[pts.length - 1];
}

/**
 * `points`: { x, z, kind } of crossing nodes and way centres (kind = the crossing tag). Returns
 * { x, z, h, w, sig } crosswalks: centre on the road, the road's heading, the road's width, signalized or not.
 */
export function snapCrossings(points, nodes, edges) {
  const signals = nodes.filter((n) => n.isSignal);
  const out = [];
  for (const p of points) {
    if (p.kind === 'unmarked' || p.kind === 'no') continue;
    const hit = nearestEdge(p.x, p.z, nodes, edges);
    if (!hit || hit.d > Math.max(SNAP_M, hit.e.width / 2 + 2)) continue;
    // judged where it lands on the road (snapping can move it toward a junction)
    if (signals.some((s) => Math.hypot(s.x - hit.px, s.z - hit.pz) < NEAR_SIGNAL_M)) continue;
    // too close to the end of a short edge: it is at a junction, the stripes would cover the junction disc
    const fromEnd = Math.min(hit.t, 1 - hit.t) * hit.len;
    if (fromEnd < Math.min(4, hit.len / 3)) continue;
    if (out.some((c) => Math.hypot(c.x - hit.px, c.z - hit.pz) < MERGE_M)) continue;
    out.push({
      x: Math.round(hit.px * 10) / 10,
      z: Math.round(hit.pz * 10) / 10,
      h: Math.round(hit.heading * 1000) / 1000,
      w: hit.e.width,
      ...(p.kind === 'traffic_signals' ? { sig: true } : {}),
    });
  }
  return out;
}

/** Crossing points from the raw crossings dump (projected with the build's `project`) */
export function crossingPoints(elements, project) {
  const pts = [];
  for (const el of elements) {
    const kind = el.tags?.crossing ?? (el.tags?.['crossing:markings'] && el.tags['crossing:markings'] !== 'no' ? 'marked' : '');
    if (el.type === 'node' && el.lat !== undefined) {
      const p = project(el.lat, el.lon);
      pts.push({ x: p.x, z: p.z, kind });
    } else if (el.type === 'way' && el.geometry) {
      const c = wayCentre(el.geometry.filter(Boolean).map((g) => project(g.lat, g.lon)));
      pts.push({ x: c.x, z: c.z, kind });
    }
  }
  return pts;
}
