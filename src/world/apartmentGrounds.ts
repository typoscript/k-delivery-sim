/**
 * Apartment complex details beside an apartment lobby: a guard booth with a red / white barrier arm on one side and
 * a row of parked cars on the other. Built with the lobby prop (near the player only) as ONE vertex-coloured mesh.
 * Spots that would sit on a road or inside a building are skipped (`isFree`), so it adapts to each lobby.
 * Deterministic: car colours / count from a hash of the lobby id.
 */
import * as THREE from 'three';
import { ColoredPart, mergeColoredParts } from './instancing';
import type { ObstacleBox } from '../types';

/** Lobby-local (x right along the facade, z toward the road) -> world */
export type LocalToWorld = (lx: number, lz: number) => { x: number; z: number };

const BOX = new THREE.BoxGeometry(1, 1, 1);
const WHEEL = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 10).rotateZ(Math.PI / 2);

const CAR_COLORS = [0xf8fafc, 0x1f2937, 0x9ca3af, 0x64748b, 0x1e3a8a, 0x7f1d1d, 0xe5e7eb, 0x0f172a].map(
  (c) => new THREE.Color(c),
);
const GLASS = new THREE.Color(0x1e293b);
const TIRE = new THREE.Color(0x111827);
const BOOTH = new THREE.Color(0xe2e8f0);
const BOOTH_ROOF = new THREE.Color(0x475569);
const STRIPE_RED = new THREE.Color(0xdc2626);
const STRIPE_WHITE = new THREE.Color(0xf8fafc);

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const local = (x: number, y: number, z: number, sx: number, sy: number, sz: number, rotY = 0) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY),
    new THREE.Vector3(sx, sy, sz),
  );

/** A parked car along the facade, centred at local (x, z), length along x */
function carParts(x: number, z: number, color: THREE.Color): ColoredPart[] {
  const parts: ColoredPart[] = [
    { geometry: BOX, matrix: local(x, 0.62, z, 4.3, 0.7, 1.8), color },
    { geometry: BOX, matrix: local(x - 0.25, 1.18, z, 2.3, 0.5, 1.6), color: GLASS },
  ];
  for (const wx of [-1.4, 1.4])
    for (const wz of [-0.78, 0.78])
      parts.push({ geometry: WHEEL, matrix: local(x + wx, 0.33, z + wz, 1, 1, 1), color: TIRE });
  return parts;
}

export interface ApartmentGroundsPlan {
  cars: number;
  gate: boolean;
  parts: ColoredPart[];
  /** World-space colliders of the parked cars and the guard booth (the barrier arm lifts, so it has none) */
  obstacles: ObstacleBox[];
}

/** Rotated rectangle (lobby-local centre / half sizes) as a world-space collider */
function footprint(toWorld: LocalToWorld, cx: number, cz: number, hx: number, hz: number): ObstacleBox {
  const pts = (
    [
      [cx - hx, cz - hz],
      [cx + hx, cz - hz],
      [cx + hx, cz + hz],
      [cx - hx, cz + hz],
    ] as const
  ).map(([lx, lz]) => {
    const w = toWorld(lx, lz);
    return [w.x, w.z] as [number, number];
  });
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), pts };
}

/**
 * Parts in lobby-local space. Cars go in a row to the lobby's left (-x), the gate to its right (+x); every footprint
 * is checked (corners and centre) with `isFree` in world space first.
 */
export function planApartmentGrounds(
  id: string,
  toWorld: LocalToWorld,
  isFree: (x: number, z: number) => boolean | null,
): ApartmentGroundsPlan | null {
  const h = hashString(id);
  const parts: ColoredPart[] = [];
  const obstacles: ObstacleBox[] = [];
  let unknown = false;
  const fits = (cx: number, cz: number, hx: number, hz: number) =>
    [
      [cx, cz],
      [cx - hx, cz - hz],
      [cx + hx, cz - hz],
      [cx - hx, cz + hz],
      [cx + hx, cz + hz],
    ].every(([lx, lz]) => {
      const w = toWorld(lx, lz);
      const free = isFree(w.x, w.z);
      if (free === null) unknown = true;
      return free === true;
    });
  // parked cars: 2~4 in a row inside the complex (behind the lobby line), starting 3 m left of the lobby
  const want = 2 + (h % 3);
  let cars = 0;
  for (let i = 0; i < want; i++) {
    const cx = -(3 + 2.4 + i * 5);
    const cz = -3.6;
    if (!fits(cx, cz, 2.3, 1)) break;
    parts.push(...carParts(cx, cz, CAR_COLORS[(h >>> (i * 3)) % CAR_COLORS.length]));
    obstacles.push(footprint(toWorld, cx, cz, 2.15, 0.9));
    cars++;
  }
  // guard booth + barrier arm across a driveway to the right of the lobby
  // (lobby-local z < 0 is inside the complex: the lobby stands on the street edge of it)
  const gate = fits(5.2, -1.8, 1.1, 1.1) && fits(8.6, -1.0, 2.2, 0.3);
  if (gate) {
    obstacles.push(footprint(toWorld, 5.2, -1.8, 0.95, 0.95));
    parts.push({ geometry: BOX, matrix: local(5.2, 1.15, -1.8, 1.9, 2.3, 1.9), color: BOOTH });
    parts.push({ geometry: BOX, matrix: local(5.2, 1.5, -0.84, 1.3, 0.8, 0.04), color: GLASS }); // window to the street
    parts.push({ geometry: BOX, matrix: local(5.2, 2.4, -1.8, 2.2, 0.18, 2.2), color: BOOTH_ROOF });
    parts.push({ geometry: BOX, matrix: local(6.35, 0.5, -1.0, 0.3, 1.0, 0.3), color: BOOTH_ROOF }); // arm post
    for (let s = 0; s < 5; s++) {
      parts.push({
        geometry: BOX,
        matrix: local(6.65 + s * 0.8, 1.0, -1.0, 0.8, 0.09, 0.09),
        color: s % 2 === 0 ? STRIPE_RED : STRIPE_WHITE,
      });
    }
  }
  // some spot is in a chunk that has not loaded yet: decide later
  if (unknown) return null;
  return { cars, gate, parts, obstacles };
}

/**
 * The merged mesh (lobby-local space, null when nothing fit) and its world colliders; 'wait' while a spot's chunk
 * is not loaded yet
 */
export function buildApartmentGrounds(
  id: string,
  toWorld: LocalToWorld,
  isFree: (x: number, z: number) => boolean | null,
  material: THREE.Material,
): { mesh: THREE.Mesh | null; obstacles: ObstacleBox[] } | 'wait' {
  const plan = planApartmentGrounds(id, toWorld, isFree);
  if (!plan) return 'wait';
  if (plan.parts.length === 0) return { mesh: null, obstacles: [] };
  const mesh = new THREE.Mesh(mergeColoredParts(plan.parts), material);
  mesh.name = 'apartment_grounds';
  return { mesh, obstacles: plan.obstacles };
}
