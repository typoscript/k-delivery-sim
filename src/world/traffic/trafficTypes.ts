/** Traffic AI shared types and tuning constants */
import type { VehicleDriveState } from '../TrafficSystem';

export interface OsmAdjEdge {
  to: number;
  dist: number;
  width: number;
  isMajor: boolean;
}

export interface AiVehicle {
  /** Index into the instanced fleet renderer (car or bus list) */
  renderIndex: number;
  wheelSpin: number;
  hazardOn: boolean;
  isBus: boolean;
  isTaxi: boolean;
  driveState: VehicleDriveState;
  fromNode: number;
  toNode: number;
  edgeDist: number;
  edgeWidth: number;
  progress: number; // 0..edgeDist along edge
  x: number;
  z: number;
  heading: number;
  speed: number;
  cruiseSpeed: number;
  braking: boolean;
  busStopWaitTimer: number;
  busStopCooldown: number;
  playerCutInActive: boolean;
  hornCooldown: number;
  colorHex: string;
  halfWidth: number;
  halfLength: number;
  /** Next edge pre-picked on approach so short follow-on edges into a signal can be braked for early */
  nextEdge: OsmAdjEdge | null;
  /** Lateral lane-offset jump at the last node, blended out over distance travelled (no teleport at turns) */
  blendX: number;
  blendZ: number;
  /** Cross-traffic deadlock breaker state */
  stuckTimer: number;
  blockedBy: number;
  ignoreIdx: number;
  ignoreTimer: number;
  /** Going around a scooter left standing in our lane: current / target left shift (m) and the obstacle */
  passOffset: number;
  passTarget: number;
  passWait: number;
  passObsX: number;
  passObsZ: number;
}

/** Squares (half-size = halfWidth) along the body axis that the AI forward ray tests against */
export const CAR_SEGMENTS = [-1.19, 0, 1.19];
export const BUS_SEGMENTS = [-3.1, -1.55, 0, 1.55, 3.1];
export const STUCK_YIELD_SEC = 2.0;
export const IGNORE_BLOCKER_SEC = 3.0;
export const PLAYER_COLLISION_PAD = 0.6;
/** Sensing radii for things in a car's path: scooter (riding or parked), walking player, pedestrian + margin */
export const PLAYER_RIDING_RADIUS = 0.9;
export const PLAYER_WALK_RADIUS = 0.6;
export const PEDESTRIAN_YIELD_RADIUS = 0.9;
export const SIGNAL_LOOKAHEAD = 32;
/** Wait this long behind a scooter standing in the lane, then go around it on the left */
export const PASS_WAIT_SEC = 3.0;
export const MAX_PASS_SHIFT = 3.6;
export const PASS_SHIFT_SPEED = 1.4; // m/s sideways while pulling out / back in
export const PASS_SPEED_CAP = 4.0; // m/s while squeezing past

export const CYCLE_DURATION = 18.0;
export const FRONT_RAY_RANGE = 12.5;
export const SAFE_FOLLOW_GAP = 5.2;
export const ACTIVE_SPAWN_RADIUS = 165.0;
