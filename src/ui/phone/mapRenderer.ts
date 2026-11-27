import { PlayerState } from '../../player/PlayerController';
import { ScooterState } from '../../vehicle/ScooterPhysics';
import { CityMapInfo } from '../../world/CityWorld';
import { NavigationPlan } from '../../delivery/DeliveryManager';
import { SignalStateSnapshot } from '../../world/TrafficSystem';
import { MapViewState } from './mapView';

import type { MapFrame, MapTheme } from './mapFrame';
import { drawAreaOverlays, drawBuildingsAndLandmarks, drawRoads } from './mapBaseLayers';
import { drawMapMarkers } from './mapMarkerLayers';
import { drawRouteLayer, drawSelfMarkers } from './mapRouteLayers';

/** Draws the full 2D GPS city map (north-up when zoomed, heading-up when riding) onto a canvas context */
export function renderMapToContext(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  dpr: number,
  view: MapViewState,
  player: PlayerState,
  scooter: ScooterState,
  navPlan: NavigationPlan,
  signalState: SignalStateSnapshot,
  isNight: boolean,
  elapsedTime: number,
  mapInfo: CityMapInfo,
  rotateHeadingUp: boolean,
): void {
  if (w < 10 || h < 10) return;

  ctx.save();
  ctx.scale(dpr, dpr);

  const theme: MapTheme = isNight
    ? {
        bg: '#111827',
        block: '#1b2534',
        park: '#173429',
        water: '#164e63',
        roadOutline: '#2a374b',
        roadFill: '#243041',
        roadCenter: 'rgba(250, 204, 21, 0.5)',
        bldgShop: '#33292a',
        bldgRes: '#233042',
        bldgPublic: '#283244',
        bldgStroke: 'rgba(148, 163, 184, 0.25)',
        labelText: '#e2e8f0',
      }
    : {
        bg: '#e5e9ef',
        block: '#eef1f5',
        park: '#cdebd2',
        water: '#7dd3fc',
        roadOutline: '#cbd5e1',
        roadFill: '#ffffff',
        roadCenter: 'rgba(234, 179, 8, 0.65)',
        bldgShop: '#fde6cc',
        bldgRes: '#dbeafe',
        bldgPublic: '#e2e8f0',
        bldgStroke: 'rgba(100, 116, 139, 0.35)',
        labelText: '#1e293b',
      };

  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, w, h);

  const effectiveZoom = rotateHeadingUp ? view.navZoomLevel : view.zoomLevel;
  const baseScale = Math.min(w, h) / 285;
  const scale = baseScale * effectiveZoom;
  const centerX = w * 0.5;
  const centerY = rotateHeadingUp ? h * 0.57 : h * 0.36;

  const viewCamX = rotateHeadingUp ? player.x : view.camX;
  const viewCamZ = rotateHeadingUp ? player.z : view.camZ;

  // Apply Heading-Up map rotation while riding in 3D Navigation Mode!
  ctx.save();
  ctx.translate(centerX, centerY);
  if (rotateHeadingUp) {
    ctx.rotate(player.heading);
  }

  const toX = (wx: number) => -(wx - viewCamX) * scale;
  const toY = (wz: number) => -(wz - viewCamZ) * scale;

  // Viewport culling (the unified city has 8,000+ road segments): anything whose bbox misses a square
  // around the camera that covers the whole canvas at any heading-up rotation is skipped
  const viewR = Math.hypot(w, h) / scale;
  const inView = (minX: number, maxX: number, minZ: number, maxZ: number) =>
    maxX >= viewCamX - viewR && minX <= viewCamX + viewR && maxZ >= viewCamZ - viewR && minZ <= viewCamZ + viewR;
  const ptsInView = (pts: ReadonlyArray<[number, number]>) => {
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
    return inView(minX, maxX, minZ, maxZ);
  };
  const frame: MapFrame = {
    ctx,
    w,
    h,
    dpr,
    view,
    player,
    scooter,
    navPlan,
    signalState,
    isNight,
    elapsedTime,
    mapInfo,
    rotateHeadingUp,
    theme,
    effectiveZoom,
    baseScale,
    scale,
    centerX,
    centerY,
    viewCamX,
    viewCamZ,
    toX,
    toY,
    viewR,
    inView,
    ptsInView,
  };
  drawAreaOverlays(frame);

  drawRoads(frame);

  drawBuildingsAndLandmarks(frame);

  drawMapMarkers(frame);

  drawRouteLayer(frame);

  drawSelfMarkers(frame);

  ctx.restore(); // undo translate/rotate
  ctx.restore(); // undo dpr scale
}
