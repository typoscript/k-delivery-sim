import { PlayerState } from '../../player/PlayerController';
import { orderDisplayFee, regularCustomerChip, specialOrderChip } from './orderTags';
import {
  ActiveMission,
  CARGO_SLOT_COUNT,
  DeliveryManager,
  MAX_CONCURRENT_ORDERS,
  NavigationPlan,
  getInstructionMeta,
} from '../../delivery/DeliveryManager';
import { getPhaseShortLabel } from './phoneFormat';

/** [콜 목록] top-nav tabs: 신규 콜 & 수락 주문 */
export function renderCallsTab(player: PlayerState, delivery: DeliveryManager): string {
  const canAccept = delivery.canAcceptMoreOrders() && !player.inCorridor;
  const full = !delivery.canAcceptMoreOrders();

  const cardsHtml = delivery.availableOrders
    .map(
      (o) => `
      <div class="order-card ${o.rainBonus > 0 ? 'rain-order' : ''}">
        <div class="order-top">
          <span class="order-shop">
            <span class="dispatch-type-pill ${o.dispatchType === 'SINGLE' ? 'single' : 'alttle'}">${o.dispatchType === 'SINGLE' ? '한집' : '알뜰'}</span>
            ${o.shop.emoji} ${o.shop.name} ${delivery.isRegularShop(o.shop.id) ? '<span class="regular-shop-tag">⭐단골</span>' : ''} <span class="ord-tag">#${o.orderNumber}</span>
          </span>
          <span class="order-fee">₩${orderDisplayFee(o).toLocaleString()}</span>
        </div>
        <div class="order-menu">
          ${o.menuName}
          <span class="food-meta-chip ${o.foodTempType === 'cold' ? 'cold' : o.isSpillSensitive ? 'spill' : ''}">${o.foodCategoryTag}</span>
          <span class="inst-badge">${getInstructionMeta(o.deliveryInstruction).badge}</span>
          ${o.rainBonus > 0 ? `<span class="rain-bonus-tag">🌧️ 우천 +₩${o.rainBonus.toLocaleString()}</span>` : ''}
          ${o.nightBonus > 0 ? `<span class="night-bonus-tag">🌙 심야 +₩${o.nightBonus.toLocaleString()}</span>` : ''}
          ${(o.peakBonus ?? 0) > 0 ? `<span class="peak-bonus-tag">🔥 피크 +₩${(o.peakBonus ?? 0).toLocaleString()}</span>` : ''}
          ${specialOrderChip(o)}${regularCustomerChip(o)}
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

export function renderAcceptedTab(
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
            <span class="step-badge ${stepCls}">${getPhaseShortLabel(m.phase, m.cargoSlot, m.cookingRemainingSec)}</span>
            <span class="mission-timer-pill ${timerCls}">⏱ ${remMin}:${remS}</span>
            <span class="order-fee">₩${orderDisplayFee(m.order).toLocaleString()}</span>
          </div>
          <div class="order-top">
            <span>${m.order.shop.emoji} ${m.order.shop.name} ${delivery.isRegularShop(m.order.shop.id) ? '<span class="regular-shop-tag">⭐단골</span>' : ''} <span class="ord-tag">#${m.order.orderNumber}</span>${slotPill}${m.order.rainBonus > 0 ? ' <span class="rain-bonus-tag">🌧️+1.5천</span>' : ''}${m.order.nightBonus > 0 ? ' <span class="night-bonus-tag">🌙+1.2천</span>' : ''}${(m.order.peakBonus ?? 0) > 0 ? ' <span class="peak-bonus-tag">🔥+1천</span>' : ''}${specialOrderChip(m.order)}${regularCustomerChip(m.order)}</span>
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
