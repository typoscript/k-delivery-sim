#!/usr/bin/env node
// Converts the cached raw Overpass dump (tools/osm/cache/suwon-raw.json) into the unified Suwon
// open-world map used for chunk streaming:
//
//   src/data/openworld/suwonWorld.json   always-loaded data bundled into the game: meta, road graph
//                                        (nodes/edges/signals), bus stops, legacy district content
//                                        (shops, residences, spawns...), chunk index
//   public/map/suwon/chunks/c_<ix>_<iz>.json   heavy per-200m-chunk geometry: buildings, parks,
//                                        waters, water lines, pedestrian plazas
//
// Usage:  node tools/osm/build-suwon-map.mjs
// Data:   © OpenStreetMap contributors, ODbL 1.0
//
// The conventions reproduce the legacy per-district generator (verified against src/data/*):
//   +Z north, +X west, metres; road widths by highway class; height = building:levels * 3.2;
//   signals at OSM traffic_signals + junctions with >= 3 roads of which >= 2 are major.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHUNK_SIZE_M,
  LEGACY_DISTRICTS,
  M_PER_DEG_LAT,
  SUWON_BBOX,
  WORLD_ORIGIN,
  project,
} from './suwon-config.mjs';
import { generateDeliverySpots, riversideSpots } from './delivery-spots.mjs';
import { crossingPoints, snapCrossings } from './crossings.mjs';
import { placeSigns } from './storeSigns.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const RAW = join(HERE, 'cache', 'suwon-raw.json');
const OUT_DIR = join(ROOT, 'public', 'map', 'suwon');
const WORLD_JSON = join(ROOT, 'src', 'data', 'openworld', 'suwonWorld.json');
const LEGACY_DIR = join(ROOT, 'src', 'data');

// ---------------------------------------------------------------- road classes (legacy-compatible)
const ROAD_CLASSES = {
  trunk: { width: 16, major: true },
  primary: { width: 14.5, major: true },
  secondary: { width: 13, major: true },
  tertiary: { width: 12, major: true },
  trunk_link: { width: 11, major: false },
  primary_link: { width: 11, major: false },
  secondary_link: { width: 10, major: false },
  tertiary_link: { width: 9.5, major: false },
  unclassified: { width: 8.6, major: false },
  residential: { width: 8.6, major: false },
  living_street: { width: 7.2, major: false },
};

const SIMPLIFY_ROAD_M = 1.5; // Douglas-Peucker tolerance for road shape points
const SIMPLIFY_AREA_M = 0.6; // ... for building / park outlines
const MIN_EDGE_M = 3.0; // collapse shorter edges (legacy min edge ~3.4m)
const MIN_BUILDING_AREA = 25;
const BUS_STOP_SPACING_M = 150;
const BUS_STOP_MAX_ROAD_DIST = 22;
const LEVEL_HEIGHT_M = 3.2;

const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;

// ---------------------------------------------------------------- geometry helpers
function perpDist(p, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.z - a.z);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

/** Douglas-Peucker on an open polyline; returns indices to keep */
function simplifyIdx(pts, tol) {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let best = -1;
    let bestD = tol;
    for (let i = s + 1; i < e; i++) {
      const d = perpDist(pts[i], pts[s], pts[e]);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([s, best], [best, e]);
    }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(i);
  return out;
}

function simplifyRing(pts, tol) {
  // drop closing duplicate
  if (pts.length > 2 && pts[0].x === pts.at(-1).x && pts[0].z === pts.at(-1).z) pts = pts.slice(0, -1);
  if (pts.length <= 4) return pts;
  // split ring at the vertex farthest from the first so DP works on two open halves
  let far = 0;
  let farD = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[0].x, pts[i].z - pts[0].z);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const a = pts.slice(0, far + 1);
  const b = pts.slice(far).concat([pts[0]]);
  const ka = simplifyIdx(a, tol).map((i) => a[i]);
  const kb = simplifyIdx(b, tol).map((i) => b[i]);
  const ring = ka.concat(kb.slice(1, -1));
  return ring.length >= 3 ? ring : pts;
}

function polygonArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    s += p.x * q.z - q.x * p.z;
  }
  return s / 2;
}

function polygonCentroid(pts) {
  const a = polygonArea(pts);
  if (Math.abs(a) < 1e-6) {
    return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, z: pts.reduce((s, p) => s + p.z, 0) / pts.length };
  }
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const f = p.x * q.z - q.x * p.z;
    cx += (p.x + q.x) * f;
    cz += (p.z + q.z) * f;
  }
  return { x: cx / (6 * a), z: cz / (6 * a) };
}

const geomToPts = (geom) => geom.filter(Boolean).map((g) => project(g.lat, g.lon));

/** Largest closed outer ring of a way or multipolygon relation */
function outerRing(el) {
  if (el.type === 'way' && el.geometry) return geomToPts(el.geometry);
  if (el.type === 'relation' && el.members) {
    // stitch outer member ways into rings
    const segs = el.members.filter((m) => m.role === 'outer' && m.geometry).map((m) => geomToPts(m.geometry));
    const rings = [];
    while (segs.length) {
      let ring = segs.shift();
      let grew = true;
      while (grew && Math.hypot(ring[0].x - ring.at(-1).x, ring[0].z - ring.at(-1).z) > 0.5) {
        grew = false;
        for (let i = 0; i < segs.length; i++) {
          const s = segs[i];
          const end = ring.at(-1);
          if (Math.hypot(s[0].x - end.x, s[0].z - end.z) < 0.5) ring = ring.concat(s.slice(1));
          else if (Math.hypot(s.at(-1).x - end.x, s.at(-1).z - end.z) < 0.5) ring = ring.concat(s.slice(0, -1).reverse());
          else continue;
          segs.splice(i, 1);
          grew = true;
          break;
        }
      }
      rings.push(ring);
    }
    rings.sort((p, q) => Math.abs(polygonArea(q)) - Math.abs(polygonArea(p)));
    return rings[0] ?? null;
  }
  return null;
}

/** Deterministic 0..1 hash from an OSM id (stable default heights between runs) */
const hash01 = (n) => {
  let h = (n * 2654435761) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
};

// ---------------------------------------------------------------- buildings
const SHOP_TYPES = new Set(['retail', 'commercial', 'supermarket', 'kiosk', 'mall', 'department_store']);
const PUBLIC_TYPES = new Set([
  'school', 'hospital', 'office', 'public', 'university', 'college', 'kindergarten', 'church', 'civic',
  'government', 'train_station', 'transportation', 'hotel', 'fire_station', 'police', 'library', 'museum',
  'temple', 'sports_hall', 'stadium', 'industrial', 'warehouse', 'parking',
]);

function buildingKind(t) {
  if (SHOP_TYPES.has(t.building) || t.shop) return 'shop';
  if (PUBLIC_TYPES.has(t.building) || t.amenity || t.office || t.tourism) return 'public';
  return 'residential';
}

function buildingHeight(t, area, id) {
  const levels = parseFloat(t['building:levels']);
  if (Number.isFinite(levels) && levels > 0) return Math.min(160, Math.max(4.5, levels * LEVEL_HEIGHT_M));
  const h = hash01(id);
  switch (t.building) {
    case 'apartments':
      // Korean apartment blocks: big footprints are high-rise towers
      return area > 450 ? 45 + Math.round(h * 6) * LEVEL_HEIGHT_M : 12 + Math.round(h * 2) * LEVEL_HEIGHT_M;
    case 'house':
    case 'detached':
      return 6.5;
    case 'roof':
    case 'garage':
    case 'garages':
    case 'shed':
      return 4.5;
    case 'retail':
    case 'commercial':
    case 'office':
      return 12 + Math.round(h * 3) * LEVEL_HEIGHT_M;
    default: {
      // legacy low-rise defaults (7.5 / 9.9 / 12.3 / 14m), bigger footprints lean taller
      const opts = [7.5, 9.9, 12.3, 14];
      const bias = Math.min(1, area / 900);
      return opts[Math.min(3, Math.floor((h * 0.6 + bias * 0.4) * 4))];
    }
  }
}

