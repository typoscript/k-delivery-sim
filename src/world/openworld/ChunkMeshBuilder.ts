import * as THREE from 'three';
import { ObstacleBox } from '../../types';
import { OsmBuildingData, OsmGraphEdge, OsmGraphNode } from '../../data/suwonTypes';
import { BuildingWallCategory, buildingWallCategory } from '../cityTextures';
import { ChunkData } from './OpenWorldTypes';
import { freezeStatic } from '../renderLayers';

/**
 * Builds the render meshes + colliders for ONE streaming chunk.
 *
 * Everything of the same material is merged into a single BufferGeometry, so a chunk costs a fixed
 * handful of draw calls (~10) no matter whether it holds 5 or 165 buildings. Materials are shared and
 * injected (never disposed per chunk); only the chunk's own geometries are disposed on unload.
 */

export interface ChunkMaterials {
  walls: Record<BuildingWallCategory, THREE.Material>;
  roof: THREE.Material;
  road: THREE.Material;
  roadLine: THREE.Material;
  park: THREE.Material;
  water: THREE.Material;
  plaza: THREE.Material;
  /** Far LOD: untextured vertex-coloured buildings (one mesh per chunk) */
  farBuildings: THREE.Material;
  /** Ground-floor shopfronts (glass) and their signboards (vertex-coloured); none when omitted */
  storefrontGlass?: THREE.Material;
  storefrontSign?: THREE.Material;
}

/** Chunks whose centre is farther than this from the camera draw the single-mesh far LOD */
export const BUILDING_LOD_DISTANCE = 300;

/** Average facade colours (base paint blended with the window pattern) for the far LOD */
const FAR_WALL_COLORS: Record<BuildingWallCategory, THREE.Color> = {
  shop: new THREE.Color(0xd8e1ec).lerp(new THREE.Color(0x1e3a5f), 0.32),
  apt: new THREE.Color(0xe6e2d8).lerp(new THREE.Color(0x334155), 0.3),
  villa: new THREE.Color(0xc89c82).lerp(new THREE.Color(0x263242), 0.28),
  public: new THREE.Color(0xcbd5e1).lerp(new THREE.Color(0x0f2942), 0.3),
};
const FAR_ROOF_COLOR = new THREE.Color(0x64748b);

/** Roads that belong to this chunk (edges bucketed by midpoint, junction discs by node position) */
export interface ChunkRoads {
  nodes: readonly OsmGraphNode[];
  edges: readonly OsmGraphEdge[];
  discNodeIds: readonly number[];
  nodeMaxWidth: Float32Array;
  /** Metres from a point to the nearest road edge (street-facing walls get shopfronts); none when omitted */
  curbOffset?: (x: number, z: number) => number;
}

export interface ChunkBuildResult {
  group: THREE.Group;
  obstacles: ObstacleBox[];
  buildingCount: number;
  triangleCount: number;
  drawCalls: number;
  dispose: () => void;
}

/** Buildings at/above this height cast shadows (same threshold CityWorld uses) */
const SHADOW_HEIGHT_M = 18;
const ROAD_Y_MAJOR = 0.042;
const ROAD_Y_MINOR = 0.032;
const ROAD_UV_SCALE = 0.1; // asphalt tile per 10m
const DISC_SEGMENTS = 14;

/** Growable non-indexed triangle soup -> BufferGeometry */
class GeoBuffer {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly uv: number[] = [];
  /** Per-vertex colours (far LOD buffer only) */
  readonly col: number[] | null;
  color = new THREE.Color(1, 1, 1);

  constructor(withColor = false) {
    this.col = withColor ? [] : null;
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number): void {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, v);
    if (this.col) this.col.push(this.color.r, this.color.g, this.color.b);
  }

  get triangles(): number {
    return this.pos.length / 9;
  }

  toGeometry(): THREE.BufferGeometry | null {
    if (this.pos.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

function signedArea(pts: ReadonlyArray<[number, number]>): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[(i + 1) % pts.length];
    s += x1 * z2 - x2 * z1;
  }
  return s / 2;
}

