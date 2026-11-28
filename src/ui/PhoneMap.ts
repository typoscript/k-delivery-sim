import * as THREE from 'three';
import { PlayerState } from '../player/PlayerController';
import { ScooterState } from '../vehicle/ScooterPhysics';
import { CityMapInfo } from '../world/CityWorld';
import { DeliveryManager, NavigationPlan } from '../delivery/DeliveryManager';
import { DispatchOffer } from '../delivery/OrderDispatchManager';
import { SignalStateSnapshot } from '../world/TrafficSystem';
import type { PhoneCallbacks, PhonePlacement, PhoneTab, PhoneTopNav } from './phone/types';
import {
  MapViewState,
  createMapViewState,
  setupMapPanAndZoom,
  setupMapZoomButtons,
} from './phone/mapView';
import { TouchHandState, setupTouchHandInteraction } from './phone/touchHand';
import { DispatchPopupEls, DispatchPopupState } from './phone/topbarBanners';
import { Ripple3DState } from './phone/screen3D';
import { PHONE_APPS, PhoneApp, weatherAppHtml } from './phone/weatherApp';
import type { WeatherReport } from '../game/weatherReport';

export type { PhoneCallbacks, PhonePlacement, PhoneTab, PhoneTopNav } from './phone/types';

import {
  setExternal3DHandHover as setExternal3DHandHoverFn,
  triggerExternal3DHandTap as triggerExternal3DHandTapFn,
  handle3DScreenTouch as handle3DScreenTouchFn,
} from './phone/phoneTouch3D';
import {
  stepBattery as stepBatteryFn,
  rechargeBatteryFull as rechargeBatteryFullFn,
} from './phone/phoneBattery';
import {
  setPlacement as setPlacementFn,
  setZoomed as setZoomedFn,
  toggleZoom as toggleZoomFn,
  toggleWithTab as toggleWithTabFn,
  syncOverlayVisibility as syncOverlayVisibilityFn,
  syncZoomCanvasSize as syncZoomCanvasSizeFn,
} from './phone/phonePlacement';
import {
  update as updateFn,
  syncDeliverySheet as syncDeliverySheetFn,
} from './phone/phoneFrame';

export class PhoneMap {
  // Offscreen high-res canvas & live Three.js texture rendered onto 3D Handheld / Handlebar-Mounted Phone!
  /** @internal phone/* */
  readonly texCanvas: HTMLCanvasElement;
  /** @internal phone/* */
  readonly texCtx: CanvasRenderingContext2D;
  public readonly screenTexture: THREE.CanvasTexture;

  // Interactive Zoomed-In Focus Overlay elements
  /** @internal phone/* */
  readonly zoomBackdropEl = document.getElementById('phone-zoom-backdrop')!;
  /** @internal phone/* */
  readonly phoneEl = document.getElementById('rider-phone')!;
  private readonly phoneScreenEl = document.querySelector('#rider-phone .phone-screen') as HTMLElement;
  /** @internal phone/* */
  readonly touchHandEl = document.getElementById('phone-touch-hand')!;
  private readonly touchRippleLayerEl = document.getElementById('phone-touch-ripple-layer')!;
  /** @internal phone/* */
  readonly pocketPillEl = document.getElementById('phone-pocket-pill')!;
  /** @internal phone/* */
  readonly pocketKeyEl = document.getElementById('pocket-pill-key')!;
  /** @internal phone/* */
  readonly pocketPillTextEl = document.getElementById('pocket-pill-text')!;
  /** @internal phone/* */
  readonly pocketBadgeEl = document.getElementById('pocket-mission-dot')!;
  /** @internal phone/* */
  readonly placementTagEl = document.getElementById('phone-placement-tag')!;

