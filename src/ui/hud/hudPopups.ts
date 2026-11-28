import { localizeKeyHints } from '../../game/keyBindings';
/** Transient HUD popups: toasts, accident banner, speed camera flash, fine ticket card and customer chat bubble */
import type { Hud } from '../Hud';
import { CustomerChatEvent } from '../../delivery/DeliveryManager';
import { SpeedCameraTriggerEvent } from '../../world/RoadHazardManager';

export function showToast(host: Hud, message: string, durationMs = 2800): void {
  host.toast.textContent = localizeKeyHints(message);
  host.toast.classList.remove('hidden');
  if (host.toastTimer !== null) {
    window.clearTimeout(host.toastTimer);
  }
  host.toastTimer = window.setTimeout(() => {
    host.toast.classList.add('hidden');
    host.toastTimer = null;
  }, durationMs);
}

/** Displays prominent top emergency banner: "보행자 접촉 사고 발생!" */
export function showAccidentBanner(
  host: Hud,
  fine: number,
  ratingLoss: number,
  newRating: number,
  durationMs = 5500,
): void {
  host.accidentBannerDetail.textContent = `과태료·합의금 -₩${fine.toLocaleString()} 즉시 차감 · 기사 신뢰 평점 -${ratingLoss.toFixed(1)}점 (현재 ★ ${newRating.toFixed(1)})`;
  host.accidentBanner.classList.remove('hidden');
  if (host.accidentBannerTimer !== null) {
    window.clearTimeout(host.accidentBannerTimer);
  }
  host.accidentBannerTimer = window.setTimeout(() => {
    host.accidentBanner.classList.add('hidden');
    host.accidentBannerTimer = null;
  }, durationMs);
}

/** Brief white strobe flash when caught by a roadside speed/red-light enforcement camera */
export function triggerSpeedCameraFlash(host: Hud): void {
  host.speedCamFlash.classList.remove('hidden', 'active');
  void host.speedCamFlash.offsetWidth;
  host.speedCamFlash.classList.add('active');
  window.setTimeout(() => {
    host.speedCamFlash.classList.remove('active');
    host.speedCamFlash.classList.add('hidden');
  }, 390);
}

/** Displays non-blocking Korean Police Traffic Violation Ticket Notice Popup Card */
export function showFineTicketPopup(host: Hud, ev: SpeedCameraTriggerEvent, durationMs = 6200): void {
  const now = new Date();
  const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  host.ftViolationEl.textContent =
    ev.kind === 'patrol_speeding'
      ? `🚓 순찰차 현장 과속 단속 (제한 ${ev.limitKmh}km/h 초과)`
      : ev.kind === 'patrol_red_light'
        ? '🚓 순찰차 현장 단속 · 신호위반 (빨간불 교차로 진입)'
        : ev.kind === 'patrol_sidewalk'
          ? '🚓 순찰차 현장 단속 · 이륜차 보도 통행'
          : ev.kind === 'patrol_wrong_way'
            ? '🚓 순찰차 현장 단속 · 일방통행 역주행'
          : ev.kind === 'red_light'
            ? '📸 무인 신호위반 단속 카메라 적발'
            : `📸 무인 과속 단속 (제한 ${ev.limitKmh}km/h 초과)`;
  host.ftLocationEl.textContent = ev.label;
  host.ftSpeedEl.textContent =
    ev.limitKmh > 0 ? `${ev.measuredKmh} km/h (제한 ${ev.limitKmh})` : `${ev.measuredKmh} km/h`;
  host.ftTimeEl.textContent = ts;
  host.ftAmountEl.textContent = `-₩${ev.fine.toLocaleString()}`;

  host.fineTicketEl.classList.remove('hidden');
  if (host.fineTicketTimer !== null) {
    window.clearTimeout(host.fineTicketTimer);
  }
  host.fineTicketTimer = window.setTimeout(() => {
    host.hideFineTicketPopup();
  }, durationMs);
}

export function hideFineTicketPopup(host: Hud): void {
  host.fineTicketEl.classList.add('hidden');
  if (host.fineTicketTimer !== null) {
    window.clearTimeout(host.fineTicketTimer);
    host.fineTicketTimer = null;
  }
}

/** Displays non-blocking Korean Messenger Customer Chat Event Popup */
export function showCustomerChatPopup(host: Hud, ev: CustomerChatEvent, durationMs = 6800): void {
  host.ccSenderEl.textContent = `💬 고객 메시지 · #${ev.orderNumber} (${ev.customerName})`;
  host.ccTitleEl.textContent = ev.title;
  host.ccMessageEl.textContent = ev.message;
  host.ccEffectEl.textContent = ev.effectBadge;
  host.chatPopupEl.classList.remove('hidden');

  if (host.chatPopupTimer !== null) {
    window.clearTimeout(host.chatPopupTimer);
  }
  host.chatPopupTimer = window.setTimeout(() => {
    host.hideCustomerChatPopup();
  }, durationMs);
}

export function hideCustomerChatPopup(host: Hud): void {
  host.chatPopupEl.classList.add('hidden');
  if (host.chatPopupTimer !== null) {
    window.clearTimeout(host.chatPopupTimer);
    host.chatPopupTimer = null;
  }
}
