import * as THREE from 'three';
import { PlayerState } from '../player/PlayerController';
import { ScooterState } from '../vehicle/ScooterPhysics';
import { CityMapInfo } from '../world/CityWorld';
import { DeliveryManager, MAX_CONCURRENT_ORDERS, NavigationPlan } from '../delivery/DeliveryManager';
import { DispatchOffer } from '../delivery/OrderDispatchManager';
import { SignalStateSnapshot } from '../world/TrafficSystem';
import { clamp } from '../types';
import type { PhoneCallbacks, PhonePlacement, PhoneTab, PhoneTopNav } from './phone/types';
import {
  MapViewState,
  createMapViewState,
  setupMapPanAndZoom,
  setupMapZoomButtons,
  stepMapCamera,
} from './phone/mapView';
import { TouchHandState, setupTouchHandInteraction } from './phone/touchHand';
import {
  DispatchPopupEls,
  DispatchPopupState,
  syncCameraAlertBanner,
  syncCookingBanner,
  syncDispatchPopup,
  syncPinTooltip,
} from './phone/topbarBanners';
import { Ripple3DState, render3DPhoneScreen } from './phone/screen3D';
import { renderMapToContext } from './phone/mapRenderer';
import { computeDeliverySheetFingerprint, renderDeliverySheetHtml } from './phone/deliverySheet';
import { resolveAreaName } from './phone/phoneFormat';


/** Phone map / screen refresh interval (10Hz): the map canvas is the costliest 2D draw per frame */
const PHONE_MAP_REFRESH_SEC = 0.1;
export type { PhoneCallbacks, PhonePlacement, PhoneTab, PhoneTopNav } from './phone/types';

export class PhoneMap {
  // Offscreen high-res canvas & live Three.js texture rendered onto 3D Handheld / Handlebar-Mounted Phone!
  private readonly texCanvas: HTMLCanvasElement;
  private readonly texCtx: CanvasRenderingContext2D;
  public readonly screenTexture: THREE.CanvasTexture;

  // Interactive Zoomed-In Focus Overlay elements
  private readonly zoomBackdropEl = document.getElementById('phone-zoom-backdrop')!;
  private readonly phoneEl = document.getElementById('rider-phone')!;
  private readonly phoneScreenEl = document.querySelector('#rider-phone .phone-screen') as HTMLElement;
  private readonly touchHandEl = document.getElementById('phone-touch-hand')!;
  private readonly touchRippleLayerEl = document.getElementById('phone-touch-ripple-layer')!;
  private readonly pocketPillEl = document.getElementById('phone-pocket-pill')!;
  private readonly pocketKeyEl = document.getElementById('pocket-pill-key')!;
  private readonly pocketPillTextEl = document.getElementById('pocket-pill-text')!;
  private readonly pocketBadgeEl = document.getElementById('pocket-mission-dot')!;
  private readonly placementTagEl = document.getElementById('phone-placement-tag')!;

  private readonly zoomCanvas = document.getElementById('phone-map-canvas') as HTMLCanvasElement;
  private readonly zoomCtx = this.zoomCanvas.getContext('2d')!;
  private readonly clockEl = document.getElementById('phone-clock')!;
  /** Game clock "HH:MM" shown in the phone status bar */
  public clockLabel: string | null = null;
  private readonly battPctEl = document.getElementById('sb-battery-pct')!;
  private readonly battWrapEl = document.getElementById('sb-battery-wrap')!;
  private readonly battFillEl = document.getElementById('sb-battery-fill')!;
  private readonly deadOverlayEl = document.getElementById('phone-dead-overlay')!;
  private readonly areaEl = document.getElementById('phone-area-name')!;
  private readonly earningsEl = document.getElementById('phone-earnings')!;
  private readonly statusPillEl = document.getElementById('phone-status-pill')!;
  private readonly pinTooltipEl = document.getElementById('phone-pin-tooltip')!;
  private readonly camAlertEl = document.getElementById('phone-cam-alert')!;
  private readonly cookingBannerEl = document.getElementById('phone-cooking-banner')!;
  private readonly topNavEl = document.getElementById('phone-top-nav')!;
  private readonly bottomSheetEl = document.querySelector('.app-bottom-sheet') as HTMLElement;
  private readonly sheetBodyEl = document.getElementById('phone-sheet-body')!;

  private readonly zoomInBtn = document.getElementById('map-zoom-in')!;
  private readonly zoomOutBtn = document.getElementById('map-zoom-out')!;
  private readonly followBtn = document.getElementById('map-follow-btn')!;
  private readonly unzoomBtn = document.getElementById('phone-unzoom-btn')!;
  private readonly stowBtn = document.getElementById('phone-stow-btn')!;

