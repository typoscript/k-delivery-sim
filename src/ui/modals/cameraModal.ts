/** Doorstep photo: viewfinder, proof status / warnings, shutter flash and the settlement screen */
import type { ModalUi } from '../ModalUi';
import { DeliveryOrder, SettlementResult } from '../../delivery/DeliveryManager';
import { PhotoProofResult } from '../../camera/PhotoProofValidator';
import { settlementBreakdownHtml, settlementPhotoBadge } from './modalViews';

export function openCameraViewfinder(host: ModalUi, order: DeliveryOrder): void {
  host.closeAll();
  host.activeModal = 'camera';
  const now = new Date();
  const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  host.cameraStamp.textContent = `#${order.orderNumber} · ${order.customer.name} ${order.unitNumber} · ${ts}`;
  host.vfFailPopup.classList.add('hidden');
  host.vfFrame.classList.remove('valid', 'fail-shake');
  host.cameraOverlay.classList.remove('hidden');
}

/** Live-updates the central 60% viewfinder detection chips (호수 팻말 + 음식 봉투) */
export function updateCameraProofStatus(host: ModalUi, res: PhotoProofResult): void {
  if (host.activeModal !== 'camera') return;
  host.vfChkPlate.textContent = res.plate.valid ? '✓ 호수 팻말' : '✕ 호수 팻말';
  host.vfChkPlate.className = `vf-chk-pill ${res.plate.valid ? 'ok' : 'miss'}`;

  host.vfChkFood.textContent = res.food.valid ? '✓ 음식 봉투' : '✕ 음식 봉투';
  host.vfChkFood.className = `vf-chk-pill ${res.food.valid ? 'ok' : 'miss'}`;

  host.vfFrame.classList.toggle('valid', res.valid);
  host.vfGuideText.textContent = res.valid
    ? '✓ 호수 + 음식 봉투 확인 완료! [Space] 또는 셔터 버튼으로 배달 완료 승인'
    : res.reason;
}

/** Displays a prominent failure warning popup inside the viewfinder and prompts re-shooting */
export function showCameraValidationWarning(host: ModalUi, res: PhotoProofResult): void {
  if (host.activeModal !== 'camera') return;
  host.vfFailPopup.innerHTML = `⚠️ 현관문 호수와 음식 봉투가 모두 보이도록 찍어주세요!<div style="font-size:11.5px;margin-top:4px;font-weight:600;color:#fecaca">${res.reason}</div>`;
  host.vfFailPopup.classList.remove('hidden');
  host.vfFrame.classList.remove('fail-shake');
  void host.vfFrame.offsetWidth;
  host.vfFrame.classList.add('fail-shake');

  if (host.vfFailTimer !== null) {
    window.clearTimeout(host.vfFailTimer);
  }
  host.vfFailTimer = window.setTimeout(() => {
    host.vfFailPopup.classList.add('hidden');
    host.vfFrame.classList.remove('fail-shake');
    host.vfFailTimer = null;
  }, 3200);
}

export function triggerCameraFlash(host: ModalUi): void {
  host.cameraFlash.classList.remove('hidden');
  host.cameraFlash.classList.add('flash');
  window.setTimeout(() => {
    host.cameraFlash.classList.remove('flash');
    host.cameraFlash.classList.add('hidden');
  }, 240);
}

export function showSettlement(host: ModalUi, result: SettlementResult, photoDataUrl: string): void {
  host.closeAll();
  host.activeModal = 'settlement';
  host.settlementPhoto.src = photoDataUrl;
  const badgeEl = host.settlementBackdrop.querySelector('.st-photo-badge');
  if (badgeEl) badgeEl.textContent = settlementPhotoBadge(result.order.deliveryInstruction);
  host.settlementRoute.textContent = `[#${result.order.orderNumber}] ${result.order.shop.emoji} ${result.order.shop.name} → ${result.order.customer.name} ${result.order.unitNumber}`;
  host.settlementBreakdown.innerHTML = settlementBreakdownHtml(result);
  const okBtn = document.getElementById('settlement-ok-btn');
  if (okBtn) {
    okBtn.textContent =
      result.order.customer.residenceKind === 'walkup_villa'
        ? '확인 (원룸·빌라 계단으로 1층 복귀)'
        : '확인 (엘리베이터 탑승 후 1층 복귀)';
  }
  host.settlementTotal.textContent = `+₩${result.earned.toLocaleString()}`;
  host.settlementCumul.textContent = `오늘 누적 수익 ₩${result.totalEarnings.toLocaleString()} (${result.completedCount}건 완료)`;
  host.settlementBackdrop.classList.remove('hidden');
}
