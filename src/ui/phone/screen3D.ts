import { PlayerState } from '../../player/PlayerController';
import { ScooterState } from '../../vehicle/ScooterPhysics';
import { CityMapInfo } from '../../world/CityWorld';
import { DeliveryManager, NavigationPlan } from '../../delivery/DeliveryManager';
import { DispatchOffer } from '../../delivery/OrderDispatchManager';
import { SignalStateSnapshot } from '../../world/TrafficSystem';
import type { PhonePlacement } from './types';
import { MapViewState } from './mapView';
import { renderMapToContext } from './mapRenderer';
import { renderRidingNavOverlay } from './ridingNavOverlay3D';
import { renderOnFootPhoneOverlay } from './onFootOverlay3D';
import { render3DDispatchCallCard } from './dispatchCallCard3D';
import { render3DCallBanner } from './callBanner3D';
import { PhoneApp, renderDock3D, renderWeatherApp3D } from './weatherApp';
import type { WeatherReport } from '../../game/weatherReport';
import type { Messenger } from '../../delivery/messenger';
import { renderMessenger3D } from './messengerApp';
import { renderBank3D } from './bankApp';

/** Phone status snapshot needed to draw the 3D screen */
export interface Phone3DScreenStatus {
  /** The incoming call was expanded to the full card (otherwise the compact banner shows) */
  offerExpanded: boolean;
  battery: number;
  isWirelessCharging: boolean;
  placement: PhonePlacement;
  /** The weather app is open (drawn instead of the delivery app) */
  weatherReport?: WeatherReport | null;
  /** Open app (the dock highlights it) */
  app?: PhoneApp;
  /** The messenger app is open (drawn instead of the delivery app) */
  messenger?: Messenger | null;
  /** Unread messages (badge on the dock) */
  unreadMessages?: number;
  /** Power saving: the screen is dimmed */
  powerSave?: boolean;
}

/** Expanding glass-touch ripple drawn on the 3D phone canvas (null when idle) */
export interface Ripple3DState {
  current: { x: number; y: number; bornAt: number } | null;
}

/**
 * Renders the 3D Smartphone CanvasTexture:
 * - While Riding + Mounted: Live Turn-by-Turn Navigation Mode (heading-up rotating minimap + turn arrow + remaining m!)
 * - While On Foot + In Hand: North-up GPS map + bundled delivery summary & cargo slot pips
 * - Whenever a 20s Call Offer is active: overlays the centered vibrating Circular Progress Call Card!
 */
