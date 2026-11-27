import {
  ActiveMission,
  CARGO_SLOT_COUNT,
  DailyFinanceLedger,
  DeliveryManager,
  DeliveryOrder,
  FUEL_PRICE_PER_PERCENT,
  REPAIR_COST_PER_DAMAGE_STAGE,
  SettlementResult,
  getInstructionMeta,
} from '../delivery/DeliveryManager';
import { PhotoProofResult } from '../camera/PhotoProofValidator';
import {
  BikeGarageSave,
  SCOOTER_MODEL_LIST,
  SCOOTER_PAINT_LIST,
  ScooterModelId,
  ScooterPaintId,
} from '../vehicle/ScooterModels';
import {
  RIDER_UPGRADE_LIST,
  RiderCareerSave,
  UpgradeId,
} from '../delivery/RiderCareer';

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
 * Handles all interactive delivery modals:
 * 1. Outdoor Store POS Order-Number Keypad
 * 2. 1st-Floor Apartment Entrance 4-Digit PIN Pad
 * 3. Scooter Rear Cargo Box 3-Slot Manager Modal
 * 4. Smartphone Camera Viewfinder Overlay (+ shutter flash)
 * 5. Delivery Completion Settlement Popup (with captured proof photo)
 * 6. 2-Second Black Fade-Out Elevator Transition
 */
export class ModalUi {
  public activeModal: ActiveModalType = 'none';

  // POS Modal
  private readonly posBackdrop = document.getElementById('pos-modal')!;
  private readonly posShopTitle = document.getElementById('pos-shop-title')!;
  private readonly posHint = document.getElementById('pos-order-hint')!;
  private readonly posDisplay = document.getElementById('pos-display')!;
  private readonly posError = document.getElementById('pos-error')!;
  private posMissionId = '';
  private posExpected = '';
  private posValue = '';
  private posHasPhone = true;

  // Apartment PIN Modal
  private readonly pinBackdrop = document.getElementById('pin-modal')!;
  private readonly pinBuildingTitle = document.getElementById('pin-building-title')!;
  private readonly pinHint = document.getElementById('pin-code-hint')!;
  private readonly pinDisplay = document.getElementById('pin-display')!;
  private readonly pinError = document.getElementById('pin-error')!;
  private pinMissionId = '';
  private pinExpected = '';
  private pinExpectedLabel = '';
  private pinTokens: string[] = [];
  private pinHasPhone = true;

  // Cargo Box 3-Slot Modal
  private readonly cargoBackdrop = document.getElementById('cargo-modal')!;
  private readonly cargoTitle = document.getElementById('cargo-modal-title')!;
  private readonly cargoHandBanner = document.getElementById('cargo-hand-banner')!;
  private readonly cargoSlotsList = document.getElementById('cargo-slots-list')!;

  // Gas Station Refuel Modal
  private readonly fuelBackdrop = document.getElementById('fuel-modal')!;
  private readonly fuelPctEl = document.getElementById('fuel-modal-pct')!;
  private readonly fuelBarEl = document.getElementById('fuel-modal-bar')!;
  private readonly fuelStatusEl = document.getElementById('fuel-modal-status')!;
  private readonly fuelCostEl = document.getElementById('fuel-modal-cost')!;
  private readonly fuelStartBtn = document.getElementById('fuel-start-btn') as HTMLButtonElement;
  private fuelStartPct = 100;
  private fuelCost = 0;
  private fuelTimer: number | null = null;
  private isFueling = false;

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