/** Flat horizontal polygon at height y, triangulated, facing up (+Y) */
function addFlatPolygon(buf: GeoBuffer, pts: ReadonlyArray<[number, number]>, y: number, uvScale = 0): void {
  if (pts.length < 3) return;
  const contour = pts.map(([x, z]) => new THREE.Vector2(x, z));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  for (const [a, b, c] of tris) {
    let p = [pts[a], pts[b], pts[c]];
    // Up-facing: (b-a) x (c-a) must have +Y; in x/z that is (cz*bx - bz*cx) style -> check and flip
    const cross = (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]) - (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]);
    if (cross < 0) p = [p[0], p[2], p[1]];
    for (const [x, z] of p) buf.vertex(x, y, z, 0, 1, 0, x * uvScale, z * uvScale);
  }
}

/**
 * Extruded building: outward-facing walls with world-metre UVs (u = perimeter distance, v = height,
 * matching the facade textures' 0.08 repeat) + flat roof.
 */
export function addBuilding(walls: GeoBuffer, roof: GeoBuffer, b: OsmBuildingData, far?: GeoBuffer): void {
  if (b.pts.length < 3) return;
  // Normalise winding so area > 0; then the outward normal of edge (dx, dz) is (dz, -dx)
  const pts = signedArea(b.pts) > 0 ? b.pts : [...b.pts].reverse();
  const h = b.height;
  let u = 0;
  for (let i = 0; i < pts.length; i++) {
    const [px, pz] = pts[i];
    const [qx, qz] = pts[(i + 1) % pts.length];
    const dx = qx - px;
    const dz = qz - pz;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) continue;
    const nx = dz / len;
    const nz = -dx / len;
    const u2 = u + len;
    // (p, pTop, q) and (q, pTop, qTop) wind counter-clockwise when seen from outside
    walls.vertex(px, 0, pz, nx, 0, nz, u, 0);
    walls.vertex(px, h, pz, nx, 0, nz, u, h);
    walls.vertex(qx, 0, qz, nx, 0, nz, u2, 0);
    walls.vertex(qx, 0, qz, nx, 0, nz, u2, 0);
    walls.vertex(px, h, pz, nx, 0, nz, u, h);
    walls.vertex(qx, h, qz, nx, 0, nz, u2, h);
    if (far) {
      far.vertex(px, 0, pz, nx, 0, nz, 0, 0);
      far.vertex(px, h, pz, nx, 0, nz, 0, 0);
      far.vertex(qx, 0, qz, nx, 0, nz, 0, 0);
      far.vertex(qx, 0, qz, nx, 0, nz, 0, 0);
      far.vertex(px, h, pz, nx, 0, nz, 0, 0);
      far.vertex(qx, h, qz, nx, 0, nz, 0, 0);
    }
    u = u2;
  }
  addFlatPolygon(roof, pts, h);
  if (far) {
    const wallColor = far.color.clone();
    far.color.copy(FAR_ROOF_COLOR);
    addFlatPolygon(far, pts, h);
    far.color.copy(wallColor);
  }
}

/** Korean street sign colours (signboards above the shopfronts) */
const SIGN_COLORS = [0xdc2626, 0x1d4ed8, 0xfacc15, 0x16a34a, 0xf8fafc, 0x0f172a, 0xea580c, 0x7c3aed, 0x0891b2, 0xbe185d].map(
  (c) => new THREE.Color(c)
);
const SHOPFRONT_UNIT_M = 6.2;
const SHOPFRONT_TOP_M = 3.0;
const SIGN_BOTTOM_M = 3.2;
const SIGN_TOP_M = 4.15;
const SIGN_DEPTH_M = 0.22;

