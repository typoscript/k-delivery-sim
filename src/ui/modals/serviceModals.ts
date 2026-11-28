/** Cargo box, repair shop, convenience store, daily report and mission bonus modals */
import type { ModalUi } from '../ModalUi';
import { CARGO_SLOT_COUNT, ClockOutResult, DailyFinanceLedger, DeliveryManager } from '../../delivery/DeliveryManager';
import { BikeGarageSave } from '../../vehicle/ScooterModels';
import { RiderCareerSave } from '../../delivery/RiderCareer';
import {
  cargoHandBanner,
  cargoSlotCardsHtml,
  dailyReportHtml,
  garageBikeListHtml,
  garagePaintGridHtml,
  garageUpgradeListHtml,
  repairCostFor,
  repairDiagHtml,
} from './modalViews';

/** Opens or refreshes the Scooter Rear Cargo Box 3-Slot Interactive UI */
export function openCargoBoxModal(host: ModalUi, delivery: DeliveryManager, playerX: number, playerZ: number): void {
  if (host.activeModal !== 'cargo') {
    host.closeAll();
    host.activeModal = 'cargo';
    host.cargoBackdrop.classList.remove('hidden');
  }
  host.renderCargoBoxSlots(delivery, playerX, playerZ);
}

export function renderCargoBoxSlots(host: ModalUi, delivery: DeliveryManager, playerX: number, playerZ: number): void {
  host.cargoTitle.textContent = `📦 오토바이 배달통 (${delivery.getLoadedCargoCount()} / ${CARGO_SLOT_COUNT}칸 적재)`;
  const carrying = delivery.getCarryingMission();
  const banner = cargoHandBanner(carrying);
  host.cargoHandBanner.className = banner.className;
  host.cargoHandBanner.innerHTML = banner.html;
  host.cargoSlotsList.innerHTML = cargoSlotCardsHtml(
    (i) => delivery.getCargoSlotMission(i),
    carrying,
    playerX,
    playerZ,
  );
}

export function openRepairModal(
  host: ModalUi,
  damageLevel: number,
  crashCount: number,
  garage: BikeGarageSave,
  career: RiderCareerSave,
): void {
  host.closeAll();
  host.activeModal = 'repair';
  host.renderRepairGarageContent(damageLevel, crashCount, garage, career);
  host.repairBackdrop.classList.remove('hidden');
}

export function renderRepairGarageContent(
  host: ModalUi,
  damageLevel: number,
  crashCount: number,
  garage: BikeGarageSave,
  career: RiderCareerSave,
): void {
  host.repairCost = repairCostFor(damageLevel);
  host.repairDiagBox.innerHTML = repairDiagHtml(damageLevel, crashCount);
  const needsRepair = damageLevel > 0;
  host.repairCostWrap.classList.toggle('hidden', !needsRepair);
  host.repairConfirmBtn.classList.toggle('hidden', !needsRepair);
  const debt = career.repairDebt ?? 0;
  if (needsRepair) {
    host.repairCostEl.textContent = `₩${host.repairCost.toLocaleString()}`;
    host.repairConfirmBtn.disabled = false;
    // short of money: the shop fixes it on credit (paid back from the next settlements) unless a debt is still open
    const short = career.walletBalance < host.repairCost;
    host.repairConfirmBtn.textContent = !short
      ? '🔧 수리 및 결제 완료 (E / Enter)'
      : debt > 0
        ? `💳 잔액 부족 · 외상 ₩${debt.toLocaleString()}을 먼저 갚아야 해요`
        : `🧾 외상으로 수리 (지갑 ₩${Math.max(0, career.walletBalance).toLocaleString()} + 외상, Enter)`;
  }
  host.repairBikeList.innerHTML = garageBikeListHtml(garage);
  host.repairPaintGrid.innerHTML = garagePaintGridHtml(garage);
  host.repairWalletChip.textContent = `지갑 ₩${career.walletBalance.toLocaleString()}${debt > 0 ? ` · 외상 ₩${debt.toLocaleString()}` : ''}`;
  host.repairUpgradeList.innerHTML = garageUpgradeListHtml(career);
}

export function openConvenienceModal(host: ModalUi, staminaPct: number, batteryPct: number): void {
  host.closeAll();
  host.activeModal = 'convenience';
  host.cvsStatusBar.textContent = `현재 체력 ${Math.round(staminaPct)}% · 스마트폰 배터리 ${Math.round(batteryPct)}%`;
  host.cvsBackdrop.classList.remove('hidden');
}

/**
 * Daily settlement report. With `clockOut` it is the end-of-shift receipt: today's goals and the
 * clock-out bonus are listed and the button starts the next working day.
 */
export function openDailyReportModal(host: ModalUi, ledger: DailyFinanceLedger, clockOut?: ClockOutResult): void {
  host.closeAll();
  host.activeModal = 'daily_report';
  host.reportOkBtn.textContent = clockOut ? `🌅 ${clockOut.nextDay}일차 출근하기` : '확인 (Esc)';
  host.reportTitleEl.textContent = clockOut
    ? `🏁 ${clockOut.day}일차 퇴근 정산 명세서`
    : `🧾 배민커넥트 ${ledger.shiftDay}일차 정산 명세서`;
  host.reportBody.innerHTML = dailyReportHtml(ledger, clockOut);

  host.reportBackdrop.classList.remove('hidden');
}

export function showMissionBonusPopup(
  host: ModalUi,
  goalTitle: string,
  bonusAmount: number,
  totalWallet: number,
): void {
  host.closeAll();
  host.activeModal = 'mission_bonus';
  host.mbTitleEl.textContent = goalTitle;
  host.mbAmountEl.textContent = `+₩${bonusAmount.toLocaleString()} 보너스 지급!`;
  host.mbWalletEl.textContent = `지갑 잔고에 즉시 반영되었습니다 (현재 ₩${totalWallet.toLocaleString()})`;
  host.missionBonusBackdrop.classList.remove('hidden');
}
