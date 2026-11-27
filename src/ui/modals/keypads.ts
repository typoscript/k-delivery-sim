import { DeliveryOrder } from '../../delivery/DeliveryManager';

/** What a keypad modal needs from ModalUi */
export interface KeypadHost {
  /** Key click sound (false = wrong code buzz) */
  beep(ok: boolean): void;
  /** Close every modal (Esc, backdrop, close button, success) */
  close(): void;
  /** Correct code entered for this mission (called after close) */
  onSuccess(missionId: string): void;
}

/** POS order-number character for a pressed key (A-Z, 0-9, '-'), or null */
export function posCharFor(rawKey: string): string | null {
  const ch = rawKey.toUpperCase();
  return /^[A-Z0-9-]$/.test(ch) ? ch : null;
}

export const POS_MAX_LENGTH = 6;
export const PIN_MAX_TOKENS = 8;

/** Lobby door pattern token for a pressed key: 🔔 (B), 🔑 (K), 📞 (C), 0-9, #, * — or null */
export function pinTokenFor(rawKey: string): string | null {
  const up = rawKey.toUpperCase();
  if (rawKey === '🔔' || up === 'B') return '🔔';
  if (rawKey === '🔑' || up === 'K') return '🔑';
  if (rawKey === '📞' || up === 'C') return '📞';
  if (rawKey === '#' || rawKey === '*' || /^[0-9]$/.test(rawKey)) return rawKey;
  return null;
}

/** Routes on-screen keypad button clicks (data-key) to the keypad; backdrop / close button close it */
function wireKeypadClicks(backdrop: HTMLElement, host: KeypadHost, handleKey: (key: string) => void): void {
  backdrop.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target === backdrop) {
      host.close();
      return;
    }
    const btn = target.closest('button') as HTMLButtonElement | null;
    if (!btn) return;
    const key = btn.dataset.key;
    if (key === 'close') host.close();
    else if (key === 'back') handleKey('Backspace');
    else if (key === 'enter') handleKey('Enter');
    else if (key) handleKey(key);
  });
}

/** Outdoor store pickup POS: type the order number (A-12 ...) */
export class PosKeypad {
  private readonly backdrop = document.getElementById('pos-modal')!;
  private readonly shopTitle = document.getElementById('pos-shop-title')!;
  private readonly hint = document.getElementById('pos-order-hint')!;
  private readonly display = document.getElementById('pos-display')!;
  private readonly error = document.getElementById('pos-error')!;
  private missionId = '';
  private expected = '';
  private value = '';
  private hasPhone = true;

  constructor(private readonly host: KeypadHost) {
    wireKeypadClicks(this.backdrop, host, (k) => this.handleKey(k));
  }

  public open(order: DeliveryOrder, hasPhone: boolean, isRegularShop: boolean): void {
    this.missionId = order.id;
    this.expected = order.orderNumber.toUpperCase();
    this.value = '';
    this.hasPhone = hasPhone;
    this.shopTitle.textContent = `${order.shop.emoji} ${order.shop.name} 야외 픽업 POS${isRegularShop ? ' ⭐ 단골' : ''}`;
    this.hint.textContent = hasPhone
      ? `내 주문번호: ${order.orderNumber} (${order.menuName})${isRegularShop ? ' · ⭐ 단골 매장 우선 조리 우대' : ''}`
      : '📱 휴대폰이 오토바이에 있어 주문번호 자동 조회 불가 ([Esc] 후 폰 회수 또는 직접 입력)';
    this.display.textContent = '주문번호 입력';
    this.display.classList.add('placeholder');
    this.error.classList.add('hidden');
    this.backdrop.classList.remove('hidden');
  }

  public hide(): void {
    this.backdrop.classList.add('hidden');
  }

  public handleKey(rawKey: string): void {
    if (rawKey === 'Backspace') {
      this.value = this.value.slice(0, -1);
      this.host.beep(true);
    } else if (rawKey === 'Enter') {
      if (this.value.trim().toUpperCase() === this.expected) {
        const id = this.missionId;
        this.host.beep(true);
        this.host.close();
        this.host.onSuccess(id);
      } else {
        this.host.beep(false);
        this.error.textContent = this.hasPhone
          ? `주문번호 불일치! (${this.expected} 입력)`
          : '주문번호 불일치! 오토바이에서 휴대폰을 챙겨 번호를 확인하세요';
        this.error.classList.remove('hidden');
      }
      return;
    } else {
      const ch = posCharFor(rawKey);
      if (ch && this.value.length < POS_MAX_LENGTH) {
        this.value += ch;
        this.error.classList.add('hidden');
        this.host.beep(true);
      }
    }
    this.render();
  }

  private render(): void {
    const empty = this.value.length === 0;
    this.display.textContent = empty ? '주문번호 입력' : this.value;
    this.display.classList.toggle('placeholder', empty);
  }
}

/** Apartment lobby door pad: enter the pattern (🔔1234, 🔑5678📞 ...) */
export class PinKeypad {
  private readonly backdrop = document.getElementById('pin-modal')!;
  private readonly buildingTitle = document.getElementById('pin-building-title')!;
  private readonly hint = document.getElementById('pin-code-hint')!;
  private readonly display = document.getElementById('pin-display')!;
  private readonly error = document.getElementById('pin-error')!;
  private missionId = '';
  private expected = '';
  private expectedLabel = '';
  private tokens: string[] = [];
  private hasPhone = true;

  constructor(private readonly host: KeypadHost) {
    wireKeypadClicks(this.backdrop, host, (k) => this.handleKey(k));
  }

  public open(order: DeliveryOrder, hasPhone: boolean): void {
    this.missionId = order.id;
    this.expected = order.doorPin;
    this.expectedLabel = order.doorPinLabel;
    this.tokens = [];
    this.hasPhone = hasPhone;
    this.buildingTitle.textContent = `${order.customer.emoji} ${order.customer.name} 공동현관`;
    this.hint.textContent = hasPhone
      ? `공동현관 출입 패턴: ${order.doorPinLabel} (${order.unitNumber})`
      : '📱 휴대폰이 오토바이에 있어 PIN 패턴 조회 불가 ([Esc] 후 폰 회수 또는 직접 입력)';
    this.display.textContent = '패턴 입력';
    this.display.classList.add('placeholder');
    this.error.classList.add('hidden');
    this.backdrop.classList.remove('hidden');
  }

  public hide(): void {
    this.backdrop.classList.add('hidden');
  }

  public handleKey(rawKey: string): void {
    if (rawKey === 'Backspace') {
      this.tokens.pop();
      this.host.beep(true);
    } else if (rawKey === 'Enter') {
      if (this.tokens.join('') === this.expected) {
        const id = this.missionId;
        this.host.beep(true);
        this.host.close();
        this.host.onSuccess(id);
        return;
      }
      this.host.beep(false);
      this.error.textContent = this.hasPhone
        ? `출입 패턴 불일치! (${this.expectedLabel})`
        : '출입 패턴 불일치! 오토바이에서 휴대폰을 챙겨 패턴을 확인하세요';
      this.error.classList.remove('hidden');
      this.tokens = [];
    } else {
      const token = pinTokenFor(rawKey);
      if (token && this.tokens.length < PIN_MAX_TOKENS) {
        this.tokens.push(token);
        this.error.classList.add('hidden');
        this.host.beep(true);
      }
    }
    this.render();
  }

  private render(): void {
    const empty = this.tokens.length === 0;
    this.display.textContent = empty ? '패턴 입력' : this.tokens.join(' ');
    this.display.classList.toggle('placeholder', empty);
  }
}