/** Deterministic 0..1 from a position (same signs every time the chunk is built) */
function hash01(x: number, z: number, salt: number): number {
  let h = (Math.imul(Math.round(x * 10), 73856093) ^ Math.imul(Math.round(z * 10), 19349663) ^ Math.imul(salt, 83492791)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296; // ^ yields a signed int: back to 0..1
}

/** Quad facing (nx, nz) from p to q between heights y0..y1, pushed `out` metres off the wall */
function addWallQuad(
  buf: GeoBuffer,
  px: number,
  pz: number,
  qx: number,
  qz: number,
  nx: number,
  nz: number,
  y0: number,
  y1: number,
  out: number
): void {
  const ax = px + nx * out;
  const az = pz + nz * out;
  const bx = qx + nx * out;
  const bz = qz + nz * out;
  buf.vertex(ax, y0, az, nx, 0, nz, 0, 0);
  buf.vertex(ax, y1, az, nx, 0, nz, 0, 1);
  buf.vertex(bx, y0, bz, nx, 0, nz, 1, 0);
  buf.vertex(bx, y0, bz, nx, 0, nz, 1, 0);
  buf.vertex(ax, y1, az, nx, 0, nz, 0, 1);
  buf.vertex(bx, y1, bz, nx, 0, nz, 1, 1);
}

/**
 * Ground-floor shops of Korean street buildings: on walls facing a road (every wall of OSM shop buildings that
 * face one), ~6m units of glass shopfront with a coloured signboard above each, separated by small pillars.
 */
export function addStorefronts(
  glass: GeoBuffer,
  sign: GeoBuffer,
  b: OsmBuildingData,
  curbOffset: (x: number, z: number) => number
): number {
  if (b.pts.length < 3 || b.height < SIGN_TOP_M + 1.5) return 0;
  // apartment towers rarely have street shops; big public buildings (schools, stations, halls) never do, small ones
  // (OSM amenity / office: restaurants, clinics, offices) usually do
  if (b.kind === 'residential' && b.height > 26) return 0;
  if (b.kind === 'public' && (b.height > 20 || b.area > 1200)) return 0;
  const pts = signedArea(b.pts) > 0 ? b.pts : [...b.pts].reverse();
  let units = 0;
  for (let i = 0; i < pts.length; i++) {
    const [px, pz] = pts[i];
    const [qx, qz] = pts[(i + 1) % pts.length];
    const dx = qx - px;
    const dz = qz - pz;
    const len = Math.hypot(dx, dz);
    if (len < 3.5) continue;
    const nx = dz / len;
    const nz = -dx / len;
    // street-facing: the sidewalk in front of the wall reaches a road within a few metres
    const mx = (px + qx) / 2;
    const mz = (pz + qz) / 2;
    const near = curbOffset(mx + nx * 1.5, mz + nz * 1.5);
    if (!(near < 7) || !(curbOffset(mx + nx * 4, mz + nz * 4) < near + 0.5)) continue;
    const n = Math.max(1, Math.round(len / SHOPFRONT_UNIT_M));
    const ux = dx / len;
    const uz = dz / len;
    const step = len / n;
    for (let k = 0; k < n; k++) {
      const s0 = k * step + 0.35;
      const s1 = (k + 1) * step - 0.35;
      if (s1 - s0 < 2) continue;
      const ax = px + ux * s0;
      const az = pz + uz * s0;
      const bx = px + ux * s1;
      const bz = pz + uz * s1;
      addWallQuad(glass, ax, az, bx, bz, nx, nz, 0.25, SHOPFRONT_TOP_M, 0.05);
      sign.color.copy(SIGN_COLORS[Math.floor(hash01(ax, az, 7) * SIGN_COLORS.length)]);
      // signboard: front face + top and bottom edges
      addWallQuad(sign, ax, az, bx, bz, nx, nz, SIGN_BOTTOM_M, SIGN_TOP_M, SIGN_DEPTH_M);
      const ox = nx * SIGN_DEPTH_M;
      const oz = nz * SIGN_DEPTH_M;
      for (const [y, ny] of [
        [SIGN_TOP_M, 1],
        [SIGN_BOTTOM_M, -1],
      ] as const) {
        const tri = [
          [ax, az],
          [ax + ox, az + oz],
          [bx, bz],
          [bx, bz],
          [ax + ox, az + oz],
          [bx + ox, bz + oz],
        ];
        if (ny < 0) tri.reverse();
        for (const [x, z] of tri) sign.vertex(x, y, z, 0, ny, 0, 0, 0);
      }
      units++;
    }
  }
  return units;
}

/** Per-building paint variation multiplied into the facade texture (subtle: same family of colours) */
const WALL_TINTS: Record<BuildingWallCategory, THREE.Color[]> = {
  shop: [0xffffff, 0xdfe8f5, 0xf3e6d6, 0xd5dde6, 0xf7eaea, 0xe3eedf].map((c) => new THREE.Color(c)),
  apt: [0xffffff, 0xf3e9db, 0xdde5ee, 0xf6efe0, 0xe2dbd0, 0xe9e2f0].map((c) => new THREE.Color(c)),
  villa: [0xffffff, 0xf7e0cf, 0xd8cdc0, 0xf2cbb8, 0xc9c1b6, 0xe6b39c, 0xc4cfdc, 0xe9e3c9].map((c) => new THREE.Color(c)),
  public: [0xffffff, 0xdfe7f0, 0xececec, 0xdde6d8].map((c) => new THREE.Color(c)),
};

/** Paint tint of one building (stable: from its position) */
export function wallTintOf(cat: BuildingWallCategory, b: Pick<OsmBuildingData, 'cx' | 'cz'>): THREE.Color {
  const list = WALL_TINTS[cat];
  return list[Math.floor(hash01(b.cx, b.cz, 3) * list.length)];
}

/** Rooftop details only on buildings up to this height (villas, shops, low offices) */
const ROOFTOP_MAX_HEIGHT_M = 36;

/** Axis-aligned box without a bottom face (rooftop structures) */
function addBox(buf: GeoBuffer, cx: number, y0: number, cz: number, sx: number, sy: number, sz: number): void {
  const x0 = cx - sx / 2;
  const x1 = cx + sx / 2;
  const z0 = cz - sz / 2;
  const z1 = cz + sz / 2;
  const y1 = y0 + sy;
  // sides (outward normals), wound counter-clockwise from outside
  addWallQuad(buf, x0, z1, x0, z0, -1, 0, y0, y1, 0);
  addWallQuad(buf, x1, z0, x1, z1, 1, 0, y0, y1, 0);
  addWallQuad(buf, x0, z0, x1, z0, 0, -1, y0, y1, 0);
  addWallQuad(buf, x1, z1, x0, z1, 0, 1, y0, y1, 0);
  addFlatPolygon(buf, [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ], y1);
}

/**
 * Rooftop detail of one building in the roof material: a low parapet along the roof edge and, on roofs big enough,
 * a water tank, air-conditioner units and the stair housing (stable per building).
 */
export function addRooftop(roof: GeoBuffer, b: OsmBuildingData): void {
  // roofs of towers are out of sight from the street: keep their budget for the streets
  if (b.pts.length < 3 || b.height > ROOFTOP_MAX_HEIGHT_M) return;
  const pts = signedArea(b.pts) > 0 ? b.pts : [...b.pts].reverse();
  const h = b.height;
  // parapet: the wall line raised 0.9m (outer face only - seen from the street)
  for (let i = 0; i < pts.length; i++) {
    const [px, pz] = pts[i];
    const [qx, qz] = pts[(i + 1) % pts.length];
    const dx = qx - px;
    const dz = qz - pz;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) continue;
    addWallQuad(roof, px, pz, qx, qz, dz / len, -dx / len, h, h + 0.9, 0);
  }
  // roof structures only where they fit well inside the footprint
  if (b.area < 100 || Math.min(b.w, b.d) < 8) return;
  const r = (salt: number) => hash01(b.cx, b.cz, salt);
  const off = (salt: number, extent: number) => (r(salt) - 0.5) * extent * 0.35;
  // stair housing, and on low buildings a water tank
  addBox(roof, b.cx + off(11, b.w), h, b.cz + off(12, b.d), 3.2, 2.6, 2.6);
  if (h <= 20) addBox(roof, b.cx + off(13, b.w), h, b.cz + off(14, b.d), 2.0, 1.7, 2.0);
  // a row of air-conditioner outdoor units (one box)
  const units = 1 + Math.floor(r(15) * 3);
  addBox(roof, b.cx + off(16, b.w), h, b.cz + off(17, b.d), units * 1.1, 0.7, 0.55);
}

