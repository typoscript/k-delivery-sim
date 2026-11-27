/** Pedestrian AI tuning: culling / detail distances, startle & collision radii, crossing and recycling */
export const SIDEWALK_Y = 0.16;
export const ROAD_Y = 0.04;
export const CULL_DISTANCE = 80;
export const CULL_DISTANCE_SQ = CULL_DISTANCE * CULL_DISTANCE;
/** Within this distance pedestrians use the full articulated rig, beyond it the merged far-LOD mesh */
export const PEDESTRIAN_DETAIL_DISTANCE = 32;
export const DETAIL_DISTANCE_SQ = PEDESTRIAN_DETAIL_DISTANCE * PEDESTRIAN_DETAIL_DISTANCE;
export const BLINK_THRESHOLD_SEC = 2.2; // last 2.2s of green = blinking -> 1.5x sprint!
export const BLINK_RUN_MULTIPLIER = 1.5;

// Sidewalk scooter avoidance & pedestrian accident constants
export const PEDESTRIAN_STARTLE_RADIUS = 3.5; // 3.5m proximity flinch & evasive sidestep!
export const PEDESTRIAN_COLLISION_MIN_KMH = 5.0; // >= 5 km/h riding required to count as accident!
export const PEDESTRIAN_SPHERE_RADIUS = 0.42;
export const SCOOTER_SPHERE_RADIUS = 0.72;
export const COLLISION_DIST = PEDESTRIAN_SPHERE_RADIUS + SCOOTER_SPHERE_RADIUS; // 1.14m bounding-sphere contact
export const FALL_RECOVERY_SEC = 6.0;
export const STARTLE_HOLD_SEC = 1.15;
export const EVADE_STEP_DIST = 0.62;
export const STARTLE_MIN_CLOSING_MPS = 1.2; // scooter must be moving TOWARD the pedestrian faster than a walk to be scary
export const STARTLE_RELEASE_RADIUS = PEDESTRIAN_STARTLE_RADIUS + 1.0; // hysteresis: calm down only once clearly away
export const STARTLE_COOLDOWN_SEC = 4.0; // no re-startle right after recovering (walk-around logic handles a parked bike)
export const STARTLE_PANIC_RADIUS = 1.6; // ...unless the scooter charges in this close at speed
export const SIDEWALK_YIELD_SEC = 1.6; // wait this long for a blocker ahead, then walk around it
export const DETOUR_SPEED = 1.1; // m/s sideways drift while walking around a blocker
// Cars: pedestrians never walk into a car body and wait for a gap before crossing a road without a signal
export const PEDESTRIAN_BODY_RADIUS = 0.35;
export const CAR_LOOKAHEAD_M = 0.8; // stop if the next 0.8m of the path is inside a car
export const CAR_CHECK_RANGE_SQ = 12 * 12;
export const CROSS_WAIT_GIVE_UP_SEC = 25;
export const CROSS_LOOK_INTERVAL_SEC = 0.3; // how often a waiting pedestrian re-checks traffic at an unsignalized crossing // a road with no gap for this long -> walk on along the sidewalk instead

// Open-world population streaming: keep the crowd around the player on the 6km unified map
export const PEDESTRIAN_INITIAL_SPAWN_RADIUS = 180; // initial spawns within this radius of the player spawn
export const PEDESTRIAN_RECYCLE_DISTANCE = 220; // hidden agents farther than this get moved near the player
export const PEDESTRIAN_RESPAWN_MIN_RADIUS = 60;
export const PEDESTRIAN_RESPAWN_MAX_RADIUS = 180;
export const RESPAWN_PREFERRED_MIN_RADIUS = CULL_DISTANCE + 6; // prefer popping in just outside the visible range
export const RECYCLE_INTERVAL_SEC = 0.5;
export const MAX_RECYCLES_PER_TICK = 8;
