import { PlayerState } from '../../player/PlayerController';
import { clamp } from '../../types';
import { ACTIVE_MAP_DATA } from '../../data/suwonDistricts';

/** Mutable GPS map camera / pan-drag state shared between input handlers and the map renderer. */
export interface MapViewState {
  followPlayer: boolean;
  zoomLevel: number;
  camX: number;
  camZ: number;
  isMapDragging: boolean;
  dragPointerId: number | null;
  dragLastX: number;
  dragLastY: number;
  panVelX: number;
  panVelZ: number;
}

export function createMapViewState(): MapViewState {
  return {
    followPlayer: true,
    zoomLevel: 1.4,
    camX: ACTIVE_MAP_DATA.meta.playerSpawn.x,
    camZ: ACTIVE_MAP_DATA.meta.playerSpawn.z,
    isMapDragging: false,
    dragPointerId: null,
    dragLastX: 0,
    dragLastY: 0,
    panVelX: 0,
    panVelZ: 0,
  };
}

/** Wires the zoomed GPS map [+] / [-] / follow buttons */
export function setupMapZoomButtons(
  zoomInBtn: HTMLElement,
  zoomOutBtn: HTMLElement,
  followBtn: HTMLElement,
  view: MapViewState
): void {
  zoomInBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    view.zoomLevel = clamp(view.zoomLevel + 0.32, 0.42, 3.2);
  });

  zoomOutBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    view.zoomLevel = clamp(view.zoomLevel - 0.32, 0.42, 3.2);
  });

  followBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    view.panVelX = 0;
    view.panVelZ = 0;
    if (!view.followPlayer) {
      // Snap right back to live player position after free-panning the map!
      view.followPlayer = true;
      followBtn.classList.add('active');
      if (view.zoomLevel < 0.9) view.zoomLevel = 1.4;
    } else {
      // Already following: toggle between close street view & wide city overview
      view.zoomLevel = view.zoomLevel > 0.95 ? 0.56 : 1.45;
    }
  });
}

/** Enables free touch/mouse press-and-drag panning + wheel zoom on the zoomed smartphone GPS map */
export function setupMapPanAndZoom(
  zoomCanvas: HTMLCanvasElement,
  followBtn: HTMLElement,
  touchHandEl: HTMLElement,
  view: MapViewState,
  isZoomed: () => boolean
): void {
  const getMapScale = (): number => {
    const rect = zoomCanvas.getBoundingClientRect();
    const baseScale = Math.min(rect.width, rect.height) / 285;
    return Math.max(0.15, baseScale * view.zoomLevel);
  };

  zoomCanvas.addEventListener('pointerdown', (e) => {
    if (!isZoomed() || e.button !== 0) return;
    view.isMapDragging = true;
    view.dragPointerId = e.pointerId;
    view.dragLastX = e.clientX;
    view.dragLastY = e.clientY;
    view.panVelX = 0;
    view.panVelZ = 0;
    zoomCanvas.classList.add('dragging');
    try {
      zoomCanvas.setPointerCapture(e.pointerId);
    } catch {
      // ignore if synthetic pointer
    }
  });

  zoomCanvas.addEventListener('pointermove', (e) => {
    if (!view.isMapDragging || e.pointerId !== view.dragPointerId) return;
    e.stopPropagation();

    const dx = e.clientX - view.dragLastX;
    const dy = e.clientY - view.dragLastY;
    if (Math.abs(dx) < 0.25 && Math.abs(dy) < 0.25) return;

    view.dragLastX = e.clientX;
    view.dragLastY = e.clientY;

    // Disengage player lock as soon as the user drags the map!
    if (view.followPlayer) {
      view.followPlayer = false;
      followBtn.classList.remove('active');
    }

    const scale = getMapScale();
    const lim = ACTIVE_MAP_DATA.meta.worldLimit;
    const worldDx = dx / scale;
    const worldDz = dy / scale;
    view.camX = clamp(view.camX + worldDx, -lim, lim);
    view.camZ = clamp(view.camZ + worldDz, -lim, lim);

    // Track smooth flick inertia
    view.panVelX = worldDx * 0.72;
    view.panVelZ = worldDz * 0.72;

    // Keep 1st-person touching finger pressed onto glass while panning
    touchHandEl.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
    touchHandEl.classList.add('active', 'tapping');
  });

  const endDrag = (e: PointerEvent) => {
    if (!view.isMapDragging || (view.dragPointerId !== null && e.pointerId !== view.dragPointerId)) {
      return;
    }
    view.isMapDragging = false;
    view.dragPointerId = null;
    zoomCanvas.classList.remove('dragging');
    touchHandEl.classList.remove('tapping');
    try {
      if (zoomCanvas.hasPointerCapture(e.pointerId)) {
        zoomCanvas.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore
    }
  };

  zoomCanvas.addEventListener('pointerup', endDrag);
  zoomCanvas.addEventListener('pointercancel', endDrag);

  // Smooth mouse-wheel / trackpad zoom right on the smartphone map!
  zoomCanvas.addEventListener(
    'wheel',
    (e) => {
      if (!isZoomed()) return;
      e.preventDefault();
      e.stopPropagation();
      const factor = e.deltaY < 0 ? 1.14 : 1 / 1.14;
      view.zoomLevel = clamp(view.zoomLevel * factor, 0.42, 3.2);
    },
    { passive: false }
  );
}

/** Per-frame camera follow / flick-inertia step for the GPS map */
export function stepMapCamera(view: MapViewState, player: PlayerState, isZoomed: boolean): void {
  if (view.followPlayer || !isZoomed) {
    view.camX += (player.x - view.camX) * 0.16;
    view.camZ += (player.z - view.camZ) * 0.16;
    view.panVelX = 0;
    view.panVelZ = 0;
  } else if (!view.isMapDragging) {
    // Smooth flick inertia glide when releasing a map drag
    if (Math.abs(view.panVelX) > 0.04 || Math.abs(view.panVelZ) > 0.04) {
      const lim = ACTIVE_MAP_DATA.meta.worldLimit;
      view.camX = clamp(view.camX + view.panVelX, -lim, lim);
      view.camZ = clamp(view.camZ + view.panVelZ, -lim, lim);
      view.panVelX *= 0.86;
      view.panVelZ *= 0.86;
    } else {
      view.panVelX = 0;
      view.panVelZ = 0;
    }
  }
}