/** Flat ribbon along a polyline (roads, rivers, pedestrian streets) */
function addRibbon(
  buf: GeoBuffer,
  pts: ReadonlyArray<[number, number]>,
  width: number,
  y: number,
  uvScale: number
): void {
  const hw = width / 2;
  let along = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) continue;
    // right = forward x up = (-fz, 0, fx)
    const rx = (-dz / len) * hw;
    const rz = (dx / len) * hw;
    const a2 = along + len;
    const v0 = along * uvScale;
    const v1 = a2 * uvScale;
    const uL = 0;
    const uR = width * uvScale;
    // left = a - r, right = a + r; up-facing winding
    const quad: Array<[number, number, number, number]> = [
      [ax - rx, az - rz, uL, v0],
      [ax + rx, az + rz, uR, v0],
      [bx - rx, bz - rz, uL, v1],
      [bx - rx, bz - rz, uL, v1],
      [ax + rx, az + rz, uR, v0],
      [bx + rx, bz + rz, uR, v1],
    ];
    for (const [x, z, u, v] of quad) buf.vertex(x, y, z, 0, 1, 0, u, v);
    along = a2;
  }
}

function addDisc(buf: GeoBuffer, cx: number, cz: number, r: number, y: number): void {
  for (let i = 0; i < DISC_SEGMENTS; i++) {
    const a0 = (i / DISC_SEGMENTS) * Math.PI * 2;
    const a1 = ((i + 1) / DISC_SEGMENTS) * Math.PI * 2;
    const p1x = cx + Math.cos(a0) * r;
    const p1z = cz + Math.sin(a0) * r;
    const p2x = cx + Math.cos(a1) * r;
    const p2z = cz + Math.sin(a1) * r;
    // up-facing: centre, p2, p1 (angles increase from +X toward +Z)
    buf.vertex(cx, y, cz, 0, 1, 0, cx * ROAD_UV_SCALE, cz * ROAD_UV_SCALE);
    buf.vertex(p2x, y, p2z, 0, 1, 0, p2x * ROAD_UV_SCALE, p2z * ROAD_UV_SCALE);
    buf.vertex(p1x, y, p1z, 0, 1, 0, p1x * ROAD_UV_SCALE, p1z * ROAD_UV_SCALE);
  }
}

