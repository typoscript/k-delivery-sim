import {
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

import {
  openCargoBoxModal as openCargoBoxModalFn,
  renderCargoBoxSlots as renderCargoBoxSlotsFn,
  openRepairModal as openRepairModalFn,
  renderRepairGarageContent as renderRepairGarageContentFn,
  openConvenienceModal as openConvenienceModalFn,
  openDailyReportModal as openDailyReportModalFn,
  showMissionBonusPopup as showMissionBonusPopupFn,
} from './modals/serviceModals';
import {
  openCameraViewfinder as openCameraViewfinderFn,
  updateCameraProofStatus as updateCameraProofStatusFn,
  showCameraValidationWarning as showCameraValidationWarningFn,
  triggerCameraFlash as triggerCameraFlashFn,
  showSettlement as showSettlementFn,
} from './modals/cameraModal';
import {
  playQuickDoorTransition as playQuickDoorTransitionFn,
  playElevatorTransition as playElevatorTransitionFn,
  playFadeTransition as playFadeTransitionFn,
} from './modals/transitions';
import {
  handleKeyDown as handleKeyDownFn,
} from './modals/modalKeys';

import { wireModalClicks } from './modals/modalClicks';

/**
 * Opens / closes every interactive modal and routes keyboard input to the open one (only one at a time):
 * store POS and lobby PIN keypads (modals/keypads), cargo box slots, gas pump (modals/fuelModal), repair & custom
 * garage, convenience store, daily statement, goal bonus, camera viewfinder, settlement popup and the fade
 * transitions. The HTML of the data-heavy modals comes from modals/modalViews.
 */

export class ModalUi {
  public activeModal: ActiveModalType = 'none';

  /** @internal modals/* */
  readonly pos: PosKeypad;
  /** @internal modals/* */
  readonly pin: PinKeypad;

  // Cargo Box 3-Slot Modal
  /** @internal modals/* */
  readonly cargoBackdrop = document.getElementById('cargo-modal')!;
  /** @internal modals/* */
  readonly cargoTitle = document.getElementById('cargo-modal-title')!;
  /** @internal modals/* */
  readonly cargoHandBanner = document.getElementById('cargo-hand-banner')!;
  /** @internal modals/* */
  readonly cargoSlotsList = document.getElementById('cargo-slots-list')!;

  /** @internal modals/* */
  readonly fuel: FuelModal;

  // Motorcycle Repair & Custom Garage Center Modal
  /** @internal modals/* */
  readonly repairBackdrop = document.getElementById('repair-modal')!;
  /** @internal modals/* */
  readonly repairDiagBox = document.getElementById('repair-diag-box')!;
  /** @internal modals/* */
  readonly repairCostWrap = document.getElementById('repair-cost-wrap')!;
  /** @internal modals/* */
  readonly repairCostEl = document.getElementById('repair-modal-cost')!;
  /** @internal modals/* */
  readonly repairConfirmBtn = document.getElementById('repair-confirm-btn') as HTMLButtonElement;
  /** @internal modals/* */
  readonly repairBikeList = document.getElementById('repair-bike-list')!;
  /** @internal modals/* */
  readonly repairPaintGrid = document.getElementById('repair-paint-grid')!;
  /** @internal modals/* */
  readonly repairUpgradeList = document.getElementById('repair-upgrade-list')!;
  /** @internal modals/* */
  readonly repairWalletChip = document.getElementById('repair-wallet-chip')!;
  /** @internal modals/* */
  repairCost = 0;

  // 24h Convenience Store Modal
  /** @internal modals/* */
  readonly cvsBackdrop = document.getElementById('convenience-modal')!;
  /** @internal modals/* */
  readonly cvsStatusBar = document.getElementById('cvs-status-bar')!;

  // Daily Comprehensive Settlement Dashboard Modal
  /** @internal modals/* */
  readonly reportBackdrop = document.getElementById('daily-report-modal')!;
  /** @internal modals/* */
  readonly reportBody = document.getElementById('daily-report-body')!;
  /** @internal modals/* */
  readonly reportOkBtn = document.getElementById('daily-report-ok-btn')!;
  /** @internal modals/* */
  readonly reportTitleEl = document.getElementById('daily-report-title')!;

  // Daily Mission Bonus Celebration Modal
  /** @internal modals/* */
  readonly missionBonusBackdrop = document.getElementById('mission-bonus-modal')!;
  /** @internal modals/* */
  readonly mbTitleEl = document.getElementById('mb-title')!;
  /** @internal modals/* */
  readonly mbAmountEl = document.getElementById('mb-amount')!;
  /** @internal modals/* */
  readonly mbWalletEl = document.getElementById('mb-wallet')!;

  // Camera Viewfinder
  /** @internal modals/* */
  readonly cameraOverlay = document.getElementById('camera-viewfinder')!;
  /** @internal modals/* */
  readonly cameraStamp = document.getElementById('camera-stamp')!;
  /** @internal modals/* */
  readonly cameraFlash = document.getElementById('camera-flash')!;
  /** @internal modals/* */
  readonly vfFrame = document.getElementById('vf-frame')!;
  /** @internal modals/* */
  readonly vfChkPlate = document.getElementById('vf-chk-plate')!;
  /** @internal modals/* */
  readonly vfChkFood = document.getElementById('vf-chk-food')!;
  /** @internal modals/* */
  readonly vfGuideText = document.getElementById('vf-guide-text')!;
  /** @internal modals/* */
  readonly vfFailPopup = document.getElementById('vf-fail-popup')!;
  /** @internal modals/* */
  vfFailTimer: number | null = null;

  // Settlement Popup
  /** @internal modals/* */
  readonly settlementBackdrop = document.getElementById('settlement-modal')!;
  /** @internal modals/* */
  readonly settlementPhoto = document.getElementById('settlement-photo') as HTMLImageElement;
  /** @internal modals/* */
  readonly settlementRoute = document.getElementById('settlement-route')!;
  /** @internal modals/* */
  readonly settlementBreakdown = document.getElementById('settlement-breakdown')!;
  /** @internal modals/* */
  readonly settlementTotal = document.getElementById('settlement-total')!;
  /** @internal modals/* */
  readonly settlementCumul = document.getElementById('settlement-cumul')!;

  // 2-Second Elevator Fade Overlay
  /** @internal modals/* */
  readonly fadeOverlay = document.getElementById('fade-overlay')!;
  /** @internal modals/* */
  readonly fadeCaption = document.getElementById('fade-caption')!;

  /** @internal modals/* */
  readonly callbacks: ModalCallbacks;

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

    wireModalClicks(this);
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
    openCargoBoxModalFn(this, delivery, playerX, playerZ);
  }

  public renderCargoBoxSlots(delivery: DeliveryManager, playerX: number, playerZ: number): void {
    renderCargoBoxSlotsFn(this, delivery, playerX, playerZ);
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
    openRepairModalFn(this, damageLevel, crashCount, garage, career);
  }

  public renderRepairGarageContent(
    damageLevel: number,
    crashCount: number,
    garage: BikeGarageSave,
    career: RiderCareerSave
  ): void {
    renderRepairGarageContentFn(this, damageLevel, crashCount, garage, career);
  }

  public openConvenienceModal(staminaPct: number, batteryPct: number): void {
    openConvenienceModalFn(this, staminaPct, batteryPct);
  }

  /**
   * Daily settlement report. With `clockOut` it is the end-of-shift receipt: today's goals and the
   * clock-out bonus are listed and the button starts the next working day.
   */
  public openDailyReportModal(ledger: DailyFinanceLedger, clockOut?: ClockOutResult): void {
    openDailyReportModalFn(this, ledger, clockOut);
  }

  public showMissionBonusPopup(goalTitle: string, bonusAmount: number, totalWallet: number): void {
    showMissionBonusPopupFn(this, goalTitle, bonusAmount, totalWallet);
  }

  public openCameraViewfinder(order: DeliveryOrder): void {
    openCameraViewfinderFn(this, order);
  }

  /** Live-updates the central 60% viewfinder detection chips (호수 팻말 + 음식 봉투) */
  public updateCameraProofStatus(res: PhotoProofResult): void {
    updateCameraProofStatusFn(this, res);
  }

  /** Displays a prominent failure warning popup inside the viewfinder and prompts re-shooting */
  public showCameraValidationWarning(res: PhotoProofResult): void {
    showCameraValidationWarningFn(this, res);
  }

  public triggerCameraFlash(): void {
    triggerCameraFlashFn(this);
  }

  public showSettlement(result: SettlementResult, photoDataUrl: string): void {
    showSettlementFn(this, result, photoDataUrl);
  }

  /**
   * Snappy ~0.55s doorway step-in / step-out fade transition (used when walking into a 1F 원룸·빌라 stairwell
   * or stepping into/out of the 1F 3D Apartment Elevator Cabin!).
   */
  public playQuickDoorTransition(caption: string, onMidpoint: () => void, onDone?: () => void): void {
    playQuickDoorTransitionFn(this, caption, onMidpoint, onDone);
  }

  /**
   * 2-Second Black Fade-Out Elevator Transition.
   * Executes onMidpoint() while the screen is completely black (teleport + toggle scene visibility!).
   */
  public playElevatorTransition(caption: string, onMidpoint: () => void, onDone?: () => void): void {
    playElevatorTransitionFn(this, caption, onMidpoint, onDone);
  }

  /** Fade to black, run onMidpoint while black at `midMs`, fade back from `clearMs`, done at `doneMs` */
  /** @internal modals/* */
  playFadeTransition(
    caption: string,
    midMs: number,
    clearMs: number,
    doneMs: number,
    onMidpoint: () => void,
    onDone?: () => void
  ): void {
    playFadeTransitionFn(this, caption, midMs, clearMs, doneMs, onMidpoint, onDone);
  }

  /** Handles physical keyboard input when POS / PIN / Cargo / Camera / Settlement modal is open */
  public handleKeyDown(e: KeyboardEvent): boolean {
    return handleKeyDownFn(this, e);
  }
}