    // POS keypad buttons
    this.posBackdrop.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target === this.posBackdrop) {
        this.closeAll();
        return;
      }
      const btn = target.closest('button') as HTMLButtonElement | null;
      if (!btn) return;
      const key = btn.dataset.key;
      if (key === 'close') this.closeAll();
      else if (key === 'back') this.handlePosKey('Backspace');
      else if (key === 'enter') this.handlePosKey('Enter');
      else if (key) this.handlePosKey(key);
    });

    // PIN keypad buttons
    this.pinBackdrop.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target === this.pinBackdrop) {
        this.closeAll();
        return;
      }
      const btn = target.closest('button') as HTMLButtonElement | null;
      if (!btn) return;
      const key = btn.dataset.key;
      if (key === 'close') this.closeAll();
      else if (key === 'back') this.handlePinKey('Backspace');
      else if (key === 'enter') this.handlePinKey('Enter');
      else if (key) this.handlePinKey(key);
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

    // Gas Station modal actions
    this.fuelBackdrop.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target === this.fuelBackdrop && !this.isFueling) {
        this.closeAll();
        return;
      }
      const btn = target.closest('button') as HTMLButtonElement | null;
      if (!btn) return;
      if (btn.dataset.action === 'close' && !this.isFueling) {
        this.closeAll();
      } else if (btn.dataset.action === 'start_fuel' && !this.isFueling) {
        this.beginRefuelSequence();
      }
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
    if (this.fuelTimer !== null) {
      window.clearInterval(this.fuelTimer);
      this.fuelTimer = null;
    }
    this.isFueling = false;
    this.activeModal = 'none';
    this.posBackdrop.classList.add('hidden');
    this.pinBackdrop.classList.add('hidden');
    this.cargoBackdrop.classList.add('hidden');
    this.fuelBackdrop.classList.add('hidden');
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
    this.posMissionId = order.id;
    this.posExpected = order.orderNumber.toUpperCase();
    this.posValue = '';
    this.posHasPhone = hasPhone;
    this.posShopTitle.textContent = `${order.shop.emoji} ${order.shop.name} 야외 픽업 POS${isRegularShop ? ' ⭐ 단골' : ''}`;
    this.posHint.textContent = hasPhone
      ? `내 주문번호: ${order.orderNumber} (${order.menuName})${isRegularShop ? ' · ⭐ 단골 매장 우선 조리 우대' : ''}`
      : '📱 휴대폰이 오토바이에 있어 주문번호 자동 조회 불가 ([Esc] 후 폰 회수 또는 직접 입력)';
    this.posDisplay.textContent = '주문번호 입력';
    this.posDisplay.classList.add('placeholder');
    this.posError.classList.add('hidden');
    this.posBackdrop.classList.remove('hidden');
  }

  public openPinKeypad(order: DeliveryOrder, hasPhone: boolean): void {
    this.closeAll();
    this.activeModal = 'pin';
    this.pinMissionId = order.id;
    this.pinExpected = order.doorPin;
    this.pinExpectedLabel = order.doorPinLabel;
    this.pinTokens = [];
    this.pinHasPhone = hasPhone;
    this.pinBuildingTitle.textContent = `${order.customer.emoji} ${order.customer.name} 공동현관`;
    this.pinHint.textContent = hasPhone
      ? `공동현관 출입 패턴: ${order.doorPinLabel} (${order.unitNumber})`
      : '📱 휴대폰이 오토바이에 있어 PIN 패턴 조회 불가 ([Esc] 후 폰 회수 또는 직접 입력)';
    this.pinDisplay.textContent = '패턴 입력';
    this.pinDisplay.classList.add('placeholder');
    this.pinError.classList.add('hidden');
    this.pinBackdrop.classList.remove('hidden');
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
    const loadedCount = delivery.getLoadedCargoCount();
    this.cargoTitle.textContent = `📦 오토바이 배달통 (${loadedCount} / ${CARGO_SLOT_COUNT}칸 적재)`;

    const carrying = delivery.getCarryingMission();
    if (carrying) {
      const actionLabel =
        carrying.phase === 'carrying_to_box' ? '픽업 음식 적재 대기' : '꺼낸 음식 (다시 적재 가능)';
      this.cargoHandBanner.className = 'cargo-hand-banner carrying';
      this.cargoHandBanner.innerHTML = `
        <div class="chb-top">
          <span>🛍️ 손에 든 음식: <b>#${carrying.order.orderNumber}</b></span>
          <span class="chb-tag">${actionLabel}</span>
        </div>
        <div class="chb-sub">${carrying.order.shop.emoji} ${carrying.order.shop.name} → ${carrying.order.customer.emoji} ${carrying.order.customer.name} ${carrying.order.unitNumber}</div>
      `;
    } else {
      this.cargoHandBanner.className = 'cargo-hand-banner free';
      this.cargoHandBanner.innerHTML = `
        <div class="chb-top">
          <span>✋ 양손 비어 있음</span>
          <span class="chb-tag">적재된 슬롯을 선택해 꺼내기</span>
        </div>
      `;
    }

    const cards: string[] = [];
    for (let i = 0; i < CARGO_SLOT_COUNT; i++) {
      const m: ActiveMission | null = delivery.getCargoSlotMission(i);
      const slotNo = i + 1;

      if (!m) {
        const canLoad =
          carrying !== null &&
          (carrying.phase === 'carrying_to_box' || carrying.phase === 'carrying_to_lobby');
        cards.push(`
          <div class="cargo-slot-card empty ${canLoad ? 'actionable' : ''}">
            <div class="cs-left">
              <div class="cs-slot-badge"><kbd>${slotNo}</kbd> 슬롯 ${slotNo}</div>
              <div class="cs-empty-text">비어 있음</div>
            </div>
            <button class="cs-btn load" data-slot="${i}" ${canLoad ? '' : 'disabled'}>
              ${canLoad ? `+ #${carrying!.order.orderNumber} 적재` : '빈 칸'}
            </button>
          </div>
        `);
      } else {
        const dist = Math.round(Math.hypot(playerX - m.order.customer.x, playerZ - m.order.customer.z));
        const isHere = dist <= 18;
        const canUnload = carrying === null;
        const intPct = Math.round(m.foodIntegrity);
        const tempPct = Math.round(m.foodTemp);
        const intColor =
          intPct >= 80 ? '#34d399' : intPct >= 50 ? '#fbbf24' : '#f87171';
        const tempIcon = m.order.foodTempType === 'cold' ? '🧊' : '🔥';
        const tempColor =
          tempPct >= 80 ? '#34d399' : tempPct >= 50 ? '#fbbf24' : '#f87171';
        const villaBadge =
          m.order.customer.residenceKind === 'walkup_villa'
            ? '<span class="villa-tag">🪜 계단 +₩500</span>'
            : '';
        const chatBadge = m.chatNote ? `<div class="chat-note-tag">💬 ${m.chatNote}</div>` : '';

        cards.push(`
          <div class="cargo-slot-card occupied ${isHere ? 'near-dest' : ''}">
            <div class="cs-main">
              <div class="cs-top-row">
                <span class="cs-slot-badge filled"><kbd>${slotNo}</kbd> 슬롯 ${slotNo}</span>
                <span class="cs-ord-num">#${m.order.orderNumber}</span>
                <span class="cs-dist ${isHere ? 'here' : ''}">${isHere ? `📍 바로 앞 (${dist}m)` : `${dist}m`}</span>
              </div>
              <div class="cs-dest">${m.order.customer.emoji} ${m.order.customer.name} <b>${m.order.unitNumber}</b>${villaBadge}</div>
              <div class="cs-meta">
                <span>${m.order.shop.emoji} ${m.order.shop.name} · ${m.order.menuName} <span class="food-meta-chip ${m.order.foodTempType === 'cold' ? 'cold' : m.order.isSpillSensitive ? 'spill' : ''}">${m.order.foodCategoryTag}</span></span>
              </div>
              ${chatBadge}
              <div class="cs-foot-row">
                <span class="cs-pin">현관 <b>${m.order.doorPinLabel}</b> · ${getInstructionMeta(m.order.deliveryInstruction).badge}</span>
                <span class="cs-int" style="color:${tempColor}">${tempIcon}${tempPct}%</span>
                <span class="cs-int" style="color:${intColor}">상태 ${intPct}%</span>
              </div>
            </div>
            <button class="cs-btn unload" data-slot="${i}" ${canUnload ? '' : 'disabled'}>
              ${canUnload ? '꺼내기' : '손 사용중'}
            </button>
          </div>
        `);
      }
    }

    this.cargoSlotsList.innerHTML = cards.join('');
  }

  public openFuelModal(currentFuel: number): void {
    this.closeAll();
    this.activeModal = 'fuel';
    this.isFueling = false;
    this.fuelStartPct = Math.round(currentFuel);
    const needed = Math.max(1, 100 - this.fuelStartPct);
    this.fuelCost = Math.max(100, Math.round((needed * FUEL_PRICE_PER_PERCENT) / 100) * 100);

    this.fuelPctEl.textContent = `${this.fuelStartPct}%`;
    this.fuelBarEl.style.width = `${this.fuelStartPct}%`;
    this.fuelStatusEl.textContent = `가득 주유 시 +${needed}% 보충 (₩${FUEL_PRICE_PER_PERCENT} / 1%)`;
    this.fuelCostEl.textContent = `₩${this.fuelCost.toLocaleString()}`;
    this.fuelStartBtn.disabled = false;
    this.fuelStartBtn.textContent = '⛽ 가득 주유 시작 (E / Enter)';
    this.fuelBackdrop.classList.remove('hidden');
  }

  private beginRefuelSequence(): void {
    if (this.isFueling) return;
    this.isFueling = true;
    this.fuelStartBtn.disabled = true;
    this.fuelStartBtn.textContent = '⛽ 주유 중...';
    this.fuelStatusEl.textContent = '연료를 주입하고 있습니다...';

    const startPct = this.fuelStartPct;
    const totalNeeded = Math.max(1, 100 - startPct);
    const totalCost = this.fuelCost;
    const steps = 16;
    let curStep = 0;

    this.fuelTimer = window.setInterval(() => {
      curStep++;
      const frac = Math.min(1, curStep / steps);
      const pct = Math.round(startPct + totalNeeded * frac);
      this.fuelPctEl.textContent = `${pct}%`;
      this.fuelBarEl.style.width = `${pct}%`;
      if (curStep % 3 === 1 && curStep < steps) {
        this.callbacks.onFuelTick();
      }

      if (curStep >= steps) {
        if (this.fuelTimer !== null) {
          window.clearInterval(this.fuelTimer);
          this.fuelTimer = null;
        }
        this.fuelStatusEl.textContent = '💳 결제가 완료되었습니다! (100% 가득 주유 완료)';
        this.fuelStartBtn.textContent = '✓ 결제 완료';
        this.callbacks.onFuelComplete(totalNeeded, totalCost);
        window.setTimeout(() => {
          this.isFueling = false;
          if (this.activeModal === 'fuel') {
            this.closeAll();
          }
        }, 720);
      }
    }, 95);
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
    this.repairCost = damageLevel * REPAIR_COST_PER_DAMAGE_STAGE;
    const accelPenalty = damageLevel * 10;

    if (damageLevel > 0) {
      this.repairDiagBox.innerHTML = `
        <div class="svc-meter-row">
          <span>차량 파손 단계</span>
          <strong style="color:#fb923c">${damageLevel}단계 / 3 (누적 전도 ${crashCount}회)</strong>
        </div>
        <div class="svc-status-text">• 사이드미러 축 틀어짐 및 가속력 <b>-${accelPenalty}%</b> 저하 중</div>
      `;
      this.repairCostWrap.classList.remove('hidden');
      this.repairCostEl.textContent = `₩${this.repairCost.toLocaleString()}`;
      this.repairConfirmBtn.classList.remove('hidden');
      this.repairConfirmBtn.disabled = false;
    } else {
      this.repairDiagBox.innerHTML = `
        <div class="svc-meter-row">
          <span>차량 정비 상태</span>
          <strong style="color:#34d399">양호 ✓ (파손 없음)</strong>
        </div>
        <div class="svc-status-text">아래에서 오토바이 기종을 변경하거나 커스텀 도색을 적용할 수 있습니다!</div>
      `;
      this.repairCostWrap.classList.add('hidden');
      this.repairConfirmBtn.classList.add('hidden');
    }

    this.repairBikeList.innerHTML = SCOOTER_MODEL_LIST.map((m) => {
      const isCurrent = garage.modelId === m.id;
      const isOwned = garage.ownedModels.includes(m.id);
      const cost = isOwned ? 0 : m.price;
      const badgeClass = isCurrent ? 'active' : isOwned ? 'owned' : '';
      const badgeText = isCurrent
        ? '✓ 탑승 중'
        : isOwned
          ? '무료 교체'
          : `₩${m.price.toLocaleString()}`;
      const fuelText = m.isElectric
        ? '⚡ EV 정숙모터'
        : m.fuelBurnMul < 0.7
          ? '⛽ 초고연비'
          : '⛽ 표준 연비';
      return `
        <button class="garage-bike-btn ${isCurrent ? 'active' : ''}" data-bike-model="${m.id}" data-cost="${cost}">
          <div class="gb-info">
            <div class="gb-name">${m.icon} ${m.name}</div>
            <div class="gb-desc">${m.tagline}</div>
            <div class="gb-stats">
              <span class="gb-stat-pill">최고 ${m.maxKmh}km/h</span>
              <span class="gb-stat-pill">가속 ${Math.round(m.accelMul * 100)}%</span>
              <span class="gb-stat-pill">${fuelText}</span>
            </div>
          </div>
          <span class="gb-price-tag ${badgeClass}">${badgeText}</span>
        </button>
      `;
    }).join('');

    this.repairPaintGrid.innerHTML = SCOOTER_PAINT_LIST.map((p) => {
      const isCurrent = garage.paintId === p.id;
      const isOwned = garage.ownedPaints.includes(p.id);
      const cost = isOwned ? 0 : p.price;
      const priceTxt = isCurrent ? '적용 중' : isOwned ? '무료' : `₩${p.price.toLocaleString()}`;
      return `
        <button class="garage-paint-btn ${isCurrent ? 'active' : ''}" data-bike-paint="${p.id}" data-cost="${cost}">
          <span class="gp-swatch" style="background:${p.swatchHex}"></span>
          <span class="gp-meta">
            <span>${p.name}</span>
            <span class="gp-price">${priceTxt}</span>
          </span>
        </button>
      `;
    }).join('');

    this.repairWalletChip.textContent = `지갑 ₩${career.walletBalance.toLocaleString()}`;
    this.repairUpgradeList.innerHTML = RIDER_UPGRADE_LIST.map((u) => {
      const owned = career.upgrades.includes(u.id);
      const canAfford = career.walletBalance >= u.price;
      const cls = owned ? 'upg-owned' : canAfford ? '' : 'upg-locked';
      const tagClass = owned ? 'active' : canAfford ? 'owned' : '';
      const tagText = owned ? '✓ 장착 완료' : `₩${u.price.toLocaleString()}`;
      return `
        <button class="garage-bike-btn ${cls}" data-upgrade-id="${u.id}" data-cost="${u.price}">
          <div class="gb-info">
            <div class="gb-name">${u.icon} ${u.name}</div>
            <div class="gb-desc">${u.shortDesc}</div>
            <div class="gb-stats">
              <span class="gb-stat-pill">${u.statBadge}</span>
            </div>
          </div>
          <span class="gb-price-tag ${tagClass}">${tagText}</span>
        </button>
      `;
    }).join('');
  }

  public openConvenienceModal(staminaPct: number, batteryPct: number): void {
    this.closeAll();
    this.activeModal = 'convenience';
    this.cvsStatusBar.textContent = `현재 체력 ${Math.round(staminaPct)}% · 스마트폰 배터리 ${Math.round(batteryPct)}%`;
    this.cvsBackdrop.classList.remove('hidden');
  }

  public openDailyReportModal(ledger: DailyFinanceLedger): void {
    this.closeAll();
    this.activeModal = 'daily_report';

    const netNeg = ledger.netProfit < 0;
    const fmt = (n: number) => `₩${Math.abs(n).toLocaleString()}`;
    const netText = `${ledger.netProfit < 0 ? '-' : '+'}${fmt(ledger.netProfit)}`;

    this.reportBody.innerHTML = `
      <div class="rep-hero">
        <div>
          <div class="rep-hero-label">오늘 최종 순수익 (${ledger.completedCount}건 완료)</div>
          <div class="rep-hero-val ${netNeg ? 'neg' : ''}">${netText}</div>
        </div>
        <div style="text-align:right;font-size:11.5px;color:#cbd5e1">
          <div>총 수입 <b style="color:#4ade80">+${fmt(ledger.grossIncome)}</b></div>
          <div>총 지출 <b style="color:#f87171">-${fmt(ledger.totalExpenses)}</b></div>
        </div>
      </div>

      <div class="rep-section">
        <div class="rep-sec-title">💰 배달 수입 명세</div>
        <div class="rep-line inc"><span>기본 배달료 합계 (${ledger.completedCount}건)</span><span>+${fmt(ledger.baseFeeTotal)}</span></div>
        <div class="rep-line inc"><span>거리 할증 합계</span><span>+${fmt(ledger.distanceBonusTotal)}</span></div>
        <div class="rep-line inc"><span>🌧️ 우천/기상 할증</span><span>+${fmt(ledger.rainBonusTotal)}</span></div>
        <div class="rep-line inc"><span>🌙 심야 할증</span><span>+${fmt(ledger.nightBonusTotal)}</span></div>
        <div class="rep-line inc"><span>${ledger.riderTier.icon} ${ledger.riderTier.name} 등급 보너스</span><span>+${fmt(ledger.tierBonusTotal)}</span></div>
        <div class="rep-line inc"><span>안전 배달 팁</span><span>+${fmt(ledger.tipTotal)}</span></div>
        <div class="rep-line inc"><span>🏆 일일 배달 미션 보너스</span><span>+${fmt(ledger.missionBonusTotal)}</span></div>
        <div class="rep-line sub inc"><span>총 수입 소계</span><span>+${fmt(ledger.grossIncome)}</span></div>
      </div>

      <div class="rep-section">
        <div class="rep-sec-title">🧾 차감 및 운영 지출 명세</div>
        <div class="rep-line exp"><span>🚨 신호위반/인도사고 과태료 차감</span><span>-${fmt(ledger.fineExpense)}</span></div>
        <div class="rep-line exp"><span>📦 음식 파손 페널티 차감</span><span>-${fmt(ledger.damageDeductionTotal)}</span></div>
        <div class="rep-line exp"><span>⛽ 유류비 지출</span><span>-${fmt(ledger.fuelExpense)}</span></div>
        <div class="rep-line exp"><span>🔧 오토바이 수리·기종·도색</span><span>-${fmt(ledger.repairExpense)}</span></div>
        <div class="rep-line exp"><span>⚙️ 성능 장비 업그레이드</span><span>-${fmt(ledger.upgradeExpense)}</span></div>
        <div class="rep-line exp"><span>🏪 편의점 음료·충전</span><span>-${fmt(ledger.convenienceExpense)}</span></div>
        <div class="rep-line sub exp"><span>총 차감/지출 소계</span><span>-${fmt(ledger.totalExpenses)}</span></div>
      </div>
      <div class="rep-section">
        <div class="rep-line inc"><span>💼 누적 영구 저장 지갑 잔고 (${ledger.riderTier.icon} 누적 ${ledger.lifetimeCompleted}건)</span><span>₩${ledger.walletBalance.toLocaleString()}</span></div>
      </div>
    `;

    this.reportBackdrop.classList.remove('hidden');
  }

  public showMissionBonusPopup(targetCount: number, bonusAmount: number, totalWallet: number): void {
    this.closeAll();
    this.activeModal = 'mission_bonus';
    this.mbTitleEl.textContent = `오늘 ${targetCount}건 배달 완료하기 (${targetCount}/${targetCount})`;
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
    if (badgeEl) {
      badgeEl.textContent =
        result.order.deliveryInstruction === 'MEET_FACE'
          ? '✓ 고객 직접 대면 전달 완료'
          : result.order.deliveryInstruction === 'KNOCK_DOOR'
            ? '✓ 노크 후 문 앞 전달 완료'
            : '✓ 문 앞 배달 인증 완료';
    }
    this.settlementRoute.textContent = `[#${result.order.orderNumber}] ${result.order.shop.emoji} ${result.order.shop.name} → ${result.order.customer.name} ${result.order.unitNumber}`;
    const rainRow =
      result.rainBonus > 0
        ? `<div class="st-row rain-bonus"><span>🌧️ 우천 할증 보너스</span><span>+₩${result.rainBonus.toLocaleString()}</span></div>`
        : '';
    const nightRow =
      result.nightBonus > 0
        ? `<div class="st-row tip"><span>🌙 심야 할증 보너스</span><span>+₩${result.nightBonus.toLocaleString()}</span></div>`
        : '';
    const tierRow =
      result.tierBonus > 0
        ? `<div class="st-row tip"><span>🏅 라이더 등급 보너스</span><span>+₩${result.tierBonus.toLocaleString()}</span></div>`
        : '';

    const tempIcon = result.order.foodTempType === 'cold' ? '🧊 보냉' : '🔥 보온';
    const tempRow =
      result.tempBonus > 0
        ? `<div class="st-row tip"><span>${tempIcon} 최적 온도 유지 (${result.foodTemp}%)</span><span>+₩${result.tempBonus.toLocaleString()}</span></div>`
        : result.foodTemp < 50
          ? `<div class="st-row warn"><span>${tempIcon} 온도 저하 (${result.foodTemp}%)</span><span>배달팁 감액 반영</span></div>`
          : `<div class="st-row"><span>${tempIcon} 상태 (${result.foodTemp}%)</span><span>보통</span></div>`;

    const villaRow =
      result.villaStairBonus > 0
        ? `<div class="st-row tip"><span>🪜 구축 빌라 계단 수고비</span><span>+₩${result.villaStairBonus.toLocaleString()}</span></div>`
        : '';

    const chatTipRow =
      result.promisedTipBonus > 0
        ? `<div class="st-row tip"><span>💬 고객 약속 조심배달 팁</span><span>+₩${result.promisedTipBonus.toLocaleString()}</span></div>`
        : '';

    const spillNote = result.spillDamageAccum > 0 ? ` · 국물/방지턱 -${result.spillDamageAccum}%` : '';
    const tipRow =
      result.tipPenalty === 0
        ? `<div class="st-row tip"><span>안전 배달 팁 (음식 상태 ${result.foodIntegrity}%)</span><span>+₩${result.tip.toLocaleString()}</span></div>`
        : `<div class="st-row warn"><span>파손 배달팁 감액 (상태 ${result.foodIntegrity}%${spillNote})</span><span>팁 ₩${result.tip.toLocaleString()} (-₩${result.tipPenalty.toLocaleString()})</span></div>
           <div class="st-row warn"><span>음식 파손 배상 차감</span><span>${Math.round(
             (result.foodIntegrity / 100 - 1) * result.baseFee
           ).toLocaleString()}원</span></div>`;

    const starsFilled = '★'.repeat(result.review.stars) + '☆'.repeat(5 - result.review.stars);
    const reviewTagsHtml = result.review.tags
      .map((t) => `<span class="st-rev-tag">${t}</span>`)
      .join('');
    const reviewBoxHtml = `
      <div class="settlement-review-box">
        <div class="st-rev-hdr">
          <span>💬 방금 도착한 고객 리뷰</span>
          <span class="st-rev-stars">${starsFilled} (${result.review.stars}.0)</span>
        </div>
        <div class="st-rev-comment">"${result.review.comment}"</div>
        <div class="st-rev-tags">${reviewTagsHtml}</div>
      </div>
    `;

    this.settlementBreakdown.innerHTML = `
      <div class="st-row"><span>기본 배달료 (${result.order.menuName})</span><span>₩${result.baseFee.toLocaleString()}</span></div>
      ${rainRow}
      ${nightRow}
      ${tierRow}
      ${tempRow}
      ${villaRow}
      ${chatTipRow}
      ${tipRow}
      ${reviewBoxHtml}
    `;
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
    if (this.activeModal === 'transition') return;
    this.closeAll();
    this.activeModal = 'transition';

    this.fadeCaption.textContent = caption;
    this.fadeOverlay.classList.remove('hidden');
    void this.fadeOverlay.offsetWidth;
    this.fadeOverlay.classList.add('opaque');

    window.setTimeout(() => {
      onMidpoint();
    }, 240);

    window.setTimeout(() => {
      this.fadeOverlay.classList.remove('opaque');
    }, 360);

    window.setTimeout(() => {
      this.fadeOverlay.classList.add('hidden');
      this.activeModal = 'none';
      if (onDone) onDone();
    }, 560);
  }

  /**
   * 2-Second Black Fade-Out Elevator Transition.
   * Executes onMidpoint() while the screen is completely black (teleport + toggle scene visibility!).
   */
  public playElevatorTransition(caption: string, onMidpoint: () => void, onDone?: () => void): void {
    if (this.activeModal === 'transition') return;
    this.closeAll();
    this.activeModal = 'transition';

    this.fadeCaption.textContent = caption;
    this.fadeOverlay.classList.remove('hidden');
    void this.fadeOverlay.offsetWidth;
    this.fadeOverlay.classList.add('opaque');

    window.setTimeout(() => {
      onMidpoint();
    }, 800);

    window.setTimeout(() => {
      this.fadeOverlay.classList.remove('opaque');
    }, 1450);

    window.setTimeout(() => {
      this.fadeOverlay.classList.add('hidden');
      this.activeModal = 'none';
      if (onDone) onDone();
    }, 2050);
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
      if (this.isFueling) return true;
      if (e.key === 'Escape') {
        this.closeAll();
      } else if (e.key === 'Enter' || e.code === 'KeyE' || e.code === 'Space') {
        this.beginRefuelSequence();
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
        this.handlePosKey(e.key);
      }
      return true;
    }

    if (this.activeModal === 'pin') {
      e.preventDefault();
      if (e.key === 'Escape') {
        this.closeAll();
      } else {
        this.handlePinKey(e.key);
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

  private handlePosKey(rawKey: string): void {
    if (rawKey === 'Backspace') {
      this.posValue = this.posValue.slice(0, -1);
      this.callbacks.onKeypadBeep(true);
    } else if (rawKey === 'Enter') {
      const normalized = this.posValue.trim().toUpperCase();
      if (normalized === this.posExpected) {
        const mId = this.posMissionId;
        this.callbacks.onKeypadBeep(true);
        this.closeAll();
        this.callbacks.onPosSuccess(mId);
      } else {
        this.callbacks.onKeypadBeep(false);
        this.posError.textContent = this.posHasPhone
          ? `주문번호 불일치! (${this.posExpected} 입력)`
          : '주문번호 불일치! 오토바이에서 휴대폰을 챙겨 번호를 확인하세요';
        this.posError.classList.remove('hidden');
      }
      return;
    } else {
      const ch = rawKey.toUpperCase();
      if (/^[A-Z0-9-]$/.test(ch) && this.posValue.length < 6) {
        this.posValue += ch;
        this.posError.classList.add('hidden');
        this.callbacks.onKeypadBeep(true);
      }
    }

    if (this.posValue.length === 0) {
      this.posDisplay.textContent = '주문번호 입력';
      this.posDisplay.classList.add('placeholder');
    } else {
      this.posDisplay.textContent = this.posValue;
      this.posDisplay.classList.remove('placeholder');
    }
  }

  private handlePinKey(rawKey: string): void {
    if (rawKey === 'Backspace') {
      this.pinTokens.pop();
      this.callbacks.onKeypadBeep(true);
    } else if (rawKey === 'Enter') {
      const entered = this.pinTokens.join('');
      if (entered === this.pinExpected) {
        const mId = this.pinMissionId;
        this.callbacks.onKeypadBeep(true);
        this.closeAll();
        this.callbacks.onPinSuccess(mId);
      } else {
        this.callbacks.onKeypadBeep(false);
        this.pinError.textContent = this.pinHasPhone
          ? `출입 패턴 불일치! (${this.pinExpectedLabel})`
          : '출입 패턴 불일치! 오토바이에서 휴대폰을 챙겨 패턴을 확인하세요';
        this.pinError.classList.remove('hidden');
        this.pinTokens = [];
      }
    } else {
      let token: string | null = null;
      const up = rawKey.toUpperCase();
      if (rawKey === '🔔' || up === 'B') token = '🔔';
      else if (rawKey === '🔑' || up === 'K') token = '🔑';
      else if (rawKey === '📞' || up === 'C') token = '📞';
      else if (rawKey === '#' || rawKey === '*' || /^[0-9]$/.test(rawKey)) token = rawKey;

      if (token && this.pinTokens.length < 8) {
        this.pinTokens.push(token);
        this.pinError.classList.add('hidden');
        this.callbacks.onKeypadBeep(true);
      }
    }

    if (this.pinTokens.length === 0) {
      this.pinDisplay.textContent = '패턴 입력';
      this.pinDisplay.classList.add('placeholder');
    } else {
      this.pinDisplay.textContent = this.pinTokens.join(' ');
      this.pinDisplay.classList.remove('placeholder');
    }
  }
}