// ---------------------------------------------------------------- main
async function loadLegacy(file) {
  const t = await readFile(join(LEGACY_DIR, file), 'utf8');
  return JSON.parse(t.slice(t.indexOf('= {') + 2, t.lastIndexOf('}') + 1));
}

async function main() {
  const raw = JSON.parse(await readFile(RAW, 'utf8'));
  const els = raw.elements;
  // Some OSM names pack two businesses into one tag with a long run of spaces
  // ("탑헤어2F                        세바스찬키친(킹크랩)"): collapse whitespace so names fit the UI
  for (const e of els) {
    if (!e.tags) continue;
    for (const k of ['name', 'name:ko', 'brand']) {
      if (typeof e.tags[k] === 'string') e.tags[k] = e.tags[k].replace(/\s+/g, ' ').trim();
    }
  }
  const stats = {};

  // ---------- 1. road graph
  const roadWays = els.filter((e) => e.type === 'way' && ROAD_CLASSES[e.tags?.highway] && e.geometry && e.nodes);
  const osmSignalIds = new Set(els.filter((e) => e.type === 'node' && e.tags?.highway === 'traffic_signals').map((e) => e.id));
  const usage = new Map();
  for (const w of roadWays) for (const nid of w.nodes) usage.set(nid, (usage.get(nid) ?? 0) + 1);

  // graph nodes keyed by OSM node id for junctions; shape points get synthetic keys
  const gNodes = []; // {x,z,osmSignal}
  const keyToIdx = new Map();
  const nodeFor = (key, p, osmSignal) => {
    let i = keyToIdx.get(key);
    if (i === undefined) {
      i = gNodes.length;
      gNodes.push({ x: p.x, z: p.z, osmSignal });
      keyToIdx.set(key, i);
    } else if (osmSignal) gNodes[i].osmSignal = true;
    return i;
  };
  const gEdges = []; // {a,b,highway,name,structure}
  // bridges / underpasses (지하차도) - kept on the graph edges so the game can rail bridges, roof tunnels etc.
  const structureOf = (t) =>
    t.bridge && t.bridge !== 'no' ? 'bridge' : t.tunnel && t.tunnel !== 'no' && t.tunnel !== 'building_passage' ? 'tunnel' : null;
  for (const w of roadWays) {
    const pts = geomToPts(w.geometry);
    // split at junction / endpoint / signal nodes, simplify the shape points in between
    let segStart = 0;
    for (let i = 1; i < w.nodes.length; i++) {
      const nid = w.nodes[i];
      const isAnchor = i === w.nodes.length - 1 || (usage.get(nid) ?? 0) > 1 || osmSignalIds.has(nid);
      if (!isAnchor) continue;
      const sub = pts.slice(segStart, i + 1);
      const keep = simplifyIdx(sub, SIMPLIFY_ROAD_M);
      let prev = nodeFor(`o${w.nodes[segStart]}`, sub[0], osmSignalIds.has(w.nodes[segStart]));
      for (let k = 1; k < keep.length; k++) {
        const j = keep[k];
        const isEnd = k === keep.length - 1;
        const cur = isEnd
          ? nodeFor(`o${nid}`, sub[j], osmSignalIds.has(nid))
          : nodeFor(`s${w.id}_${segStart + j}`, sub[j], false);
        gEdges.push({ a: prev, b: cur, highway: w.tags.highway, name: w.tags.name ?? '', structure: structureOf(w.tags) });
        prev = cur;
      }
      segStart = i;
    }
  }
  stats.rawGraph = { nodes: gNodes.length, edges: gEdges.length };

  // collapse edges shorter than MIN_EDGE_M (union-find), keeping signal flags
  const parent = gNodes.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const e of gEdges) {
    const a = find(e.a);
    const b = find(e.b);
    if (a === b) continue;
    if (Math.hypot(gNodes[a].x - gNodes[b].x, gNodes[a].z - gNodes[b].z) < MIN_EDGE_M) {
      parent[b] = a;
      gNodes[a].osmSignal ||= gNodes[b].osmSignal;
    }
  }
  // dedupe edges, drop self loops
  const edgeMap = new Map();
  for (const e of gEdges) {
    const a = find(e.a);
    const b = find(e.b);
    if (a === b) continue;
    const k = a < b ? `${a}_${b}` : `${b}_${a}`;
    const prev = edgeMap.get(k);
    if (!prev || ROAD_CLASSES[e.highway].width > ROAD_CLASSES[prev.highway].width) edgeMap.set(k, { ...e, a, b });
  }
  let edges = [...edgeMap.values()];

  // keep only the largest connected component so every road is reachable by AI & navigation
  const adj = new Map();
  for (const e of edges) {
    (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)).push(e.b);
    (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)).push(e.a);
  }
  const comp = new Map();
  const compSizes = [];
  for (const start of adj.keys()) {
    if (comp.has(start)) continue;
    const id = compSizes.length;
    let size = 0;
    const stack = [start];
    comp.set(start, id);
    while (stack.length) {
      const n = stack.pop();
      size++;
      for (const m of adj.get(n)) if (!comp.has(m)) comp.set(m, id), stack.push(m);
    }
    compSizes.push(size);
  }
  const mainComp = compSizes.indexOf(Math.max(...compSizes));
  const droppedEdges = edges.filter((e) => comp.get(e.a) !== mainComp).length;
  edges = edges.filter((e) => comp.get(e.a) === mainComp);
  stats.components = { count: compSizes.length, mainNodes: compSizes[mainComp], droppedEdges };

  // reindex nodes compactly
  const remap = new Map();
  const nodes = [];
  for (const e of edges) {
    for (const k of ['a', 'b']) {
      if (!remap.has(e[k])) {
        remap.set(e[k], nodes.length);
        const g = gNodes[e[k]];
        nodes.push({ id: nodes.length, x: r1(g.x), z: r1(g.z), isSignal: false, _osmSignal: g.osmSignal });
      }
    }
  }
  const outEdges = edges.map((e) => {
    const a = remap.get(e.a);
    const b = remap.get(e.b);
    const cls = ROAD_CLASSES[e.highway];
    return {
      a,
      b,
      dist: r1(Math.hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z)),
      width: cls.width,
      highway: e.highway,
      name: e.name,
      isMajor: cls.major,
      ...(e.structure ? { [e.structure]: true } : {}),
    };
  });
  stats.structures = {
    bridges: outEdges.filter((e) => e.bridge).length,
    tunnels: outEdges.filter((e) => e.tunnel).length,
  };

  // signals: OSM-tagged + real arterial junctions. The legacy rule (>=3 roads, >=2 major) also caught every
  // side street T-junction along an arterial; over the whole city that gave 1,185 signals (one every ~100m).
  // Require a major road crossing (>=3 major arms) or a 4-way junction on a major road instead.
  const deg = new Array(nodes.length).fill(0);
  const majDeg = new Array(nodes.length).fill(0);
  for (const e of outEdges) {
    deg[e.a]++;
    deg[e.b]++;
    if (e.isMajor) majDeg[e.a]++, majDeg[e.b]++;
  }
  for (const n of nodes) {
    const d = deg[n.id];
    const m = majDeg[n.id];
    n.isSignal = n._osmSignal || (d >= 3 && m >= 3) || (d >= 4 && m >= 2);
    delete n._osmSignal;
  }
  stats.graph = {
    nodes: nodes.length,
    edges: outEdges.length,
    signals: nodes.filter((n) => n.isSignal).length,
    roadKm: r1(outEdges.reduce((s, e) => s + e.dist, 0) / 1000),
  };

  // ---------- 2. area features -> chunks
  const bboxMin = project(SUWON_BBOX.north, SUWON_BBOX.east); // +X is west, so east edge is min x
  const bboxMax = project(SUWON_BBOX.south, SUWON_BBOX.west);
  const minX = Math.min(bboxMin.x, bboxMax.x);
  const maxX = Math.max(bboxMin.x, bboxMax.x);
  const minZ = Math.min(bboxMin.z, bboxMax.z);
  const maxZ = Math.max(bboxMin.z, bboxMax.z);
  const cols = Math.ceil((maxX - minX) / CHUNK_SIZE_M);
  const rows = Math.ceil((maxZ - minZ) / CHUNK_SIZE_M);
  const chunks = new Map();
  const chunkOf = (x, z) => {
    const ix = Math.max(0, Math.min(cols - 1, Math.floor((x - minX) / CHUNK_SIZE_M)));
    const iz = Math.max(0, Math.min(rows - 1, Math.floor((z - minZ) / CHUNK_SIZE_M)));
    const key = `${ix}_${iz}`;
    if (!chunks.has(key))
      chunks.set(key, { ix, iz, buildings: [], parks: [], waters: [], waterLines: [], pedestrianPlazas: [], signs: [] });
    return chunks.get(key);
  };
  const toPts = (ring) => ring.map((p) => [r1(p.x), r1(p.z)]);

  let bCount = 0;
  let bSkipped = 0;
  const allBuildings = []; // kept for generated delivery spots (step 5)
  for (const el of els) {
    const t = el.tags;
    if (!t?.building) continue;
    const ringRaw = outerRing(el);
    if (!ringRaw || ringRaw.length < 3) {
      bSkipped++;
      continue;
    }
    const ring = simplifyRing(ringRaw, SIMPLIFY_AREA_M);
    const area = Math.abs(polygonArea(ring));
    if (area < MIN_BUILDING_AREA) {
      bSkipped++;
      continue;
    }
    const c = polygonCentroid(ring);
    const xs = ring.map((p) => p.x);
    const zs = ring.map((p) => p.z);
    const b = {
      name: t.name ?? '',
      kind: buildingKind(t),
      height: r1(buildingHeight(t, area, el.id)),
      area: Math.round(area),
      cx: r1(c.x),
      cz: r1(c.z),
      w: r1(Math.max(...xs) - Math.min(...xs)),
      d: r1(Math.max(...zs) - Math.min(...zs)),
      minX: r1(Math.min(...xs)),
      maxX: r1(Math.max(...xs)),
      minZ: r1(Math.min(...zs)),
      maxZ: r1(Math.max(...zs)),
      pts: toPts(ring),
    };
    chunkOf(b.cx, b.cz).buildings.push(b);
    allBuildings.push({ id: el.id, type: el.type, tags: t, kind: b.kind, ring: b.pts, area, height: b.height, cx: b.cx, cz: b.cz, minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ });
    bCount++;
  }
  stats.buildings = { kept: bCount, skipped: bSkipped };

  const isPark = (t) =>
    ['park', 'garden', 'playground'].includes(t.leisure) || ['grass', 'recreation_ground', 'village_green'].includes(t.landuse);
  let parkN = 0;
  let waterN = 0;
  let waterLineN = 0;
  let plazaN = 0;
  /** Whole stream polylines (before cutting into chunk pieces) for the riverside delivery spots */
  const streamLinesAll = [];
  for (const el of els) {
    const t = el.tags;
    if (!t || t.building) continue;
    if (isPark(t) || t.natural === 'water') {
      const ringRaw = outerRing(el);
      if (!ringRaw || ringRaw.length < 3) continue;
      const ring = simplifyRing(ringRaw, SIMPLIFY_AREA_M * 2);
      if (Math.abs(polygonArea(ring)) < 40) continue;
      const c = polygonCentroid(ring);
      const target = t.natural === 'water' ? 'waters' : 'parks';
      chunkOf(c.x, c.z)[target].push({ name: t.name ?? '', pts: toPts(ring) });
      target === 'waters' ? waterN++ : parkN++;
    } else if (t.waterway && el.geometry) {
      // rivers/streams are long lines: cut into <= CHUNK_SIZE pieces so each lands in its own chunk
      const pts = geomToPts(el.geometry);
      const keep = simplifyIdx(pts, SIMPLIFY_ROAD_M).map((i) => pts[i]);
      const width = t.waterway === 'river' ? 18 : t.waterway === 'canal' ? 10 : 5;
      streamLinesAll.push({ name: t.name ?? '', width, pts: keep });
      let piece = [keep[0]];
      let len = 0;
      for (let i = 1; i < keep.length; i++) {
        len += Math.hypot(keep[i].x - keep[i - 1].x, keep[i].z - keep[i - 1].z);
        piece.push(keep[i]);
        if (len >= CHUNK_SIZE_M || i === keep.length - 1) {
          const mid = piece[piece.length >> 1];
          chunkOf(mid.x, mid.z).waterLines.push({ name: t.name ?? '', width, pts: toPts(piece) });
          waterLineN++;
          piece = [keep[i]];
          len = 0;
        }
      }
    } else if ((t.highway === 'pedestrian' || t['area:highway'] === 'pedestrian') && el.geometry) {
      const pts = geomToPts(el.geometry);
      const keep = simplifyIdx(pts, SIMPLIFY_ROAD_M).map((i) => pts[i]);
      const mid = keep[keep.length >> 1];
      chunkOf(mid.x, mid.z).pedestrianPlazas.push({ name: t.name ?? '', width: 8, pts: toPts(keep) });
      plazaN++;
    }
  }
  stats.areas = { parks: parkN, waters: waterN, waterLines: waterLineN, plazas: plazaN };

  // ---------- 3. bus stops snapped to the road graph (right-hand lane, shelter on the curb side)
  const busNodes = els.filter((e) => e.type === 'node' && e.tags?.highway === 'bus_stop');
  const nearestEdge = (x, z, majorFirst) => {
    let best = null;
    for (let i = 0; i < outEdges.length; i++) {
      const e = outEdges[i];
      const a = nodes[e.a];
      const b = nodes[e.b];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
      const px = a.x + dx * t;
      const pz = a.z + dz * t;
      let d = Math.hypot(x - px, z - pz);
      if (majorFirst && !e.isMajor) d += 8; // prefer arterials where buses actually run
      if (!best || d < best.d) best = { i, d, px, pz, t };
    }
    return best;
  };
  const busStops = [];
  for (const bn of busNodes) {
    const p = project(bn.lat, bn.lon);
    const hit = nearestEdge(p.x, p.z, true);
    if (!hit || hit.d > BUS_STOP_MAX_ROAD_DIST) continue;
    if (busStops.some((s) => Math.hypot(s.x - p.x, s.z - p.z) < BUS_STOP_SPACING_M)) continue;
    const e = outEdges[hit.i];
    const a = nodes[e.a];
    const b = nodes[e.b];
    let fx = b.x - a.x;
    let fz = b.z - a.z;
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl;
    fz /= fl;
    // right = forward x up = (-fz, 0, fx); serve the travel direction whose right side the stop is on
    let rx = -fz;
    let rz = fx;
    if ((p.x - hit.px) * rx + (p.z - hit.pz) * rz < 0) {
      rx = -rx;
      rz = -rz;
    }
    const lane = Math.max(1.8, Math.min(3.3, e.width * 0.25));
    const sx = hit.px + rx * lane;
    const sz = hit.pz + rz * lane;
    const shx = hit.px + rx * (e.width / 2 + 1.6);
    const shz = hit.pz + rz * (e.width / 2 + 1.6);
    busStops.push({
      name: bn.tags.name ?? '버스정류장',
      x: r1(sx),
      z: r1(sz),
      shelterX: r1(shx),
      shelterZ: r1(shz),
      facingHeading: r3(Math.atan2(sx - shx, sz - shz)),
      edgeIndex: hit.i,
    });
  }
  stats.busStops = busStops.length;

  // ---------- 4. legacy hand-tuned district content moved into world coordinates
  const legacyDistricts = [];
  for (const d of LEGACY_DISTRICTS) {
    const j = await loadLegacy(d.file);
    const off = project(d.originLat, d.originLon);
    const mv = (o) => ({ ...o, x: r1(o.x + off.x), z: r1(o.z + off.z) });
    const mvSpot = (s) => ({ ...s, x: r1(s.x + off.x), z: r1(s.z + off.z), roadX: r1(s.roadX + off.x), roadZ: r1(s.roadZ + off.z) });
    const roadDist = [...j.shops, ...j.residences].map((s) => nearestEdge(s.x + off.x, s.z + off.z, false).d);
    legacyDistricts.push({
      id: d.id,
      name: j.meta.name,
      shortName: j.meta.shortName ?? j.meta.name,
      badgeLabel: j.meta.badgeLabel ?? '',
      origin: { x: r1(off.x), z: r1(off.z), lat: d.originLat, lon: d.originLon },
      halfSize: j.meta.worldLimit,
      station: mv(j.meta.station),
      scooterSpawn: { ...mv(j.meta.scooterSpawn), heading: j.meta.scooterSpawn.heading },
      playerSpawn: { ...mv(j.meta.playerSpawn), heading: j.meta.playerSpawn.heading },
      shops: j.shops.map(mv),
      residences: j.residences.map(mv),
      // What the open world still needs from the hand-tuned district maps (district-local coordinates), so the
      // game does not have to download the full legacy datasets: the station for landmarks, named buildings
      // landmarks are placed against, and building footprints the convenience stores keep clear of
      localStation: j.meta.station,
      namedBuildings: j.buildings.filter((b) => b.name),
      buildingBoxes: j.buildings.map((b) => [r1(b.minX), r1(b.maxX), r1(b.minZ), r1(b.maxZ)]),
      serviceSpots: { gas: mvSpot(j.serviceSpots.gas), repair: mvSpot(j.serviceSpots.repair) },
    });
    stats[`legacy_${d.id}`] = {
      offset: [r1(off.x), r1(off.z)],
      deliverySpots: roadDist.length,
      maxDistToNewRoad: r1(Math.max(...roadDist)),
      medianDistToNewRoad: r1(roadDist.sort((p, q) => p - q)[roadDist.length >> 1]),
    };
  }

  // ---------- 4a. pedestrian crossings (cache/suwon-crossings.json from `fetch-suwon.mjs --crossings`, optional)
  let crossings = [];
  try {
    const cr = JSON.parse(await readFile(join(HERE, 'cache', 'suwon-crossings.json'), 'utf8'));
    crossings = snapCrossings(crossingPoints(cr.elements, project), nodes, outEdges);
  } catch {
    console.warn('no crossings cache (node tools/osm/fetch-suwon.mjs --crossings): only signal crosswalks');
  }
  stats.crossings = crossings.length;

  // ---------- 4c. storefront signs with real names (raw food places + cache/suwon-shops.json from --shops)
  {
    const pois = [];
    const seen = new Set();
    const addPoi = (el) => {
      if (el.type !== 'node' || !el.tags?.name || el.lat === undefined) return;
      const p = project(el.lat, el.lon);
      const k = `${el.tags.name}|${Math.round(p.x / 5)}|${Math.round(p.z / 5)}`;
      if (seen.has(k)) return;
      seen.add(k);
      pois.push({ name: el.tags.name, x: p.x, z: p.z });
    };
    for (const el of els) if (el.tags?.amenity || el.tags?.shop) addPoi(el);
    try {
      const sh = JSON.parse(await readFile(join(HERE, 'cache', 'suwon-shops.json'), 'utf8'));
      for (const el of sh.elements) addPoi(el);
    } catch {
      console.warn('no shops cache (node tools/osm/fetch-suwon.mjs --shops): signs only for the food places');
    }
    const nearestRoad = (x, z) => {
      let best = null;
      let bestD = 60;
      for (const e of outEdges) {
        const a = nodes[e.a];
        const b = nodes[e.b];
        if (Math.min(a.x, b.x) - bestD > x || Math.max(a.x, b.x) + bestD < x) continue;
        if (Math.min(a.z, b.z) - bestD > z || Math.max(a.z, b.z) + bestD < z) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
        const px = a.x + dx * t;
        const pz = a.z + dz * t;
        const d = Math.hypot(px - x, pz - z);
        if (d < bestD) {
          bestD = d;
          best = { x: px, z: pz };
        }
      }
      return best;
    };
    const signs = placeSigns(pois, allBuildings, nearestRoad);
    for (const s of signs) chunkOf(s.x, s.z).signs.push(s);
    stats.signs = { pois: pois.length, placed: signs.length };
  }

  // ---------- 4b. riverside spots: customers on the stream walkways (walk in along the walkway)
  const riverside = riversideSpots(streamLinesAll, nodes, outEdges);
  stats.riverside = riverside.length;

  // ---------- 5. generated delivery spots: OSM food places -> shops, residential buildings -> customers
  const generated = generateDeliverySpots({
    elements: els,
    buildings: allBuildings,
    nodes,
    edges: outEdges,
    busStops,
    legacyDistricts,
    outerRing,
    chunkOf: (x, z) => {
      const ix = Math.max(0, Math.min(cols - 1, Math.floor((x - minX) / CHUNK_SIZE_M)));
      const iz = Math.max(0, Math.min(rows - 1, Math.floor((z - minZ) / CHUNK_SIZE_M)));
      return `${ix}_${iz}`;
    },
    project,
  });
  stats.generatedSpots = generated.stats;

  // ---------- 6. write
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(join(OUT_DIR, 'chunks'), { recursive: true });
  const chunkIndex = [];
  let chunkBytes = 0;
  let maxChunk = { key: '', buildings: 0, bytes: 0 };
  for (const [key, c] of [...chunks.entries()].sort()) {
    const body = JSON.stringify({
      ix: c.ix,
      iz: c.iz,
      buildings: c.buildings,
      parks: c.parks,
      waters: c.waters,
      waterLines: c.waterLines,
      pedestrianPlazas: c.pedestrianPlazas,
      ...(c.signs.length > 0 ? { signs: c.signs } : {}),
    });
    await writeFile(join(OUT_DIR, 'chunks', `c_${key}.json`), body);
    chunkBytes += body.length;
    chunkIndex.push({ key, ix: c.ix, iz: c.iz, buildings: c.buildings.length, bytes: body.length });
    if (c.buildings.length > maxChunk.buildings) maxChunk = { key, buildings: c.buildings.length, bytes: body.length };
  }
  const world = {
    meta: {
      name: '수원시 통합 오픈월드 (인계동 · 행궁동 · 수원역 · 광교)',
      attribution: '© OpenStreetMap contributors (ODbL 1.0)',
      osmTimestamp: raw.osm3s?.timestamp_osm_base ?? '',
      origin: WORLD_ORIGIN,
      metersPerDegLat: M_PER_DEG_LAT,
      bbox: SUWON_BBOX,
      bounds: { minX: r1(minX), maxX: r1(maxX), minZ: r1(minZ), maxZ: r1(maxZ) },
      chunkSize: CHUNK_SIZE_M,
      chunkGrid: { originX: r1(minX), originZ: r1(minZ), cols, rows },
    },
    nodes,
    edges: outEdges,
    busStops,
    crossings,
    legacyDistricts,
    generatedShops: generated.shops,
    generatedResidences: [...generated.residences, ...riverside],
    generatedFuelStations: generated.fuelStations,
    chunks: chunkIndex,
  };
  const worldBody = JSON.stringify(world);
  await mkdir(dirname(WORLD_JSON), { recursive: true });
  await writeFile(WORLD_JSON, worldBody);

  stats.output = {
    worldJsonKB: Math.round(worldBody.length / 1024),
    chunkFiles: chunkIndex.length,
    chunksTotalKB: Math.round(chunkBytes / 1024),
    chunkGrid: `${cols} x ${rows}`,
    heaviestChunk: maxChunk,
  };
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
