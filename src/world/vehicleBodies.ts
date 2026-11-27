import { ObstacleBox } from '../types';

/**
 * Shared geometry for AI vehicle bodies (heading-aligned rectangles), used by:
 * - the scooter / on-foot player collision (exact rotated rectangle obstacles),
 * - AI cars sensing things in their path (player, parked scooter, pedestrians),
 * - pedestrians never walking into a car and waiting for a gap at unsignalized crossings,
 * - pushing anything a car drove into back out of its body.
 * Heading convention: forward = (sin h, cos h), heading 0 = +Z.
 */
export interface VehicleBody {
  x: number;
  z: number;
  heading: number;
  halfLength: number;
  halfWidth: number;
  /** m/s along the heading */
  speed: number;
}

/** Point in the body frame: along = forward distance from the centre, side = distance to the right */
export function toBodyFrame(b: VehicleBody, px: number, pz: number): { along: number; side: number } {
  const fx = Math.sin(b.heading);
  const fz = Math.cos(b.heading);
  const rx = px - b.x;
  const rz = pz - b.z;
  return { along: rx * fx + rz * fz, side: rx * -fz + rz * fx };
}

/** Exact rotated-rectangle obstacle (AABB + polygon) for collidesWithWorld() */
export function vehicleObstacle(b: VehicleBody, pad = 0): ObstacleBox {
  const fx = Math.sin(b.heading);
  const fz = Math.cos(b.heading);
  const rx = -fz;
  const rz = fx;
  const l = b.halfLength + pad;
  const w = b.halfWidth + pad;
  const pts: Array<[number, number]> = [
    [b.x + fx * l + rx * w, b.z + fz * l + rz * w],
    [b.x + fx * l - rx * w, b.z + fz * l - rz * w],
    [b.x - fx * l - rx * w, b.z - fz * l - rz * w],
    [b.x - fx * l + rx * w, b.z - fz * l + rz * w],
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ, pts };
}

/** True if a circle (x, z, radius) overlaps the body rectangle */
export function overlapsBody(b: VehicleBody, x: number, z: number, radius: number): boolean {
  const { along, side } = toBodyFrame(b, x, z);
  const da = Math.max(0, Math.abs(along) - b.halfLength);
  const ds = Math.max(0, Math.abs(side) - b.halfWidth);
  return da * da + ds * ds < radius * radius;
}

/**
 * Gap in metres from the car's front bumper to a circle in its path (its swept lane = body width + radius),
 * or Infinity if the circle is not in front of the car within `range`. A circle touching the bumper gives <= 0.
 */
export function gapAheadOfBody(b: VehicleBody, x: number, z: number, radius: number, range: number): number {
  const { along, side } = toBodyFrame(b, x, z);
  if (Math.abs(side) >= b.halfWidth + radius) return Infinity;
  // Must be ahead of the car's centre (something beside the rear half is not "in the path")
  if (along <= 0) return Infinity;
  const gap = along - b.halfLength - radius;
  return gap < range ? gap : Infinity;
}

/**
 * Sideways shift to the LEFT (toward the centre line, right-hand traffic) that moves the car's swept lane
 * clear of a circle in its path: 0 if the circle is not ahead in the lane. Moving the car left by s turns
 * the circle's right-side offset `side` into `side + s`, so s = needed clearance - side.
 */
export function passShiftFor(b: VehicleBody, x: number, z: number, radius: number, clearance = 0.35): number {
  const { along, side } = toBodyFrame(b, x, z);
  if (along <= 0) return 0;
  const need = b.halfWidth + radius + clearance;
  if (Math.abs(side) >= need) return 0;
  return need - side;
}

/** The body moved sideways to the left by `shift` metres (same heading) */
export function shiftedLeft(b: VehicleBody, shift: number): VehicleBody {
  return { ...b, x: b.x + Math.cos(b.heading) * shift, z: b.z - Math.sin(b.heading) * shift };
}

/**
 * Pushes a circle out of every car body it overlaps (minimum translation along the body's length or width).
 * Returns the corrected position, or null if it was not inside any car.
 */
export function pushOutOfBodies(
  x: number,
  z: number,
  radius: number,
  bodies: readonly VehicleBody[]
): { x: number; z: number } | null {
  let moved = false;
  for (let pass = 0; pass < 2; pass++) {
    let any = false;
    for (const b of bodies) {
      const { along, side } = toBodyFrame(b, x, z);
      const penAlong = b.halfLength + radius - Math.abs(along);
      const penSide = b.halfWidth + radius - Math.abs(side);
      if (penAlong <= 0 || penSide <= 0) continue;
      const fx = Math.sin(b.heading);
      const fz = Math.cos(b.heading);
      const eps = 0.01;
      if (penSide <= penAlong) {
        const s = (side >= 0 ? 1 : -1) * (penSide + eps);
        x += -fz * s;
        z += fx * s;
      } else {
        const s = (along >= 0 ? 1 : -1) * (penAlong + eps);
        x += fx * s;
        z += fz * s;
      }
      any = moved = true;
    }
    if (!any) break;
  }
  return moved ? { x, z } : null;
}

/** Distance from (px, pz) to segment a-b */
function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** Lateral clearance a car body must keep from an unsignalized crossing line for it to count as clear */
export const CROSSING_CLEARANCE_M = 1.2;

/**
 * Gap acceptance for a pedestrian crossing a road without a signal from a to b at `walkSpeed`:
 * clear if no car body is on or next to the crossing now, and no moving car reaches it before the
 * pedestrian is across (straight-line prediction along each car's heading, plus a safety margin).
 */
export function isRoadCrossingClear(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  bodies: readonly VehicleBody[],
  walkSpeed = 1.1,
  marginSec = 1.5
): boolean {
  const crossSec = Math.min(12, Math.hypot(bx - ax, bz - az) / Math.max(0.3, walkSpeed) + marginSec);
  for (const b of bodies) {
    // Cheap reject: too far to matter even at speed
    const reach = b.halfLength + Math.abs(b.speed) * crossSec + 30;
    if (distToSegment(b.x, b.z, ax, az, bx, bz) > reach) continue;
    const fx = Math.sin(b.heading);
    const fz = Math.cos(b.heading);
    const steps = Math.abs(b.speed) < 0.3 ? 0 : Math.ceil(crossSec / 0.25);
    for (let i = 0; i <= steps; i++) {
      const t = i * 0.25;
      const cx = b.x + fx * b.speed * t;
      const cz = b.z + fz * b.speed * t;
      // Body is a rectangle: test its nose, centre and tail points against the crossing line
      for (const off of [b.halfLength, 0, -b.halfLength]) {
        const d = distToSegment(cx + fx * off, cz + fz * off, ax, az, bx, bz);
        if (d < b.halfWidth + CROSSING_CLEARANCE_M) return false;
      }
    }
  }
  return true;
}
