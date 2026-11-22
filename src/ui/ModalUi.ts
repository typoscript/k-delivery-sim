import { DeliveryOrder, SettlementResult } from '../delivery/DeliveryManager';

export type ActiveModalType = 'none' | 'pos' | 'pin' | 'camera' | 'settlement' | 'transition';

export interface ModalCallbacks {
  onPosSuccess: () => void;
  onPinSuccess: () => void;
  onTakePhoto: () => void;
  onSettlementClose: () => void;
  onKeypadBeep: (ok: boolean) => void;
}

/**
 * Handles all interactive delivery modals:
 * 1. Outdoor Store POS Order-Number Keypad
 * 2. 1st-Floor Apartment Entrance 4-Digit PIN Pad
 * 3. Smartphone Camera Viewfinder Overlay (+ shutter flash)
 * 4. Delivery Completion Settlement Popup (with captured proof photo)
 * 5. 2-Second Black Fade-Out Elevator Transition
 */
export class ModalUi {
  public activeModal: ActiveModalType = 'none';

  // POS Modal
  private readonly posBackdrop = document.getElementById('pos-modal')!;
  private readonly posShopTitle = document.getElementById('pos-shop-title')!;
  private readonly posHint = document.getElementById('pos-order-hint')!;
  private readonly posDisplay = document.getElementById('pos-display')!;
  private readonly posError = document.getElementById('pos-error')!;
  private posExpected = '';
  private posValue = '';

  // Apartment PIN Modal
  private readonly pinBackdrop = document.getElementById('pin-modal')!;
  private readonly pinBuildingTitle = document.getElementById('pin-building-title')!;
  private readonly pinHint = document.getElementById('pin-code-hint')!;
  private readonly pinDisplay = document.getElementById('pin-display')!;
  private readonly pinError = document.getElementById('pin-error')!;
  private pinExpected = '';
  private pinValue = '';

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
      this.activeModal === 'settlement' ||
      this.activeModal === 'transition'
    );
  }

  public closeAll(): void {
    if (this.activeModal === 'transition') return;
    this.activeModal = 'none';
    this.posBackdrop.classList.add('hidden');
    this.pinBackdrop.classList.add('hidden');
    this.cameraOverlay.classList.add('hidden');
    this.settlementBackdrop.classList.add('hidden');
  }

  public openPosKeypad(order: DeliveryOrder): void {
    this.closeAll();
    this.activeModal = 'pos';
    this.posExpected = order.orderNumber.toUpperCase();
    this.posValue = '';
    this.posShopTitle.textContent = `${order.shop.emoji} ${order.shop.name} 야외 픽업 POS`;
    this.posHint.textContent = `내 주문번호: ${order.orderNumber} (${order.menuName})`;
    this.posDisplay.textContent = '주문번호 입력';
    this.posDisplay.classList.add('placeholder');
    this.posError.classList.add('hidden');
    this.posBackdrop.classList.remove('hidden');
  }

  public openPinKeypad(order: DeliveryOrder): void {
    this.closeAll();
    this.activeModal = 'pin';
    this.pinExpected = order.doorPin;
    this.pinValue = '';
    this.pinBuildingTitle.textContent = `${order.customer.emoji} ${order.customer.name} 공동현관`;
    this.pinHint.textContent = `고객 요청 메모 PIN: ${order.doorPin} (${order.unitNumber})`;
    this.pinDisplay.textContent = '----';
    this.pinError.classList.add('hidden');
    this.pinBackdrop.classList.remove('hidden');
  }

  public openCameraViewfinder(order: DeliveryOrder): void {
    this.closeAll();
    this.activeModal = 'camera';
    const now = new Date();
    const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    this.cameraStamp.textContent = `${order.customer.name} ${order.unitNumber} · ${ts}`;
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
    this.settlementRoute.textContent = `${result.order.shop.emoji} ${result.order.shop.name} → ${result.order.customer.name} ${result.order.unitNumber}`;
    const tipRow =
      result.tip > 0
        ? `<div class="st-row tip"><span>안전 배달 팁 (상태 ${result.foodIntegrity}%)</span><span>+₩${result.tip.toLocaleString()}</span></div>`
        : `<div class="st-row warn"><span>음식 상태 반영 (${result.foodIntegrity}%)</span><span>${Math.round(
            (result.foodIntegrity / 100 - 1) * result.baseFee
          ).toLocaleString()}원</span></div>`;

    this.settlementBreakdown.innerHTML = `
      <div class="st-row"><span>기본 배달료 (${result.order.menuName})</span><span>₩${result.baseFee.toLocaleString()}</span></div>
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
    // Force reflow for smooth CSS opacity fade-in
    void this.fadeOverlay.offsetWidth;
    this.fadeOverlay.classList.add('opaque');

    // Midpoint at 800ms (screen completely black -> teleport & occlude outdoor city!)
    window.setTimeout(() => {
      onMidpoint();
    }, 800);

    // Begin fade-back-in at 1450ms (total ~2.0s elevator ride!)
    window.setTimeout(() => {
      this.fadeOverlay.classList.remove('opaque');
    }, 1450);

    window.setTimeout(() => {
      this.fadeOverlay.classList.add('hidden');
      this.activeModal = 'none';
      if (onDone) onDone();
    }, 2050);
  }

  /** Handles physical keyboard input when POS / PIN / Camera / Settlement modal is open */
  public handleKeyDown(e: KeyboardEvent): boolean {
    if (this.activeModal === 'none') return false;

    if (this.activeModal === 'transition') {
      e.preventDefault();
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
      return false; // allow looking/aiming at the food bag with mouse/arrows!
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
        this.callbacks.onKeypadBeep(true);
        this.closeAll();
        this.callbacks.onPosSuccess();
      } else {
        this.callbacks.onKeypadBeep(false);
        this.posError.textContent = `주문번호 불일치! (${this.posExpected} 입력)`;
        this.posError.classList.remove('hidden');
      }
      return;
    } else {
      const ch = rawKey.toUpperCase();
      if (/^[A-C0-9-]$/.test(ch) && this.posValue.length < 6) {
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
        this.callbacks.onKeypadBeep(true);
        this.closeAll();
        this.callbacks.onPinSuccess();
      } else {
        this.callbacks.onKeypadBeep(false);
        this.pinError.textContent = `비밀번호 불일치! (${this.pinExpected} 입력)`;
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
