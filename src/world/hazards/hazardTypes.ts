import * as THREE from 'three';
import { PedestrianRig } from '../PedestrianFactory';
import type { ScooterProximityInfo } from '../PedestrianManager';
import type { SignalStateSnapshot } from '../TrafficSystem';

// Shared unit types, tuning constants and placement rules of the road hazards (RoadHazardManager + hazards/*)

export interface SpeedCameraTriggerEvent {
  cameraId: string;
  label: string;
  kind: 'speeding' | 'red_light' | 'patrol_speeding';
  measuredKmh: number;
  limitKmh: number;
  fine: number;
}

export interface PopOutWarningEvent {
  hazardName: string;
}

export interface OsmAdjEdge {
  to: number;
  dist: number;
  width: number;
  isMajor: boolean;
}

export interface PolicePatrolUnit {
  id: string;
  label: string;
  group: THREE.Group;
  redBarMat: THREE.MeshStandardMaterial;
  blueBarMat: THREE.MeshStandardMaterial;
  fromNode: number;
  toNode: number;
  edgeDist: number;
  edgeWidth: number;
  progress: number;
  x: number;
  z: number;
  heading: number;
  speed: number;
  cruiseSpeed: number;
  sirenTimer: number;
  citeCooldown: number;
  blendX: number;
  blendZ: number;
}

export interface ConstructionZoneUnit {
  id: string;
  label: string;
  x: number;
  z: number;
  strobeMat: THREE.MeshStandardMaterial;
}

export interface RivalRiderUnit {
  id: string;
  group: THREE.Group;
  color: string;
  fromNode: number;
  toNode: number;
  edgeDist: number;
  edgeWidth: number;
  progress: number;
  x: number;
  z: number;
  heading: number;
  speed: number;
  cruiseSpeed: number;
  blendX: number;
  blendZ: number;
}

export interface SpeedCameraUnit {
  id: string;
  label: string;
  x: number;
  z: number;
  axis: 'ns' | 'ew';
  limitKmh: number;
  ledMat: THREE.MeshStandardMaterial;
  flashMat: THREE.MeshBasicMaterial;
  flashTimer: number;
  cooldown: number;
  wasInZone: boolean;
}

export type PopOutState = 'hidden' | 'popping_out' | 'holding' | 'retreating' | 'fallen';

export interface ParkedHazardUnit {
  id: string;
  name: string;
  x: number;
  z: number;
  heading: number;
  isTruck: boolean;
  hazardMat: THREE.MeshStandardMaterial;
  popRig: PedestrianRig;
  popState: PopOutState;
  popStartX: number;
  popStartZ: number;
  popOutX: number;
  popOutZ: number;
  popX: number;
  popZ: number;
  popHeading: number;
  popTimer: number;
  popCooldown: number;
  popFallSide: number;
}

export const SPEED_CAMERA_LIMIT_KMH = 50;
export const SPEED_CAMERA_GRACE_KMH = 2;
export const SPEED_CAMERA_WARN_DIST = 80;
export const SPEED_CAMERA_FINE = 40000;
export const PATROL_ENFORCEMENT_FINE = 50000;
export const PATROL_SPEED_LIMIT_KMH = 60;
export const POPOUT_GLOBAL_COOLDOWN_SEC = 18.0;
export const POPOUT_COLLISION_RADIUS = 1.14;

// --- Open-world scaling ---
/** Road coverage (km^2 of occupied 100m cells) above which a map counts as the large unified open world */
export const LARGE_MAP_COVERAGE_KM2 = 3.0;
/** Moving units (police, rivals) farther than this from the player get respawned near the player */
export const HAZARD_RECYCLE_DISTANCE = 300;
export const HAZARD_RESPAWN_MIN_RADIUS = 120;
export const HAZARD_RESPAWN_MAX_RADIUS = 250;
export const HAZARD_RECYCLE_INTERVAL_SEC = 2.0;
/** Large map only: static props (cameras, parked cars, construction) beyond this are hidden */
export const STATIC_PROP_VISIBLE_DIST = 420;
export const STATIC_VISIBILITY_INTERVAL_SEC = 0.5;

export interface PlacementRule {
  /** Count & minimum spacing on legacy-size (~0.8km) district maps, unchanged from the original game */
  legacyCount: number;
  legacySpacing: number;
  /** Density & spacing on the large unified map */
  perKm2: number;
  largeSpacing: number;
}

export const CAMERA_RULE: PlacementRule = { legacyCount: 6, legacySpacing: 95, perKm2: 1.5, largeSpacing: 320 };
export const PARKED_RULE: PlacementRule = { legacyCount: 6, legacySpacing: 68, perKm2: 3.0, largeSpacing: 160 };
export const CONSTRUCTION_RULE: PlacementRule = { legacyCount: 3, legacySpacing: 110, perKm2: 0.6, largeSpacing: 600 };

/** Underpasses / tunnels / overpasses: no double-parked trucks or road works there */
export const GRADE_SEPARATED_NAME = /지하차도|터널|고가/;

/** Per-frame inputs shared by every hazard kind's step */
export interface HazardFrame {
  /** Clamped frame time (s) */
  dt: number;
  elapsedTime: number;
  scooter: ScooterProximityInfo;
  signalState: SignalStateSnapshot;
  speedKmh: number;
  /** Scooter forward direction */
  scFwdX: number;
  scFwdZ: number;
  /** Shared 3.2Hz hazard / LED blink phase */
  blinkOn: boolean;
}
