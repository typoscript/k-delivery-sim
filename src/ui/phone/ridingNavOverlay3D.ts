import { ScooterState } from '../../vehicle/ScooterPhysics';
import { CityMapInfo } from '../../world/CityWorld';
import { CARGO_SLOT_COUNT, DeliveryManager, MAX_CONCURRENT_ORDERS, NavigationPlan } from '../../delivery/DeliveryManager';
import { TurnDirection } from '../../world/RoadNavigator';
import { clamp } from '../../types';

/** High-contrast 3D Handlebar Turn-by-Turn Navigation HUD while riding */
export function renderRidingNavOverlay(
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
    drawTurnArrowIcon(ctx, 65, 95, g.direction);

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
export function drawTurnArrowIcon(
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
