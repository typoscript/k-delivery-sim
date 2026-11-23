export const CITY_ROAD_LINES = [-200, -120, -40, 40, 120, 200] as const;
export const CITY_BLOCK_CENTERS = [-160, -80, 0, 80, 160] as const;
export const CITY_WORLD_LIMIT = 285;

export type WeatherMode = 'clear' | 'cloudy' | 'rain';
export type SlipSurfaceType = 'none' | 'manhole' | 'crosswalk_paint';

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
  facesNorth?: boolean;
}

export interface BusStopPoint {
  name: string;
  x: number; // stop point along road or bus bay center
  z: number;
  shelterX: number;
  shelterZ: number;
  dir: 0 | 1 | 2 | 3; // CardinalDir of bus stopping here (1 = +X East, 3 = -X West, etc.)
  roadIndex: number; // index into CITY_ROAD_LINES
}

export interface ServiceStationInfo {
  name: string;
  kind: 'gas' | 'repair';
  padMinX: number;
  padMaxX: number;
  padMinZ: number;
  padMaxZ: number;
  interactX: number;
  interactZ: number;
  interactRadius: number;
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
  worldLimit = CITY_WORLD_LIMIT
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
