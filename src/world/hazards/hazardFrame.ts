/** Per-frame hazards: cameras, parked cars, patrols, construction, rivals, recycling and prop culling */
import type { RoadHazardManager } from '../RoadHazardManager';
import { SignalStateSnapshot } from '../TrafficSystem';
import { PedestrianCollisionEvent, ScooterProximityInfo } from '../PedestrianManager';
import { stepSpeedCameras } from './speedCameras';
import { stepParkedHazards } from './parkedHazards';
import { stepPolicePatrols } from './policePatrols';
import { stepConstructionZones } from './constructionZones';
import { stepRivalRiders } from './rivalRiders';
import {
  HAZARD_RECYCLE_INTERVAL_SEC,
  HazardFrame,
  PopOutWarningEvent,
  STATIC_VISIBILITY_INTERVAL_SEC,
  SpeedCameraTriggerEvent,
} from './hazardTypes';

export function step(
  host: RoadHazardManager,
  dt: number,
  elapsedTime: number,
  inCorridor: boolean,
  scooter: ScooterProximityInfo,
  signalState: SignalStateSnapshot,
  onSpeedCameraTriggered?: (ev: SpeedCameraTriggerEvent) => void,
  onPopOutWarning?: (ev: PopOutWarningEvent) => void,
  onPopOutPedestrianHit?: (ev: PedestrianCollisionEvent) => void,
  onCameraApproachBeep?: (isOverSpeed: boolean) => void,
  onPolicePatrolCite?: (ev: SpeedCameraTriggerEvent) => void,
  /** On-foot player position (defaults to the scooter); moving units / prop culling follow it */ playerPos?: {
    x: number;
    z: number;
  },
): void {
  if (inCorridor) {
    host.upcomingCamera = null;
    return;
  }

  const clampedDt = Math.min(dt, 0.05);
  const playerX = playerPos?.x ?? scooter.x;
  const playerZ = playerPos?.z ?? scooter.z;

  // Open world: keep police / rivals around the player and hide far-away static props
  host.recycleTimer += clampedDt;
  if (host.recycleTimer >= HAZARD_RECYCLE_INTERVAL_SEC) {
    host.recycleTimer = 0;
    host.recycleMovingUnits(playerX, playerZ);
  }
  if (host.staticProps.length > 0) {
    host.staticVisTimer += clampedDt;
    if (host.staticVisTimer >= STATIC_VISIBILITY_INTERVAL_SEC) {
      host.staticVisTimer = 0;
      host.updateStaticPropVisibility(playerX, playerZ);
    }
  }
  const speedKmh = Math.abs(scooter.speedMps) * 3.6;
  const scFwdX = Math.sin(scooter.heading);
  const scFwdZ = Math.cos(scooter.heading);
  const blinkOn = Math.floor(elapsedTime * 3.2) % 2 === 0;
  const frame: HazardFrame = {
    dt: clampedDt,
    elapsedTime,
    scooter,
    signalState,
    speedKmh,
    scFwdX,
    scFwdZ,
    blinkOn,
  };
  stepSpeedCameras(host, frame, onSpeedCameraTriggered, onCameraApproachBeep);
  stepPolicePatrols(host, frame, onPolicePatrolCite);
  stepConstructionZones(host, frame);
  stepRivalRiders(host, frame);
  stepParkedHazards(host, frame, onPopOutWarning, onPopOutPedestrianHit);
}
