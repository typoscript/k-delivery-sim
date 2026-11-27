import {
  CARGO_SLOT_COUNT,
  ClockOutResult,
  DailyFinanceLedger,
  DeliveryManager,
  DeliveryOrder,
  SettlementResult,
} from '../delivery/DeliveryManager';
import { PhotoProofResult } from '../camera/PhotoProofValidator';
import { BikeGarageSave, ScooterModelId, ScooterPaintId } from '../vehicle/ScooterModels';
import { RiderCareerSave, UpgradeId } from '../delivery/RiderCareer';
import { PinKeypad, PosKeypad } from './modals/keypads';
import { FuelModal } from './modals/fuelModal';
import {
  cargoHandBanner,
  cargoSlotCardsHtml,
  dailyReportHtml,
  garageBikeListHtml,
  garagePaintGridHtml,
  garageUpgradeListHtml,
  repairCostFor,
  repairDiagHtml,
  settlementBreakdownHtml,
  settlementPhotoBadge,
} from './modals/modalViews';

export type ActiveModalType =
  | 'none'
  | 'pos'
  | 'pin'
  | 'cargo'
  | 'fuel'
  | 'repair'
  | 'convenience'
  | 'daily_report'
  | 'mission_bonus'
  | 'camera'
  | 'settlement'
  | 'transition';

export type ConvenienceItemKind = 'energy_drink' | 'iced_coffee' | 'power_bank';

export interface ModalCallbacks {
  onPosSuccess: (missionId: string) => void;
  onPinSuccess: (missionId: string) => void;
  onCargoSlotAction: (slotIndex: number) => void;
  onFuelTick: () => void;
  onFuelComplete: (addedPercent: number, cost: number) => void;
  onRepairConfirm: (cost: number) => void;
  onSelectBikeModel: (modelId: ScooterModelId, cost: number) => void;
  onSelectBikePaint: (paintId: ScooterPaintId, cost: number) => void;
  onBuyUpgrade: (upgradeId: UpgradeId, cost: number) => void;
  onConvenienceBuy: (item: ConvenienceItemKind, cost: number) => void;
  onTakePhoto: () => void;
  onSettlementClose: () => void;
  onKeypadBeep: (ok: boolean) => void;
}

/**
 * Opens / closes every interactive modal and routes keyboard input to the open one (only one at a time):
 * store POS and lobby PIN keypads (modals/keypads), cargo box slots, gas pump (modals/fuelModal), repair & custom
 * garage, convenience store, daily statement, goal bonus, camera viewfinder, settlement popup and the fade
 * transitions. The HTML of the data-heavy modals comes from modals/modalViews.
 */

export class ModalUi {
  public activeModal: ActiveModalType = 'none';

  private readonly pos: PosKeypad;
  private readonly pin: PinKeypad;

  // Cargo Box 3-Slot Modal
  private readonly cargoBackdrop = document.getElementById('cargo-modal')!;
  private readonly cargoTitle = document.getElementById('cargo-modal-title')!;
  private readonly cargoHandBanner = document.getElementById('cargo-hand-banner')!;
  private readonly cargoSlotsList = document.getElementById('cargo-slots-list')!;

  private readonly fuel: FuelModal;

  // Motorcycle Repair & Custom Garage Center Modal
  private readonly repairBackdrop = document.getElementById('repair-modal')!;
  private readonly repairDiagBox = document.getElementById('repair-diag-box')!;
  private readonly repairCostWrap = document.getElementById('repair-cost-wrap')!;
  private readonly repairCostEl = document.getElementById('repair-modal-cost')!;
  private readonly repairConfirmBtn = document.getElementById('repair-confirm-btn') as HTMLButtonElement;
  private readonly repairBikeList = document.getElementById('repair-bike-list')!;
  private readonly repairPaintGrid = document.getElementById('repair-paint-grid')!;
  private readonly repairUpgradeList = document.getElementById('repair-upgrade-list')!;
  private readonly repairWalletChip = document.getElementById('repair-wallet-chip')!;
  private repairCost = 0;

  // 24h Convenience Store Modal
  private readonly cvsBackdrop = document.getElementById('convenience-modal')!;
  private readonly cvsStatusBar = document.getElementById('cvs-status-bar')!;

