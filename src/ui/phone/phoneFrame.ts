/** Per-frame phone sync: status bar, banners, delivery sheet, zoomed GPS map and the 3D screen texture */
import type { PhoneMap } from '../PhoneMap';
import { PlayerState } from '../../player/PlayerController';
import { ScooterState } from '../../vehicle/ScooterPhysics';
import { CityMapInfo } from '../../world/CityWorld';
import { DeliveryManager, MAX_CONCURRENT_ORDERS, NavigationPlan } from '../../delivery/DeliveryManager';
import { DispatchOffer } from '../../delivery/OrderDispatchManager';
import { SignalStateSnapshot } from '../../world/TrafficSystem';
import { stepMapCamera } from './mapView';
import { syncCameraAlertBanner, syncCookingBanner, syncDispatchPopup, syncPinTooltip } from './topbarBanners';
import { render3DPhoneScreen } from './screen3D';
import { renderMapToContext } from './mapRenderer';
import { computeDeliverySheetFingerprint, renderDeliverySheetHtml } from './deliverySheet';
import { resolveAreaName } from './phoneFormat';

/** Phone map / screen refresh interval (10Hz): the map canvas is the costliest 2D draw per frame */
const PHONE_MAP_REFRESH_SEC = 0.1;
/** Power saving: the phone screens redraw only a few times a second */
const POWER_SAVE_REFRESH_SEC = 0.4;