export function render3DPhoneScreen(
  texCanvas: HTMLCanvasElement,
  texCtx: CanvasRenderingContext2D,
  phone: Phone3DScreenStatus,
  view: MapViewState,
  ripple: Ripple3DState,
  player: PlayerState,
  scooter: ScooterState,
  delivery: DeliveryManager,
  activeOffer: DispatchOffer | null,
  navPlan: NavigationPlan,
  signalState: SignalStateSnapshot,
  isNight: boolean,
  elapsedTime: number,
  mapInfo: CityMapInfo,
  clockStr: string,
  areaName: string
): void {
  const ctx = texCtx;
  const w = texCanvas.width;
  const h = texCanvas.height;

  // Battery depleted screen on 3D phone!
  if (phone.battery <= 0.05) {
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f87171';
    ctx.font = 'bold 48px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🪫', w * 0.5, h * 0.42);
    ctx.font = '900 22px sans-serif';
    ctx.fillText('배터리 방전 (0%)', w * 0.5, h * 0.52);
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('거치대 [Tab] 시동 무선충전', w * 0.5, h * 0.59);
    ctx.fillText('또는 🏪 K-24 편의점 충전', w * 0.5, h * 0.635);
    return;
  }

  const isRidingNavMode = player.mode === 'riding' && phone.placement === 'mounted';

  // Weather / messenger / bank app open: its own screen (the status bar and an incoming call still show)
  if (phone.weatherReport || phone.messenger || phone.app === 'bank') {
    if (phone.app === 'bank') renderBank3D(ctx, w, h, delivery);
    else if (phone.messenger) renderMessenger3D(ctx, w, h, phone.messenger);
    else renderWeatherApp3D(ctx, w, h, phone.weatherReport!);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
    ctx.fillRect(0, 0, w, 34);
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(clockStr, 16, 18);
    ctx.textAlign = 'right';
    ctx.fillText(`🔋${Math.round(phone.battery)}%`, w - 14, 18);
    renderDock3D(ctx, w, h, phone.app ?? 'weather', { messenger: phone.unreadMessages ?? 0 });
    if (activeOffer) {
      if (phone.offerExpanded) render3DDispatchCallCard(ctx, w, h, activeOffer, elapsedTime);
      else render3DCallBanner(ctx, w, activeOffer, elapsedTime);
    }
    if (phone.powerSave) dimForPowerSave(ctx, w, h);
    return;
  }

  // 1. Live GPS map background (Heading-Up rotating minimap when riding!)
  renderMapToContext(
    ctx,
    w,
    h,
    1,
    view,
    player,
    scooter,
    navPlan,
    signalState,
    isNight,
    elapsedTime,
    mapInfo,
    isRidingNavMode
  );

  ctx.save();
  // 2. Top status bar
  ctx.fillStyle = isNight ? 'rgba(15, 23, 42, 0.84)' : 'rgba(255, 255, 255, 0.86)';
  ctx.fillRect(0, 0, w, 34);
  ctx.fillStyle = isNight ? '#f8fafc' : '#0f172a';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(clockStr, 16, 18);
  ctx.textAlign = 'right';
  const battPct = Math.round(phone.battery);
  const battBadge = phone.isWirelessCharging
    ? `⚡${battPct}%`
    : battPct <= 15
      ? `🪫${battPct}%`
      : `🔋${battPct}%`;
  ctx.fillStyle = phone.isWirelessCharging
    ? '#10b981'
    : battPct <= 15
      ? '#ef4444'
      : isNight
        ? '#f8fafc'
        : '#0f172a';
  ctx.fillText(isRidingNavMode ? `NAVI · ${battBadge}` : `5G · ${battBadge}`, w - 14, 18);

  if (isRidingNavMode) {
    renderRidingNavOverlay(ctx, w, h, scooter, delivery, navPlan, isNight, areaName, mapInfo, elapsedTime);
  } else {
    renderOnFootPhoneOverlay(ctx, w, h, player, delivery, navPlan, isNight, areaName);
  }

  // App dock at the bottom (drawn after the overlays so it stays on top)
  renderDock3D(ctx, w, h, phone.app ?? 'delivery', { messenger: phone.unreadMessages ?? 0 });

  // Incoming call: compact banner at the top (map stays visible), or the full card once expanded
  if (activeOffer) {
    if (phone.offerExpanded) render3DDispatchCallCard(ctx, w, h, activeOffer, elapsedTime);
    else render3DCallBanner(ctx, w, activeOffer, elapsedTime);
  }

  // Expanding capacitive glass touch ripple rendered directly onto the 3D phone screen!
  if (ripple.current) {
    const age = elapsedTime - ripple.current.bornAt;
    if (age >= 0 && age < 0.42) {
      const p = age / 0.42;
      const radius = 10 + p * 36;
      ctx.save();
      ctx.strokeStyle = `rgba(45, 212, 191, ${(1 - p) * 0.95})`;
      ctx.fillStyle = `rgba(45, 212, 191, ${(1 - p) * 0.3})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(ripple.current.x, ripple.current.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    } else {
      ripple.current = null;
    }
  }

  if (phone.powerSave) dimForPowerSave(ctx, w, h);
  ctx.restore();
}

/** Power saving: dim the whole screen and say so in the corner */
function dimForPowerSave(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.save();
  ctx.fillStyle = 'rgba(2, 6, 23, 0.3)';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#fbbf24';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('🪫 절전 모드', 12, 46);
  ctx.restore();
}
