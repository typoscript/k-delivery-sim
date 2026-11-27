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
    if (!wb) wallBufs.set(key, (wb = new GeoBuffer()));
    farBuf.color.copy(FAR_WALL_COLORS[cat]);
    addBuilding(wb, tall ? roofTall : roofLow, b, farBuf);
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
