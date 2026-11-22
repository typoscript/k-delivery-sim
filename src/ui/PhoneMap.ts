import * as THREE from 'three';
import { PlayerState } from '../player/PlayerController';
import { ScooterState } from '../vehicle/ScooterPhysics';
import { CityMapInfo } from '../world/CityWorld';
import { DeliveryManager } from '../delivery/DeliveryManager';
import { SignalStateSnapshot } from '../world/TrafficSystem';
import { clamp } from '../types';

export type PhonePlacement = 'pocket' | 'in_hand' | 'mounted';

export interface PhoneCallbacks {
  onAcceptOrder: (orderId: string) => void;
  onRefreshOrders: () => void;
  onCancelMission: () => void;
  onInteractMission: () => void;
  onTogglePhone: () => void;
  onToggleZoom: () => void;
}

export class PhoneMap {
  // Offscreen high-res canvas & live Three.js texture rendered onto 3D Handheld / Handlebar-Mounted Phone!
  private readonly texCanvas: HTMLCanvasElement;
  private readonly texCtx: CanvasRenderingContext2D;
  public readonly screenTexture: THREE.CanvasTexture;

  // Interactive Zoomed-In Focus Overlay elements
  private readonly zoomBackdropEl = document.getElementById('phone-zoom-backdrop')!;
  private readonly phoneEl = document.getElementById('rider-phone')!;
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
  private readonly sheetBodyEl = document.getElementById('phone-sheet-body')!;

  private readonly zoomInBtn = document.getElementById('map-zoom-in')!;
  private readonly zoomOutBtn = document.getElementById('map-zoom-out')!;
  private readonly followBtn = document.getElementById('map-follow-btn')!;
  private readonly unzoomBtn = document.getElementById('phone-unzoom-btn')!;
  private readonly stowBtn = document.getElementById('phone-stow-btn')!;

  private readonly callbacks: PhoneCallbacks;
  public placement: PhonePlacement = 'pocket';
  public isZoomed = false;

