import { PlayerState } from '../player/PlayerController';
import { ScooterState } from '../vehicle/ScooterPhysics';
import { CityMapInfo } from '../world/CityWorld';
import { DeliveryManager } from '../delivery/DeliveryManager';
import { SignalStateSnapshot, TrafficCarSnapshot } from '../world/TrafficSystem';
import { clamp } from '../types';

export interface PhoneCallbacks {
  onAcceptOrder: (orderId: string) => void;
  onRefreshOrders: () => void;
  onCancelMission: () => void;
  onInteractMission: () => void;
}

export class PhoneMap {
  private readonly phoneEl = document.getElementById('rider-phone')!;
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
  private readonly expandBtn = document.getElementById('phone-expand-btn')!;

  private readonly callbacks: PhoneCallbacks;
  public isExpanded = false;
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

    this.expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleExpand();
    });

    // Event delegation for dynamically rendered delivery app buttons
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
    this.syncCanvasSize();
  }

  public toggleExpand(): boolean {
    this.isExpanded = !this.isExpanded;
    this.phoneEl.classList.toggle('expanded', this.isExpanded);
    this.expandBtn.textContent = this.isExpanded ? '축소' : '확대';
    requestAnimationFrame(() => this.syncCanvasSize());
    return this.isExpanded;
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
    trafficCars: TrafficCarSnapshot[],
    signalState: SignalStateSnapshot,
    isNight: boolean,
    elapsedTime: number,
    mapInfo: CityMapInfo
  ): void {
    this.syncCanvasSize();
    this.phoneEl.classList.toggle('night', isNight);

    const now = new Date();
    this.clockEl.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(
      now.getMinutes()
    ).padStart(2, '0')}`;

    this.areaEl.textContent = this.resolveAreaName(player.x, player.z, mapInfo);
    this.earningsEl.textContent = `₩${delivery.totalEarnings.toLocaleString()} (${delivery.completedCount}건)`;

    const isRiding = player.mode === 'riding';
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

    this.renderMap(player, scooter, delivery, trafficCars, signalState, isNight, elapsedTime, mapInfo);
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
    trafficCars: TrafficCarSnapshot[],
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
    const centerY = h * 0.38; // centered cleanly in visible upper map area above bottom sheet

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

    // 3.5. Live Traffic Signals & AI Vehicles on GPS Map
    const sigHex = (c: 'green' | 'yellow' | 'red') =>
      c === 'green' ? '#22c55e' : c === 'yellow' ? '#facc15' : '#ef4444';

    for (const ix of mapInfo.roadLines) {
      for (const iz of mapInfo.roadLines) {
        const mx = toX(ix);
        const my = toY(iz);
        // Compact NS (vertical) & EW (horizontal) live signal dots at intersection center
        ctx.fillStyle = sigHex(signalState.ns);
        ctx.beginPath();
        ctx.arc(mx, my - 2.6, 2.1, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = sigHex(signalState.ew);
        ctx.beginPath();
        ctx.arc(mx + 2.8, my, 2.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    for (const car of trafficCars) {
      const cx = toX(car.x);
      const cy = toY(car.z);
      ctx.save();
      ctx.translate(cx, cy);
      // Match map orientation (+Z up, +X left -> rotate by -heading)
      ctx.rotate(-car.heading);
      ctx.fillStyle = car.color;
      ctx.strokeStyle = isNight ? 'rgba(0,0,0,0.65)' : 'rgba(15,23,42,0.45)';
      ctx.lineWidth = 0.9;
      ctx.fillRect(-2.4, -4.2, 4.8, 8.4);
      ctx.strokeRect(-2.4, -4.2, 4.8, 8.4);
      ctx.restore();
    }

    // 4. Active Delivery GPS Navigation Route Line + Pulsing Destination Pin!
    const target = delivery.getCurrentTarget();
    if (target && delivery.activeMission) {
      const isPickup = delivery.activeMission.phase === 'pickup';
      const routeColor = isPickup ? '#f97316' : '#10b981';
      const route = delivery.computeRoute(player.x, player.z);

      if (route.length >= 2) {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        // Glow halo
        ctx.strokeStyle = isPickup ? 'rgba(249,115,22,0.28)' : 'rgba(16,185,129,0.28)';
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(toX(route[0].x), toY(route[0].z));
        for (let i = 1; i < route.length; i++) {
          ctx.lineTo(toX(route[i].x), toY(route[i].z));
        }
        ctx.stroke();

        // Crisp inner nav line
        ctx.strokeStyle = routeColor;
        ctx.lineWidth = 3.5;
        ctx.stroke();
        ctx.restore();
      }

      // Pulsing destination pin
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

    // 5. Scooter Pin (turns red if fallen/crashed!)
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