  // Daily Comprehensive Settlement Dashboard Modal
  private readonly reportBackdrop = document.getElementById('daily-report-modal')!;
  private readonly reportBody = document.getElementById('daily-report-body')!;
  private readonly reportOkBtn = document.getElementById('daily-report-ok-btn')!;
  private readonly reportTitleEl = document.getElementById('daily-report-title')!;

  // Daily Mission Bonus Celebration Modal
  private readonly missionBonusBackdrop = document.getElementById('mission-bonus-modal')!;
  private readonly mbTitleEl = document.getElementById('mb-title')!;
  private readonly mbAmountEl = document.getElementById('mb-amount')!;
  private readonly mbWalletEl = document.getElementById('mb-wallet')!;

  // Camera Viewfinder
  private readonly cameraOverlay = document.getElementById('camera-viewfinder')!;
  private readonly cameraStamp = document.getElementById('camera-stamp')!;
  private readonly cameraFlash = document.getElementById('camera-flash')!;
  private readonly vfFrame = document.getElementById('vf-frame')!;
  private readonly vfChkPlate = document.getElementById('vf-chk-plate')!;
  private readonly vfChkFood = document.getElementById('vf-chk-food')!;
  private readonly vfGuideText = document.getElementById('vf-guide-text')!;
  private readonly vfFailPopup = document.getElementById('vf-fail-popup')!;
  private vfFailTimer: number | null = null;

  // Settlement Popup
  private readonly settlementBackdrop = document.getElementById('settlement-modal')!;
  private readonly settlementPhoto = document.getElementById('settlement-photo') as HTMLImageElement;
  private readonly settlementRoute = document.getElementById('settlement-route')!;
  private readonly settlementBreakdown = document.getElementById('settlement-breakdown')!;
  private readonly settlementTotal = document.getElementById('settlement-total')!;
  private readonly settlementCumul = document.getElementById('settlement-cumul')!;

  // 2-Second Elevator Fade Overlay
  private readonly fadeOverlay = document.getElementById('fade-overlay')!;
  private readonly fadeCaption = document.getElementById('fade-caption')!;

  private readonly callbacks: ModalCallbacks;

