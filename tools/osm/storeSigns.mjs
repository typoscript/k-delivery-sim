// Storefront signs with real names (실제 상호 간판): each named OSM shop / service is put on the street-facing wall of
// the building it is in (or the nearest one within reach), on the ground-floor sign band, facing the street.
// Pure geometry, unit tested. Data: © OpenStreetMap contributors, ODbL 1.0

import { pointInRing } from './delivery-spots.mjs';

/** A POI belongs to a building it is in, or the nearest one within this distance of its walls */
export const SIGN_REACH_M = 12;
/** Sign width on the wall (shorter walls get a shorter sign) */
export const SIGN_MAX_W = 5;
/** Two signs on the same wall keep this far apart (centre to centre); a later one too close is dropped */
export const SIGN_SPACING_M = 4;
/** Longest name shown (characters) */
const MAX_NAME = 14;

function distToSeg(x, z, a, b) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
  return { d: Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t)), t };
}

/**
 * `pois`: { name, x, z }; `buildings`: { ring: [[x, z]...], minX, maxX, minZ, maxZ, height }; `nearestRoad(x, z)`:
 * the closest point on a road centre line ({ x, z }). Returns { n, x, z, h, w } signs: the name, the sign's centre
 * on the wall (sign band height is the game's), the heading it faces (out of the wall, toward the street) and its
 * width.
 */
export function placeSigns(pois, buildings, nearestRoad) {
  const out = [];
  for (const p of pois) {
    const name = String(p.name).trim().slice(0, MAX_NAME);
    if (!name) continue;
    // the building: one containing the POI, else the nearest wall within reach
    let best = null;
    for (const b of buildings) {
      if (p.x < b.minX - SIGN_REACH_M || p.x > b.maxX + SIGN_REACH_M || p.z < b.minZ - SIGN_REACH_M || p.z > b.maxZ + SIGN_REACH_M) {
        continue;
      }
      const inside = pointInRing(p.x, p.z, b.ring);
      let d = Infinity;
      for (let i = 0; i < b.ring.length; i++) d = Math.min(d, distToSeg(p.x, p.z, b.ring[i], b.ring[(i + 1) % b.ring.length]).d);
      const score = inside ? -1 : d;
      if (score <= SIGN_REACH_M && (!best || score < best.score)) best = { b, score };
    }
    if (!best || best.b.height < 5) continue;
    const road = nearestRoad(p.x, p.z);
    if (!road) continue;
    // the wall facing that road: outward normal toward the road, closest to it
    const ring = best.b.ring;
    let area = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const c = ring[(i + 1) % ring.length];
      area += a[0] * c[1] - c[0] * a[1];
    }
    const ccw = area > 0;
    let wall = null;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const c = ring[(i + 1) % ring.length];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < 3) continue;
      // outward normal of a counter-clockwise ring (x, z): (dz, -dx) / len
      let nx = (c[1] - a[1]) / len;
      let nz = -(c[0] - a[0]) / len;
      if (!ccw) {
        nx = -nx;
        nz = -nz;
      }
      const mx = (a[0] + c[0]) / 2;
      const mz = (a[1] + c[1]) / 2;
      const toRoad = (road.x - mx) * nx + (road.z - mz) * nz;
      if (toRoad <= 0) continue;
      const d = Math.hypot(road.x - mx, road.z - mz);
      if (!wall || d < wall.d) wall = { a, c, len, nx, nz, d };
    }
    if (!wall) continue;
    const w = Math.min(SIGN_MAX_W, wall.len - 0.8);
    if (w < 1.6) continue;
    // under the POI along the wall, kept on the wall
    const { t } = distToSeg(p.x, p.z, wall.a, wall.c);
    const half = w / 2 / wall.len;
    const tc = Math.max(half, Math.min(1 - half, t));
    const x = wall.a[0] + (wall.c[0] - wall.a[0]) * tc;
    const z = wall.a[1] + (wall.c[1] - wall.a[1]) * tc;
    if (out.some((s) => Math.hypot(s.x - x, s.z - z) < SIGN_SPACING_M)) continue;
    out.push({
      n: name,
      x: Math.round(x * 100) / 100,
      z: Math.round(z * 100) / 100,
      h: Math.round(Math.atan2(wall.nx, wall.nz) * 1000) / 1000,
      w: Math.round(w * 10) / 10,
    });
  }
  return out;
}
