import {
  ActiveMission,
  CARGO_SLOT_COUNT,
  DeliveryManager,
  DeliveryOrder,
  SettlementResult,
} from '../delivery/DeliveryManager';

export type ActiveModalType = 'none' | 'pos' | 'pin' | 'cargo' | 'camera' | 'settlement' | 'transition';

export interface ModalCallbacks {
  onPosSuccess: (missionId: string) => void;
  onPinSuccess: (missionId: string) => void;
  onCargoSlotAction: (slotIndex: number) => void;
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
  private pinValue = '';
  private pinHasPhone = true;

  // Cargo Box 3-Slot Modal
  private readonly cargoBackdrop = document.getElementById('cargo-modal')!;
  private readonly cargoTitle = document.getElementById('cargo-modal-title')!;
  private readonly cargoHandBanner = document.getElementById('cargo-hand-banner')!;
  private readonly cargoSlotsList = document.getElementById('cargo-slots-list')!;

  // Camera Viewfinder
  private readonly cameraOverlay = document.getElementById('camera-viewfinder')!;
  private readonly cameraStamp = document.getElementById('camera-stamp')!;
  private readonly cameraFlash = document.getElementById('camera-flash')!;

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
  }

  public isBlockingMovement(): boolean {
    return (
      this.activeModal === 'pos' ||
      this.activeModal === 'pin' ||
      this.activeModal === 'cargo' ||
      this.activeModal === 'settlement' ||
      this.activeModal === 'transition'
    );
  }

  public closeAll(): void {
    if (this.activeModal === 'transition') return;
    this.activeModal = 'none';
    this.posBackdrop.classList.add('hidden');
    this.pinBackdrop.classList.add('hidden');
    this.cargoBackdrop.classList.add('hidden');
    this.cameraOverlay.classList.add('hidden');
    this.settlementBackdrop.classList.add('hidden');
  }

  public openPosKeypad(order: DeliveryOrder, hasPhone: boolean): void {
    this.closeAll();
    this.activeModal = 'pos';
    this.posMissionId = order.id;
    this.posExpected = order.orderNumber.toUpperCase();
    this.posValue = '';
    this.posHasPhone = hasPhone;
    this.posShopTitle.textContent = `${order.shop.emoji} ${order.shop.name} 야외 픽업 POS`;
    this.posHint.textContent = hasPhone
      ? `내 주문번호: ${order.orderNumber} (${order.menuName})`
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
    this.pinValue = '';
    this.pinHasPhone = hasPhone;
    this.pinBuildingTitle.textContent = `${order.customer.emoji} ${order.customer.name} 공동현관`;
    this.pinHint.textContent = hasPhone
      ? `고객 요청 메모 PIN: ${order.doorPin} (${order.unitNumber})`
      : '📱 휴대폰이 오토바이에 있어 PIN 자동 조회 불가 ([Esc] 후 폰 회수 또는 직접 입력)';
    this.pinDisplay.textContent = '----';
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
        const intColor =
          m.foodIntegrity >= 80 ? '#34d399' : m.foodIntegrity >= 50 ? '#fbbf24' : '#f87171';

        cards.push(`
          <div class="cargo-slot-card occupied ${isHere ? 'near-dest' : ''}">
            <div class="cs-main">
              <div class="cs-top-row">
                <span class="cs-slot-badge filled"><kbd>${slotNo}</kbd> 슬롯 ${slotNo}</span>
                <span class="cs-ord-num">#${m.order.orderNumber}</span>
                <span class="cs-dist ${isHere ? 'here' : ''}">${isHere ? `📍 바로 앞 (${dist}m)` : `${dist}m`}</span>
              </div>
              <div class="cs-dest">${m.order.customer.emoji} ${m.order.customer.name} <b>${m.order.unitNumber}</b></div>
              <div class="cs-meta">
                <span>${m.order.shop.emoji} ${m.order.shop.name} · ${m.order.menuName}</span>
              </div>
              <div class="cs-foot-row">
                <span class="cs-pin">PIN <b>${m.order.doorPin}</b></span>
                <span class="cs-int" style="color:${intColor}">음식 상태 ${m.foodIntegrity}%</span>
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

  public openCameraViewfinder(order: DeliveryOrder): void {
    this.closeAll();
    this.activeModal = 'camera';
    const now = new Date();
    const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    this.cameraStamp.textContent = `#${order.orderNumber} · ${order.customer.name} ${order.unitNumber} · ${ts}`;
    this.cameraOverlay.classList.remove('hidden');
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
    this.settlementRoute.textContent = `[#${result.order.orderNumber}] ${result.order.shop.emoji} ${result.order.shop.name} → ${result.order.customer.name} ${result.order.unitNumber}`;
    const rainRow =
      result.rainBonus > 0
        ? `<div class="st-row rain-bonus"><span>🌧️ 우천 할증 보너스</span><span>+₩${result.rainBonus.toLocaleString()}</span></div>`
        : '';

    const tipRow =
      result.tipPenalty === 0
        ? `<div class="st-row tip"><span>안전 배달 팁 (음식 상태 ${result.foodIntegrity}%)</span><span>+₩${result.tip.toLocaleString()}</span></div>`
        : `<div class="st-row warn"><span>파손 배달팁 감액 (상태 ${result.foodIntegrity}%)</span><span>팁 ₩${result.tip.toLocaleString()} (-₩${result.tipPenalty.toLocaleString()})</span></div>
           <div class="st-row warn"><span>음식 파손 배상 차감</span><span>${Math.round(
             (result.foodIntegrity / 100 - 1) * result.baseFee
           ).toLocaleString()}원</span></div>`;

    this.settlementBreakdown.innerHTML = `
      <div class="st-row"><span>기본 배달료 (${result.order.menuName})</span><span>₩${result.baseFee.toLocaleString()}</span></div>
      ${rainRow}
      ${tipRow}
    `;
    this.settlementTotal.textContent = `+₩${result.earned.toLocaleString()}`;
    this.settlementCumul.textContent = `오늘 누적 수익 ₩${result.totalEarnings.toLocaleString()} (${result.completedCount}건 완료)`;
    this.settlementBackdrop.classList.remove('hidden');
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
      if (/^[A-D0-9-]$/.test(ch) && this.posValue.length < 6) {
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
      this.pinValue = this.pinValue.slice(0, -1);
      this.callbacks.onKeypadBeep(true);
    } else if (rawKey === 'Enter') {
      if (this.pinValue === this.pinExpected) {
        const mId = this.pinMissionId;
        this.callbacks.onKeypadBeep(true);
        this.closeAll();
        this.callbacks.onPinSuccess(mId);
      } else {
        this.callbacks.onKeypadBeep(false);
        this.pinError.textContent = this.pinHasPhone
          ? `비밀번호 불일치! (${this.pinExpected} 입력)`
          : '비밀번호 불일치! 오토바이에서 휴대폰을 챙겨 PIN을 확인하세요';
        this.pinError.classList.remove('hidden');
        this.pinValue = '';
      }
    } else if (/^[0-9]$/.test(rawKey) && this.pinValue.length < 4) {
      this.pinValue += rawKey;
      this.pinError.classList.add('hidden');
      this.callbacks.onKeypadBeep(true);
    }

    this.pinDisplay.textContent = this.pinValue.padEnd(4, '-');
  }
}
