/**
 * Street props of the open world, built only around the player: roadside trees (가로수) along major roads and utility
 * poles with overhead wires along the alleys. Placements are computed once from the road graph (data only) and
 * bucketed per streaming chunk; each chunk's props become ONE vertex-coloured mesh (one draw call) that the
 * ProximityCuller builds when the player comes within a chunk and disposes again when they leave.
 * Deterministic: positions come from the road graph, variations from a position hash (same street every visit).
 */
import * as THREE from 'three';
import { ColoredPart, mergeColoredParts } from './instancing';
import { excludeFromMirrors, freezeStatic } from './renderLayers';
import { ProximityCuller } from './openworld/ProximityCuller';
import { ChunkGridSpec } from './openworld/OpenWorldTypes';
import { chunkCoordOf, chunkKey } from './openworld/ChunkGrid';
import type { OsmGraphEdge, OsmGraphNode } from '../data/suwonTypes';

export type StreetPropKind = 'tree' | 'pole';

export interface StreetPropPlacement {
  kind: StreetPropKind;
  x: number;
  z: number;
  /** Direction of the road the prop stands along (rad) */
  heading: number;
  /** 0..1 variation (tree size / colour, transformer on a pole) */
  v: number;
  /** For poles: the next pole along the same alley (overhead wires go there) */
  next?: { x: number; z: number };
}

/** Trees every 12 m on both sides of major roads, 1.7 m onto the sidewalk */
const TREE_SPACING_M = 12;
const TREE_CURB_OFFSET_M = 1.7;
/** Poles every 28 m on one side of alleys, at the edge of the road */
const POLE_SPACING_M = 28;
const POLE_CURB_OFFSET_M = 0.5;

function hash01(x: number, z: number, salt: number): number {
  let h =
    (Math.imul(Math.round(x * 10), 73856093) ^ Math.imul(Math.round(z * 10), 19349663) ^ Math.imul(salt, 83492791)) >>>
    0;
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Where the props go: along every road segment, trimmed back from both junctions, skipping spots that fall on
 * another road (`curbOffset` < 0.3 m: crossings, merges). Pure (data only), unit tested.
 */
export function planStreetProps(
  nodes: readonly OsmGraphNode[],
  edges: readonly OsmGraphEdge[],
  nodeMaxWidth: ArrayLike<number>,
  curbOffset: (x: number, z: number) => number,
): StreetPropPlacement[] {
  const out: StreetPropPlacement[] = [];
  for (const e of edges) {
    const a = nodes[e.a];
    const b = nodes[e.b];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const fx = dx / len;
    const fz = dz / len;
    // right = forward x up = (-fz, 0, fx)
    const rx = -fz;
    const rz = fx;
    const heading = Math.atan2(dx, dz);
    const trimA = nodeMaxWidth[e.a] * 0.6 + (a.isSignal ? 12 : 3);
    const trimB = nodeMaxWidth[e.b] * 0.6 + (b.isSignal ? 12 : 3);
    const usable = len - trimA - trimB;
    if (!(usable > 4)) continue;
    const hw = e.width / 2;
    if (e.isMajor && e.width >= 8) {
      const n = Math.ceil(usable / TREE_SPACING_M) + 1;
      for (const side of [-1, 1]) {
        for (let i = 0; i < n; i++) {
          const t = trimA + (n === 1 ? usable / 2 : (i * usable) / (n - 1));
          const off = side * (hw + TREE_CURB_OFFSET_M);
          const x = a.x + fx * t + rx * off;
          const z = a.z + fz * t + rz * off;
          if (curbOffset(x, z) < 0.3) continue;
          out.push({ kind: 'tree', x, z, heading, v: hash01(x, z, 1) });
        }
      }
    } else if (!e.isMajor && e.width < 8 && len >= POLE_SPACING_M) {
      // one side per alley (stable), wires from pole to pole
      const side = hash01(a.x + b.x, a.z + b.z, 2) < 0.5 ? -1 : 1;
      const off = side * (hw + POLE_CURB_OFFSET_M);
      const n = Math.ceil(usable / POLE_SPACING_M) + 1;
      let prev: StreetPropPlacement | null = null;
      for (let i = 0; i < n; i++) {
        const t = trimA + (n === 1 ? usable / 2 : (i * usable) / (n - 1));
        const x = a.x + fx * t + rx * off;
        const z = a.z + fz * t + rz * off;
        if (curbOffset(x, z) < 0.3) {
          prev = null;
          continue;
        }
        const pole: StreetPropPlacement = { kind: 'pole', x, z, heading, v: hash01(x, z, 3) };
        if (prev) prev.next = { x, z };
        out.push(pole);
        prev = pole;
      }
    }
  }
  return out;
}

const TREE_TRUNK = new THREE.CylinderGeometry(0.12, 0.18, 2.6, 6);
const TREE_CANOPY = new THREE.IcosahedronGeometry(1.6, 0);
const POLE = new THREE.CylinderGeometry(0.13, 0.17, 9, 6);
const ARM = new THREE.BoxGeometry(1.6, 0.12, 0.12);
const TRANSFORMER = new THREE.CylinderGeometry(0.32, 0.32, 0.9, 8);
const WIRE = new THREE.BoxGeometry(0.035, 0.035, 1);

const TRUNK_COLOR = new THREE.Color(0x5b4636);
const CANOPY_COLORS = [0x3f7d3a, 0x4a8b3f, 0x356e35, 0x5b9446].map((c) => new THREE.Color(c));
const POLE_COLOR = new THREE.Color(0x9ca3af);
const WIRE_COLOR = new THREE.Color(0x1f2937);

const m4 = (x: number, y: number, z: number, rotY = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY),
    new THREE.Vector3(sx, sy, sz),
  );

