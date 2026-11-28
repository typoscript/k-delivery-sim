/**
 * Apartment complex details beside an apartment lobby: a guard booth with a guard and a red / white barrier arm on
 * one side and a row of parked cars on the other. Built near the player only as ONE vertex-coloured mesh plus the
 * barrier arm (its own small mesh, it lifts when the rider rides up).
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
const GUARD_UNIFORM = new THREE.Color(0x1e3a5f);
const GUARD_SKIN = new THREE.Color(0xe0ac7e);
const GUARD_VEST = new THREE.Color(0xfacc15);
const SIGN_RED = new THREE.Color(0xdc2626);

/** Barrier arm pivot (top of its post), lobby-local; the arm reaches +x from it and lifts by turning about z */
export const GATE_ARM_PIVOT = { x: 6.35, y: 1.0, z: -1.0 } as const;
/** Lobby-local spot where the guard stands, beside the barrier post facing the street */
export const GUARD_SPOT = { x: 5.85, z: -0.35 } as const;

/** A guard in a navy uniform with a yellow safety vest and cap, standing at local (x, z) facing +z (the street) */
function guardParts(x: number, z: number): ColoredPart[] {
  return [
    { geometry: BOX, matrix: local(x, 0.43, z, 0.34, 0.86, 0.22), color: GUARD_UNIFORM }, // legs
    { geometry: BOX, matrix: local(x, 1.15, z, 0.46, 0.6, 0.26), color: GUARD_UNIFORM }, // torso
    { geometry: BOX, matrix: local(x, 1.2, z + 0.01, 0.48, 0.34, 0.27), color: GUARD_VEST }, // vest
    { geometry: BOX, matrix: local(x, 1.6, z, 0.24, 0.26, 0.24), color: GUARD_SKIN }, // head
    { geometry: BOX, matrix: local(x, 1.76, z + 0.03, 0.28, 0.08, 0.32), color: GUARD_UNIFORM }, // cap
  ];
}

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
  /** Barrier arm parts around GATE_ARM_PIVOT (empty without a gate): a separate mesh so it can lift */
  armParts: ColoredPart[];
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
  /** 지상 차량 출입 금지 complex: a no-entry sign on the booth */
  noEntry = false,
): ApartmentGroundsPlan | null {
  const h = hashString(id);
  const parts: ColoredPart[] = [];
  const armParts: ColoredPart[] = [];
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
    parts.push(...guardParts(GUARD_SPOT.x, GUARD_SPOT.z));
    if (noEntry) {
      // "지상 차량 출입 금지": red no-entry plate with a white bar on the booth roof, facing the street
      parts.push({ geometry: BOX, matrix: local(5.2, 2.95, -0.86, 0.78, 0.78, 0.05), color: SIGN_RED });
      parts.push({ geometry: BOX, matrix: local(5.2, 2.95, -0.82, 0.56, 0.14, 0.04), color: STRIPE_WHITE });
      parts.push({ geometry: BOX, matrix: local(5.2, 2.5, -0.9, 0.08, 0.3, 0.08), color: BOOTH_ROOF });
    }
    for (let s = 0; s < 5; s++) {
      armParts.push({
        geometry: BOX,
        matrix: local(0.3 + s * 0.8, 0, 0, 0.8, 0.09, 0.09),
        color: s % 2 === 0 ? STRIPE_RED : STRIPE_WHITE,
      });
    }
  }
  // some spot is in a chunk that has not loaded yet: decide later
  if (unknown) return null;
  return { cars, gate, parts, armParts, obstacles };
}

export interface ApartmentGroundsBuild {
  mesh: THREE.Mesh | null;
  /** Barrier arm (lobby-local, positioned at its pivot; lift with rotation.z), null without a gate */
  arm: THREE.Mesh | null;
  obstacles: ObstacleBox[];
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
  noEntry = false,
): ApartmentGroundsBuild | 'wait' {
  const plan = planApartmentGrounds(id, toWorld, isFree, noEntry);
  if (!plan) return 'wait';
  if (plan.parts.length === 0) return { mesh: null, arm: null, obstacles: [] };
  const mesh = new THREE.Mesh(mergeColoredParts(plan.parts), material);
  mesh.name = 'apartment_grounds';
  let arm: THREE.Mesh | null = null;
  if (plan.armParts.length > 0) {
    arm = new THREE.Mesh(mergeColoredParts(plan.armParts), material);
    arm.name = 'apartment_gate_arm';
    arm.position.set(GATE_ARM_PIVOT.x, GATE_ARM_PIVOT.y, GATE_ARM_PIVOT.z);
  }
  return { mesh, arm, obstacles: plan.obstacles };
}

/** Rider on the scooter within this many metres of the guard: the barrier lifts (or the guard waves them off) */
export const GATE_TRIGGER_M = 11;
/** Farther than this the barrier lowers again and the guard speaks again next time */
export const GATE_RESET_M = 20;
/** Barrier arm fully up (radians about its pivot) */
export const GATE_ARM_UP = 1.35;

/** Live state of one gate: lift 0 (down) .. 1 (up) */
export interface GateState {
  noEntry: boolean;
  lift: number;
  open: boolean;
  spoke: boolean;
}

/**
 * One frame of a gate: riding up to the guard opens it ('welcome') - at a 지상 차량 출입 금지 complex it stays down
 * ('blocked'); the guard speaks once per approach. Moving away lowers it again. Returns what the guard said, if anything.
 */
export function stepGate(g: GateState, dist: number, riding: boolean, dt: number): 'welcome' | 'blocked' | null {
  let said: 'welcome' | 'blocked' | null = null;
  if (riding && dist < GATE_TRIGGER_M && !g.spoke) {
    g.spoke = true;
    g.open = !g.noEntry;
    said = g.noEntry ? 'blocked' : 'welcome';
  } else if (dist > GATE_RESET_M) {
    g.spoke = false;
    g.open = false;
  }
  const target = g.open ? 1 : 0;
  if (g.lift !== target) g.lift = target > g.lift ? Math.min(1, g.lift + dt * 0.9) : Math.max(0, g.lift - dt * 0.9);
  return said;
}
