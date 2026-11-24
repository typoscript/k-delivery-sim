export const CITY_ROAD_LINES = [-200, -120, -40, 40, 120, 200] as const;
export const CITY_BLOCK_CENTERS = [-160, -80, 0, 80, 160] as const;
export const CITY_WORLD_LIMIT = 285;

export type WeatherMode = 'clear' | 'cloudy' | 'rain';
export type SlipSurfaceType = 'none' | 'manhole' | 'crosswalk_paint';
export type ResidenceKind = 'apartment' | 'walkup_villa' | 'officetel';
export type FoodTempType = 'hot' | 'cold';

export interface SpeedBumpInfo {
  id: string;
  x: number;
  z: number;
  axis: 'ew' | 'ns'; // 'ew' spans road along X (bar along Z), 'ns' spans road along Z (bar along X)
  halfLength: number; // half width across road (~6.4m)
  halfWidth: number; // half depth along travel direction (~1.15m)
  label: string;
}

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
  residenceKind?: ResidenceKind;
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

export interface SpeedCameraMarker {
  id: string;
  x: number;
  z: number;
  limitKmh: number;
}

export interface PolicePatrolMarker {
  id: string;
  x: number;
  z: number;
  heading: number;
  sirenActive: boolean;
}

export interface ConstructionZoneMarker {
  id: string;
  x: number;
  z: number;
  label: string;
}

export interface RivalRiderMarker {
  id: string;
  x: number;
  z: number;
  heading: number;
  color: string;
}

export type GraphicsQuality = 'high' | 'medium' | 'low';

export interface GameSettings {
  masterVolume: number; // 0..1
  voiceNaviEnabled: boolean;
  mouseSensitivity: number; // 0.5..2.0
  graphicsQuality: GraphicsQuality;
}

export interface UpcomingCameraAlert {
  cameraId: string;
  label: string;
  distanceMeters: number;
  limitKmh: number;
  isOverSpeed: boolean;
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
