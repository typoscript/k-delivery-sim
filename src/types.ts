import type { NotificationPrefs } from './ui/phone/notificationPrefs';
import { ACTIVE_MAP_DATA } from './data/suwonDistricts';
export const CITY_ROAD_LINES = [-200, -120, -40, 40, 120, 200] as const;
export const CITY_BLOCK_CENTERS = [-160, -80, 0, 80, 160] as const;
/** Square half-extent of the drivable world (410m per legacy district, ~3.1km for the unified Suwon map) */
export const CITY_WORLD_LIMIT = ACTIVE_MAP_DATA.meta.worldLimit;

export type WeatherMode = 'clear' | 'cloudy' | 'rain' | 'snow';
export type SlipSurfaceType = 'none' | 'manhole' | 'crosswalk_paint';
/** 'riverside': a customer waiting on a stream walkway bench (산책로 쉼터) - walk in, hand the food over */
export type ResidenceKind = 'apartment' | 'walkup_villa' | 'officetel' | 'riverside';
export type FoodTempType = 'hot' | 'cold';

export interface SpeedBumpInfo {
  id: string;
  x: number;
  z: number;
  axis: 'ew' | 'ns';
  angle?: number; // road travel heading in radians (0 = +Z)
  halfLength: number; // half width across road
  halfWidth: number; // half depth along travel direction
  label: string;
}

export interface ObstacleBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  pts?: Array<[number, number]>; // Optional exact 2D footprint polygon for rotated/L-shaped OSM buildings!
}

export interface CityZoneMarker {
  name: string;
  x: number;
  z: number;
  type: 'shop' | 'residential';
}

export interface LandmarkMarker {
  name: string;
  shortLabel: string;
  icon: string;
  x: number;
  z: number;
  color: string;
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
  facingHeading?: number;
}

export interface BusStopPoint {
  name: string;
  x: number; // stop point along road
  z: number;
  shelterX: number;
  shelterZ: number;
  facingHeading: number;
  edgeIndex: number;
}

export interface ServiceStationInfo {
  name: string;
  kind: 'gas' | 'repair' | 'convenience';
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
  /** Road graph nodes of the narrowed segment (route planning detours around it) */
  edgeA: number;
  edgeB: number;
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
  /** Background loops (rain, wind on bridges, running water, elevator hum) on top of the master volume, 0..1 */
  ambienceVolume: number;
  voiceNaviEnabled: boolean;
  mouseSensitivity: number; // 0.5..2.0
  graphicsQuality: GraphicsQuality;
  /** Dynamic resolution: lower the render resolution automatically when the GPU can't keep 60fps */
  autoResolution: boolean;
  /** Power saving: 30fps while idle / in menus, 60fps as soon as the player acts */
  powerSaving: boolean;
  /** Phone notifications: categories on / off and 방해 금지 while riding */
  notifications: NotificationPrefs;
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

function circleIntersectsPolygon(
  cx: number,
  cz: number,
  radius: number,
  pts: Array<[number, number]>
): boolean {
  const n = pts.length;
  if (n < 3) return false;
  const rSq = radius * radius;

  // 1. Point-in-polygon (ray casting)
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i][0];
    const zi = pts[i][1];
    const xj = pts[j][0];
    const zj = pts[j][1];
    if ((zi > cz) !== (zj > cz) && cx < ((xj - xi) * (cz - zi)) / (zj - zi + 1e-12) + xi) {
      inside = !inside;
    }

    // 2. Circle-vs-segment distance check along each polygon edge
    const vx = xj - xi;
    const vz = zj - zi;
    const lenSq = vx * vx + vz * vz;
    let t = lenSq > 1e-6 ? ((cx - xi) * vx + (cz - zi) * vz) / lenSq : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const px = xi + vx * t;
    const pz = zi + vz * t;
    const dx = cx - px;
    const dz = cz - pz;
    if (dx * dx + dz * dz < rSq) {
      return true;
    }
  }
  return inside;
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
      if (!box.pts) return true;
      if (circleIntersectsPolygon(x, z, radius, box.pts)) {
        return true;
      }
    }
  }
  return false;
}