  /** @internal phone/* */
  readonly zoomCanvas = document.getElementById('phone-map-canvas') as HTMLCanvasElement;
  /** @internal phone/* */
  readonly zoomCtx = this.zoomCanvas.getContext('2d')!;
  /** @internal phone/* */
  readonly clockEl = document.getElementById('phone-clock')!;
  /** Game clock "HH:MM" shown in the phone status bar */
  public clockLabel: string | null = null;
  /** @internal phone/* */
  readonly battPctEl = document.getElementById('sb-battery-pct')!;
  /** @internal phone/* */
  readonly battWrapEl = document.getElementById('sb-battery-wrap')!;
  /** @internal phone/* */
  readonly battFillEl = document.getElementById('sb-battery-fill')!;
  /** @internal phone/* */
  readonly deadOverlayEl = document.getElementById('phone-dead-overlay')!;
  /** @internal phone/* */
  readonly areaEl = document.getElementById('phone-area-name')!;
  /** @internal phone/* */
  readonly earningsEl = document.getElementById('phone-earnings')!;
  /** @internal phone/* */
  readonly statusPillEl = document.getElementById('phone-status-pill')!;
  /** @internal phone/* */
  readonly pinTooltipEl = document.getElementById('phone-pin-tooltip')!;
  /** @internal phone/* */
  readonly camAlertEl = document.getElementById('phone-cam-alert')!;
  /** @internal phone/* */
  readonly cookingBannerEl = document.getElementById('phone-cooking-banner')!;
  private readonly topNavEl = document.getElementById('phone-top-nav')!;
  private readonly bottomSheetEl = document.querySelector('.app-bottom-sheet') as HTMLElement;
  /** @internal phone/* */
  readonly sheetBodyEl = document.getElementById('phone-sheet-body')!;

  private readonly zoomInBtn = document.getElementById('map-zoom-in')!;
  private readonly zoomOutBtn = document.getElementById('map-zoom-out')!;
  /** @internal phone/* */
  readonly followBtn = document.getElementById('map-follow-btn')!;
  private readonly unzoomBtn = document.getElementById('phone-unzoom-btn')!;
  /** @internal phone/* */
  readonly stowBtn = document.getElementById('phone-stow-btn')!;

  // 20-Second Incoming Call Popup DOM elements inside Zoomed Smartphone
  /** @internal phone/* */
  readonly dispatchEls: DispatchPopupEls = {
    dispatchPopupEl: document.getElementById('phone-dispatch-popup')!,
    dispatchCardEl: document.getElementById('dispatch-popup-card')!,
    dpTypeBadgeEl: document.getElementById('dp-type-badge')!,
    dpRingFgEl: document.getElementById('dp-ring-fg')!,
    dpTimerTextEl: document.getElementById('dp-timer-text')!,
    dpFeeEl: document.getElementById('dp-fee')!,
    dpSubMetaEl: document.getElementById('dp-sub-meta')!,
    dpStopsEl: document.getElementById('dp-stops')!,
    bannerEl: document.getElementById('phone-dispatch-banner')!,
    bannerTitleEl: document.getElementById('db-title')!,
    bannerMetaEl: document.getElementById('db-meta')!,
    bannerFillEl: document.getElementById('db-progress-fill')!,
  };
  /** @internal phone/* */
  readonly dispatchState: DispatchPopupState = { lastOfferPopupId: '', lastOfferPulseTick: 0, expandedOfferId: '', currentOfferId: '' };

  /** Open app: the delivery app (map + calls) or the weather app (the only place the weather is shown) */
  public app: PhoneApp = 'delivery';
  /** Latest weather app report (set by the game clock every game minute) */
  public weatherReport: WeatherReport | null = null;
  private readonly appDockEl = document.getElementById('phone-app-dock')!;
  private readonly weatherAppEl = document.getElementById('phone-weather-app')!;
  private weatherHtmlKey = '';