  // 20-Second Incoming Call Popup DOM elements inside Zoomed Smartphone
  private readonly dispatchEls: DispatchPopupEls = {
    dispatchPopupEl: document.getElementById('phone-dispatch-popup')!,
    dispatchCardEl: document.getElementById('dispatch-popup-card')!,
    dpTypeBadgeEl: document.getElementById('dp-type-badge')!,
    dpRingFgEl: document.getElementById('dp-ring-fg')!,
    dpTimerTextEl: document.getElementById('dp-timer-text')!,
    dpFeeEl: document.getElementById('dp-fee')!,
    dpSubMetaEl: document.getElementById('dp-sub-meta')!,
    dpStopsEl: document.getElementById('dp-stops')!,
  };
  private readonly dispatchState: DispatchPopupState = { lastOfferPopupId: '', lastOfferPulseTick: 0 };

  private readonly callbacks: PhoneCallbacks;
  public placement: PhonePlacement = 'pocket';
  public isZoomed = false;
  public battery = 88; // 0..100% live smartphone battery
  public isWirelessCharging = false;
  private lowBatteryWarned = false;
  private deadBatteryWarned = false;
  public topNav: PhoneTopNav = 'calls';
  public activeTab: PhoneTab = 'calls';

  // GPS map camera / pan-drag state (see phone/mapView.ts)
  private readonly view: MapViewState = createMapViewState();
  private readonly touchState: TouchHandState = { tapTimer: null };
  private lastSheetFingerprint = '';
  private last3DRenderTime = -1;
  private lastZoomMapRenderTime = -1;
  private lastZoomMapLevel = -1;
  private lastZoomCanvasW = -1;
  private lastZoomCanvasH = -1;
  private readonly ripple3D: Ripple3DState = { current: null };
  private lastElapsed = 0;

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

