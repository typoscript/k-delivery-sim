import { CityMapInfo } from '../../world/CityWorld';
import { regularCustomerChip, specialOrderChip, specialOrderTag } from './orderTags';
import { DeliveryManager, NavigationPlan, getInstructionMeta } from '../../delivery/DeliveryManager';
import { DispatchOffer } from '../../delivery/OrderDispatchManager';
import { clamp } from '../../types';

/** DOM nodes of the 20-second incoming call popup inside the zoomed smartphone */
export interface DispatchPopupEls {
  dispatchPopupEl: HTMLElement;
  dispatchCardEl: HTMLElement;
  dpTypeBadgeEl: HTMLElement;
  dpRingFgEl: HTMLElement;
  dpTimerTextEl: HTMLElement;
  dpFeeEl: HTMLElement;
  dpSubMetaEl: HTMLElement;
  dpStopsEl: HTMLElement;
}

export interface DispatchPopupState {
  lastOfferPopupId: string;
  lastOfferPulseTick: number;
}

/** Highlights Korean apartment lobby PIN pattern & delivery instruction at the top of the smartphone app */
export function syncPinTooltip(
  pinTooltipEl: HTMLElement,
  delivery: DeliveryManager,
  navPlan: NavigationPlan
): void {
  const focus = navPlan.focusMission ?? delivery.activeMission;
  if (!focus) {
    pinTooltipEl.classList.add('hidden');
    return;
  }
  const inst = getInstructionMeta(focus.order.deliveryInstruction);
  const villaTxt =
    focus.order.customer.residenceKind === 'walkup_villa' ? ' · 🪜계단' : '';
  const chatTxt = focus.chatNote ? ` · 💬${focus.chatNote}` : '';
  pinTooltipEl.innerHTML = `🔑 <b>${focus.order.doorPinLabel}</b> · ${focus.order.unitNumber}${villaTxt} · ${inst.badge}${chatTxt}`;
  pinTooltipEl.classList.remove('hidden');
}

/** Shows 80m speed-camera approach warning strip inside zoomed smartphone topbar */
export function syncCameraAlertBanner(camAlertEl: HTMLElement, mapInfo: CityMapInfo): void {
  const cam = mapInfo.upcomingCamera;
  if (!cam) {
    camAlertEl.classList.add('hidden');
    return;
  }
  camAlertEl.className = `phone-cam-alert${cam.isOverSpeed ? ' overspeed' : ''}`;
  camAlertEl.innerHTML = `
    <span>📷 전방 ${cam.distanceMeters}m 신호·과속 단속</span>
    <span>${cam.isOverSpeed ? '🚨 감속!' : `제한 ${cam.limitKmh}`}</span>
  `;
}