  /** @internal phone/* */
  readonly callbacks: PhoneCallbacks;
  public placement: PhonePlacement = 'pocket';
  public isZoomed = false;
  public battery = 88; // 0..100% live smartphone battery
  public isWirelessCharging = false;
  /** @internal phone/* */
  lowBatteryWarned = false;
  /** @internal phone/* */
  deadBatteryWarned = false;
  public topNav: PhoneTopNav = 'calls';
  public activeTab: PhoneTab = 'calls';

  // GPS map camera / pan-drag state (see phone/mapView.ts)
  /** GPS map camera / zoom state (the in-world phone touch zooms it too) */
  public readonly view: MapViewState = createMapViewState();
  /** @internal phone/* */
  readonly touchState: TouchHandState = { tapTimer: null };
  /** @internal phone/* */
  lastSheetFingerprint = '';
  /** @internal phone/* */
  last3DRenderTime = -1;
  /** @internal phone/* */
  lastZoomMapRenderTime = -1;
  /** @internal phone/* */
  lastZoomMapLevel = -1;
  /** @internal phone/* */
  lastZoomCanvasW = -1;
  /** @internal phone/* */
  lastZoomCanvasH = -1;
  /** @internal phone/* */
  readonly ripple3D: Ripple3DState = { current: null };
  /** @internal phone/* */
  lastElapsed = 0;

