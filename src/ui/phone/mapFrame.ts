/** Shared per-draw state for the phone map layers (see mapRenderer) */
import { PlayerState } from '../../player/PlayerController';
import { ScooterState } from '../../vehicle/ScooterPhysics';
import { CityMapInfo } from '../../world/CityWorld';
import { NavigationPlan } from '../../delivery/DeliveryManager';
import { SignalStateSnapshot } from '../../world/TrafficSystem';
import { MapViewState } from './mapView';

export type MapTheme = Record<
  | 'bg'
  | 'block'
  | 'park'
  | 'water'
  | 'roadOutline'
  | 'roadFill'
  | 'roadCenter'
  | 'bldgShop'
  | 'bldgRes'
  | 'bldgPublic'
  | 'bldgStroke'
  | 'labelText',
  string
>;

/** Everything the map layers share for one draw: inputs, colours, scale and the world -> canvas helpers */
export interface MapFrame {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  dpr: number;
  view: MapViewState;
  player: PlayerState;
  scooter: ScooterState;
  navPlan: NavigationPlan;
  signalState: SignalStateSnapshot;
  isNight: boolean;
  elapsedTime: number;
  mapInfo: CityMapInfo;
  rotateHeadingUp: boolean;
  theme: MapTheme;
  effectiveZoom: number;
  baseScale: number;
  scale: number;
  centerX: number;
  centerY: number;
  viewCamX: number;
  viewCamZ: number;
  toX: (wx: number) => number;
  toY: (wz: number) => number;
  viewR: number;
  inView: (minX: number, maxX: number, minZ: number, maxZ: number) => boolean;
  ptsInView: (pts: ReadonlyArray<[number, number]>) => boolean;
}