  private followPlayer = true;
  private zoomLevel = 1.5;
  private camX = -62;
  private camZ = -34;
  private lastSheetFingerprint = '';

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
      this.zoomLevel = clamp(this.zoomLevel + 0.35, 0.72, 2.8);
    });

    this.zoomOutBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.zoomLevel = clamp(this.zoomLevel - 0.35, 0.72, 2.8);
    });

    this.followBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.followPlayer = !this.followPlayer;
      this.followBtn.classList.toggle('active', this.followPlayer);
      this.zoomLevel = this.followPlayer ? 1.5 : 0.76;
    });

    this.unzoomBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onToggleZoom();
    });

    this.stowBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onTogglePhone();
    });

    // Clicking backdrop outside zoomed phone exits zoom cleanly
    this.zoomBackdropEl.addEventListener('click', (e) => {
      if (e.target === this.zoomBackdropEl) {
        this.callbacks.onToggleZoom();
      }
    });

    // Bottom hint pill: if in pocket -> Tab toggle; if holding/mounted -> V zoom!
    this.pocketPillEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.placement === 'pocket') {
        this.callbacks.onTogglePhone();
      } else {
        this.callbacks.onToggleZoom();
      }
    });

    this.sheetBodyEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const target = e.target as HTMLElement;
      const btn = target.closest('button') as HTMLButtonElement | null;
      if (!btn) return;

      const action = btn.dataset.action;
      if (action === 'accept' && btn.dataset.id) {
        this.callbacks.onAcceptOrder(btn.dataset.id);
      } else if (action === 'refresh') {
        this.callbacks.onRefreshOrders();
      } else if (action === 'cancel') {
        this.callbacks.onCancelMission();
      } else if (action === 'interact') {
        this.callbacks.onInteractMission();
      }
    });

    this.followBtn.classList.add('active');
    this.setPlacement('pocket');
  }

  public setPlacement(next: PhonePlacement): void {
    this.placement = next;
    if (next === 'pocket') {
      this.isZoomed = false;
    }
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
      requestAnimationFrame(() => this.syncZoomCanvasSize());
    }
    return this.isZoomed;
  }

  public toggleZoom(): { zoomed: boolean; message: string } {
    if (this.placement === 'pocket') {
      return { zoomed: false, message: '먼저 [Tab]으로 휴대폰을 꺼내거나 거치대에 놓으세요' };
    }
    const next = this.setZoomed(!this.isZoomed);
    return {
      zoomed: next,
      message: next
        ? '🔍 휴대폰 확대 보기 (콜 수락 / 지도 조작 · V로 축소)'
        : this.placement === 'mounted'
          ? '오토바이 거치대 3D 시점으로 복귀'
          : '손에 든 3D 휴대폰 시점으로 복귀',
    };
  }

  /**
   * Condition 1 (Not riding): Tab takes phone out of pocket into 3D hand (or puts it back)
   * Condition 2 (Riding): Tab places phone from pocket onto 3D scooter handlebar mount (or puts it back)
   */
  public toggleWithTab(isRiding: boolean): { placement: PhonePlacement; message: string } {
    if (this.placement !== 'pocket') {
      const wasMounted = this.placement === 'mounted';
      this.setPlacement('pocket');
      return {
        placement: 'pocket',
        message: wasMounted
          ? '거치대에서 휴대폰을 빼서 주머니에 넣었습니다'
          : '휴대폰을 주머니에 넣었습니다',
      };
    }

    if (isRiding) {
      this.setPlacement('mounted');
      return {
        placement: 'mounted',
        message: '📱 오토바이 거치대에 장착! ([V] 또는 휴대폰 클릭으로 확대)',
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

    // Bottom corner chip visible whenever NOT zoomed (tells player Tab or V!)
    this.pocketPillEl.classList.toggle('hidden', showZoomModal);

    if (this.placement === 'in_hand') {
      this.placementTagEl.textContent = '✋ 손에 든 휴대폰 (확대 보기)';
      this.stowBtn.textContent = '주머니로';
    } else if (this.placement === 'mounted') {
      this.placementTagEl.textContent = '🛵 오토바이 거치대 (확대 보기)';
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
    signalState: SignalStateSnapshot,
    isNight: boolean,
    elapsedTime: number,
    mapInfo: CityMapInfo
  ): void {
    const isRiding = player.mode === 'riding';

    // Update minimal bottom hint chip when not zoomed
    if (!this.isZoomed) {
      if (this.placement === 'pocket') {
        this.pocketKeyEl.textContent = 'Tab';
        this.pocketPillTextEl.textContent = isRiding
          ? '오토바이 거치대에 휴대폰 놓기'
          : '주머니에서 휴대폰 꺼내기';
      } else {
        this.pocketKeyEl.textContent = 'V';
        this.pocketPillTextEl.textContent =
          this.placement === 'mounted'
            ? '거치대 휴대폰 확대해서 보기 (Tab: 분리)'
            : '손에 든 휴대폰 확대해서 보기 (Tab: 넣기)';
      }
      this.pocketBadgeEl.classList.toggle('hidden', delivery.activeMission === null);
    }

    if (this.placement === 'pocket') {
      return;
    }

    // Smooth camera pan on GPS map
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
      // Render crisp interactive zoomed-in smartphone UI
      this.syncZoomCanvasSize();
      this.phoneEl.classList.toggle('night', isNight);
      this.clockEl.textContent = clockStr;
      this.areaEl.textContent = areaName;
      this.earningsEl.textContent = `₩${delivery.totalEarnings.toLocaleString()} (${delivery.completedCount}건)`;

      const kmh = Math.round(Math.abs(scooter.speed) * 3.6);
      if (player.mode === 'knockdown') {
        this.statusPillEl.textContent = '💥 넘어짐! 회복 중';
        this.statusPillEl.className = 'app-status-pill danger';
      } else if (isRiding) {
        this.statusPillEl.textContent = kmh > 0 ? `🛵 주행 중 · ${kmh} km/h` : '🛵 시동 ON · 대기';
        this.statusPillEl.className = 'app-status-pill riding';
      } else {
        this.statusPillEl.textContent = `🚶 도보 · 오토바이 ${player.distanceToScooter.toFixed(0)}m`;
        this.statusPillEl.className = 'app-status-pill foot';
      }

      this.syncDeliverySheet(player, delivery);

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.renderMapToContext(
        this.zoomCtx,
        this.zoomCanvas.width / dpr,
        this.zoomCanvas.height / dpr,
        dpr,
        player,
        scooter,
        delivery,
        signalState,
        isNight,
        elapsedTime,
        mapInfo
      );
    } else {
      // Render full smartphone screen directly onto the 3D Hand / 3D Scooter Mount texture!
      this.render3DPhoneScreen(
        player,
        scooter,
        delivery,
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

  /** Renders complete crisp smartphone display (GPS map + status bar + delivery banner) to 3D CanvasTexture */
  private render3DPhoneScreen(
    player: PlayerState,
    scooter: ScooterState,
    delivery: DeliveryManager,
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

    // 1. Base live GPS map fills entire 3D phone screen
    this.renderMapToContext(
      ctx,
      w,
      h,
      1,
      player,
      scooter,
      delivery,
      signalState,
      isNight,
      elapsedTime,
      mapInfo
    );

    ctx.save();
    // 2. Top status bar (Clock, 5G, Battery)
    ctx.fillStyle = isNight ? 'rgba(15, 23, 42, 0.78)' : 'rgba(255, 255, 255, 0.8)';
    ctx.fillRect(0, 0, w, 36);
    ctx.fillStyle = isNight ? '#f8fafc' : '#0f172a';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(clockStr, 18, 20);
    ctx.textAlign = 'right';
    ctx.fillText('5G 🔋', w - 16, 20);

    // Top app location card
    ctx.fillStyle = isNight ? 'rgba(15, 23, 42, 0.9)' : 'rgba(255, 255, 255, 0.94)';
    ctx.beginPath();
    ctx.roundRect(14, 44, w - 28, 66, 16);
    ctx.fill();

    ctx.fillStyle = '#14b8a6';
    ctx.beginPath();
    ctx.arc(32, 66, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = isNight ? '#f8fafc' : '#0f172a';
    ctx.font = 'bold 17px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(areaName, 44, 67);

    ctx.fillStyle = isNight ? '#34d399' : '#059669';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`₩${delivery.totalEarnings.toLocaleString()}`, w - 26, 67);

    const isRiding = player.mode === 'riding';
    const kmh = Math.round(Math.abs(scooter.speed) * 3.6);
    ctx.fillStyle = isNight ? '#7dd3fc' : '#1d4ed8';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(
      isRiding ? `🛵 주행 중 · ${kmh} km/h` : `🚶 도보 · 오토바이 ${player.distanceToScooter.toFixed(0)}m`,
      26,
      94
    );

    // 3. Bottom Delivery App Sheet on the 3D phone screen
    const sheetY = h - 188;
    ctx.fillStyle = isNight ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.96)';
    ctx.beginPath();
    ctx.roundRect(12, sheetY, w - 24, 174, 20);
    ctx.fill();

    // Sheet handle bar
    ctx.fillStyle = 'rgba(100,116,139,0.45)';
    ctx.beginPath();
    ctx.roundRect(w / 2 - 22, sheetY + 9, 44, 5, 3);
    ctx.fill();

    const m = delivery.activeMission;
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
        ctx.fillText(`₩${first.baseFee.toLocaleString()}`, w - 36, sheetY + 80);

        ctx.fillStyle = isNight ? '#94a3b8' : '#475569';
        ctx.font = '600 13px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`→ ${first.customer.name} ${first.unitNumber} (${first.distanceMeters}m)`, 36, sheetY + 104);
      }

      ctx.fillStyle = '#0d9488';
      ctx.beginPath();
      ctx.roundRect(24, sheetY + 128, w - 48, 34, 10);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🔍 [V] 또는 터치하여 확대 · 콜 수락', w / 2, sheetY + 146);
    } else {
      const p = m.phase;
      const dist = delivery.getDistanceToOutdoorTarget(player.x, player.z);
      const badgeColor =
        p === 'to_pickup' || p === 'carrying_to_box' ? '#ea580c' : '#059669';
      const stepLabel = this.getPhaseShortLabel(p);

      ctx.fillStyle = badgeColor;
      ctx.beginPath();
      ctx.roundRect(26, sheetY + 26, 178, 26, 13);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12.5px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(stepLabel, 115, sheetY + 40);

      if (dist !== null && !player.inCorridor) {
        ctx.fillStyle = isNight ? '#60a5fa' : '#2563eb';
        ctx.font = 'bold 22px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`${Math.round(dist)}m`, w - 26, sheetY + 42);
      }

      const targetTitle =
        p === 'to_pickup' || p === 'carrying_to_box'
          ? `${m.order.shop.emoji} ${m.order.shop.name}`
          : `${m.order.customer.emoji} ${m.order.customer.name} ${m.order.unitNumber}`;
      ctx.fillStyle = isNight ? '#f8fafc' : '#0f172a';
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(targetTitle, 26, sheetY + 78);

      ctx.fillStyle = isNight ? '#94a3b8' : '#475569';
      ctx.font = '700 13px sans-serif';
      const metaInfo =
        p === 'to_pickup'
          ? `주문번호: ${m.order.orderNumber} · ${m.order.menuName}`
          : `공동현관 PIN: ${m.order.doorPin} · ${m.order.menuName}`;
      ctx.fillText(metaInfo, 26, sheetY + 102);

      if (p === 'cargo_loaded') {
        const barColor =
          m.foodIntegrity >= 80 ? '#10b981' : m.foodIntegrity >= 50 ? '#f59e0b' : '#ef4444';
        ctx.fillStyle = 'rgba(100,116,139,0.25)';
        ctx.beginPath();
        ctx.roundRect(26, sheetY + 120, w - 52, 10, 5);
        ctx.fill();
        ctx.fillStyle = barColor;
        ctx.beginPath();
        ctx.roundRect(26, sheetY + 120, ((w - 52) * m.foodIntegrity) / 100, 10, 5);
        ctx.fill();

        ctx.fillStyle = isNight ? '#cbd5e1' : '#334155';
        ctx.font = 'bold 13px sans-serif';
        ctx.fillText(`배달통 적재됨 · 상태 ${m.foodIntegrity}%`, 26, sheetY + 148);
      } else {
        ctx.fillStyle = isNight ? '#cbd5e1' : '#334155';
        ctx.font = 'bold 12.5px sans-serif';
        ctx.fillText(this.getPhaseHint(p, m.order.orderNumber, m.order.doorPin), 26, sheetY + 144);
      }
    }

    ctx.restore();
  }

  private getPhaseShortLabel(phase: string): string {
    switch (phase) {
      case 'to_pickup':
        return '1단계 · 야외 픽업대';
      case 'carrying_to_box':
        return '2단계 · 배달통 적재';
      case 'cargo_loaded':
        return '3단계 · 고객지 주행';
      case 'carrying_to_lobby':
        return '4단계 · 공동현관 PIN';
      case 'lobby_unlocked':
        return '5단계 · 엘리베이터 탑승';
      case 'in_corridor':
        return '6단계 · 문 앞 내려놓기';
      case 'photo_mode':
        return '7단계 · 완료 사진 촬영';
      case 'corridor_exit':
        return '완료 · 1층으로 복귀';
      default:
        return '배달 진행 중';
    }
  }

  private getPhaseHint(phase: string, orderNo: string, pin: string): string {
    switch (phase) {
      case 'to_pickup':
        return `야외 픽업대 [E] → POS에 "${orderNo}" 입력`;
      case 'carrying_to_box':
        return '오토바이 뒤 배달통에서 [E]로 적재 (손에 든 채 운전 불가)';
      case 'cargo_loaded':
        return '고객 건물 도착 후 하차(F) → 뒤편 배달통 [E] 꺼내기';
      case 'carrying_to_lobby':
        return `1층 유리문 [E] → 공동현관 PIN "${pin}" 입력`;
      case 'lobby_unlocked':
        return '열린 현관 앞에서 [E]로 엘리베이터 탑승';
      case 'in_corridor':
        return '목표 호수 문 앞 발매트에서 [E]로 음식 내려놓기';
      case 'photo_mode':
        return '[Space] 키 또는 셔터 버튼으로 배달 완료 사진 촬영';
      case 'corridor_exit':
        return '복도 엘리베이터 앞에서 [E]를 눌러 1층으로 복귀';
      default:
        return '';
    }
  }

  private syncDeliverySheet(player: PlayerState, delivery: DeliveryManager): void {
    const m = delivery.activeMission;
    const dist = delivery.getDistanceToOutdoorTarget(player.x, player.z);
    const roundedDist = dist !== null && !player.inCorridor ? Math.round(dist) : -1;

    const fingerprint = m
      ? `active:${m.order.id}:${m.phase}:${m.foodIntegrity}:${roundedDist}:${player.mode}`
      : `list:${delivery.availableOrders.map((o) => o.id).join(',')}`;

    if (fingerprint === this.lastSheetFingerprint) return;
    this.lastSheetFingerprint = fingerprint;

    if (!m) {
      const cardsHtml = delivery.availableOrders
        .map(
          (o) => `
          <div class="order-card">
            <div class="order-top">
              <span class="order-shop">${o.shop.emoji} ${o.shop.name} <span class="ord-tag">#${o.orderNumber}</span></span>
              <span class="order-fee">₩${o.baseFee.toLocaleString()}</span>
            </div>
            <div class="order-menu">${o.menuName}</div>
            <div class="order-bottom">
              <span class="order-dest">→ ${o.customer.name} ${o.unitNumber} (${o.distanceMeters}m)</span>
              <button class="order-accept-btn" data-action="accept" data-id="${o.id}">수락</button>
            </div>
          </div>`
        )
        .join('');

      this.sheetBodyEl.innerHTML = `
        <div class="sheet-header-row">
          <span class="sheet-title">🔔 신규 배달 콜 (${delivery.availableOrders.length})</span>
          <button class="sheet-refresh-btn" data-action="refresh" title="콜 새로고침">↻ 새로고침</button>
        </div>
        <div class="order-list">${cardsHtml}</div>
      `;
      return;
    }

    const p = m.phase;
    const isPickupStage = p === 'to_pickup' || p === 'carrying_to_box';
    const stepBadge = `<span class="step-badge ${isPickupStage ? 'pickup' : 'dropoff'}">${this.getPhaseShortLabel(p)}</span>`;
    const targetName = isPickupStage
      ? `${m.order.shop.emoji} ${m.order.shop.name}`
      : `${m.order.customer.emoji} ${m.order.customer.name} ${m.order.unitNumber}`;

    const integrityColor =
      m.foodIntegrity >= 80 ? '#10b981' : m.foodIntegrity >= 50 ? '#f59e0b' : '#ef4444';

    this.sheetBodyEl.innerHTML = `
      <div class="sheet-header-row">
        ${stepBadge}
        ${p !== 'corridor_exit' && !player.inCorridor ? '<button class="sheet-cancel-btn" data-action="cancel">배달 취소</button>' : ''}
      </div>
      <div class="active-target-row">
        <span class="active-target-name">${targetName}</span>
        ${roundedDist >= 0 ? `<span class="active-target-dist">${roundedDist}m</span>` : ''}
      </div>
      <div class="active-menu-line">${m.order.menuName} · 기본 ₩${m.order.baseFee.toLocaleString()}</div>
      <div class="order-codes-row">
        <span>픽업번호 <b>${m.order.orderNumber}</b></span>
        <span>현관PIN <b>${m.order.doorPin}</b></span>
        <span>호수 <b>${m.order.unitNumber}</b></span>
      </div>
      ${
        p === 'cargo_loaded'
          ? `<div class="integrity-row">
               <span>배달통 음식 상태</span>
               <span style="color:${integrityColor};font-weight:800">${m.foodIntegrity}%</span>
             </div>
             <div class="integrity-track">
               <div class="integrity-fill" style="width:${m.foodIntegrity}%;background:${integrityColor}"></div>
             </div>`
          : ''
      }
      <div class="mission-hint">${this.getPhaseHint(p, m.order.orderNumber, m.order.doorPin)}</div>
    `;
  }

  private resolveAreaName(px: number, pz: number, mapInfo: CityMapInfo): string {
    if (Math.abs(px) < 33 && Math.abs(pz) < 33) return '중앙 공원 광장';
    let nearest = '시내 도로';
    let bestDist = 62;
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
    delivery: DeliveryManager,
    signalState: SignalStateSnapshot,
    isNight: boolean,
    elapsedTime: number,
    mapInfo: CityMapInfo
  ): void {
    if (w < 10 || h < 10) return;

    ctx.save();
    ctx.scale(dpr, dpr);

    const theme = isNight
      ? {
          bg: '#131b26',
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

    const baseScale = Math.min(w, h) / 285;
    const scale = baseScale * this.zoomLevel;
    const centerX = w * 0.5;
    const centerY = h * 0.39;

    const toX = (wx: number) => centerX - (wx - this.camX) * scale;
    const toY = (wz: number) => centerY - (wz - this.camZ) * scale;

    // 1. Blocks & Central Park
    for (const bx of [-80, 0, 80]) {
      for (const bz of [-80, 0, 80]) {
        const bw = 65.5 * scale;
        ctx.fillStyle = bx === 0 && bz === 0 ? theme.park : theme.block;
        ctx.beginPath();
        ctx.roundRect(toX(bx) - bw / 2, toY(bz) - bw / 2, bw, bw, 4 * this.zoomLevel);
        ctx.fill();
      }
    }
    ctx.fillStyle = theme.water;
    ctx.beginPath();
    ctx.arc(toX(0), toY(0), 5.6 * scale, 0, Math.PI * 2);
    ctx.fill();

    // 2. Road Grid
    const roadW = mapInfo.roadWidth * scale;
    const drawRoads = () => {
      ctx.beginPath();
      for (const c of mapInfo.roadLines) {
        ctx.moveTo(toX(-152), toY(c));
        ctx.lineTo(toX(152), toY(c));
        ctx.moveTo(toX(c), toY(-152));
        ctx.lineTo(toX(c), toY(152));
      }
    };
    ctx.lineCap = 'square';
    ctx.strokeStyle = theme.roadOutline;
    ctx.lineWidth = roadW + 2.4;
    drawRoads();
    ctx.stroke();

    ctx.strokeStyle = theme.roadFill;
    ctx.lineWidth = roadW;
    drawRoads();
    ctx.stroke();

    ctx.save();
    ctx.strokeStyle = theme.roadCenter;
    ctx.lineWidth = Math.max(1, 1.1 * this.zoomLevel);
    ctx.setLineDash([4 * this.zoomLevel, 5 * this.zoomLevel]);
    drawRoads();
    ctx.stroke();
    ctx.restore();

    // 3. Building Footprints
    for (const b of mapInfo.buildings) {
      const rw = b.w * scale;
      const rd = b.d * scale;
      ctx.fillStyle =
        b.kind === 'shop'
          ? theme.bldgShop
          : b.kind === 'residential'
            ? theme.bldgRes
            : theme.bldgPublic;
      ctx.strokeStyle = theme.bldgStroke;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(toX(b.x) - rw / 2, toY(b.z) - rd / 2, rw, rd, 2.5);
      ctx.fill();
      ctx.stroke();

      if (b.label && this.zoomLevel >= 1.15 && rw > 12) {
        ctx.font = `700 ${Math.round(clamp(10 * Math.sqrt(this.zoomLevel), 10, 13))}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = theme.labelText;
        ctx.fillText(b.label, toX(b.x), toY(b.z));
      }
    }

    // 3.5. Intersection signal status dots (other cars intentionally NOT shown!)
    const sigHex = (c: 'green' | 'yellow' | 'red') =>
      c === 'green' ? '#22c55e' : c === 'yellow' ? '#facc15' : '#ef4444';

    for (const ix of mapInfo.roadLines) {
      for (const iz of mapInfo.roadLines) {
        const mx = toX(ix);
        const my = toY(iz);
        ctx.fillStyle = sigHex(signalState.ns);
        ctx.beginPath();
        ctx.arc(mx, my - 2.6, 2.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = sigHex(signalState.ew);
        ctx.beginPath();
        ctx.arc(mx + 2.6, my, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 4. Active Delivery GPS Navigation Route Line + Destination Pin
    const target = delivery.getCurrentOutdoorTarget();
    if (target && delivery.activeMission && !player.inCorridor) {
      const isPickup = delivery.activeMission.phase === 'to_pickup';
      const routeColor = isPickup ? '#f97316' : '#10b981';
      const route = delivery.computeRoute(player.x, player.z);

      if (route.length >= 2) {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = isPickup ? 'rgba(249,115,22,0.3)' : 'rgba(16,185,129,0.3)';
        ctx.lineWidth = 9;
        ctx.beginPath();
        ctx.moveTo(toX(route[0].x), toY(route[0].z));
        for (let i = 1; i < route.length; i++) {
          ctx.lineTo(toX(route[i].x), toY(route[i].z));
        }
        ctx.stroke();

        ctx.strokeStyle = routeColor;
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.restore();
      }

      const tx = toX(target.x);
      const ty = toY(target.z);
      const pulse = 10 + Math.sin(elapsedTime * 5) * 3.5;
      ctx.fillStyle = isPickup ? 'rgba(249,115,22,0.3)' : 'rgba(16,185,129,0.3)';
      ctx.beginPath();
      ctx.arc(tx, ty, pulse, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = routeColor;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(tx, ty, 6.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // 5. Own Scooter Pin
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
    }
    ctx.fillStyle = scooter.crashed ? '#ef4444' : '#0d9488';
    ctx.beginPath();
    ctx.arc(sx, sy, 6.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 6. Player Live GPS Cone & Arrow
    const px = toX(player.x);
    const py = toY(player.z);
    const dirX = -Math.sin(player.heading);
    const dirY = -Math.cos(player.heading);
    const mapAngle = Math.atan2(dirY, dirX);

    const grad = ctx.createRadialGradient(px, py, 2, px, py, 26);
    grad.addColorStop(0, 'rgba(59, 130, 246, 0.45)');
    grad.addColorStop(1, 'rgba(59, 130, 246, 0.0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.arc(px, py, 26, mapAngle - 0.55, mapAngle + 0.55);
    ctx.closePath();
    ctx.fill();

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(mapAngle + Math.PI / 2);
    ctx.fillStyle = '#2563eb';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(0, -8.5);
    ctx.lineTo(6.2, 6.5);
    ctx.lineTo(0, 3.5);
    ctx.lineTo(-6.2, 6.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.restore();
  }
}