  constructor(callbacks: PhoneCallbacks) {
    this.callbacks = callbacks;

    // 360x680 crisp canvas texture for the 3D phone in hand & on scooter mount
    this.texCanvas = document.createElement('canvas');
    this.texCanvas.width = 360;
    this.texCanvas.height = 680;
    this.texCtx = this.texCanvas.getContext('2d')!;
    this.screenTexture = new THREE.CanvasTexture(this.texCanvas);
    this.screenTexture.colorSpace = THREE.SRGBColorSpace;
    this.screenTexture.minFilter = THREE.LinearFilter;
    this.screenTexture.magFilter = THREE.LinearFilter;

    setupMapZoomButtons(this.zoomInBtn, this.zoomOutBtn, this.followBtn, this.view);

    this.unzoomBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onToggleZoom();
    });

    this.stowBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onTogglePhone();
    });

    this.zoomBackdropEl.addEventListener('click', (e) => {
      if (e.target === this.zoomBackdropEl) {
        this.callbacks.onToggleZoom();
      }
    });

    this.pocketPillEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.placement === 'pocket' || this.pocketPillEl.classList.contains('away')) {
        this.callbacks.onTogglePhone();
      } else {
        this.callbacks.onToggleZoom();
      }
    });

    this.appDockEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      const app = btn?.dataset.app as PhoneApp | undefined;
      if (app) this.setApp(app);
    });

    this.topNavEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const target = e.target as HTMLElement;
      const btn = target.closest('button') as HTMLButtonElement | null;
      const nextTop = btn?.dataset.topnav as PhoneTopNav | undefined;
      if (!nextTop) return;
      this.setTopNav(nextTop);
    });

    this.sheetBodyEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const target = e.target as HTMLElement;
      const btn = target.closest('button') as HTMLButtonElement | null;
      if (!btn) return;

      const action = btn.dataset.action;
      if (action === 'tab' && btn.dataset.tab) {
        this.activeTab = btn.dataset.tab as PhoneTab;
        if (this.activeTab === 'calls' || this.activeTab === 'accepted') this.topNav = 'calls';
        else if (this.activeTab === 'route' || this.activeTab === 'checklist') this.topNav = 'nav';
        else this.topNav = 'earnings';
        this.syncTopNavHighlight();
        this.lastSheetFingerprint = '';
      } else if (action === 'accept' && btn.dataset.id) {
        this.callbacks.onAcceptOrder(btn.dataset.id);
        this.lastSheetFingerprint = '';
      } else if (action === 'refresh') {
        this.callbacks.onRefreshOrders();
        this.lastSheetFingerprint = '';
      } else if (action === 'cancel' && btn.dataset.id) {
        this.callbacks.onCancelMission(btn.dataset.id);
        this.lastSheetFingerprint = '';
      } else if (action === 'focus' && btn.dataset.id) {
        this.callbacks.onSelectMission(btn.dataset.id);
        this.lastSheetFingerprint = '';
      } else if (action === 'auto_route') {
        this.callbacks.onSelectMission(null);
        this.lastSheetFingerprint = '';
      } else if (action === 'open_report') {
        this.callbacks.onOpenDailyReport();
      } else if (action === 'clock_out') {
        this.callbacks.onClockOut();
        this.lastSheetFingerprint = '';
      } else if (action === 'interact') {
        this.callbacks.onInteractMission();
      }
    });

    const onOfferClick = (e: MouseEvent) => {
      e.stopPropagation();
      const target = e.target as HTMLElement;
      const btn = target.closest('button') as HTMLButtonElement | null;
      if (!btn) return;
      if (btn.dataset.action === 'accept_offer') {
        this.callbacks.onAcceptDispatchOffer();
      } else if (btn.dataset.action === 'reject_offer') {
        this.callbacks.onRejectDispatchOffer();
      } else if (btn.dataset.action === 'expand_offer') {
        this.dispatchState.expandedOfferId = this.dispatchState.currentOfferId;
      }
    };
    this.dispatchEls.dispatchPopupEl.addEventListener('click', onOfferClick);
    this.dispatchEls.bannerEl.addEventListener('click', onOfferClick);

    this.followBtn.classList.add('active');
    setupTouchHandInteraction(
      {
        phoneScreenEl: this.phoneScreenEl,
        touchHandEl: this.touchHandEl,
        touchRippleLayerEl: this.touchRippleLayerEl,
      },
      this.touchState,
      this.view,
      () => this.isZoomed,
      this.callbacks
    );
    setupMapPanAndZoom(this.zoomCanvas, this.followBtn, this.touchHandEl, this.view, () => this.isZoomed);
    this.setPlacement('pocket');
  }

  /**
   * Drives the 1st-person touching hand when hovering over the in-world 3D phone
   * (mounted on scooter handlebar or held in 3D hand) without zooming!
   */
  public setExternal3DHandHover(active: boolean, clientX: number, clientY: number): void {
    setExternal3DHandHoverFn(this, active, clientX, clientY);
  }

  /** Triggers a brief tap-down press on the 1st-person touching hand over the 3D phone */
  public triggerExternal3DHandTap(clientX: number, clientY: number): void {
    triggerExternal3DHandTapFn(this, clientX, clientY);
  }

  /**
   * Direct in-world UV touch hit-testing on the 360x680 3D phone screen canvas!
   * Allows riders to tap [👆 콜 수락] / [거절] right on the 3D handlebar or handheld phone
   * without opening the full-screen zoom modal.
   */
  public handle3DScreenTouch(
    u: number,
    v: number,
    activeOfferId: string | null
  ): 'accept_offer' | 'reject_offer' | 'expand_offer' | 'switch_app' | 'zoom' {
    return handle3DScreenTouchFn(this, u, v, activeOfferId);
  }

  private setTopNav(next: PhoneTopNav): void {
    this.topNav = next;
    if (next === 'calls') {
      if (this.activeTab !== 'calls' && this.activeTab !== 'accepted') this.activeTab = 'calls';
    } else if (next === 'nav') {
      if (this.activeTab !== 'route' && this.activeTab !== 'checklist') this.activeTab = 'route';
    } else {
      if (this.activeTab !== 'finance' && this.activeTab !== 'reviews' && this.activeTab !== 'career') this.activeTab = 'finance';
    }
    this.syncTopNavHighlight();
    this.lastSheetFingerprint = '';
  }

  /** @internal phone/* */
  syncTopNavHighlight(): void {
    const btns = this.topNavEl.querySelectorAll('button[data-topnav]');
    btns.forEach((b) => {
      const el = b as HTMLButtonElement;
      el.classList.toggle('active', el.dataset.topnav === this.topNav);
    });
    this.bottomSheetEl.classList.toggle('earnings-expanded', this.topNav === 'earnings');
  }

  /**
   * Steps realistic smartphone battery drain (on-foot/zoomed) and handlebar-mount wireless charging!
   * Mounting phone (`Tab`) with scooter engine ON rapidly recharges via wireless charging dock.
   */
  public stepBattery(
    dt: number,
    scooterEngineOn: boolean,
    onWirelessChargeStart?: () => void,
    onLowBattery?: () => void,
    onBatteryDead?: () => void,
    chargeSpeedMul = 1.0
  ): void {
    stepBatteryFn(this, dt, scooterEngineOn, onWirelessChargeStart, onLowBattery, onBatteryDead, chargeSpeedMul);
  }

  public rechargeBatteryFull(): void {
    rechargeBatteryFullFn(this);
  }

  public setPlacement(next: PhonePlacement): void {
    setPlacementFn(this, next);
  }

  public setZoomed(zoomed: boolean): boolean {
    return setZoomedFn(this, zoomed);
  }

  public toggleZoom(isRiding: boolean): { zoomed: boolean; message: string } {
    return toggleZoomFn(this, isRiding);
  }

  public toggleWithTab(
    isRiding: boolean,
    nearScooter: boolean
  ): {
    placement: PhonePlacement;
    anim?: 'mount' | 'unmount';
    blocked?: boolean;
    message: string;
  } {
    return toggleWithTabFn(this, isRiding, nearScooter);
  }

  /** @internal phone/* */
  syncOverlayVisibility(): void {
    syncOverlayVisibilityFn(this);
  }

  /** @internal phone/* */
  syncZoomCanvasSize(): void {
    syncZoomCanvasSizeFn(this);
  }

  public update(
    player: PlayerState,
    scooter: ScooterState,
    delivery: DeliveryManager,
    activeOffer: DispatchOffer | null,
    navPlan: NavigationPlan,
    signalState: SignalStateSnapshot,
    isNight: boolean,
    elapsedTime: number,
    mapInfo: CityMapInfo
  ): void {
    updateFn(this, player, scooter, delivery, activeOffer, navPlan, signalState, isNight, elapsedTime, mapInfo);
  }

  /** @internal phone/* */
  syncDeliverySheet(
    player: PlayerState,
    delivery: DeliveryManager,
    navPlan: NavigationPlan
  ): void {
    syncDeliverySheetFn(this, player, delivery, navPlan);
  }

  /** [Y]: the next app on the dock */
  public cycleApp(): PhoneApp {
    const i = PHONE_APPS.findIndex((a) => a.id === this.app);
    this.setApp(PHONE_APPS[(i + 1) % PHONE_APPS.length].id);
    return this.app;
  }

  /** Switches the open app (zoomed phone dock; the 3D phone shows the same app) */
  public setApp(app: PhoneApp): void {
    if (app === this.app) return;
    this.app = app;
    this.phoneScreenEl.classList.toggle('app-weather', app === 'weather');
    this.weatherAppEl.classList.toggle('hidden', app !== 'weather');
    for (const b of this.appDockEl.querySelectorAll<HTMLButtonElement>('.dock-app')) {
      b.classList.toggle('active', b.dataset.app === app);
    }
    this.weatherHtmlKey = '';
    this.last3DRenderTime = -1;
    this.lastSheetFingerprint = '';
    this.callbacks.onAppSwitched?.(app);
  }

  /** @internal phone/* - redraws the weather app screen when its report changed */
  syncWeatherApp(): void {
    const r = this.weatherReport;
    if (!r) return;
    const key = JSON.stringify(r);
    if (key === this.weatherHtmlKey) return;
    this.weatherHtmlKey = key;
    this.weatherAppEl.className = `phone-weather-app wx-${r.mode}`;
    this.weatherAppEl.innerHTML = weatherAppHtml(r);
  }

}
