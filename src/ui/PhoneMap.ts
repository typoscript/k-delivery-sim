import * as THREE from 'three';
import { PlayerState } from '../player/PlayerController';
import { ScooterState } from '../vehicle/ScooterPhysics';
import { CityMapInfo } from '../world/CityWorld';
import {
  ActiveMission,
  CARGO_SLOT_COUNT,
  DeliveryManager,
  MAX_CONCURRENT_ORDERS,
  NavigationPlan,
  getInstructionMeta,
} from '../delivery/DeliveryManager';
import { DispatchOffer } from '../delivery/OrderDispatchManager';
import { SignalStateSnapshot } from '../world/TrafficSystem';
import { TurnDirection } from '../world/RoadNavigator';
import { clamp } from '../types';
import { ACTIVE_DISTRICT, ACTIVE_MAP_DATA } from '../data/suwonDistricts';

export type PhonePlacement = 'pocket' | 'in_hand' | 'mounted';
export type PhoneTopNav = 'calls' | 'nav' | 'earnings';
export type PhoneTab = 'calls' | 'accepted' | 'checklist' | 'route' | 'finance';

export interface PhoneCallbacks {
  onAcceptOrder: (orderId: string) => void;
  onAcceptDispatchOffer: () => void;
  onRejectDispatchOffer: () => void;
  onRefreshOrders: () => void;
  onCancelMission: (orderId: string) => void;
  onSelectMission: (missionId: string | null) => void;
  onOpenDailyReport: () => void;
  onInteractMission: () => void;
  onTogglePhone: () => void;
  onToggleZoom: () => void;
  onScreenTap?: () => void;
}

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
  private touchTapTimer: number | null = null;
  private readonly pocketPillEl = document.getElementById('phone-pocket-pill')!;
  private readonly pocketKeyEl = document.getElementById('pocket-pill-key')!;
  private readonly pocketPillTextEl = document.getElementById('pocket-pill-text')!;
  private readonly pocketBadgeEl = document.getElementById('pocket-mission-dot')!;
  private readonly placementTagEl = document.getElementById('phone-placement-tag')!;

  private readonly zoomCanvas = document.getElementById('phone-map-canvas') as HTMLCanvasElement;
  private readonly zoomCtx = this.zoomCanvas.getContext('2d')!;
  private readonly clockEl = document.getElementById('phone-clock')!;
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
  private readonly dispatchPopupEl = document.getElementById('phone-dispatch-popup')!;
  private readonly dispatchCardEl = document.getElementById('dispatch-popup-card')!;
  private readonly dpTypeBadgeEl = document.getElementById('dp-type-badge')!;
  private readonly dpRingFgEl = document.getElementById('dp-ring-fg')!;
  private readonly dpTimerTextEl = document.getElementById('dp-timer-text')!;
  private readonly dpFeeEl = document.getElementById('dp-fee')!;
  private readonly dpSubMetaEl = document.getElementById('dp-sub-meta')!;
  private readonly dpStopsEl = document.getElementById('dp-stops')!;
  private lastOfferPopupId = '';
  private lastOfferPulseTick = 0;

  private readonly callbacks: PhoneCallbacks;
  public placement: PhonePlacement = 'pocket';
  public isZoomed = false;
  public topNav: PhoneTopNav = 'calls';
  public activeTab: PhoneTab = 'calls';

  private followPlayer = true;
  private zoomLevel = 1.4;
  private camX = ACTIVE_MAP_DATA.meta.playerSpawn.x;
  private camZ = ACTIVE_MAP_DATA.meta.playerSpawn.z;
  private lastSheetFingerprint = '';
  private last3DRenderTime = -1;
  private ripple3D: { x: number; y: number; bornAt: number } | null = null;
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

    this.zoomInBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.zoomLevel = clamp(this.zoomLevel + 0.32, 0.48, 2.8);
    });

    this.zoomOutBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.zoomLevel = clamp(this.zoomLevel - 0.32, 0.48, 2.8);
    });

    this.followBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.followPlayer = !this.followPlayer;
      this.followBtn.classList.toggle('active', this.followPlayer);
      this.zoomLevel = this.followPlayer ? 1.5 : 0.56;
    });

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
      } else if (action === 'interact') {
        this.callbacks.onInteractMission();
      }
    });

    this.dispatchPopupEl.addEventListener('click', (e) => {
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
    this.setupTouchHandInteraction();
    this.setPlacement('pocket');
  }

  /** Wires realistic 1st-person touching hand & glass tap ripples across the zoomed smartphone screen */
  private setupTouchHandInteraction(): void {
    const positionHand = (clientX: number, clientY: number) => {
      this.touchHandEl.style.transform = `translate3d(${clientX}px, ${clientY}px, 0)`;
    };

    this.phoneScreenEl.addEventListener('pointerenter', (e) => {
      if (!this.isZoomed) return;
      positionHand(e.clientX, e.clientY);
      this.touchHandEl.classList.add('active');
    });

    this.phoneScreenEl.addEventListener('pointermove', (e) => {
      if (!this.isZoomed) return;
      positionHand(e.clientX, e.clientY);
      if (!this.touchHandEl.classList.contains('active')) {
        this.touchHandEl.classList.add('active');
      }
    });

    this.phoneScreenEl.addEventListener('pointerleave', () => {
      this.touchHandEl.classList.remove('active', 'tapping');
    });

    this.phoneScreenEl.addEventListener('pointerdown', (e) => {
      if (!this.isZoomed) return;
      positionHand(e.clientX, e.clientY);
      this.touchHandEl.classList.add('active', 'tapping');

      if (this.touchTapTimer !== null) {
        window.clearTimeout(this.touchTapTimer);
      }
      this.touchTapTimer = window.setTimeout(() => {
        this.touchHandEl.classList.remove('tapping');
        this.touchTapTimer = null;
      }, 170);

      // Spawn capacitive glass touch ripple at exact fingertip location on screen
      const rect = this.phoneScreenEl.getBoundingClientRect();
      const rx = e.clientX - rect.left;
      const ry = e.clientY - rect.top;
      const ripple = document.createElement('span');
      ripple.className = 'phone-touch-ripple';
      ripple.style.left = `${rx}px`;
      ripple.style.top = `${ry}px`;
      this.touchRippleLayerEl.appendChild(ripple);
      window.setTimeout(() => ripple.remove(), 420);

      this.callbacks.onScreenTap?.();
    });

    window.addEventListener('pointerup', () => {
      this.touchHandEl.classList.remove('tapping');
    });
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
    if (this.touchTapTimer !== null) {
      window.clearTimeout(this.touchTapTimer);
    }
    this.touchTapTimer = window.setTimeout(() => {
      this.touchHandEl.classList.remove('tapping');
      this.touchTapTimer = null;
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
    this.ripple3D = { x: cx, y: cy, bornAt: this.lastElapsed };
    this.last3DRenderTime = -1;
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
      this.activeTab = 'finance';
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

  public setPlacement(next: PhonePlacement): void {
    this.placement = next;
    if (next === 'pocket') {
      this.isZoomed = false;
    }
    this.last3DRenderTime = -1;
    this.syncOverlayVisibility();
  }

  public setZoomed(zoomed: boolean): boolean {
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
      this.touchHandEl.classList.remove('active', 'tapping');
      this.last3DRenderTime = -1;
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

    const targetX = this.followPlayer ? player.x : 0;
    const targetZ = this.followPlayer ? player.z : 0;
    this.camX += (targetX - this.camX) * 0.16;
    this.camZ += (targetZ - this.camZ) * 0.16;

    const now = new Date();
    const clockStr = `${String(now.getHours()).padStart(2, '0')}:${String(
      now.getMinutes()
    ).padStart(2, '0')}`;
    const areaName = this.resolveAreaName(player.x, player.z, mapInfo);

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
      this.syncPinTooltip(delivery, navPlan);
      this.syncCameraAlertBanner(mapInfo);
      this.syncCookingBanner(delivery);
      this.syncDispatchPopup(activeOffer);

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.renderMapToContext(
        this.zoomCtx,
        this.zoomCanvas.width / dpr,
        this.zoomCanvas.height / dpr,
        dpr,
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
      // Throttle 3D CanvasTexture updates to ~20Hz for smooth GPU performance
      if (elapsedTime - this.last3DRenderTime < 0.05 && this.last3DRenderTime >= 0) {
        return;
      }
      this.last3DRenderTime = elapsedTime;

      this.render3DPhoneScreen(
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

  /** Highlights Korean apartment lobby PIN pattern & delivery instruction at the top of the smartphone app */
  private syncPinTooltip(delivery: DeliveryManager, navPlan: NavigationPlan): void {
    const focus = navPlan.focusMission ?? delivery.activeMission;
    if (!focus) {
      this.pinTooltipEl.classList.add('hidden');
      return;
    }
    const inst = getInstructionMeta(focus.order.deliveryInstruction);
    const villaTxt =
      focus.order.customer.residenceKind === 'walkup_villa' ? ' · 🪜계단' : '';
    const chatTxt = focus.chatNote ? ` · 💬${focus.chatNote}` : '';
    this.pinTooltipEl.innerHTML = `🔑 <b>${focus.order.doorPinLabel}</b> · ${focus.order.unitNumber}${villaTxt} · ${inst.badge}${chatTxt}`;
    this.pinTooltipEl.classList.remove('hidden');
  }

  /** Shows 80m speed-camera approach warning strip inside zoomed smartphone topbar */
  private syncCameraAlertBanner(mapInfo: CityMapInfo): void {
    const cam = mapInfo.upcomingCamera;
    if (!cam) {
      this.camAlertEl.classList.add('hidden');
      return;
    }
    this.camAlertEl.className = `phone-cam-alert${cam.isOverSpeed ? ' overspeed' : ''}`;
    this.camAlertEl.innerHTML = `
      <span>📷 전방 ${cam.distanceMeters}m 신호·과속 단속</span>
      <span>${cam.isOverSpeed ? '🚨 감속!' : `제한 ${cam.limitKmh}`}</span>
    `;
  }

  /** Shows yellow cooking delay gauge (or emerald ready banner) inside zoomed smartphone topbar */
  private syncCookingBanner(delivery: DeliveryManager): void {
    const cm = delivery.getPrimaryCookingMission();
    if (!cm) {
      this.cookingBannerEl.classList.add('hidden');
      return;
    }
    this.cookingBannerEl.classList.remove('hidden');
    if (cm.phase === 'cooking_wait') {
      const rem = Math.max(1, Math.ceil(cm.cookingRemainingSec));
      const pct =
        cm.cookingDurationSec > 0
          ? clamp((cm.cookingRemainingSec / cm.cookingDurationSec) * 100, 0, 100)
          : 0;
      this.cookingBannerEl.className = 'phone-cooking-banner';
      this.cookingBannerEl.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:6px">
          <span>🍳 ${cm.order.shop.name} [#${cm.order.orderNumber}] 조리 중</span>
          <span>남은 ${rem}초</span>
        </div>
        <div class="phone-ck-track"><div class="phone-ck-fill" style="width:${pct.toFixed(1)}%"></div></div>
      `;
    } else {
      this.cookingBannerEl.className = 'phone-cooking-banner ready';
      this.cookingBannerEl.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:6px">
          <span>🔔 ${cm.order.shop.name} [#${cm.order.orderNumber}] 조리 완료!</span>
          <span>트레이 [E] 수령</span>
        </div>
        <div class="phone-ck-track"><div class="phone-ck-fill" style="width:100%"></div></div>
      `;
    }
  }

  /** Syncs the interactive 20s circular progress call popup inside the zoomed smartphone UI */
  private syncDispatchPopup(offer: DispatchOffer | null): void {
    if (!offer) {
      this.dispatchPopupEl.classList.add('hidden');
      this.lastOfferPopupId = '';
      return;
    }

    this.dispatchPopupEl.classList.remove('hidden');
    const isSingle = offer.type === 'SINGLE';

    if (offer.id !== this.lastOfferPopupId || offer.pulseTick !== this.lastOfferPulseTick) {
      this.lastOfferPopupId = offer.id;
      this.lastOfferPulseTick = offer.pulseTick;

      this.dispatchCardEl.classList.toggle('alttle', !isSingle);
      this.dispatchCardEl.classList.remove('vibrate');
      void this.dispatchCardEl.offsetWidth;
      this.dispatchCardEl.classList.add('vibrate');

      this.dpTypeBadgeEl.className = `dp-type-badge ${isSingle ? 'single' : 'alttle'}`;
      this.dpTypeBadgeEl.textContent = isSingle
        ? '🚀 한집배달 · 단건 직행'
        : '🛵 알뜰배달 · 2건 묶음';

      const rainTag = offer.totalRainBonus > 0 ? ` (🌧️우천+₩${offer.totalRainBonus.toLocaleString()})` : '';
      this.dpFeeEl.textContent = `₩${offer.totalFee.toLocaleString()}`;
      this.dpSubMetaEl.textContent = `제한 ${Math.round(offer.timeLimitSec / 60)}분(${offer.timeLimitSec}초) · 총 ${offer.totalDistanceMeters}m${rainTag}`;

      this.dpStopsEl.innerHTML = offer.orders
        .map(
          (o, idx) => `
          <div class="dp-stop-item">
            <div class="dp-stop-shop">${offer.orders.length > 1 ? `${idx + 1}. ` : ''}${o.shop.emoji} ${o.shop.name} <span class="ord-tag">#${o.orderNumber}</span> <span class="food-meta-chip ${o.foodTempType === 'cold' ? 'cold' : o.isSpillSensitive ? 'spill' : ''}">${o.foodCategoryTag}</span></div>
            <div class="dp-stop-cust">→ ${o.customer.emoji} ${o.customer.name} ${o.unitNumber}${o.customer.residenceKind === 'walkup_villa' ? ' <span class="villa-tag">🪜계단+500</span>' : ''} · ${getInstructionMeta(o.deliveryInstruction).badge}</div>
          </div>`
        )
        .join('');
    }

    // Smooth circular SVG ring countdown (r=18 -> circumference = 113.097)
    const frac = clamp(offer.remainingOfferSec / offer.durationOfferSec, 0, 1);
    const circ = 113.1;
    this.dpRingFgEl.style.strokeDashoffset = String((1 - frac) * circ);
    this.dpRingFgEl.setAttribute(
      'class',
      `dp-ring-fg ${offer.remainingOfferSec <= 5 ? 'urgent' : offer.remainingOfferSec <= 10 ? 'warn' : ''}`
    );
    this.dpTimerTextEl.textContent = String(Math.max(0, Math.ceil(offer.remainingOfferSec)));
  }

  /**
   * Renders the 3D Smartphone CanvasTexture:
   * - While Riding + Mounted: Live Turn-by-Turn Navigation Mode (heading-up rotating minimap + turn arrow + remaining m!)
   * - While On Foot + In Hand: North-up GPS map + bundled delivery summary & cargo slot pips
   * - Whenever a 20s Call Offer is active: overlays the centered vibrating Circular Progress Call Card!
   */
  private render3DPhoneScreen(
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
    const ctx = this.texCtx;
    const w = this.texCanvas.width;
    const h = this.texCanvas.height;
    const isRidingNavMode = player.mode === 'riding' && this.placement === 'mounted';

    // 1. Live GPS map background (Heading-Up rotating minimap when riding!)
    this.renderMapToContext(
      ctx,
      w,
      h,
      1,
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
    ctx.fillText(isRidingNavMode ? 'NAVI · 5G 🔋' : '5G 🔋', w - 14, 18);

    if (isRidingNavMode) {
      this.renderRidingNavOverlay(ctx, w, h, scooter, delivery, navPlan, isNight, areaName, mapInfo, elapsedTime);
    } else {
      this.renderOnFootPhoneOverlay(ctx, w, h, player, delivery, navPlan, isNight, areaName);
    }

    // Centered 20-Second Incoming Call Popup Card on the 3D Mounted / Handheld Phone Screen!
    if (activeOffer) {
      this.render3DDispatchCallCard(ctx, w, h, activeOffer, elapsedTime);
    }

    // Expanding capacitive glass touch ripple rendered directly onto the 3D phone screen!
    if (this.ripple3D) {
      const age = elapsedTime - this.ripple3D.bornAt;
      if (age >= 0 && age < 0.42) {
        const p = age / 0.42;
        const radius = 10 + p * 36;
        ctx.save();
        ctx.strokeStyle = `rgba(45, 212, 191, ${(1 - p) * 0.95})`;
        ctx.fillStyle = `rgba(45, 212, 191, ${(1 - p) * 0.3})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(this.ripple3D.x, this.ripple3D.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      } else {
        this.ripple3D = null;
      }
    }

    ctx.restore();
  }

  /** Draws the vibrating 20-second circular-progress Baemin Connect style call card on the 3D phone screen */
  private render3DDispatchCallCard(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    offer: DispatchOffer,
    elapsedTime: number
  ): void {
    const isSingle = offer.type === 'SINGLE';
    const frac = clamp(offer.remainingOfferSec / offer.durationOfferSec, 0, 1);
    const secLeft = Math.max(0, Math.ceil(offer.remainingOfferSec));

    // Dim backdrop over map so call card pops clearly while riding
    ctx.fillStyle = 'rgba(7, 12, 24, 0.72)';
    ctx.fillRect(0, 34, w, h - 34);

    // Subtle phone vibration jitter during first 0.7s of arrival or final 5s urgency!
    const age = offer.durationOfferSec - offer.remainingOfferSec;
    const isVibrating = age < 0.7 || offer.remainingOfferSec <= 5.0;
    const shakeX = isVibrating ? Math.sin(elapsedTime * 55) * 4.2 : 0;

    const cardX = 18 + shakeX;
    const cardW = w - 36;
    const cardH = 344;
    const cardY = (h - cardH) * 0.5 + 8;

    ctx.save();
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = isSingle ? '#2dd4bf' : '#a78bfa';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, 24);
    ctx.fill();
    ctx.stroke();

    // Header delivery type badge
    ctx.fillStyle = isSingle ? '#0d9488' : '#7c3aed';
    ctx.beginPath();
    ctx.roundRect(cardX + 16, cardY + 18, 178, 32, 16);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14.5px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isSingle ? '🚀 한집배달 (직행)' : '🛵 알뜰배달 (2건)', cardX + 105, cardY + 34);

    // 20-Second Circular Progress Ring Timer (top right of card)
    const ringCx = cardX + cardW - 44;
    const ringCy = cardY + 46;
    const ringR = 26;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(ringCx, ringCy, ringR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle =
      offer.remainingOfferSec <= 5 ? '#ef4444' : offer.remainingOfferSec <= 10 ? '#f59e0b' : '#2dd4bf';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(ringCx, ringCy, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(secLeft), ringCx, ringCy + 1);

    // Total Payout Fee
    ctx.fillStyle = '#34d399';
    ctx.font = '900 36px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`₩${offer.totalFee.toLocaleString()}`, cardX + 18, cardY + 86);

    // Time limit & total distance subline
    ctx.fillStyle = offer.totalRainBonus > 0 ? '#38bdf8' : '#94a3b8';
    ctx.font = 'bold 13.5px sans-serif';
    const metaLine =
      offer.totalRainBonus > 0
        ? `제한 ${offer.timeLimitSec}초 · ${offer.totalDistanceMeters}m · 🌧️할증포함`
        : `제한시간 ${offer.timeLimitSec}초 · 총 거리 ${offer.totalDistanceMeters}m`;
    ctx.fillText(metaLine, cardX + 18, cardY + 116);

    // Orders breakdown box
    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.beginPath();
    ctx.roundRect(cardX + 16, cardY + 134, cardW - 32, 128, 14);
    ctx.fill();

    offer.orders.forEach((o, i) => {
      const oy = cardY + 158 + i * 56;
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'left';
      const prefix = offer.orders.length > 1 ? `${i + 1}. ` : '';
      ctx.fillText(`${prefix}${o.shop.emoji} ${o.shop.name} [#${o.orderNumber}]`, cardX + 28, oy);

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '600 13.5px sans-serif';
      ctx.fillText(`→ ${o.customer.emoji} ${o.customer.name} ${o.unitNumber}`, cardX + 28, oy + 23);
    });

    // Bottom Split Touch Buttons on 3D Phone: [거절] (left) & [👆 콜 수락] (right) — directly clickable in 3D!
    // Reject button (x: 34..128, y: cardY+276..cardY+326)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.beginPath();
    ctx.roundRect(cardX + 16, cardY + 276, 94, 50, 14);
    ctx.fill();
    ctx.fillStyle = '#cbd5e1';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('거절', cardX + 63, cardY + 301);

    // Accept button (x: 138..326, y: cardY+276..cardY+326)
    ctx.fillStyle = isSingle ? '#0d9488' : '#7c3aed';
    ctx.beginPath();
    ctx.roundRect(cardX + 120, cardY + 276, cardW - 136, 50, 14);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 17.5px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('👆 바로 터치 수락', cardX + 120 + (cardW - 136) / 2, cardY + 301);

    ctx.restore();
  }

  /** High-contrast 3D Handlebar Turn-by-Turn Navigation HUD while riding */
  private renderRidingNavOverlay(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    scooter: ScooterState,
    delivery: DeliveryManager,
    navPlan: NavigationPlan,
    isNight: boolean,
    areaName: string,
    mapInfo: CityMapInfo,
    elapsedTime: number
  ): void {
    const g = navPlan.guidance;
    const fm = navPlan.focusMission;

    if (g && fm) {
      // --- Top Turn-by-Turn Banner ---
      const bannerBg = navPlan.isPickupTarget ? '#c2410c' : '#047857';
      const accentBg = navPlan.isPickupTarget ? '#ea580c' : '#059669';

      ctx.fillStyle = bannerBg;
      ctx.beginPath();
      ctx.roundRect(12, 42, w - 24, 134, 18);
      ctx.fill();

      // Left Turn Arrow Box
      ctx.fillStyle = 'rgba(0, 0, 0, 0.24)';
      ctx.beginPath();
      ctx.roundRect(22, 52, 86, 86, 14);
      ctx.fill();
      this.drawTurnArrowIcon(ctx, 65, 95, g.direction);

      // Right Distance & Instruction
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 38px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${g.distanceToTurn}m`, 122, 80);

      ctx.fillStyle = '#d1fae5';
      ctx.font = 'bold 16px sans-serif';
      const shortInstr =
        g.direction === 'left'
          ? '좌회전'
          : g.direction === 'right'
            ? '우회전'
            : g.direction === 'uturn'
              ? '유턴 (경로 이탈)'
              : g.direction === 'arrive'
                ? '목적지 도착 부근'
                : '직진 주행';
      ctx.fillText(shortInstr, 122, 114);

      // Target sub-strip at bottom of turn card
      ctx.fillStyle = accentBg;
      ctx.beginPath();
      ctx.roundRect(20, 144, w - 40, 26, 8);
      ctx.fill();

      const destTitle = navPlan.isPickupTarget
        ? `픽업 #${fm.order.orderNumber} ${fm.order.shop.name}`
        : `배달 #${fm.order.orderNumber} ${fm.order.customer.name} ${fm.order.unitNumber}`;
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12.5px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(destTitle.slice(0, 22), 28, 157);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#a7f3d0';
      ctx.fillText(`남은 ${g.totalDistance}m`, w - 28, 157);
    } else {
      // No active delivery yet -> clean cruising navigation header
      ctx.fillStyle = isNight ? 'rgba(15, 23, 42, 0.92)' : 'rgba(255, 255, 255, 0.95)';
      ctx.beginPath();
      ctx.roundRect(12, 42, w - 24, 72, 16);
      ctx.fill();

      ctx.fillStyle = '#14b8a6';
      ctx.beginPath();
      ctx.arc(30, 66, 6, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = isNight ? '#f8fafc' : '#0f172a';
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`🧭 내비 대기 · ${areaName}`, 44, 67);

      ctx.fillStyle = isNight ? '#94a3b8' : '#475569';
      ctx.font = 'bold 13.5px sans-serif';
      ctx.fillText(
        `신규 콜 ${delivery.availableOrders.length}건 대기 · [V] 확대로 수락`,
        26,
        96
      );
    }

    // 80m Forward Speed-Camera Navi Warning Strip on 3D Handlebar Smartphone!
    const upCam = mapInfo.upcomingCamera;
    if (upCam) {
      const alertY = g && fm ? 184 : 122;
      const flashRed = upCam.isOverSpeed && Math.floor(elapsedTime * 6) % 2 === 0;
      ctx.fillStyle = upCam.isOverSpeed
        ? flashRed
          ? 'rgba(220, 38, 38, 0.96)'
          : 'rgba(153, 27, 27, 0.95)'
        : 'rgba(234, 179, 8, 0.95)';
      ctx.strokeStyle = upCam.isOverSpeed ? '#fecaca' : '#0f172a';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(12, alertY, w - 24, 42, 12);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = upCam.isOverSpeed ? '#ffffff' : '#0f172a';
      ctx.font = '900 14.5px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`📷 전방 ${upCam.distanceMeters}m 신호·과속 단속`, 22, alertY + 21);

      ctx.textAlign = 'right';
      ctx.fillText(upCam.isOverSpeed ? '🚨 감속!' : `제한 ${upCam.limitKmh}`, w - 22, alertY + 21);
    }

    // Yellow Cooking Delay Countdown Gauge Strip on 3D Mounted Handlebar Smartphone!
    const cookM = delivery.getPrimaryCookingMission();
    if (cookM) {
      const barY = (g && fm ? 184 : 122) + (upCam ? 48 : 0);
      const isWaiting = cookM.phase === 'cooking_wait';
      const frac =
        isWaiting && cookM.cookingDurationSec > 0
          ? clamp(cookM.cookingRemainingSec / cookM.cookingDurationSec, 0, 1)
          : 1;
      const remSec = Math.max(1, Math.ceil(cookM.cookingRemainingSec));

      ctx.fillStyle = isWaiting ? 'rgba(28, 22, 6, 0.94)' : 'rgba(6, 52, 36, 0.95)';
      ctx.strokeStyle = isWaiting ? '#facc15' : '#34d399';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(12, barY, w - 24, 54, 14);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isWaiting ? '#fef08a' : '#a7f3d0';
      ctx.font = 'bold 13.5px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        isWaiting
          ? `🍳 ${cookM.order.shop.name} [#${cookM.order.orderNumber}] 조리 중`
          : `🔔 ${cookM.order.shop.name} [#${cookM.order.orderNumber}] 준비 완료!`,
        22,
        barY + 18
      );

      ctx.textAlign = 'right';
      ctx.fillStyle = isWaiting ? '#fde047' : '#34d399';
      ctx.font = '900 14px sans-serif';
      ctx.fillText(isWaiting ? `${remSec}초` : '[E] 수령', w - 22, barY + 18);

      // Yellow countdown progress bar
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.roundRect(22, barY + 34, w - 44, 10, 5);
      ctx.fill();
      ctx.fillStyle = isWaiting ? '#facc15' : '#34d399';
      ctx.beginPath();
      ctx.roundRect(22, barY + 34, (w - 44) * frac, 10, 5);
      ctx.fill();
    }

    // --- Bottom Compact Riding Telemetry + Cargo Slots Strip ---
    const botY = h - 126;
    ctx.fillStyle = isNight ? 'rgba(15, 23, 42, 0.94)' : 'rgba(255, 255, 255, 0.95)';
    ctx.beginPath();
    ctx.roundRect(12, botY, w - 24, 114, 18);
    ctx.fill();

    const kmh = Math.round(Math.abs(scooter.speed) * 3.6);
    ctx.fillStyle = isNight ? '#38bdf8' : '#0284c7';
    ctx.font = '900 32px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${kmh}`, 24, botY + 34);
    ctx.fillStyle = isNight ? '#94a3b8' : '#64748b';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('km/h', 24 + (kmh >= 10 ? 44 : 26), botY + 40);

    // Bundle count pill
    ctx.fillStyle = delivery.activeMissions.length > 0 ? '#059669' : '#475569';
    ctx.beginPath();
    ctx.roundRect(w - 134, botY + 14, 110, 26, 13);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12.5px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      `묶음 ${delivery.activeMissions.length}/${MAX_CONCURRENT_ORDERS}건`,
      w - 79,
      botY + 27
    );

    // 3 Cargo Slot Pips
    const slotW = (w - 56) / 3;
    for (let i = 0; i < CARGO_SLOT_COUNT; i++) {
      const sm = delivery.getCargoSlotMission(i);
      const sx = 22 + i * (slotW + 6);
      const sy = botY + 56;
      ctx.fillStyle = sm
        ? 'rgba(16, 185, 129, 0.22)'
        : isNight
          ? 'rgba(255,255,255,0.08)'
          : '#e2e8f0';
      ctx.beginPath();
      ctx.roundRect(sx, sy, slotW, 24, 7);
      ctx.fill();

      ctx.fillStyle = sm ? (isNight ? '#34d399' : '#047857') : '#64748b';
      ctx.font = 'bold 11.5px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(sm ? `📦${i + 1} #${sm.order.orderNumber}` : `슬롯${i + 1} 빈칸`, sx + slotW / 2, sy + 12);
    }

    // Next stop preview line
    const nextStop = navPlan.recommendedStops[1];
    ctx.fillStyle = isNight ? '#cbd5e1' : '#334155';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'left';
    const nextText = nextStop
      ? `다음 경유: ${nextStop.emoji} ${nextStop.label} (#${nextStop.orderNumber})`
      : navPlan.recommendedStops.length === 1
        ? '마지막 목적지입니다 · [V]로 상세 보기'
        : '[V] 또는 화면 클릭으로 배달앱 확대';
    ctx.fillText(nextText.slice(0, 32), 24, botY + 98);
  }

  /** Draws a crisp high-contrast vector turn arrow inside the 3D riding navigation header */
  private drawTurnArrowIcon(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    dir: TurnDirection
  ): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = '#39ff14';
    ctx.fillStyle = '#39ff14';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (dir === 'straight') {
      ctx.beginPath();
      ctx.moveTo(0, 26);
      ctx.lineTo(0, -18);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -28);
      ctx.lineTo(-15, -8);
      ctx.lineTo(15, -8);
      ctx.closePath();
      ctx.fill();
    } else if (dir === 'left') {
      ctx.beginPath();
      ctx.moveTo(12, 26);
      ctx.lineTo(12, -2);
      ctx.quadraticCurveTo(12, -12, 2, -12);
      ctx.lineTo(-14, -12);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-26, -12);
      ctx.lineTo(-7, -26);
      ctx.lineTo(-7, 2);
      ctx.closePath();
      ctx.fill();
    } else if (dir === 'right') {
      ctx.beginPath();
      ctx.moveTo(-12, 26);
      ctx.lineTo(-12, -2);
      ctx.quadraticCurveTo(-12, -12, -2, -12);
      ctx.lineTo(14, -12);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(26, -12);
      ctx.lineTo(7, -26);
      ctx.lineTo(7, 2);
      ctx.closePath();
      ctx.fill();
    } else if (dir === 'uturn') {
      ctx.beginPath();
      ctx.moveTo(14, 24);
      ctx.lineTo(14, -6);
      ctx.arc(0, -6, 14, 0, Math.PI, true);
      ctx.lineTo(-14, 12);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-14, 24);
      ctx.lineTo(-26, 8);
      ctx.lineTo(-2, 8);
      ctx.closePath();
      ctx.fill();
    } else {
      // 'arrive' pulsing target pin
      ctx.strokeStyle = '#ffffff';
      ctx.fillStyle = '#39ff14';
      ctx.beginPath();
      ctx.arc(0, -4, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fillStyle = '#064e3b';
      ctx.beginPath();
      ctx.arc(0, -4, 7, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  /** On-foot 3D hand-held phone summary overlay */
  private renderOnFootPhoneOverlay(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    player: PlayerState,
    delivery: DeliveryManager,
    navPlan: NavigationPlan,
    isNight: boolean,
    areaName: string
  ): void {
    // Top location card
    ctx.fillStyle = isNight ? 'rgba(15, 23, 42, 0.9)' : 'rgba(255, 255, 255, 0.94)';
    ctx.beginPath();
    ctx.roundRect(14, 42, w - 28, 64, 16);
    ctx.fill();

    ctx.fillStyle = '#14b8a6';
    ctx.beginPath();
    ctx.arc(32, 64, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = isNight ? '#f8fafc' : '#0f172a';
    ctx.font = 'bold 17px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(areaName, 44, 65);

    ctx.fillStyle = isNight ? '#34d399' : '#059669';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`₩${delivery.totalEarnings.toLocaleString()}`, w - 26, 65);

    ctx.fillStyle = isNight ? '#7dd3fc' : '#1d4ed8';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(
      `🚶 도보 · 오토바이 ${player.distanceToScooter.toFixed(0)}m · 묶음 ${delivery.activeMissions.length}/${MAX_CONCURRENT_ORDERS}`,
      26,
      91
    );

    // Top highlight tooltip on 3D phone screen for active Korean lobby PIN pattern & delivery instruction
    const focusOnFoot = navPlan.focusMission ?? delivery.activeMission;
    if (focusOnFoot) {
      const inst = getInstructionMeta(focusOnFoot.order.deliveryInstruction);
      ctx.fillStyle = 'rgba(15, 118, 110, 0.95)';
      ctx.beginPath();
      ctx.roundRect(14, 112, w - 28, 30, 10);
      ctx.fill();
      ctx.fillStyle = '#fef08a';
      ctx.font = 'bold 12.5px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        `🔑 ${focusOnFoot.order.doorPinLabel} · ${inst.badge}`.slice(0, 32),
        w / 2,
        127
      );
    }

    // Yellow Cooking Delay Gauge on 3D Handheld Phone when waiting on foot
    const cookOnFoot = delivery.getPrimaryCookingMission();
    if (cookOnFoot) {
      const cy = focusOnFoot ? 148 : 112;
      const isWaiting = cookOnFoot.phase === 'cooking_wait';
      const frac =
        isWaiting && cookOnFoot.cookingDurationSec > 0
          ? clamp(cookOnFoot.cookingRemainingSec / cookOnFoot.cookingDurationSec, 0, 1)
          : 1;
      const remSec = Math.max(1, Math.ceil(cookOnFoot.cookingRemainingSec));

      ctx.fillStyle = isWaiting ? 'rgba(28, 22, 6, 0.95)' : 'rgba(6, 52, 36, 0.96)';
      ctx.strokeStyle = isWaiting ? '#facc15' : '#34d399';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(14, cy, w - 28, 48, 12);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isWaiting ? '#fef08a' : '#a7f3d0';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(
        isWaiting
          ? `🍳 ${cookOnFoot.order.shop.name} 조리 중 (${remSec}초)`
          : `🔔 ${cookOnFoot.order.shop.name} 음식이 준비되었습니다!`,
        24,
        cy + 16
      );

      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.roundRect(24, cy + 30, w - 48, 9, 4.5);
      ctx.fill();
      ctx.fillStyle = isWaiting ? '#facc15' : '#34d399';
      ctx.beginPath();
      ctx.roundRect(24, cy + 30, (w - 48) * frac, 9, 4.5);
      ctx.fill();
    }

    // Bottom sheet card
    const sheetY = h - 196;
    ctx.fillStyle = isNight ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.96)';
    ctx.beginPath();
    ctx.roundRect(12, sheetY, w - 24, 182, 20);
    ctx.fill();

    ctx.fillStyle = 'rgba(100,116,139,0.45)';
    ctx.beginPath();
    ctx.roundRect(w / 2 - 22, sheetY + 9, 44, 5, 3);
    ctx.fill();

    const m = navPlan.focusMission ?? delivery.activeMission;
    if (!m) {
      ctx.fillStyle = isNight ? '#f8fafc' : '#0f172a';
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`🔔 신규 배달 콜 ${delivery.availableOrders.length}건`, 26, sheetY + 42);

      const first = delivery.availableOrders[0];
      if (first) {
        ctx.fillStyle = isNight ? '#1e293b' : '#f1f5f9';
        ctx.beginPath();
        ctx.roundRect(24, sheetY + 58, w - 48, 62, 12);
        ctx.fill();

        ctx.fillStyle = isNight ? '#f8fafc' : '#0f172a';
        ctx.font = 'bold 15px sans-serif';
        ctx.fillText(`${first.shop.emoji} ${first.shop.name} [#${first.orderNumber}]`, 36, sheetY + 80);

        ctx.fillStyle = isNight ? '#34d399' : '#059669';
        ctx.textAlign = 'right';
        ctx.fillText(
          `₩${(first.baseFee + first.rainBonus).toLocaleString()}`,
          w - 36,
          sheetY + 80
        );

        ctx.fillStyle = first.rainBonus > 0 ? '#38bdf8' : isNight ? '#94a3b8' : '#475569';
        ctx.font = '600 13px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(
          first.rainBonus > 0
            ? `🌧️ 우천 할증 +₩${first.rainBonus.toLocaleString()} · ${first.customer.name}`
            : `→ ${first.customer.name} ${first.unitNumber} (${first.distanceMeters}m)`,
          36,
          sheetY + 104
        );
      }

      ctx.fillStyle = '#0d9488';
      ctx.beginPath();
      ctx.roundRect(24, sheetY + 132, w - 48, 36, 10);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('👆 폰 클릭하여 터치 조작 (배달앱)', w / 2, sheetY + 150);
    } else {
      const p = m.phase;
      const badgeColor =
        p === 'to_pickup' || p === 'carrying_to_box' ? '#ea580c' : '#059669';
      ctx.fillStyle = badgeColor;
      ctx.beginPath();
      ctx.roundRect(24, sheetY + 24, 178, 25, 12);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.getPhaseShortLabel(p, m.cargoSlot), 113, sheetY + 37);

      if (navPlan.guidance && !player.inCorridor) {
        ctx.fillStyle = isNight ? '#4ade80' : '#059669';
        ctx.font = 'bold 22px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`${navPlan.guidance.totalDistance}m`, w - 26, sheetY + 39);
      }

      const targetTitle =
        p === 'to_pickup' || p === 'carrying_to_box'
          ? `${m.order.shop.emoji} ${m.order.shop.name}`
          : `${m.order.customer.emoji} ${m.order.customer.name} ${m.order.unitNumber}`;
      ctx.fillStyle = isNight ? '#f8fafc' : '#0f172a';
      ctx.font = 'bold 17px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(targetTitle, 24, sheetY + 72);

      ctx.fillStyle = isNight ? '#94a3b8' : '#475569';
      ctx.font = '700 12.5px sans-serif';
      const instMeta = getInstructionMeta(m.order.deliveryInstruction);
      ctx.fillText(
        `#${m.order.orderNumber} · ${instMeta.badge} · ${m.order.doorPinLabel}`.slice(0, 34),
        24,
        sheetY + 96
      );

      // 3 Cargo Slot Pips
      const slotW = (w - 60) / 3;
      for (let i = 0; i < CARGO_SLOT_COUNT; i++) {
        const sm = delivery.getCargoSlotMission(i);
        const sx = 24 + i * (slotW + 6);
        const sy = sheetY + 112;
        ctx.fillStyle = sm
          ? 'rgba(16, 185, 129, 0.2)'
          : isNight
            ? 'rgba(255,255,255,0.08)'
            : '#e2e8f0';
        ctx.beginPath();
        ctx.roundRect(sx, sy, slotW, 24, 7);
        ctx.fill();
        ctx.fillStyle = sm ? (isNight ? '#34d399' : '#047857') : '#64748b';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(sm ? `슬롯${i + 1} #${sm.order.orderNumber}` : `슬롯${i + 1} 비어있음`, sx + slotW / 2, sy + 12);
      }

      ctx.fillStyle = isNight ? '#38bdf8' : '#0284c7';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      const ms = delivery.getDailyMissionStatus();
      ctx.fillText(
        ms.completed
          ? '🏆 일일 미션 달성! (+₩5,000 지급 완료) · [V] 확대'
          : `🏆 오늘 미션 ${ms.current}/${ms.target}건 (+₩${ms.bonus.toLocaleString()}) · [V] 확대`,
        w / 2,
        sheetY + 160
      );
    }
  }

  private getPhaseShortLabel(phase: string, cargoSlot: number | null, cookSec = 0): string {
    switch (phase) {
      case 'to_pickup':
        return '픽업 대기 · POS 입력';
      case 'cooking_wait':
        return `🍳 조리 중 (${Math.max(1, Math.ceil(cookSec))}초)`;
      case 'pickup_ready':
        return '🔔 조리 완료 · 수령 대기';
      case 'carrying_to_box':
        return '음식 휴대 · 배달통 적재';
      case 'cargo_loaded':
        return cargoSlot !== null ? `배달통 슬롯 ${cargoSlot + 1} 적재` : '배달통 적재됨';
      case 'carrying_to_lobby':
        return '공동현관 PIN 입력';
      case 'lobby_unlocked':
        return '현관 개방 · 엘리베이터';
      case 'in_corridor':
        return '복도 · 고객 요청 전달';
      case 'photo_mode':
        return '완료 인증 사진 촬영';
      case 'knock_waiting':
        return '노크 완료 · 확인 대기';
      case 'meet_waiting':
        return '대면 수령 진행 중';
      case 'corridor_exit':
        return '완료 · 1층으로 복귀';
      default:
        return '배달 진행 중';
    }
  }

  private syncDeliverySheet(
    player: PlayerState,
    delivery: DeliveryManager,
    navPlan: NavigationPlan
  ): void {
    const activeFp = delivery.activeMissions
      .map(
        (m) =>
          `${m.order.id}:${m.phase}:${m.cargoSlot}:${Math.round(m.foodIntegrity)}:${Math.round(m.foodTemp)}:${m.order.unitNumber}:${m.order.deliveryInstruction}:${m.chatNote ?? ''}:${Math.ceil(m.cookingRemainingSec)}:${this.activeTab === 'accepted' ? Math.ceil(m.remainingTimeSec) : 0}`
      )
      .join(',');
    const availFp = delivery.availableOrders.map((o) => `${o.id}:${o.rainBonus}`).join(',');
    const distFp = navPlan.guidance ? Math.round(navPlan.guidance.totalDistance / 5) : -1;
    const finFp = `${delivery.totalEarnings}:${delivery.fuelExpense}:${delivery.repairExpense}:${delivery.fineExpense}`;
    const fingerprint = `${this.activeTab}|${delivery.selectedMissionId ?? 'auto'}|r:${delivery.isWeatherRaining}|${activeFp}|${availFp}|c:${delivery.completedMissions.length}|d:${distFp}|f:${finFp}|${player.inCorridor}`;

    if (fingerprint === this.lastSheetFingerprint) return;
    this.lastSheetFingerprint = fingerprint;

    const activeCnt = delivery.activeMissions.length;
    const doneCnt = delivery.completedMissions.length;
    const stopsCnt = navPlan.recommendedStops.length;
    this.syncTopNavHighlight();

    // Context sub-pills matching the Baemin Connect top 3-tab structure ([콜 목록] / [내비] / [수익])
    let subNavHtml = '';
    if (this.topNav === 'calls') {
      subNavHtml = `
        <div class="bc-sub-pills">
          <button class="bc-sub-btn ${this.activeTab === 'calls' ? 'active' : ''}" data-action="tab" data-tab="calls">
            🔔 신규 콜 (${delivery.availableOrders.length})
          </button>
          <button class="bc-sub-btn ${this.activeTab === 'accepted' ? 'active' : ''}" data-action="tab" data-tab="accepted">
            📋 수락 주문 (${activeCnt}/${MAX_CONCURRENT_ORDERS})
          </button>
        </div>
      `;
    } else if (this.topNav === 'nav') {
      subNavHtml = `
        <div class="bc-sub-pills">
          <button class="bc-sub-btn ${this.activeTab === 'route' ? 'active' : ''}" data-action="tab" data-tab="route">
            🧭 추천 동선 (${stopsCnt})
          </button>
          <button class="bc-sub-btn ${this.activeTab === 'checklist' ? 'active' : ''}" data-action="tab" data-tab="checklist">
            ☑ 완료 체크 (${doneCnt})
          </button>
        </div>
      `;
    }

    let bodyHtml = '';
    if (this.activeTab === 'calls') {
      bodyHtml = this.renderDailyMissionWidget(delivery) + this.renderCallsTab(player, delivery);
    } else if (this.activeTab === 'accepted') {
      bodyHtml = this.renderAcceptedTab(player, delivery, navPlan);
    } else if (this.activeTab === 'checklist') {
      bodyHtml = this.renderChecklistTab(delivery);
    } else if (this.activeTab === 'route') {
      bodyHtml = this.renderRouteTab(delivery, navPlan);
    } else {
      bodyHtml = this.renderFinanceTab(delivery);
    }

    this.sheetBodyEl.innerHTML = subNavHtml + bodyHtml;
  }

  private renderCallsTab(player: PlayerState, delivery: DeliveryManager): string {
    const canAccept = delivery.canAcceptMoreOrders() && !player.inCorridor;
    const full = !delivery.canAcceptMoreOrders();

    const cardsHtml = delivery.availableOrders
      .map(
        (o) => `
        <div class="order-card ${o.rainBonus > 0 ? 'rain-order' : ''}">
          <div class="order-top">
            <span class="order-shop">
              <span class="dispatch-type-pill ${o.dispatchType === 'SINGLE' ? 'single' : 'alttle'}">${o.dispatchType === 'SINGLE' ? '한집' : '알뜰'}</span>
              ${o.shop.emoji} ${o.shop.name} <span class="ord-tag">#${o.orderNumber}</span>
            </span>
            <span class="order-fee">₩${(o.baseFee + o.rainBonus).toLocaleString()}</span>
          </div>
          <div class="order-menu">
            ${o.menuName}
            <span class="food-meta-chip ${o.foodTempType === 'cold' ? 'cold' : o.isSpillSensitive ? 'spill' : ''}">${o.foodCategoryTag}</span>
            <span class="inst-badge">${getInstructionMeta(o.deliveryInstruction).badge}</span>
            ${o.rainBonus > 0 ? `<span class="rain-bonus-tag">🌧️ 우천 할증 +₩${o.rainBonus.toLocaleString()}</span>` : ''}
          </div>
          <div class="order-bottom">
            <span class="order-dest">→ ${o.customer.name} ${o.unitNumber}${o.customer.residenceKind === 'walkup_villa' ? '<span class="villa-tag">🪜계단+500</span>' : ''} (${o.distanceMeters}m)</span>
            <button class="order-accept-btn" data-action="accept" data-id="${o.id}" ${canAccept ? '' : 'disabled'}>
              ${full ? '3건 만석' : '수락'}
            </button>
          </div>
        </div>`
      )
      .join('');

    return `
      <div class="sheet-header-row">
        <span class="sheet-title">${delivery.isWeatherRaining ? '🌧️ 우천 할증 콜' : '🔔 신규 배달 콜'}</span>
        <span class="bundle-cap-pill ${full ? 'full' : ''}">배차 ${delivery.activeMissions.length}/${MAX_CONCURRENT_ORDERS}건</span>
        <button class="sheet-refresh-btn" data-action="refresh" title="콜 새로고침">↻</button>
      </div>
      <div class="order-list">${cardsHtml || '<div class="empty-tab-msg">대기 중인 콜이 없습니다</div>'}</div>
    `;
  }

  private renderAcceptedTab(
    player: PlayerState,
    delivery: DeliveryManager,
    navPlan: NavigationPlan
  ): string {
    if (delivery.activeMissions.length === 0) {
      return `
        <div class="empty-tab-msg">
          수락된 주문이 없습니다.<br/>[콜 대기] 탭에서 최대 ${MAX_CONCURRENT_ORDERS}건까지 묶음 배차를 수락하세요!
        </div>
      `;
    }

    const focusId = navPlan.focusMission?.order.id ?? null;
    const cards = delivery.activeMissions
      .map((m: ActiveMission) => {
        const isPickupStage =
          m.phase === 'to_pickup' ||
          m.phase === 'cooking_wait' ||
          m.phase === 'pickup_ready' ||
          m.phase === 'carrying_to_box';
        const stepCls =
          m.phase === 'cooking_wait'
            ? 'cooking'
            : m.phase === 'pickup_ready'
              ? 'ready'
              : isPickupStage
                ? 'pickup'
                : 'dropoff';
        const isFocused = m.order.id === focusId;
        const isPinned = delivery.selectedMissionId === m.order.id;
        const inCorridorPhase =
          m.phase === 'in_corridor' ||
          m.phase === 'photo_mode' ||
          m.phase === 'knock_waiting' ||
          m.phase === 'meet_waiting' ||
          m.phase === 'corridor_exit';

        let slotPill = '';
        if (m.cargoSlot !== null) {
          slotPill = `<span class="slot-pill">📦 슬롯 ${m.cargoSlot + 1}</span>`;
        } else if (
          m.phase === 'carrying_to_box' ||
          m.phase === 'carrying_to_lobby' ||
          m.phase === 'lobby_unlocked' ||
          m.phase === 'in_corridor'
        ) {
          slotPill = `<span class="slot-pill hand">🛍️ 손에 휴대</span>`;
        }

        const intPct = Math.round(m.foodIntegrity);
        const tempPct = Math.round(m.foodTemp);
        const intColor =
          intPct >= 80 ? '#10b981' : intPct >= 50 ? '#f59e0b' : '#ef4444';
        const tempCls = tempPct >= 80 ? 'good' : tempPct >= 50 ? 'warn' : 'bad';
        const tempIcon = m.order.foodTempType === 'cold' ? '🧊' : '🔥';
        const remSec = Math.ceil(m.remainingTimeSec);
        const remMin = Math.floor(remSec / 60);
        const remS = String(remSec % 60).padStart(2, '0');
        const timerCls = remSec <= 30 ? 'urgent' : remSec <= 60 ? 'warn' : '';
        const typeBadge =
          m.order.dispatchType === 'SINGLE'
            ? '<span class="dispatch-type-pill single">한집</span>'
            : '<span class="dispatch-type-pill alttle">알뜰</span>';
        const villaPill =
          m.order.customer.residenceKind === 'walkup_villa'
            ? '<span class="villa-tag">🪜계단+500</span>'
            : '';
        const chatRow = m.chatNote ? `<div class="chat-note-tag">💬 ${m.chatNote}</div>` : '';

        return `
          <div class="accepted-card ${isFocused ? 'focused' : ''}">
            <div class="accepted-top">
              ${typeBadge}
              <span class="step-badge ${stepCls}">${this.getPhaseShortLabel(m.phase, m.cargoSlot, m.cookingRemainingSec)}</span>
              <span class="mission-timer-pill ${timerCls}">⏱ ${remMin}:${remS}</span>
              <span class="order-fee">₩${(m.order.baseFee + m.order.rainBonus).toLocaleString()}</span>
            </div>
            <div class="order-top">
              <span>${m.order.shop.emoji} ${m.order.shop.name} <span class="ord-tag">#${m.order.orderNumber}</span>${slotPill}${m.order.rainBonus > 0 ? ' <span class="rain-bonus-tag">🌧️+1.5천</span>' : ''}</span>
            </div>
            <div class="order-dest">→ ${m.order.customer.emoji} ${m.order.customer.name} <b>${m.order.unitNumber}</b>${villaPill} <span class="inst-badge">${getInstructionMeta(m.order.deliveryInstruction).badge}</span></div>
            <div class="order-menu" style="margin-top:2px">
              ${m.order.menuName} <span class="food-meta-chip ${m.order.foodTempType === 'cold' ? 'cold' : m.order.isSpillSensitive ? 'spill' : ''}">${m.order.foodCategoryTag}</span>
            </div>
            ${chatRow}
            <div class="order-codes-row">
              <span>현관 <b>${m.order.doorPinLabel}</b></span>
              <span class="temp-pill ${tempCls}">${tempIcon}${tempPct}%</span>
              <span style="color:${intColor};font-weight:800">상태 ${intPct}%</span>
            </div>
            <div class="accepted-actions">
              ${
                !player.inCorridor
                  ? `<button class="sheet-focus-btn ${isPinned ? 'active' : ''}" data-action="${isPinned ? 'auto_route' : 'focus'}" data-id="${m.order.id}">
                      ${isPinned ? '🧭 고정 안내 중' : isFocused ? '🧭 현재 안내 중' : '경로 우선 안내'}
                    </button>`
                  : ''
              }
              ${
                !inCorridorPhase && !player.inCorridor
                  ? `<button class="sheet-cancel-btn" data-action="cancel" data-id="${m.order.id}">취소</button>`
                  : ''
              }
            </div>
          </div>
        `;
      })
      .join('');

    return `
      <div class="sheet-header-row">
        <span class="sheet-title">📋 수락된 주문 (${delivery.activeMissions.length}/${MAX_CONCURRENT_ORDERS})</span>
        <span class="bundle-cap-pill">배달통 ${delivery.getLoadedCargoCount()}/${CARGO_SLOT_COUNT}칸</span>
      </div>
      <div class="order-list">${cards}</div>
    `;
  }

  private renderChecklistTab(delivery: DeliveryManager): string {
    const activePicked = delivery.activeMissions.filter((m) => m.pickedUp).length;
    const totalPicked = activePicked + delivery.completedMissions.length;
    const totalDelivered = delivery.completedCount;

    const activeCards = delivery.activeMissions
      .map((m) => {
        const picked = m.pickedUp;
        const inBox = m.cargoSlot !== null;
        const delivered = m.phase === 'corridor_exit';
        return `
          <div class="check-card">
            <div class="order-top">
              <span>${m.order.shop.emoji} ${m.order.shop.name} <span class="ord-tag">#${m.order.orderNumber}</span></span>
              <span class="order-dest">${m.order.customer.name} ${m.order.unitNumber}</span>
            </div>
            <div class="check-steps">
              <span class="chk-chip ${picked ? 'checked' : ''}">${picked ? '☑' : '☐'} 픽업 완료</span>
              <span class="chk-chip ${inBox ? 'checked' : ''}">${inBox ? `☑ 슬롯 ${m.cargoSlot! + 1}` : picked ? '☐ 배달통/휴대' : '☐ 적재 대기'}</span>
              <span class="chk-chip ${delivered ? 'checked' : ''}">${delivered ? '☑' : '☐'} 배달 완료</span>
            </div>
          </div>
        `;
      })
      .join('');

    const doneCards = delivery.completedMissions
      .slice(0, 5)
      .map(
        (c) => `
          <div class="check-card done">
            <div class="order-top">
              <span>✅ ${c.order.shop.name} <span class="ord-tag">#${c.order.orderNumber}</span></span>
              <span class="order-fee">+₩${c.earned.toLocaleString()}</span>
            </div>
            <div class="check-steps">
              <span class="chk-chip checked">☑ 픽업 완료</span>
              <span class="chk-chip checked">☑ 배달 완료 (${c.order.customer.name} ${c.order.unitNumber})</span>
            </div>
          </div>
        `
      )
      .join('');

    return `
      <div class="check-summary">
        <span>☑ 픽업 완료 ${totalPicked}건</span>
        <span>🏁 배달 완료 ${totalDelivered}건</span>
      </div>
      <div class="order-list">
        ${activeCards}
        ${doneCards}
        ${
          !activeCards && !doneCards
            ? '<div class="empty-tab-msg">아직 진행 중이거나 완료된 배달 내역이 없습니다.</div>'
            : ''
        }
      </div>
    `;
  }

  private renderRouteTab(delivery: DeliveryManager, navPlan: NavigationPlan): string {
    if (navPlan.recommendedStops.length === 0) {
      return `
        <div class="empty-tab-msg">
          추천 동선이 없습니다.<br/>[콜 대기]에서 주문을 수락하면 A* 최적 묶음 동선을 계산합니다.
        </div>
      `;
    }

    const isAuto = delivery.selectedMissionId === null;
    const stopCards = navPlan.recommendedStops
      .map(
        (st, idx) => `
        <button class="route-stop-card ${st.isCurrent ? 'current' : ''}" data-action="focus" data-id="${st.missionId}">
          <span class="route-step-num ${st.kind}">${idx + 1}</span>
          <div class="route-stop-info">
            <div class="route-stop-title">${st.emoji} ${st.label}</div>
            <div class="route-stop-sub">${st.sublabel}</div>
          </div>
          <span class="route-stop-dist">${idx === 0 ? `${st.legDistance}m` : `+${st.legDistance}m`}</span>
        </button>
      `
      )
      .join('');

    return `
      <div class="route-summary-bar">
        <span>🧭 최적 동선 · 총 ${navPlan.totalBundleDistance}m (${navPlan.recommendedStops.length}곳)</span>
        <button class="route-auto-btn ${isAuto ? '' : 'inactive'}" data-action="auto_route">
          ${isAuto ? '자동 추천 ON' : '자동 추천 복귀'}
        </button>
      </div>
      <div class="order-list">${stopCards}</div>
    `;
  }

  private renderDailyMissionWidget(delivery: DeliveryManager): string {
    const ms = delivery.getDailyMissionStatus();
    return `
      <div class="bc-mission-card ${ms.completed ? 'done' : ''}">
        <div class="bc-mission-top">
          <span>🏆 ${ms.title} (현재 ${ms.current}/${ms.target})</span>
          <span class="bc-mission-reward">${ms.completed ? '✓ 지급완료' : `+₩${ms.bonus.toLocaleString()}`}</span>
        </div>
        <div class="bc-mission-track">
          <div class="bc-mission-fill" style="width:${ms.progressPct}%"></div>
        </div>
        <div class="bc-mission-sub">
          <span>${ms.completed ? '🎉 일일 보너스 +₩5,000 지갑 반영 완료!' : `앞으로 ${ms.target - ms.current}건 더 완료 시 보너스 지급`}</span>
          <span>${ms.progressPct}%</span>
        </div>
      </div>
    `;
  }

  private renderFinanceTab(delivery: DeliveryManager): string {
    const l = delivery.getDailyLedger();
    const fmt = (n: number) => `₩${Math.abs(n).toLocaleString()}`;
    const netSign = l.netProfit < 0 ? '-' : '';
    const today = new Date();
    const dateStr = `${today.getMonth() + 1}월 ${today.getDate()}일 · ${l.completedCount}건`;

    return `
      ${this.renderDailyMissionWidget(delivery)}
      <div class="bc-receipt">
        <div class="bc-receipt-hdr">
          <span class="bc-receipt-brand">🧾 배민커넥트 일일 정산 명세서</span>
          <span class="bc-receipt-date">${dateStr} · ★ ${l.riderRating.toFixed(1)}</span>
        </div>
        <div class="bc-rcpt-row inc"><span>기본 배달료 합계</span><span>+${fmt(l.baseFeeTotal)}</span></div>
        <div class="bc-rcpt-row inc"><span>거리 할증 합계</span><span>+${fmt(l.distanceBonusTotal)}</span></div>
        <div class="bc-rcpt-row inc"><span>🌧️ 우천/기상 할증</span><span>+${fmt(l.rainBonusTotal)}</span></div>
        <div class="bc-rcpt-row inc"><span>안전 배달 팁 / 미션 보너스</span><span>+${fmt(l.tipTotal + l.missionBonusTotal)}</span></div>
        <div class="bc-rcpt-divider"></div>
        <div class="bc-rcpt-row ded"><span>🚨 신호위반/인도사고 과태료 차감</span><span>-${fmt(l.fineExpense)}</span></div>
        <div class="bc-rcpt-row ded"><span>📦 음식 파손 페널티 차감</span><span>-${fmt(l.damageDeductionTotal)}</span></div>
        <div class="bc-rcpt-row ded"><span>⛽ 유류비 · 🔧 수리비</span><span>-${fmt(l.fuelExpense + l.repairExpense)}</span></div>
        <div class="bc-rcpt-total">
          <span>최종 실수령액 (Net Earnings)</span>
          <span class="bc-rcpt-net ${l.netProfit < 0 ? 'neg' : ''}">${netSign}${fmt(l.netProfit)}</span>
        </div>
      </div>
      <button class="fin-open-btn" data-action="open_report">📊 전체 화면 정산 명세서 크게 보기</button>
    `;
  }

  private resolveAreaName(px: number, pz: number, mapInfo: CityMapInfo): string {
    const st = ACTIVE_MAP_DATA.meta.station;
    if (Math.hypot(px - st.x, pz - st.z) < 68) return ACTIVE_DISTRICT.shortName;
    let nearest = ACTIVE_DISTRICT.shortName;
    let bestDist = 95;
    for (const z of mapInfo.zones) {
      const d = Math.hypot(px - z.x, pz - z.z);
      if (d < bestDist) {
        bestDist = d;
        nearest = z.name;
      }
    }
    return nearest;
  }

  private renderMapToContext(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    dpr: number,
    player: PlayerState,
    scooter: ScooterState,
    navPlan: NavigationPlan,
    signalState: SignalStateSnapshot,
    isNight: boolean,
    elapsedTime: number,
    mapInfo: CityMapInfo,
    rotateHeadingUp: boolean
  ): void {
    if (w < 10 || h < 10) return;

    ctx.save();
    ctx.scale(dpr, dpr);

    const theme = isNight
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

    const effectiveZoom = rotateHeadingUp ? 1.85 : this.zoomLevel;
    const baseScale = Math.min(w, h) / 285;
    const scale = baseScale * effectiveZoom;
    const centerX = w * 0.5;
    const centerY = rotateHeadingUp ? h * 0.57 : h * 0.36;

    const viewCamX = rotateHeadingUp ? player.x : this.camX;
    const viewCamZ = rotateHeadingUp ? player.z : this.camZ;

    // Apply Heading-Up map rotation while riding in 3D Navigation Mode!
    ctx.save();
    ctx.translate(centerX, centerY);
    if (rotateHeadingUp) {
      ctx.rotate(player.heading);
    }

    const toX = (wx: number) => -(wx - viewCamX) * scale;
    const toY = (wz: number) => -(wz - viewCamZ) * scale;

    // 1. Real Suwon Ingye-dong Parks (효원공원 etc.)
    for (const park of ACTIVE_MAP_DATA.parks) {
      if (park.pts.length < 3) continue;
      ctx.fillStyle = theme.park;
      ctx.beginPath();
      ctx.moveTo(toX(park.pts[0][0]), toY(park.pts[0][1]));
      for (let i = 1; i < park.pts.length; i++) {
        ctx.lineTo(toX(park.pts[i][0]), toY(park.pts[i][1]));
      }
      ctx.closePath();
      ctx.fill();
    }

    // 1.5. Pedestrian Plazas (나혜석거리)
    ctx.lineCap = 'round';
    ctx.strokeStyle = isNight ? '#3d332a' : '#e9d8c8';
    for (const pl of ACTIVE_MAP_DATA.pedestrianPlazas) {
      if (pl.pts.length < 2) continue;
      ctx.lineWidth = Math.max(2.5, pl.width * scale);
      ctx.beginPath();
      ctx.moveTo(toX(pl.pts[0][0]), toY(pl.pts[0][1]));
      for (let i = 1; i < pl.pts.length; i++) {
        ctx.lineTo(toX(pl.pts[i][0]), toY(pl.pts[i][1]));
      }
      ctx.stroke();
    }

    // 2. Real Suwon Ingye-dong OSM Road Network (218 segments!)
    const osmNodes = ACTIVE_MAP_DATA.nodes;
    const osmEdges = ACTIVE_MAP_DATA.edges;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Road outlines
    ctx.strokeStyle = theme.roadOutline;
    for (const e of osmEdges) {
      const na = osmNodes[e.a];
      const nb = osmNodes[e.b];
      ctx.lineWidth = Math.max(2.5, e.width * scale + 2.0);
      ctx.beginPath();
      ctx.moveTo(toX(na.x), toY(na.z));
      ctx.lineTo(toX(nb.x), toY(nb.z));
      ctx.stroke();
    }

    // Road fills
    ctx.strokeStyle = theme.roadFill;
    for (const e of osmEdges) {
      const na = osmNodes[e.a];
      const nb = osmNodes[e.b];
      ctx.lineWidth = Math.max(1.8, e.width * scale);
      ctx.beginPath();
      ctx.moveTo(toX(na.x), toY(na.z));
      ctx.lineTo(toX(nb.x), toY(nb.z));
      ctx.stroke();
    }

    // Yellow center lines on major Suwon boulevards (효원로, 권광로, 경수대로, 권선로)
    ctx.save();
    ctx.strokeStyle = theme.roadCenter;
    ctx.lineWidth = Math.max(1, 1.0 * effectiveZoom);
    ctx.setLineDash([4 * effectiveZoom, 5 * effectiveZoom]);
    ctx.beginPath();
    for (const e of osmEdges) {
      if (!e.isMajor) continue;
      const na = osmNodes[e.a];
      const nb = osmNodes[e.b];
      ctx.moveTo(toX(na.x), toY(na.z));
      ctx.lineTo(toX(nb.x), toY(nb.z));
    }
    ctx.stroke();
    ctx.restore();

    // 3. Real Suwon Building Polygon Footprints (322 OSM buildings!)
    for (const b of mapInfo.buildings) {
      ctx.fillStyle =
        b.kind === 'shop'
          ? theme.bldgShop
          : b.kind === 'residential'
            ? theme.bldgRes
            : theme.bldgPublic;
      ctx.strokeStyle = theme.bldgStroke;
      ctx.lineWidth = 0.85;
      ctx.beginPath();
      if (b.pts && b.pts.length >= 3) {
        ctx.moveTo(toX(b.pts[0][0]), toY(b.pts[0][1]));
        for (let i = 1; i < b.pts.length; i++) {
          ctx.lineTo(toX(b.pts[i][0]), toY(b.pts[i][1]));
        }
        ctx.closePath();
      } else {
        const rw = b.w * scale;
        const rd = b.d * scale;
        ctx.roundRect(toX(b.x) - rw / 2, toY(b.z) - rd / 2, rw, rd, 2);
      }
      ctx.fill();
      ctx.stroke();

      if (b.label && !rotateHeadingUp && effectiveZoom >= 1.1 && b.w * scale > 10) {
        ctx.font = `700 ${Math.round(clamp(9.5 * Math.sqrt(effectiveZoom), 9, 12))}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = theme.labelText;
        ctx.fillText(b.label, toX(b.x), toY(b.z));
      }
    }

    // 3.2. Suwon City Hall Station Subway Marker (🚇 수원시청역)
    {
      const st = ACTIVE_MAP_DATA.meta.station;
      const sx = toX(st.x);
      const sy = toY(st.z);
      ctx.fillStyle = '#f59e0b';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, 8.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.save();
      ctx.translate(sx, sy);
      if (rotateHeadingUp) ctx.rotate(-player.heading);
      ctx.fillStyle = '#0f172a';
      ctx.font = '900 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(st.badgeChar ?? '역', 0, 0.5);
      ctx.restore();
    }

    // 3.5. Bus stop icons, Service Station pins (⛽ Gas / 🔧 Repair), & Intersection signal status dots
    for (const bs of mapInfo.busStops) {
      const bx = toX(bs.shelterX);
      const by = toY(bs.shelterZ);
      ctx.fillStyle = '#1d4ed8';
      ctx.beginPath();
      ctx.roundRect(bx - 4, by - 4, 8, 8, 2);
      ctx.fill();
    }

    for (const st of mapInfo.serviceStations) {
      const stx = toX(st.interactX);
      const sty = toY(st.interactZ);
      ctx.fillStyle = st.kind === 'gas' ? '#eab308' : '#ea580c';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.roundRect(stx - 8, sty - 8, 16, 16, 4);
      ctx.fill();
      ctx.stroke();

      ctx.save();
      ctx.translate(stx, sty);
      if (rotateHeadingUp) ctx.rotate(-player.heading);
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(st.kind === 'gas' ? '⛽' : '🔧', 0, 0.5);
      ctx.restore();
    }

    // Fixed Speed / Red-Light Enforcement Camera Markers (📷50) on Smartphone GPS Map!
    if (mapInfo.speedCameras) {
      for (const cam of mapInfo.speedCameras) {
        const cx = toX(cam.x);
        const cy = toY(cam.z);
        ctx.fillStyle = '#dc2626';
        ctx.strokeStyle = '#fef08a';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(cx, cy, 7.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.save();
        ctx.translate(cx, cy);
        if (rotateHeadingUp) ctx.rotate(-player.heading);
        ctx.fillStyle = '#ffffff';
        ctx.font = '900 8px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(cam.limitKmh), 0, 0.5);
        ctx.restore();
      }
    }

    // Live Korean Police Patrol Car Markers (🚓 with alternating red/blue strobe) on Smartphone GPS Map!
    if (mapInfo.policePatrols) {
      const strobe = Math.floor(elapsedTime * 5) % 2 === 0;
      for (const p of mapInfo.policePatrols) {
        const px2 = toX(p.x);
        const py2 = toY(p.z);
        ctx.fillStyle = strobe ? '#2563eb' : '#ef4444';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(px2, py2, p.sirenActive ? 9.5 : 7.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.save();
        ctx.translate(px2, py2);
        if (rotateHeadingUp) ctx.rotate(-player.heading);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 9.5px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🚓', 0, 0.5);
        ctx.restore();
      }
    }

    // 1-Lane Road Construction Zone Markers (🚧) on Smartphone GPS Map!
    if (mapInfo.constructionZones) {
      for (const cz of mapInfo.constructionZones) {
        const cx = toX(cz.x);
        const cy = toY(cz.z);
        ctx.fillStyle = '#f97316';
        ctx.strokeStyle = '#fef08a';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, 6.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.save();
        ctx.translate(cx, cy);
        if (rotateHeadingUp) ctx.rotate(-player.heading);
        ctx.font = 'bold 8.5px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🚧', 0, 0.5);
        ctx.restore();
      }
    }

    // Rival AI Delivery Scooter Rider Dots on Smartphone GPS Map!
    if (mapInfo.rivalRiders) {
      for (const rr of mapInfo.rivalRiders) {
        const rx = toX(rr.x);
        const ry = toY(rr.z);
        ctx.fillStyle = rr.color;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(rx, ry, 4.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    const sigHex = (c: 'green' | 'yellow' | 'red') =>
      c === 'green' ? '#22c55e' : c === 'yellow' ? '#facc15' : '#ef4444';

    for (const sn of ACTIVE_MAP_DATA.nodes) {
      if (!sn.isSignal) continue;
      const mx = toX(sn.x);
      const my = toY(sn.z);
      ctx.fillStyle = sigHex(signalState.ns);
      ctx.beginPath();
      ctx.arc(mx, my - 2.6, 2.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = sigHex(signalState.ew);
      ctx.beginPath();
      ctx.arc(mx + 2.6, my, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Secondary Bundled Stops Preview Dashed Line
    if (!player.inCorridor && navPlan.recommendedStops.length > 1) {
      ctx.save();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
      ctx.lineWidth = 2.6;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      for (let i = 0; i < navPlan.recommendedStops.length; i++) {
        const st = navPlan.recommendedStops[i];
        const sx = toX(st.x);
        const sy = toY(st.z);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 5. Primary A* Fluorescent Neon-Green Navigation Polyline
    if (!player.inCorridor && navPlan.route.length >= 2) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Outer neon glow
      ctx.strokeStyle = 'rgba(57, 255, 20, 0.38)';
      ctx.lineWidth = rotateHeadingUp ? 12 : 9.5;
      ctx.beginPath();
      ctx.moveTo(toX(navPlan.route[0].x), toY(navPlan.route[0].z));
      for (let i = 1; i < navPlan.route.length; i++) {
        ctx.lineTo(toX(navPlan.route[i].x), toY(navPlan.route[i].z));
      }
      ctx.stroke();

      // Core fluorescent green stroke
      ctx.strokeStyle = '#39ff14';
      ctx.lineWidth = rotateHeadingUp ? 5.5 : 4.2;
      ctx.stroke();
      ctx.restore();
    }

    // 6. Numbered Bundled Stop Markers (1, 2, 3...)
    if (!player.inCorridor) {
      for (let i = navPlan.recommendedStops.length - 1; i >= 0; i--) {
        const st = navPlan.recommendedStops[i];
        const tx = toX(st.x);
        const ty = toY(st.z);
        const pinColor =
          st.kind === 'pickup' ? '#f97316' : st.kind === 'load_box' ? '#0284c7' : '#10b981';

        if (st.isCurrent) {
          const pulse = 11 + Math.sin(elapsedTime * 5) * 3.5;
          ctx.fillStyle =
            st.kind === 'pickup' ? 'rgba(249,115,22,0.34)' : 'rgba(57,255,20,0.34)';
          ctx.beginPath();
          ctx.arc(tx, ty, pulse, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = pinColor;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(tx, ty, st.isCurrent ? 8.5 : 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Keep step number upright even when map is rotated!
        ctx.save();
        ctx.translate(tx, ty);
        if (rotateHeadingUp) ctx.rotate(-player.heading);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 9.5px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), 0, 0.5);
        ctx.restore();
      }
    }

    // 7. Own Scooter Pin
    const sx = toX(scooter.x);
    const sy = toY(scooter.z);
    if (player.mode !== 'riding') {
      ctx.save();
      ctx.strokeStyle = scooter.crashed ? 'rgba(239,68,68,0.65)' : 'rgba(20,184,166,0.6)';
      ctx.lineWidth = 1.8;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(toX(player.x), toY(player.z));
      ctx.lineTo(sx, sy);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = scooter.crashed ? '#ef4444' : '#0d9488';
      ctx.beginPath();
      ctx.arc(sx, sy, 6.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // 8. Player Live GPS Arrow
    const px = toX(player.x);
    const py = toY(player.z);
    const dirX = -Math.sin(player.heading);
    const dirY = -Math.cos(player.heading);
    const mapAngle = Math.atan2(dirY, dirX);

    const grad = ctx.createRadialGradient(px, py, 2, px, py, 28);
    grad.addColorStop(0, 'rgba(59, 130, 246, 0.45)');
    grad.addColorStop(1, 'rgba(59, 130, 246, 0.0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.arc(px, py, 28, mapAngle - 0.55, mapAngle + 0.55);
    ctx.closePath();
    ctx.fill();

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(mapAngle + Math.PI / 2);
    ctx.fillStyle = rotateHeadingUp ? '#38bdf8' : '#2563eb';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(0, rotateHeadingUp ? -11 : -8.5);
    ctx.lineTo(rotateHeadingUp ? 8 : 6.2, rotateHeadingUp ? 8.5 : 6.5);
    ctx.lineTo(0, rotateHeadingUp ? 4.5 : 3.5);
    ctx.lineTo(rotateHeadingUp ? -8 : -6.2, rotateHeadingUp ? 8.5 : 6.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.restore(); // undo translate/rotate
    ctx.restore(); // undo dpr scale
  }
}
