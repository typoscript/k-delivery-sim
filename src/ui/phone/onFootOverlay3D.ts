import { PlayerState } from '../../player/PlayerController';
import { fitName } from './canvasText';
import {
  CARGO_SLOT_COUNT,
  DeliveryManager,
  MAX_CONCURRENT_ORDERS,
  NavigationPlan,
  getInstructionMeta,
} from '../../delivery/DeliveryManager';
import { clamp } from '../../types';
import { getPhaseShortLabel } from './phoneFormat';

/** On-foot 3D hand-held phone summary overlay */
export function renderOnFootPhoneOverlay(
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
      const feeText = `₩${(first.baseFee + first.rainBonus).toLocaleString()}`;
      const nameW = w - 36 - ctx.measureText(feeText).width - 12 - 36;
      ctx.fillText(fitName(ctx, `${first.shop.emoji} `, first.shop.name, ` [#${first.orderNumber}]`, nameW), 36, sheetY + 80);

      ctx.fillStyle = isNight ? '#34d399' : '#059669';
      ctx.textAlign = 'right';
      ctx.fillText(feeText, w - 36, sheetY + 80);

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
    ctx.fillText(getPhaseShortLabel(p, m.cargoSlot), 113, sheetY + 37);

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
    const goals = delivery.getShiftGoals();
    const next = goals.find((g) => !g.claimed);
    ctx.fillText(
      next
        ? `📅 ${delivery.shiftDay}일차 목표 ${next.icon} ${next.title} ${next.current}/${next.target} · [V] 확대`
        : `🏆 ${delivery.shiftDay}일차 목표 모두 달성! · [V] 확대`,
      w / 2,
      sheetY + 160
    );
  }
}
