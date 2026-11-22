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
}

export class PhoneMap {
  private readonly phoneEl = document.getElementById('rider-phone')!;
  private readonly pocketPillEl = document.getElementById('phone-pocket-pill')!;
  private readonly pocketPillTextEl = document.getElementById('pocket-pill-text')!;
  private readonly pocketBadgeEl = document.getElementById('pocket-mission-dot')!;
  private readonly placementTagEl = document.getElementById('phone-placement-tag')!;

  private readonly canvas = document.getElementById('phone-map-canvas') as HTMLCanvasElement;
  private readonly ctx = this.canvas.getContext('2d')!;
  private readonly clockEl = document.getElementById('phone-clock')!;
  private readonly areaEl = document.getElementById('phone-area-name')!;
  private readonly earningsEl = document.getElementById('phone-earnings')!;
  private readonly statusPillEl = document.getElementById('phone-status-pill')!;
  private readonly sheetBodyEl = document.getElementById('phone-sheet-body')!;

  private readonly zoomInBtn = document.getElementById('map-zoom-in')!;
  private readonly zoomOutBtn = document.getElementById('map-zoom-out')!;
  private readonly followBtn = document.getElementById('map-follow-btn')!;
  private readonly stowBtn = document.getElementById('phone-stow-btn')!;

  private readonly callbacks: PhoneCallbacks;
  public placement: PhonePlacement = 'pocket';

  private followPlayer = true;
  private zoomLevel = 1.5;
  private camX = -62;
  private camZ = -34;
  private lastSheetFingerprint = '';