    this.dispatchEls.dispatchPopupEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const target = e.target as HTMLElement;
      const btn = target.closest('button') as HTMLButtonElement | null;
      if (!btn) return;
      if (btn.dataset.action === 'accept_offer') {
        this.callbacks.onAcceptDispatchOffer();
      } else if (btn.dataset.action === 'reject_offer') {
        this.callbacks.onRejectDispatchOffer();
      }
    });

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
    if (this.isZoomed) return;
    if (active) {
      this.touchHandEl.style.transform = `translate3d(${clientX}px, ${clientY}px, 0)`;
      this.touchHandEl.classList.add('active');
      document.body.classList.add('phone-3d-hover');
    } else {
      this.touchHandEl.classList.remove('active', 'tapping');
      document.body.classList.remove('phone-3d-hover');
    }
  }

  /** Triggers a brief tap-down press on the 1st-person touching hand over the 3D phone */
  public triggerExternal3DHandTap(clientX: number, clientY: number): void {
    this.touchHandEl.style.transform = `translate3d(${clientX}px, ${clientY}px, 0)`;
    this.touchHandEl.classList.add('active', 'tapping');
    if (this.touchState.tapTimer !== null) {
      window.clearTimeout(this.touchState.tapTimer);
    }
    this.touchState.tapTimer = window.setTimeout(() => {
      this.touchHandEl.classList.remove('tapping');
      this.touchState.tapTimer = null;
    }, 170);
  }

  /**
   * Direct in-world UV touch hit-testing on the 360x680 3D phone screen canvas!
   * Allows riders to tap [👆 콜 수락] / [거절] right on the 3D handlebar or handheld phone
   * without opening the full-screen zoom modal.
   */
  public handle3DScreenTouch(
    u: number,
    v: number,
    hasActiveOffer: boolean
  ): 'accept_offer' | 'reject_offer' | 'zoom' {
    const cx = clamp(u, 0, 1) * this.texCanvas.width;
    const cy = clamp(1 - v, 0, 1) * this.texCanvas.height;

    // Show expanding touch ripple directly on the 3D phone canvas texture!
    this.ripple3D.current = { x: cx, y: cy, bornAt: this.lastElapsed };
    this.last3DRenderTime = -1;
    this.lastZoomMapRenderTime = -1;
    this.callbacks.onScreenTap?.();

    if (hasActiveOffer) {
      // Match split CTA button row drawn in render3DDispatchCallCard (y = 452..502, padded slightly for touch)
      if (cy >= 438 && cy <= 518) {
        if (cx >= 134 && cx <= 336) {
          return 'accept_offer';
        }
        if (cx >= 24 && cx < 134) {
          return 'reject_offer';
        }
      }
    }
    return 'zoom';
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

  private syncTopNavHighlight(): void {
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
    const clampedDt = Math.min(dt, 0.05);
    const chargingNow = this.placement === 'mounted' && scooterEngineOn;

    if (chargingNow && !this.isWirelessCharging && this.battery < 99.5) {
      onWirelessChargeStart?.();
    }
    this.isWirelessCharging = chargingNow;

    if (chargingNow) {
      this.battery = clamp(this.battery + 4.4 * chargeSpeedMul * clampedDt, 0, 100);
      if (this.battery > 18) this.lowBatteryWarned = false;
      if (this.battery > 3) this.deadBatteryWarned = false;
    } else {
      const drainRate = this.isZoomed ? 0.85 : this.placement === 'in_hand' ? 0.52 : 0.14;
      this.battery = clamp(this.battery - drainRate * clampedDt, 0, 100);
    }

    if (this.battery <= 15 && this.battery > 0 && !this.lowBatteryWarned && !chargingNow) {
      this.lowBatteryWarned = true;
      onLowBattery?.();
    }
    if (this.battery <= 0.05 && !this.deadBatteryWarned && !chargingNow) {
      this.deadBatteryWarned = true;
      onBatteryDead?.();
    }

    // Sync zoomed smartphone status bar & depleted lock overlay
    const pct = Math.round(this.battery);
    this.battPctEl.textContent = chargingNow ? `⚡${pct}%` : `${pct}%`;
    this.battFillEl.style.width = `${Math.max(4, pct)}%`;
    this.battWrapEl.classList.toggle('charging', chargingNow);
    this.battWrapEl.classList.toggle('low', !chargingNow && pct <= 15);
    this.deadOverlayEl.classList.toggle('hidden', this.battery > 0.05);
  }

  public rechargeBatteryFull(): void {
    this.battery = 100;
    this.lowBatteryWarned = false;
    this.deadBatteryWarned = false;
    this.last3DRenderTime = -1;
    this.lastZoomMapRenderTime = -1;
  }

  public setPlacement(next: PhonePlacement): void {
    this.placement = next;
    if (next === 'pocket') {
      this.isZoomed = false;
    }
    this.last3DRenderTime = -1;
    this.lastZoomMapRenderTime = -1;
    this.syncOverlayVisibility();
  }

  public setZoomed(zoomed: boolean): boolean {
    this.view.isMapDragging = false;
    this.view.dragPointerId = null;
    this.view.panVelX = 0;
    this.view.panVelZ = 0;
    this.zoomCanvas.classList.remove('dragging');
    if (this.placement === 'pocket') {
      this.isZoomed = false;
      this.syncOverlayVisibility();
      return false;
    }
    this.isZoomed = zoomed;
    this.syncOverlayVisibility();
    if (this.isZoomed) {
      this.lastSheetFingerprint = '';
      requestAnimationFrame(() => this.syncZoomCanvasSize());
    } else {
      this.view.followPlayer = true;
      this.followBtn.classList.add('active');
      this.touchHandEl.classList.remove('active', 'tapping');
      this.last3DRenderTime = -1;
    this.lastZoomMapRenderTime = -1;
    }
    return this.isZoomed;
  }

  public toggleZoom(isRiding: boolean): { zoomed: boolean; message: string } {
    if (this.placement === 'pocket') {
      return { zoomed: false, message: '먼저 [Tab]으로 휴대폰을 꺼내거나 거치대에 놓으세요' };
    }
    // Realistic physical possession restriction: phone left on scooter cannot be opened while on foot!
    if (this.placement === 'mounted' && !isRiding) {
      return {
        zoomed: false,
        message: '🚫 휴대폰이 오토바이 거치대에 있습니다! 오토바이 근처에서 [Tab]으로 먼저 챙기세요',
      };
    }
    const next = this.setZoomed(!this.isZoomed);
    return {
      zoomed: next,
      message: next
        ? '🔍 휴대폰 확대 보기 (묶음 콜 · 추천 동선 · 지도 조작 · V로 축소)'
        : this.placement === 'mounted'
          ? '오토바이 거치대 3D 내비게이션 시점으로 복귀'
          : '손에 든 3D 휴대폰 시점으로 복귀',
    };
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
    if (isRiding) {
      if (this.placement === 'mounted') {
        this.setPlacement('pocket');
        return {
          placement: 'pocket',
          anim: 'unmount',
          message: '📱 거치대에서 휴대폰을 빼서 주머니에 넣었습니다',
        };
      }
      this.setPlacement('mounted');
      return {
        placement: 'mounted',
        anim: 'mount',
        message: '📱 거치대에 휴대폰 장착! 라이딩 내비게이션 모드 활성화',
      };
    }

    if (this.placement === 'mounted') {
      if (!nearScooter) {
        return {
          placement: 'mounted',
          blocked: true,
          message: '🚫 휴대폰이 오토바이 거치대에 꽂혀 있습니다! 오토바이로 가서 [Tab]으로 챙기세요',
        };
      }
      this.setPlacement('pocket');
      return {
        placement: 'pocket',
        anim: 'unmount',
        message: '📱 오토바이 거치대에서 휴대폰을 챙겨 주머니에 넣었습니다',
      };
    }

    if (this.placement === 'in_hand') {
      this.setPlacement('pocket');
      return {
        placement: 'pocket',
        message: '휴대폰을 주머니에 넣었습니다',
      };
    }

    this.setPlacement('in_hand');
    return {
      placement: 'in_hand',
      message: '✋ 주머니에서 휴대폰을 꺼냈습니다 ([V] 또는 휴대폰 클릭으로 확대)',
    };
  }

  private syncOverlayVisibility(): void {
    const showZoomModal = this.placement !== 'pocket' && this.isZoomed;
    this.zoomBackdropEl.classList.toggle('hidden', !showZoomModal);
    this.phoneEl.classList.toggle('mode-hand', this.placement === 'in_hand');
    this.phoneEl.classList.toggle('mode-mounted', this.placement === 'mounted');
    this.pocketPillEl.classList.toggle('hidden', showZoomModal);

    if (this.placement === 'in_hand') {
      this.placementTagEl.textContent = '✋ 손에 든 휴대폰 (확대 보기)';
      this.stowBtn.textContent = '주머니로';
    } else if (this.placement === 'mounted') {
      this.placementTagEl.textContent = '🛵 오토바이 거치대 내비게이션 (확대 보기)';
      this.stowBtn.textContent = '분리';
    }
  }

  private syncZoomCanvasSize(): void {
    const rect = this.zoomCanvas.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetW = Math.round(rect.width * dpr);
    const targetH = Math.round(rect.height * dpr);
    if (this.zoomCanvas.width !== targetW || this.zoomCanvas.height !== targetH) {
      this.zoomCanvas.width = targetW;
      this.zoomCanvas.height = targetH;
    }
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
    this.lastElapsed = elapsedTime;
    const isRiding = player.mode === 'riding';

    if (!this.isZoomed) {
      const leftOnBike = this.placement === 'mounted' && !isRiding;
      this.pocketPillEl.classList.toggle('away', leftOnBike);
      this.pocketPillEl.classList.toggle('incoming', !leftOnBike && activeOffer !== null);

      if (leftOnBike) {
        this.pocketKeyEl.textContent = 'Tab';
        this.pocketPillTextEl.textContent = player.canMountScooter
          ? '오토바이 거치대에서 휴대폰 챙기기'
          : `휴대폰이 오토바이에 있음 (${player.inCorridor ? '1층' : `${player.distanceToScooter.toFixed(0)}m`})`;
      } else if (activeOffer !== null) {
        const typeLabel = activeOffer.type === 'SINGLE' ? '한집배달' : '알뜰 2건';
        const sec = Math.max(0, Math.ceil(activeOffer.remainingOfferSec));
        if (this.placement === 'pocket') {
          this.pocketKeyEl.textContent = 'Tab';
          this.pocketPillTextEl.textContent = `🔔 ${typeLabel} ₩${activeOffer.totalFee.toLocaleString()} (${sec}초) · 폰 꺼내기`;
        } else {
          this.pocketKeyEl.textContent = 'Tab/V';
          this.pocketPillTextEl.textContent = `🔔 ${typeLabel} ₩${activeOffer.totalFee.toLocaleString()} (${sec}초) · 즉시 수락!`;
        }
      } else if (this.placement === 'pocket') {
        this.pocketKeyEl.textContent = 'Tab';
        this.pocketPillTextEl.textContent = isRiding
          ? '거치대에 휴대폰 장착 (내비게이션)'
          : '주머니에서 휴대폰 꺼내기';
      } else {
        this.pocketKeyEl.textContent = 'V';
        this.pocketPillTextEl.textContent =
          this.placement === 'mounted'
            ? '거치대 폰 확대 (Tab: 주머니로)'
            : '손에 든 폰 확대 (Tab: 주머니로)';
      }
      this.pocketBadgeEl.classList.toggle(
        'hidden',
        delivery.activeMissions.length === 0 && activeOffer === null
      );
    }

    if (this.placement === 'pocket') {
      return;
    }

    stepMapCamera(this.view, player, this.isZoomed);

    // In-game time (GameClock via Hud.setClock); falls back to the device clock before the first frame
    const now = new Date();
    const clockStr =
      this.clockLabel ?? `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const areaName = resolveAreaName(player.x, player.z, mapInfo);

    if (this.isZoomed) {
      this.syncZoomCanvasSize();
      this.phoneEl.classList.toggle('night', isNight);
      this.clockEl.textContent = clockStr;
      this.areaEl.textContent = areaName;
      this.earningsEl.textContent = `₩${delivery.totalEarnings.toLocaleString()} (${delivery.completedCount}건)`;

      const kmh = Math.round(Math.abs(scooter.speed) * 3.6);
      const bundleSuffix =
        delivery.activeMissions.length > 0
          ? ` · 묶음 ${delivery.activeMissions.length}/${MAX_CONCURRENT_ORDERS}`
          : '';
      if (player.mode === 'knockdown') {
        this.statusPillEl.textContent = '💥 넘어짐! 회복 중';
        this.statusPillEl.className = 'app-status-pill danger';
      } else if (isRiding) {
        this.statusPillEl.textContent =
          kmh > 0 ? `🛵 주행 ${kmh}km/h${bundleSuffix}` : `🛵 대기${bundleSuffix}`;
        this.statusPillEl.className = 'app-status-pill riding';
      } else {
        this.statusPillEl.textContent = `🚶 도보 · 바이크 ${player.distanceToScooter.toFixed(0)}m`;
        this.statusPillEl.className = 'app-status-pill foot';
      }

      this.syncDeliverySheet(player, delivery, navPlan);
      syncPinTooltip(this.pinTooltipEl, delivery, navPlan);
      syncCameraAlertBanner(this.camAlertEl, mapInfo);
      syncCookingBanner(this.cookingBannerEl, delivery);
      syncDispatchPopup(this.dispatchEls, this.dispatchState, activeOffer, delivery);

      // Zoomed phone map redraws at 10Hz (was every frame). Redraw right away while the rider is
      // dragging / flicking / zooming it, or after a canvas resize (which clears it), so input stays smooth.
      const v = this.view;
      const interacting =
        v.isMapDragging || Math.abs(v.panVelX) + Math.abs(v.panVelZ) > 0.01 || v.zoomLevel !== this.lastZoomMapLevel;
      const resized = this.zoomCanvas.width !== this.lastZoomCanvasW || this.zoomCanvas.height !== this.lastZoomCanvasH;
      if (
        !interacting &&
        !resized &&
        this.lastZoomMapRenderTime >= 0 &&
        elapsedTime - this.lastZoomMapRenderTime < PHONE_MAP_REFRESH_SEC
      ) {
        return;
      }
      this.lastZoomMapRenderTime = elapsedTime;
      this.lastZoomMapLevel = v.zoomLevel;
      this.lastZoomCanvasW = this.zoomCanvas.width;
      this.lastZoomCanvasH = this.zoomCanvas.height;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderMapToContext(
        this.zoomCtx,
        this.zoomCanvas.width / dpr,
        this.zoomCanvas.height / dpr,
        dpr,
        this.view,
        player,
        scooter,
        navPlan,
        signalState,
        isNight,
        elapsedTime,
        mapInfo,
        false
      );
    } else {
      // Throttle 3D CanvasTexture redraw + GPU upload to 10Hz
      if (elapsedTime - this.last3DRenderTime < PHONE_MAP_REFRESH_SEC && this.last3DRenderTime >= 0) {
        return;
      }
      this.last3DRenderTime = elapsedTime;

      render3DPhoneScreen(
        this.texCanvas,
        this.texCtx,
        {
          battery: this.battery,
          isWirelessCharging: this.isWirelessCharging,
          placement: this.placement,
        },
        this.view,
        this.ripple3D,
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
        areaName
      );
      this.screenTexture.needsUpdate = true;
    }
  }

  private syncDeliverySheet(
    player: PlayerState,
    delivery: DeliveryManager,
    navPlan: NavigationPlan
  ): void {
    const fingerprint = computeDeliverySheetFingerprint(this.activeTab, player, delivery, navPlan);
    if (fingerprint === this.lastSheetFingerprint) return;
    this.lastSheetFingerprint = fingerprint;

    this.syncTopNavHighlight();
    this.sheetBodyEl.innerHTML = renderDeliverySheetHtml(
      this.topNav,
      this.activeTab,
      player,
      delivery,
      navPlan
    );
  }
}