/** Shows yellow cooking delay gauge (or emerald ready banner) inside zoomed smartphone topbar */
export function syncCookingBanner(cookingBannerEl: HTMLElement, delivery: DeliveryManager): void {
  const cm = delivery.getPrimaryCookingMission();
  if (!cm) {
    cookingBannerEl.classList.add('hidden');
    return;
  }
  cookingBannerEl.classList.remove('hidden');
  if (cm.phase === 'cooking_wait') {
    const rem = Math.max(1, Math.ceil(cm.cookingRemainingSec));
    const pct =
      cm.cookingDurationSec > 0
        ? clamp((cm.cookingRemainingSec / cm.cookingDurationSec) * 100, 0, 100)
        : 0;
    cookingBannerEl.className = 'phone-cooking-banner';
    cookingBannerEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:6px">
        <span>🍳 ${cm.order.shop.name} [#${cm.order.orderNumber}] 조리 중</span>
        <span>남은 ${rem}초</span>
      </div>
      <div class="phone-ck-track"><div class="phone-ck-fill" style="width:${pct.toFixed(1)}%"></div></div>
    `;
  } else {
    cookingBannerEl.className = 'phone-cooking-banner ready';
    cookingBannerEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:6px">
        <span>🔔 ${cm.order.shop.name} [#${cm.order.orderNumber}] 조리 완료!</span>
        <span>트레이 [E] 수령</span>
      </div>
      <div class="phone-ck-track"><div class="phone-ck-fill" style="width:100%"></div></div>
    `;
  }
}

/** Syncs the interactive 20s circular progress call popup inside the zoomed smartphone UI */
export function syncDispatchPopup(
  els: DispatchPopupEls,
  state: DispatchPopupState,
  offer: DispatchOffer | null,
  delivery: DeliveryManager
): void {
  if (!offer) {
    els.dispatchPopupEl.classList.add('hidden');
    state.lastOfferPopupId = '';
    return;
  }

  els.dispatchPopupEl.classList.remove('hidden');
  const isSingle = offer.type === 'SINGLE';

  if (offer.id !== state.lastOfferPopupId || offer.pulseTick !== state.lastOfferPulseTick) {
    state.lastOfferPopupId = offer.id;
    state.lastOfferPulseTick = offer.pulseTick;

    els.dispatchCardEl.classList.toggle('alttle', !isSingle);
    els.dispatchCardEl.classList.remove('vibrate');
    void els.dispatchCardEl.offsetWidth;
    els.dispatchCardEl.classList.add('vibrate');

    const specialKind = offer.orders.find((o) => o.special)?.special;
    els.dpTypeBadgeEl.className = `dp-type-badge ${isSingle ? 'single' : 'alttle'}${specialKind ? ` special-${specialKind}` : ''}`;
    els.dpTypeBadgeEl.textContent =
      specialKind === 'urgent'
        ? '⏱️ 급한 배달 · 한집 직행'
        : specialKind === 'group'
          ? '🍱 단체 주문 · 한집 직행'
          : isSingle
            ? '🚀 한집배달 · 단건 직행'
            : '🛵 알뜰배달 · 2건 묶음';

    const rainTag = offer.totalRainBonus > 0 ? ` · 🌧️우천+₩${offer.totalRainBonus.toLocaleString()}` : '';
    const nightTag = offer.totalNightBonus > 0 ? ` · 🌙심야+₩${offer.totalNightBonus.toLocaleString()}` : '';
    const peakTag = offer.totalPeakBonus > 0 ? ` · 🔥피크+₩${offer.totalPeakBonus.toLocaleString()}` : '';
    const special = offer.orders.find((o) => o.special);
    const specialTag = special ? ` · ${specialOrderTag(special)}` : '';
    els.dpFeeEl.textContent = `₩${offer.totalFee.toLocaleString()}`;
    els.dpSubMetaEl.textContent = `제한 ${Math.round(offer.timeLimitSec / 60)}분(${offer.timeLimitSec}초) · 총 ${offer.totalDistanceMeters}m${rainTag}${nightTag}${peakTag}${specialTag}`;

    els.dpStopsEl.innerHTML = offer.orders
      .map(
        (o, idx) => `
        <div class="dp-stop-item">
          <div class="dp-stop-shop">${offer.orders.length > 1 ? `${idx + 1}. ` : ''}${o.shop.emoji} ${o.shop.name} ${delivery.isRegularShop(o.shop.id) ? '<span class="regular-shop-tag">⭐단골</span> ' : ''}<span class="ord-tag">#${o.orderNumber}</span> <span class="food-meta-chip ${o.foodTempType === 'cold' ? 'cold' : o.isSpillSensitive ? 'spill' : ''}">${o.foodCategoryTag}</span>${specialOrderChip(o)}</div>
          <div class="dp-stop-cust">→ ${o.customer.emoji} ${o.customer.name} ${o.unitNumber}${regularCustomerChip(o)}${o.customer.residenceKind === 'walkup_villa' ? ' <span class="villa-tag">🪜계단+500</span>' : ''} · ${getInstructionMeta(o.deliveryInstruction).badge}</div>
        </div>`
      )
      .join('');
  }

  // Smooth circular SVG ring countdown (r=18 -> circumference = 113.097)
  const frac = clamp(offer.remainingOfferSec / offer.durationOfferSec, 0, 1);
  const circ = 113.1;
  els.dpRingFgEl.style.strokeDashoffset = String((1 - frac) * circ);
  els.dpRingFgEl.setAttribute(
    'class',
    `dp-ring-fg ${offer.remainingOfferSec <= 5 ? 'urgent' : offer.remainingOfferSec <= 10 ? 'warn' : ''}`
  );
  els.dpTimerTextEl.textContent = String(Math.max(0, Math.ceil(offer.remainingOfferSec)));
}