  constructor(callbacks: PhoneCallbacks) {
    this.callbacks = callbacks;

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

    this.stowBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onTogglePhone();
    });

    this.pocketPillEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onTogglePhone();
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
    this.phoneEl.classList.toggle('mode-pocket', next === 'pocket');
    this.phoneEl.classList.toggle('mode-hand', next === 'in_hand');
    this.phoneEl.classList.toggle('mode-mounted', next === 'mounted');
    this.pocketPillEl.classList.toggle('hidden', next !== 'pocket');

    if (next === 'in_hand') {
      this.placementTagEl.textContent = '✋ 손에 들고 보는 중';
      this.stowBtn.textContent = '주머니로';
    } else if (next === 'mounted') {
      this.placementTagEl.textContent = '🛵 오토바이 거치대 장착';
      this.stowBtn.textContent = '분리';
    }

    if (next !== 'pocket') {
      requestAnimationFrame(() => this.syncCanvasSize());
    }
  }

  /**
   * Condition 1 (Not riding): Tab takes phone out of pocket into hand (or puts it back)
   * Condition 2 (Riding): Tab places phone from pocket onto scooter mount (or puts it back)
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
        message: '📱 휴대폰을 오토바이 거치대에 장착했습니다',
      };
    }

    this.setPlacement('in_hand');
    return {
      placement: 'in_hand',
      message: '📱 주머니에서 휴대폰을 꺼내 손에 들었습니다',
    };
  }

  private syncCanvasSize(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetW = Math.round(rect.width * dpr);
    const targetH = Math.round(rect.height * dpr);
    if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
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

    // Update minimal pocket hint chip when phone is stowed away in pocket
    if (this.placement === 'pocket') {
      this.pocketPillTextEl.textContent = isRiding
        ? '오토바이 거치대에 휴대폰 놓기'
        : '주머니에서 휴대폰 꺼내기';
      this.pocketBadgeEl.classList.toggle('hidden', delivery.activeMission === null);
      return;
    }

    this.syncCanvasSize();
    this.phoneEl.classList.toggle('night', isNight);

    const now = new Date();
    this.clockEl.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(
      now.getMinutes()
    ).padStart(2, '0')}`;

    this.areaEl.textContent = this.resolveAreaName(player.x, player.z, mapInfo);
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

    const targetX = this.followPlayer ? player.x : 0;
    const targetZ = this.followPlayer ? player.z : 0;
    this.camX += (targetX - this.camX) * 0.16;
    this.camZ += (targetZ - this.camZ) * 0.16;

    this.renderMap(player, scooter, delivery, signalState, isNight, elapsedTime, mapInfo);
  }

  private syncDeliverySheet(player: PlayerState, delivery: DeliveryManager): void {
    const m = delivery.activeMission;
    const dist = delivery.getDistanceToTarget(player.x, player.z);
    const inZone = delivery.isInsideTargetZone(player.x, player.z);
    const roundedDist = dist !== null ? Math.round(dist) : -1;

    const fingerprint = m
      ? `active:${m.order.id}:${m.phase}:${m.foodIntegrity}:${roundedDist}:${inZone}:${player.mode}`
      : `list:${delivery.availableOrders.map((o) => o.id).join(',')}`;

    if (fingerprint === this.lastSheetFingerprint) return;
    this.lastSheetFingerprint = fingerprint;

    if (!m) {
      const cardsHtml = delivery.availableOrders
        .map(
          (o) => `
          <div class="order-card">
            <div class="order-top">
              <span class="order-shop">${o.shop.emoji} ${o.shop.name}</span>
              <span class="order-fee">₩${o.baseFee.toLocaleString()}</span>
            </div>
            <div class="order-menu">${o.menuName}</div>
            <div class="order-bottom">
              <span class="order-dest">→ ${o.customer.name} (${o.distanceMeters}m)</span>
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

    const isPickup = m.phase === 'pickup';
    const stepBadge = isPickup
      ? '<span class="step-badge pickup">1단계 · 픽업 이동</span>'
      : '<span class="step-badge dropoff">2단계 · 고객 배달</span>';
    const targetName = isPickup
      ? `${m.order.shop.emoji} ${m.order.shop.name}`
      : `${m.order.customer.emoji} ${m.order.customer.name}`;
    const actionLabel = isPickup ? '음식 픽업 완료 [E]' : '문 앞 배달 완료 [E]';

    const integrityColor =
      m.foodIntegrity >= 80 ? '#10b981' : m.foodIntegrity >= 50 ? '#f59e0b' : '#ef4444';

    const actionHtml = inZone
      ? player.mode === 'on_foot'
        ? `<button class="mission-action-btn ${isPickup ? 'pickup' : 'dropoff'}" data-action="interact">${actionLabel}</button>`
        : `<div class="mission-hint">먼저 <kbd>F</kbd>로 오토바이에서 내리세요</div>`
      : `<div class="mission-hint">${isPickup ? '주황색 픽업 구역으로 이동하세요' : '초록색 배달 목적지로 이동하세요'}</div>`;

    this.sheetBodyEl.innerHTML = `
      <div class="sheet-header-row">
        ${stepBadge}
        <button class="sheet-cancel-btn" data-action="cancel">배달 취소</button>
      </div>
      <div class="active-target-row">
        <span class="active-target-name">${targetName}</span>
        <span class="active-target-dist">${roundedDist}m</span>
      </div>
      <div class="active-menu-line">${m.order.menuName} · 기본 ₩${m.order.baseFee.toLocaleString()}</div>
      ${
        !isPickup
          ? `<div class="integrity-row">
               <span>음식 상태</span>
               <span style="color:${integrityColor};font-weight:800">${m.foodIntegrity}%</span>
             </div>
             <div class="integrity-track">
               <div class="integrity-fill" style="width:${m.foodIntegrity}%;background:${integrityColor}"></div>
             </div>`
          : ''
      }
      ${actionHtml}
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

  private renderMap(
    player: PlayerState,
    scooter: ScooterState,
    delivery: DeliveryManager,
    signalState: SignalStateSnapshot,
    isNight: boolean,
    elapsedTime: number,
    mapInfo: CityMapInfo
  ): void {
    const ctx = this.ctx;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.width / dpr;
    const h = this.canvas.height / dpr;
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
    const centerY = h * 0.38;

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
        ctx.font = `600 ${Math.round(clamp(9 * Math.sqrt(this.zoomLevel), 9, 11.5))}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = theme.labelText;
        ctx.fillText(b.label, toX(b.x), toY(b.z));
      }
    }

    // 3.5. Intersection signal status dots (other vehicles are intentionally NOT shown on phone GPS)
    const sigHex = (c: 'green' | 'yellow' | 'red') =>
      c === 'green' ? '#22c55e' : c === 'yellow' ? '#facc15' : '#ef4444';

    for (const ix of mapInfo.roadLines) {
      for (const iz of mapInfo.roadLines) {
        const mx = toX(ix);
        const my = toY(iz);
        ctx.fillStyle = sigHex(signalState.ns);
        ctx.beginPath();
        ctx.arc(mx, my - 2.6, 2.0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = sigHex(signalState.ew);
        ctx.beginPath();
        ctx.arc(mx + 2.6, my, 2.0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 4. Active Delivery GPS Navigation Route Line + Pulsing Destination Pin
    const target = delivery.getCurrentTarget();
    if (target && delivery.activeMission) {
      const isPickup = delivery.activeMission.phase === 'pickup';
      const routeColor = isPickup ? '#f97316' : '#10b981';
      const route = delivery.computeRoute(player.x, player.z);

      if (route.length >= 2) {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = isPickup ? 'rgba(249,115,22,0.28)' : 'rgba(16,185,129,0.28)';
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(toX(route[0].x), toY(route[0].z));
        for (let i = 1; i < route.length; i++) {
          ctx.lineTo(toX(route[i].x), toY(route[i].z));
        }
        ctx.stroke();

        ctx.strokeStyle = routeColor;
        ctx.lineWidth = 3.5;
        ctx.stroke();
        ctx.restore();
      }

      const tx = toX(target.x);
      const ty = toY(target.z);
      const pulse = 9 + Math.sin(elapsedTime * 5) * 3;
      ctx.fillStyle = isPickup ? 'rgba(249,115,22,0.28)' : 'rgba(16,185,129,0.28)';
      ctx.beginPath();
      ctx.arc(tx, ty, pulse, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = routeColor;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(tx, ty, 6.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // 5. Own Scooter Pin (red if crashed)
    const sx = toX(scooter.x);
    const sy = toY(scooter.z);
    if (player.mode !== 'riding') {
      ctx.save();
      ctx.strokeStyle = scooter.crashed ? 'rgba(239,68,68,0.6)' : 'rgba(20,184,166,0.55)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(toX(player.x), toY(player.z));
      ctx.lineTo(sx, sy);
      ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = scooter.crashed ? '#ef4444' : '#0d9488';
    ctx.beginPath();
    ctx.arc(sx, sy, 5.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // 6. Player Live GPS Cone & Arrow
    const px = toX(player.x);
    const py = toY(player.z);
    const dirX = -Math.sin(player.heading);
    const dirY = -Math.cos(player.heading);
    const mapAngle = Math.atan2(dirY, dirX);

    const grad = ctx.createRadialGradient(px, py, 2, px, py, 24);
    grad.addColorStop(0, 'rgba(59, 130, 246, 0.45)');
    grad.addColorStop(1, 'rgba(59, 130, 246, 0.0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.arc(px, py, 24, mapAngle - 0.55, mapAngle + 0.55);
    ctx.closePath();
    ctx.fill();

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(mapAngle + Math.PI / 2);
    ctx.fillStyle = '#2563eb';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5.8, 6);
    ctx.lineTo(0, 3.2);
    ctx.lineTo(-5.8, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.restore();
  }
}