/** The meshes' parts of one set of props (world space) */
export function streetPropParts(props: readonly StreetPropPlacement[]): ColoredPart[] {
  const parts: ColoredPart[] = [];
  for (const p of props) {
    if (p.kind === 'tree') {
      const s = 0.85 + p.v * 0.4;
      parts.push({ geometry: TREE_TRUNK, matrix: m4(p.x, 1.3 * s, p.z, 0, s, s, s), color: TRUNK_COLOR });
      parts.push({
        geometry: TREE_CANOPY,
        matrix: m4(p.x, 3.4 * s, p.z, p.v * 6.28, s, s * 0.9, s),
        color: CANOPY_COLORS[Math.floor(p.v * CANOPY_COLORS.length) % CANOPY_COLORS.length],
      });
    } else {
      parts.push({ geometry: POLE, matrix: m4(p.x, 4.5, p.z), color: POLE_COLOR });
      // cross arm across the alley
      parts.push({ geometry: ARM, matrix: m4(p.x, 8.4, p.z, p.heading + Math.PI / 2), color: POLE_COLOR });
      if (p.v < 0.3) parts.push({ geometry: TRANSFORMER, matrix: m4(p.x, 6.6, p.z), color: POLE_COLOR });
      if (p.next) {
        const dx = p.next.x - p.x;
        const dz = p.next.z - p.z;
        const len = Math.hypot(dx, dz);
        const rot = Math.atan2(dx, dz);
        // three wires hanging off the arm, slightly below it
        for (const o of [-0.65, 0, 0.65]) {
          const ox = Math.cos(rot) * o;
          const oz = -Math.sin(rot) * o;
          parts.push({
            geometry: WIRE,
            matrix: m4(p.x + dx / 2 + ox, 8.3 - Math.abs(o) * 0.05, p.z + dz / 2 + oz, rot, 1, 1, len),
            color: WIRE_COLOR,
          });
        }
      }
    }
  }
  return parts;
}

/**
 * Registers each chunk's props with the culler (built within 1 chunk of the player, disposed beyond 2).
 * Returns how many props were planned.
 */
export function registerStreetProps(
  culler: ProximityCuller,
  spec: ChunkGridSpec,
  parent: THREE.Object3D,
  props: readonly StreetPropPlacement[],
): number {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const byChunk = new Map<string, StreetPropPlacement[]>();
  for (const p of props) {
    const c = chunkCoordOf(spec, p.x, p.z);
    const key = chunkKey(c.ix, c.iz);
    const list = byChunk.get(key);
    if (list) list.push(p);
    else byChunk.set(key, [p]);
  }
  for (const list of byChunk.values()) {
    const { x, z } = list[0];
    culler.registerLazy(
      parent,
      x,
      z,
      () => {
        const geometry = mergeColoredParts(streetPropParts(list));
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'street_props';
        excludeFromMirrors(mesh);
        freezeStatic(mesh);
        return { object: mesh, dispose: () => geometry.dispose() };
      },
      1,
      2,
    );
  }
  return props.length;
}