export function update(
  host: PhoneMap,
  player: PlayerState,
  scooter: ScooterState,
  delivery: DeliveryManager,
  activeOffer: DispatchOffer | null,
  navPlan: NavigationPlan,
  signalState: SignalStateSnapshot,
  isNight: boolean,
  elapsedTime: number,
  mapInfo: CityMapInfo,
): void {
  host.lastElapsed = elapsedTime;
  const isRiding = player.mode === 'riding';

  if (!host.isZoomed) {
    const leftOnBike = host.placement === 'mounted' && !isRiding;
    host.pocketPillEl.classList.toggle('away', leftOnBike);
    host.pocketPillEl.classList.toggle('incoming', !leftOnBike && activeOffer !== null);

    if (leftOnBike) {
      host.pocketKeyEl.textContent = 'Tab';
      host.pocketPillTextEl.textContent = player.canMountScooter
        ? '오토바이 거치대에서 휴대폰 챙기기'
        : `휴대폰이 오토바이에 있음 (${player.inCorridor ? '1층' : `${player.distanceToScooter.toFixed(0)}m`})`;
    } else if (activeOffer !== null) {
      const typeLabel = activeOffer.type === 'SINGLE' ? '한집배달' : '알뜰 2건';
      const sec = Math.max(0, Math.ceil(activeOffer.remainingOfferSec));
      if (host.placement === 'pocket') {
        host.pocketKeyEl.textContent = 'Tab';
        host.pocketPillTextEl.textContent = `🔔 ${typeLabel} ₩${activeOffer.totalFee.toLocaleString()} (${sec}초) · 폰 꺼내기`;
      } else {
        host.pocketKeyEl.textContent = 'Tab/V';
        host.pocketPillTextEl.textContent = `🔔 ${typeLabel} ₩${activeOffer.totalFee.toLocaleString()} (${sec}초) · 즉시 수락!`;
      }
    } else if (host.placement === 'pocket') {
      host.pocketKeyEl.textContent = 'Tab';
      host.pocketPillTextEl.textContent = isRiding ? '거치대에 휴대폰 장착 (내비게이션)' : '주머니에서 휴대폰 꺼내기';
    } else {
      host.pocketKeyEl.textContent = 'V';
      host.pocketPillTextEl.textContent =
        host.placement === 'mounted' ? '거치대 폰 확대 (Tab: 주머니로)' : '손에 든 폰 확대 (Tab: 주머니로)';
    }
    host.pocketBadgeEl.classList.toggle('hidden', delivery.activeMissions.length === 0 && activeOffer === null);
  }

  if (host.placement === 'pocket') {
    return;
  }

  stepMapCamera(host.view, player, host.isZoomed);

  // In-game time (GameClock via Hud.setClock); falls back to the device clock before the first frame
  const now = new Date();
  const clockStr =
    host.clockLabel ?? `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const areaName = resolveAreaName(player.x, player.z, mapInfo);

  if (host.isZoomed) {
    host.syncZoomCanvasSize();
    host.phoneEl.classList.toggle('night', isNight);
    host.clockEl.textContent = clockStr;
    host.areaEl.textContent = areaName;
    host.earningsEl.textContent = `₩${delivery.totalEarnings.toLocaleString()} (${delivery.completedCount}건)`;

    const kmh = Math.round(Math.abs(scooter.speed) * 3.6);
    const bundleSuffix =
      delivery.activeMissions.length > 0 ? ` · 묶음 ${delivery.activeMissions.length}/${MAX_CONCURRENT_ORDERS}` : '';
    if (player.mode === 'knockdown') {
      host.statusPillEl.textContent = '💥 넘어짐! 회복 중';
      host.statusPillEl.className = 'app-status-pill danger';
    } else if (isRiding) {
      host.statusPillEl.textContent = kmh > 0 ? `🛵 주행 ${kmh}km/h${bundleSuffix}` : `🛵 대기${bundleSuffix}`;
      host.statusPillEl.className = 'app-status-pill riding';
    } else {
      host.statusPillEl.textContent = `🚶 도보 · 바이크 ${player.distanceToScooter.toFixed(0)}m`;
      host.statusPillEl.className = 'app-status-pill foot';
    }

    host.syncDockBadge();
    host.syncNotifications();
    // Weather / messenger app open: its screen covers the delivery app (incoming calls still pop up over it)
    if (host.app === 'bank') {
      host.syncDeliverySheet(player, delivery, navPlan);
      syncDispatchPopup(host.dispatchEls, host.dispatchState, activeOffer, delivery);
      return;
    }
    if (host.app === 'messenger') {
      host.syncMessengerApp();
      syncDispatchPopup(host.dispatchEls, host.dispatchState, activeOffer, delivery);
      return;
    }
    if (host.app === 'weather') {
      host.syncWeatherApp();
      syncDispatchPopup(host.dispatchEls, host.dispatchState, activeOffer, delivery);
      return;
    }
    host.syncDeliverySheet(player, delivery, navPlan);
    syncPinTooltip(host.pinTooltipEl, delivery, navPlan);
    syncCameraAlertBanner(host.camAlertEl, mapInfo);
    syncCookingBanner(host.cookingBannerEl, delivery);
    syncDispatchPopup(host.dispatchEls, host.dispatchState, activeOffer, delivery);

    // Zoomed phone map redraws at 10Hz (was every frame). Redraw right away while the rider is
    // dragging / flicking / zooming it, or after a canvas resize (which clears it), so input stays smooth.
    const v = host.view;
    const interacting =
      v.isMapDragging || Math.abs(v.panVelX) + Math.abs(v.panVelZ) > 0.01 || v.zoomLevel !== host.lastZoomMapLevel;
    const resized = host.zoomCanvas.width !== host.lastZoomCanvasW || host.zoomCanvas.height !== host.lastZoomCanvasH;
    if (
      !interacting &&
      !resized &&
      host.lastZoomMapRenderTime >= 0 &&
      elapsedTime - host.lastZoomMapRenderTime < (host.powerSave ? POWER_SAVE_REFRESH_SEC : PHONE_MAP_REFRESH_SEC)
    ) {
      return;
    }
    host.lastZoomMapRenderTime = elapsedTime;
    host.lastZoomMapLevel = v.zoomLevel;
    host.lastZoomCanvasW = host.zoomCanvas.width;
    host.lastZoomCanvasH = host.zoomCanvas.height;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderMapToContext(
      host.zoomCtx,
      host.zoomCanvas.width / dpr,
      host.zoomCanvas.height / dpr,
      dpr,
      host.view,
      player,
      scooter,
      navPlan,
      signalState,
      isNight,
      elapsedTime,
      mapInfo,
      false,
    );
  } else {
    // Throttle 3D CanvasTexture redraw + GPU upload to 10Hz
    const refresh = host.powerSave ? POWER_SAVE_REFRESH_SEC : PHONE_MAP_REFRESH_SEC;
    if (elapsedTime - host.last3DRenderTime < refresh && host.last3DRenderTime >= 0) {
      return;
    }
    host.last3DRenderTime = elapsedTime;

    render3DPhoneScreen(
      host.texCanvas,
      host.texCtx,
      {
        battery: host.battery,
        isWirelessCharging: host.isWirelessCharging,
        placement: host.placement,
        offerExpanded: activeOffer !== null && host.dispatchState.expandedOfferId === activeOffer.id,
        weatherReport: host.app === 'weather' ? host.weatherReport : null,
        messenger: host.app === 'messenger' ? host.messenger : null,
        unreadMessages: host.messenger?.unread ?? 0,
        app: host.app,
        powerSave: host.powerSave,
      },
      host.view,
      host.ripple3D,
      player,
      scooter,
      delivery,
      activeOffer,
      navPlan,
      signalState,
      isNight,
      elapsedTime,
      mapInfo,
      clockStr,
      areaName,
    );
    host.screenTexture.needsUpdate = true;
  }
}

export function syncDeliverySheet(
  host: PhoneMap,
  player: PlayerState,
  delivery: DeliveryManager,
  navPlan: NavigationPlan,
): void {
  const fingerprint = computeDeliverySheetFingerprint(host.activeTab, player, delivery, navPlan);
  if (fingerprint === host.lastSheetFingerprint) return;
  host.lastSheetFingerprint = fingerprint;

  host.syncTopNavHighlight();
  host.sheetBodyEl.innerHTML = renderDeliverySheetHtml(host.topNav, host.activeTab, player, delivery, navPlan);
}