  constructor(callbacks: ModalCallbacks) {
    this.callbacks = callbacks;

    this.pos = new PosKeypad({
      beep: (ok) => callbacks.onKeypadBeep(ok),
      close: () => this.closeAll(),
      onSuccess: (id) => callbacks.onPosSuccess(id),
    });
    this.pin = new PinKeypad({
      beep: (ok) => callbacks.onKeypadBeep(ok),
      close: () => this.closeAll(),
      onSuccess: (id) => callbacks.onPinSuccess(id),
    });
    this.fuel = new FuelModal({
      close: () => this.closeAll(),
      isOpen: () => this.activeModal === 'fuel',
      onFuelTick: () => callbacks.onFuelTick(),
      onFuelComplete: (added, cost) => callbacks.onFuelComplete(added, cost),
    });

    // Cargo Box 3-Slot modal clicks
    this.cargoBackdrop.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target === this.cargoBackdrop) {
        this.closeAll();
        return;
      }
      const btn = target.closest('button') as HTMLButtonElement | null;
      if (!btn) return;
      if (btn.dataset.action === 'close') {
        this.closeAll();
        return;
      }
      if (btn.dataset.slot !== undefined) {
        const slotIdx = Number(btn.dataset.slot);
        if (!Number.isNaN(slotIdx)) {
          this.callbacks.onCargoSlotAction(slotIdx);
        }
      }
    });

    // Camera shutter button
    document.getElementById('camera-shutter-btn')!.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.activeModal === 'camera') {
        this.callbacks.onTakePhoto();
      }
    });

    // Settlement confirm button
    document.getElementById('settlement-ok-btn')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeAll();
      this.callbacks.onSettlementClose();
    });

    // Repair & Custom Garage Center modal actions
    this.repairBackdrop.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target === this.repairBackdrop) {
        this.closeAll();
        return;
      }
      const btn = target.closest('button') as HTMLButtonElement | null;
      if (!btn) return;
      if (btn.dataset.action === 'close') {
        this.closeAll();
      } else if (btn.dataset.action === 'confirm_repair' && this.repairCost > 0) {
        const cost = this.repairCost;
        this.closeAll();
        this.callbacks.onRepairConfirm(cost);
      } else if (btn.dataset.bikeModel) {
        const modelId = btn.dataset.bikeModel as ScooterModelId;
        const cost = Number(btn.dataset.cost || 0);
        this.callbacks.onSelectBikeModel(modelId, cost);
      } else if (btn.dataset.bikePaint) {
        const paintId = btn.dataset.bikePaint as ScooterPaintId;
        const cost = Number(btn.dataset.cost || 0);
        this.callbacks.onSelectBikePaint(paintId, cost);
      } else if (btn.dataset.upgradeId) {
        const upgradeId = btn.dataset.upgradeId as UpgradeId;
        const cost = Number(btn.dataset.cost || 0);
        this.callbacks.onBuyUpgrade(upgradeId, cost);
      }
    });

    // 24h Convenience Store modal actions
    this.cvsBackdrop.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target === this.cvsBackdrop) {
        this.closeAll();
        return;
      }
      const btn = target.closest('button') as HTMLButtonElement | null;
      if (!btn) return;
      if (btn.dataset.action === 'close') {
        this.closeAll();
      } else if (btn.dataset.item) {
        const item = btn.dataset.item as ConvenienceItemKind;
        const cost = Number(btn.dataset.cost || 1500);
        this.closeAll();
        this.callbacks.onConvenienceBuy(item, cost);
      }
    });

    // Daily Comprehensive Report modal actions
    this.reportBackdrop.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target === this.reportBackdrop) {
        this.closeAll();
        return;
      }
      const btn = target.closest('button') as HTMLButtonElement | null;
      if (btn?.dataset.action === 'close') {
        this.closeAll();
      }
    });

    // Mission Bonus Celebration modal actions
    this.missionBonusBackdrop.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target === this.missionBonusBackdrop) {
        this.closeAll();
        return;
      }
      const btn = target.closest('button') as HTMLButtonElement | null;
      if (btn?.dataset.action === 'close') {
        this.closeAll();
      }
    });
  }

  public isBlockingMovement(): boolean {
    return (
      this.activeModal === 'pos' ||
      this.activeModal === 'pin' ||
      this.activeModal === 'cargo' ||
      this.activeModal === 'fuel' ||
      this.activeModal === 'repair' ||
      this.activeModal === 'convenience' ||
      this.activeModal === 'daily_report' ||
      this.activeModal === 'mission_bonus' ||
      this.activeModal === 'settlement' ||
      this.activeModal === 'transition'
    );
  }

  public closeAll(): void {
    if (this.activeModal === 'transition') return;
    this.activeModal = 'none';
    this.pos.hide();
    this.pin.hide();
    this.fuel.hide();
    this.cargoBackdrop.classList.add('hidden');
    this.repairBackdrop.classList.add('hidden');
    this.cvsBackdrop.classList.add('hidden');
    this.reportBackdrop.classList.add('hidden');
    this.missionBonusBackdrop.classList.add('hidden');
    this.cameraOverlay.classList.add('hidden');
    this.settlementBackdrop.classList.add('hidden');
  }

  public openPosKeypad(order: DeliveryOrder, hasPhone: boolean, isRegularShop = false): void {
    this.closeAll();
    this.activeModal = 'pos';
    this.pos.open(order, hasPhone, isRegularShop);
  }

  public openPinKeypad(order: DeliveryOrder, hasPhone: boolean): void {
    this.closeAll();
    this.activeModal = 'pin';
    this.pin.open(order, hasPhone);
  }

  /** Opens or refreshes the Scooter Rear Cargo Box 3-Slot Interactive UI */
  public openCargoBoxModal(delivery: DeliveryManager, playerX: number, playerZ: number): void {
    if (this.activeModal !== 'cargo') {
      this.closeAll();
      this.activeModal = 'cargo';
      this.cargoBackdrop.classList.remove('hidden');
    }
    this.renderCargoBoxSlots(delivery, playerX, playerZ);
  }

  public renderCargoBoxSlots(delivery: DeliveryManager, playerX: number, playerZ: number): void {
    this.cargoTitle.textContent = `📦 오토바이 배달통 (${delivery.getLoadedCargoCount()} / ${CARGO_SLOT_COUNT}칸 적재)`;
    const carrying = delivery.getCarryingMission();
    const banner = cargoHandBanner(carrying);
    this.cargoHandBanner.className = banner.className;
    this.cargoHandBanner.innerHTML = banner.html;
    this.cargoSlotsList.innerHTML = cargoSlotCardsHtml((i) => delivery.getCargoSlotMission(i), carrying, playerX, playerZ);
  }

  public openFuelModal(currentFuel: number): void {
    this.closeAll();
    this.activeModal = 'fuel';
    this.fuel.open(currentFuel);
  }

  public openRepairModal(
    damageLevel: number,
    crashCount: number,
    garage: BikeGarageSave,
    career: RiderCareerSave
  ): void {
    this.closeAll();
    this.activeModal = 'repair';
    this.renderRepairGarageContent(damageLevel, crashCount, garage, career);
    this.repairBackdrop.classList.remove('hidden');
  }

  public renderRepairGarageContent(
    damageLevel: number,
    crashCount: number,
    garage: BikeGarageSave,
    career: RiderCareerSave
  ): void {
    this.repairCost = repairCostFor(damageLevel);
    this.repairDiagBox.innerHTML = repairDiagHtml(damageLevel, crashCount);
    const needsRepair = damageLevel > 0;
    this.repairCostWrap.classList.toggle('hidden', !needsRepair);
    this.repairConfirmBtn.classList.toggle('hidden', !needsRepair);
    if (needsRepair) {
      this.repairCostEl.textContent = `₩${this.repairCost.toLocaleString()}`;
      this.repairConfirmBtn.disabled = false;
    }
    this.repairBikeList.innerHTML = garageBikeListHtml(garage);
    this.repairPaintGrid.innerHTML = garagePaintGridHtml(garage);
    this.repairWalletChip.textContent = `지갑 ₩${career.walletBalance.toLocaleString()}`;
    this.repairUpgradeList.innerHTML = garageUpgradeListHtml(career);
  }

  public openConvenienceModal(staminaPct: number, batteryPct: number): void {
    this.closeAll();
    this.activeModal = 'convenience';
    this.cvsStatusBar.textContent = `현재 체력 ${Math.round(staminaPct)}% · 스마트폰 배터리 ${Math.round(batteryPct)}%`;
    this.cvsBackdrop.classList.remove('hidden');
  }

  /**
   * Daily settlement report. With `clockOut` it is the end-of-shift receipt: today's goals and the
   * clock-out bonus are listed and the button starts the next working day.
   */
  public openDailyReportModal(ledger: DailyFinanceLedger, clockOut?: ClockOutResult): void {
    this.closeAll();
    this.activeModal = 'daily_report';
    this.reportOkBtn.textContent = clockOut ? `🌅 ${clockOut.nextDay}일차 출근하기` : '확인 (Esc)';
    this.reportTitleEl.textContent = clockOut
      ? `🏁 ${clockOut.day}일차 퇴근 정산 명세서`
      : `🧾 배민커넥트 ${ledger.shiftDay}일차 정산 명세서`;
    this.reportBody.innerHTML = dailyReportHtml(ledger, clockOut);

    this.reportBackdrop.classList.remove('hidden');
  }

  public showMissionBonusPopup(goalTitle: string, bonusAmount: number, totalWallet: number): void {
    this.closeAll();
    this.activeModal = 'mission_bonus';
    this.mbTitleEl.textContent = goalTitle;
    this.mbAmountEl.textContent = `+₩${bonusAmount.toLocaleString()} 보너스 지급!`;
    this.mbWalletEl.textContent = `지갑 잔고에 즉시 반영되었습니다 (현재 ₩${totalWallet.toLocaleString()})`;
    this.missionBonusBackdrop.classList.remove('hidden');
  }

  public openCameraViewfinder(order: DeliveryOrder): void {
    this.closeAll();
    this.activeModal = 'camera';
    const now = new Date();
    const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    this.cameraStamp.textContent = `#${order.orderNumber} · ${order.customer.name} ${order.unitNumber} · ${ts}`;
    this.vfFailPopup.classList.add('hidden');
    this.vfFrame.classList.remove('valid', 'fail-shake');
    this.cameraOverlay.classList.remove('hidden');
  }

  /** Live-updates the central 60% viewfinder detection chips (호수 팻말 + 음식 봉투) */
  public updateCameraProofStatus(res: PhotoProofResult): void {
    if (this.activeModal !== 'camera') return;
    this.vfChkPlate.textContent = res.plate.valid ? '✓ 호수 팻말' : '✕ 호수 팻말';
    this.vfChkPlate.className = `vf-chk-pill ${res.plate.valid ? 'ok' : 'miss'}`;

    this.vfChkFood.textContent = res.food.valid ? '✓ 음식 봉투' : '✕ 음식 봉투';
    this.vfChkFood.className = `vf-chk-pill ${res.food.valid ? 'ok' : 'miss'}`;

    this.vfFrame.classList.toggle('valid', res.valid);
    this.vfGuideText.textContent = res.valid
      ? '✓ 호수 + 음식 봉투 확인 완료! [Space] 또는 셔터 버튼으로 배달 완료 승인'
      : res.reason;
  }

  /** Displays a prominent failure warning popup inside the viewfinder and prompts re-shooting */
  public showCameraValidationWarning(res: PhotoProofResult): void {
    if (this.activeModal !== 'camera') return;
    this.vfFailPopup.innerHTML = `⚠️ 현관문 호수와 음식 봉투가 모두 보이도록 찍어주세요!<div style="font-size:11.5px;margin-top:4px;font-weight:600;color:#fecaca">${res.reason}</div>`;
    this.vfFailPopup.classList.remove('hidden');
    this.vfFrame.classList.remove('fail-shake');
    void this.vfFrame.offsetWidth;
    this.vfFrame.classList.add('fail-shake');

    if (this.vfFailTimer !== null) {
      window.clearTimeout(this.vfFailTimer);
    }
    this.vfFailTimer = window.setTimeout(() => {
      this.vfFailPopup.classList.add('hidden');
      this.vfFrame.classList.remove('fail-shake');
      this.vfFailTimer = null;
    }, 3200);
  }

  public triggerCameraFlash(): void {
    this.cameraFlash.classList.remove('hidden');
    this.cameraFlash.classList.add('flash');
    window.setTimeout(() => {
      this.cameraFlash.classList.remove('flash');
      this.cameraFlash.classList.add('hidden');
    }, 240);
  }

  public showSettlement(result: SettlementResult, photoDataUrl: string): void {
    this.closeAll();
    this.activeModal = 'settlement';
    this.settlementPhoto.src = photoDataUrl;
    const badgeEl = this.settlementBackdrop.querySelector('.st-photo-badge');
    if (badgeEl) badgeEl.textContent = settlementPhotoBadge(result.order.deliveryInstruction);
    this.settlementRoute.textContent = `[#${result.order.orderNumber}] ${result.order.shop.emoji} ${result.order.shop.name} → ${result.order.customer.name} ${result.order.unitNumber}`;
    this.settlementBreakdown.innerHTML = settlementBreakdownHtml(result);
    const okBtn = document.getElementById('settlement-ok-btn');
    if (okBtn) {
      okBtn.textContent =
        result.order.customer.residenceKind === 'walkup_villa'
          ? '확인 (원룸·빌라 계단으로 1층 복귀)'
          : '확인 (엘리베이터 탑승 후 1층 복귀)';
    }
    this.settlementTotal.textContent = `+₩${result.earned.toLocaleString()}`;
    this.settlementCumul.textContent = `오늘 누적 수익 ₩${result.totalEarnings.toLocaleString()} (${result.completedCount}건 완료)`;
    this.settlementBackdrop.classList.remove('hidden');
  }

  /**
   * Snappy ~0.55s doorway step-in / step-out fade transition (used when walking into a 1F 원룸·빌라 stairwell
   * or stepping into/out of the 1F 3D Apartment Elevator Cabin!).
   */
  public playQuickDoorTransition(caption: string, onMidpoint: () => void, onDone?: () => void): void {
    this.playFadeTransition(caption, 240, 360, 560, onMidpoint, onDone);
  }

  /**
   * 2-Second Black Fade-Out Elevator Transition.
   * Executes onMidpoint() while the screen is completely black (teleport + toggle scene visibility!).
   */
  public playElevatorTransition(caption: string, onMidpoint: () => void, onDone?: () => void): void {
    this.playFadeTransition(caption, 800, 1450, 2050, onMidpoint, onDone);
  }

  /** Fade to black, run onMidpoint while black at `midMs`, fade back from `clearMs`, done at `doneMs` */
  private playFadeTransition(
    caption: string,
    midMs: number,
    clearMs: number,
    doneMs: number,
    onMidpoint: () => void,
    onDone?: () => void
  ): void {
    if (this.activeModal === 'transition') return;
    this.closeAll();
    this.activeModal = 'transition';
    this.fadeCaption.textContent = caption;
    this.fadeOverlay.classList.remove('hidden');
    void this.fadeOverlay.offsetWidth;
    this.fadeOverlay.classList.add('opaque');
    window.setTimeout(onMidpoint, midMs);
    window.setTimeout(() => this.fadeOverlay.classList.remove('opaque'), clearMs);
    window.setTimeout(() => {
      this.fadeOverlay.classList.add('hidden');
      this.activeModal = 'none';
      if (onDone) onDone();
    }, doneMs);
  }

  /** Handles physical keyboard input when POS / PIN / Cargo / Camera / Settlement modal is open */
  public handleKeyDown(e: KeyboardEvent): boolean {
    if (this.activeModal === 'none') return false;

    // Swallow OS key auto-repeat: holding Space/E/Enter must not chain shutter -> settlement close, or E open -> close
    if (e.repeat) {
      e.preventDefault();
      return true;
    }

    if (this.activeModal === 'transition') {
      e.preventDefault();
      return true;
    }

    if (this.activeModal === 'cargo') {
      e.preventDefault();
      if (e.key === 'Escape' || e.code === 'KeyE') {
        this.closeAll();
      } else if (e.key === '1' || e.key === '2' || e.key === '3') {
        this.callbacks.onCargoSlotAction(Number(e.key) - 1);
      }
      return true;
    }

    if (this.activeModal === 'fuel') {
      e.preventDefault();
      if (this.fuel.isFueling) return true;
      if (e.key === 'Escape') {
        this.closeAll();
      } else if (e.key === 'Enter' || e.code === 'KeyE' || e.code === 'Space') {
        this.fuel.begin();
      }
      return true;
    }

    if (this.activeModal === 'repair') {
      e.preventDefault();
      if (e.key === 'Escape') {
        this.closeAll();
      } else if ((e.key === 'Enter' || e.code === 'Space') && this.repairCost > 0) {
        const cost = this.repairCost;
        this.closeAll();
        this.callbacks.onRepairConfirm(cost);
      }
      return true;
    }

    if (this.activeModal === 'convenience') {
      e.preventDefault();
      if (e.key === 'Escape' || e.code === 'KeyE') {
        this.closeAll();
      } else if (e.key === '1') {
        this.closeAll();
        this.callbacks.onConvenienceBuy('energy_drink', 1500);
      } else if (e.key === '2') {
        this.closeAll();
        this.callbacks.onConvenienceBuy('iced_coffee', 1200);
      } else if (e.key === '3') {
        this.closeAll();
        this.callbacks.onConvenienceBuy('power_bank', 2000);
      }
      return true;
    }

    if (this.activeModal === 'daily_report' || this.activeModal === 'mission_bonus') {
      if (e.key === 'Escape' || e.key === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        this.closeAll();
      }
      return true;
    }

    if (this.activeModal === 'pos') {
      e.preventDefault();
      if (e.key === 'Escape') {
        this.closeAll();
      } else {
        this.pos.handleKey(e.key);
      }
      return true;
    }

    if (this.activeModal === 'pin') {
      e.preventDefault();
      if (e.key === 'Escape') {
        this.closeAll();
      } else {
        this.pin.handleKey(e.key);
      }
      return true;
    }

    if (this.activeModal === 'camera') {
      if (e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault();
        this.callbacks.onTakePhoto();
        return true;
      }
      return false;
    }

    if (this.activeModal === 'settlement') {
      if (e.key === 'Enter' || e.code === 'Space' || e.key === 'Escape') {
        e.preventDefault();
        this.closeAll();
        this.callbacks.onSettlementClose();
      }
      return true;
    }

    return false;
  }
}