export function buildChunkMeshes(chunk: ChunkData, roads: ChunkRoads, mats: ChunkMaterials): ChunkBuildResult {
  const group = new THREE.Group();
  group.name = `chunk_${chunk.ix}_${chunk.iz}`;
  const geometries: THREE.BufferGeometry[] = [];
  let triangleCount = 0;

  let drawCalls = 0;
  const addMesh = (
    buf: GeoBuffer,
    mat: THREE.Material,
    opts: { cast?: boolean; receive?: boolean; order?: number; parent?: THREE.Object3D; countDraw?: boolean }
  ) => {
    const geo = buf.toGeometry();
    if (!geo) return;
    geometries.push(geo);
    if (opts.countDraw !== false) {
      triangleCount += buf.triangles;
      drawCalls++;
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = !!opts.cast;
    mesh.receiveShadow = opts.receive ?? true;
    if (opts.order !== undefined) mesh.renderOrder = opts.order;
    mesh.matrixAutoUpdate = false; // static world geometry
    mesh.updateMatrix();
    (opts.parent ?? group).add(mesh);
  };

  // --- Buildings: one merged wall mesh per (facade category x shadow caster), one shared roof mesh pair
  const wallBufs = new Map<string, GeoBuffer>();
  const roofTall = new GeoBuffer();
  const roofLow = new GeoBuffer();
  const farBuf = new GeoBuffer(true);
  const shopGlass = new GeoBuffer();
  const shopSign = new GeoBuffer(true);
  const withStorefronts = !!(roads.curbOffset && mats.storefrontGlass && mats.storefrontSign);
  const obstacles: ObstacleBox[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const b of chunk.buildings) {
    const tall = b.height >= SHADOW_HEIGHT_M;
    const cat = buildingWallCategory(b.kind, b.height);
    const key = `${cat}|${tall ? 'T' : 'L'}`;
    let wb = wallBufs.get(key);
    if (!wb) wallBufs.set(key, (wb = new GeoBuffer(true)));
    farBuf.color.copy(FAR_WALL_COLORS[cat]);
    wb.color.copy(wallTintOf(cat, b));
    addBuilding(wb, tall ? roofTall : roofLow, b, farBuf);
    addRooftop(tall ? roofTall : roofLow, b);
    if (withStorefronts) addStorefronts(shopGlass, shopSign, b, roads.curbOffset!);
    obstacles.push({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, pts: b.pts });
    minX = Math.min(minX, b.minX);
    maxX = Math.max(maxX, b.maxX);
    minZ = Math.min(minZ, b.minZ);
    maxZ = Math.max(maxZ, b.maxZ);
  }
  if (chunk.buildings.length > 0) {
    // Building LOD: textured per-category meshes nearby, one untextured vertex-coloured mesh far away.
    // Vertices stay in world space; the LOD node sits at the chunk centre so distance is measured
    // from there and its levels are offset back.
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const lod = new THREE.LOD();
    lod.position.set(cx, 0, cz);
    const near = new THREE.Group();
    near.position.set(-cx, 0, -cz);
    const far = new THREE.Group();
    far.position.set(-cx, 0, -cz);
    for (const [key, buf] of wallBufs) {
      const [cat, tall] = key.split('|') as [BuildingWallCategory, string];
      addMesh(buf, mats.walls[cat], { cast: tall === 'T', parent: near });
    }
    addMesh(roofTall, mats.roof, { cast: true, parent: near });
    addMesh(roofLow, mats.roof, { parent: near });
    if (withStorefronts) {
      addMesh(shopGlass, mats.storefrontGlass!, { parent: near });
      addMesh(shopSign, mats.storefrontSign!, { parent: near });
    }
    addMesh(farBuf, mats.farBuildings, { parent: far, countDraw: false });
    lod.addLevel(near, 0);
    lod.addLevel(far, BUILDING_LOD_DISTANCE);
    group.add(lod);
  }

  // --- Roads: merged ribbons + junction discs + yellow centre dashes on arterials
  const road = new GeoBuffer();
  const lines = new GeoBuffer();
  for (const e of roads.edges) {
    const a = roads.nodes[e.a];
    const b = roads.nodes[e.b];
    const y = e.isMajor ? ROAD_Y_MAJOR : ROAD_Y_MINOR;
    addRibbon(road, [[a.x, a.z], [b.x, b.z]], e.width, y, ROAD_UV_SCALE);
    if (e.isMajor && e.dist >= 10) {
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const count = Math.floor((e.dist - 4) / 9);
      for (let i = 0; i < count; i++) {
        const f0 = (i + 0.5) / count - 2 / e.dist;
        const f1 = (i + 0.5) / count + 2 / e.dist;
        addRibbon(lines, [[a.x + dx * f0, a.z + dz * f0], [a.x + dx * f1, a.z + dz * f1]], 0.22, y + 0.012, 0);
      }
    }
  }
  for (const id of roads.discNodeIds) {
    const n = roads.nodes[id];
    const w = roads.nodeMaxWidth[id];
    if (w > 0) addDisc(road, n.x, n.z, w * 0.51, w >= 11 ? ROAD_Y_MAJOR + 0.001 : ROAD_Y_MINOR + 0.001);
  }
  addMesh(road, mats.road, {});
  addMesh(lines, mats.roadLine, { receive: false });

  // --- Ground cover: parks, water bodies, rivers/streams, pedestrian streets
  const park = new GeoBuffer();
  for (const p of chunk.parks) addFlatPolygon(park, p.pts, 0.02, 0.1);
  addMesh(park, mats.park, {});

  const water = new GeoBuffer();
  for (const w of chunk.waters) addFlatPolygon(water, w.pts, 0.015, 0.05);
  for (const wl of chunk.waterLines) addRibbon(water, wl.pts, wl.width, 0.016, 0.05);
  addMesh(water, mats.water, {});

  const plaza = new GeoBuffer();
  for (const pz of chunk.pedestrianPlazas) addRibbon(plaza, pz.pts, pz.width, 0.025, 0.25);
  addMesh(plaza, mats.plaza, {});

  // Static chunk: compute world matrices once, skip the subtree in per-frame scene updates
  freezeStatic(group);

  return {
    group,
    obstacles,
    buildingCount: chunk.buildings.length,
    triangleCount,
    // Near-level draw calls (the far level replaces all building meshes with one)
    drawCalls,
    dispose: () => {
      for (const g of geometries) g.dispose();
      geometries.length = 0;
      group.removeFromParent();
      group.clear();
    },
  };
}
