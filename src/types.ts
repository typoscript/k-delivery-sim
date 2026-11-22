export interface ObstacleBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface CityZoneMarker {
  name: string;
  x: number;
  z: number;
  type: 'shop' | 'residential';
}

export interface DeliveryLocation {
  id: string;
  name: string;
  x: number;
  z: number;
  type: 'shop' | 'residential';
  menus?: string[];
  emoji: string;
}

export function wrapAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function collidesWithWorld(
  x: number,
  z: number,
  radius: number,
  obstacles: ObstacleBox[],
  worldLimit = 192
): boolean {
  if (Math.abs(x) > worldLimit - radius || Math.abs(z) > worldLimit - radius) {
    return true;
  }
  for (const box of obstacles) {
    if (
      x + radius > box.minX &&
      x - radius < box.maxX &&
      z + radius > box.minZ &&
      z - radius < box.maxZ
    ) {
      return true;
    }
  }
  return false;
}
