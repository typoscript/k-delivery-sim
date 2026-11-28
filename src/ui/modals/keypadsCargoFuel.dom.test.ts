// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGamePageDom } from '../../test/domFixture';
import { ModalUi, ModalCallbacks } from '../ModalUi';
import { DeliveryManager } from '../../delivery/DeliveryManager';
import { FUEL_PRICE_PER_PERCENT } from '../../delivery/deliveryTypes';
import { fuelPurchase, fullTankCost } from './fuelModal';
import { DeliveryLocation } from '../../types';

function recordingCallbacks(log: unknown[][]): ModalCallbacks {
  return new Proxy({} as ModalCallbacks, {
    get:
      (_t, k) =>
      (...args: unknown[]) =>
        log.push([k, ...args]),
  });
}
const key = (k: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent('keydown', { key: k, code: /^[a-z]$/i.test(k) ? `Key${k.toUpperCase()}` : k, ...init });
const loc = (id: string, x: number, type: 'shop' | 'residential'): DeliveryLocation => ({
  id,
  name: id,
  x,
  z: 0,
  type,
  emoji: '',
  menus: type === 'shop' ? ['제육볶음 정식'] : undefined,
});
const newDelivery = () =>
  new DeliveryManager([loc('s1', 0, 'shop'), loc('s2', 40, 'shop'), loc('r1', 300, 'residential')]);
const shown = (id: string) => !document.getElementById(id)!.classList.contains('hidden');
const beeps = (log: unknown[][]) => log.filter((l) => l[0] === 'onKeypadBeep').map((l) => l[1]);

describe('POS / PIN keypads (DOM)', () => {
  let log: unknown[][];
  let ui: ModalUi;
  beforeEach(() => {
    loadGamePageDom();
    log = [];
    ui = new ModalUi(recordingCallbacks(log));
  });

  it('POS: a wrong order number beeps and shows the right one; typing it (keys or buttons) picks up', () => {
    const order = newDelivery().availableOrders[0];
    ui.openPosKeypad(order, true);
    expect(shown('pos-modal')).toBe(true);
    for (const ch of 'Z9') ui.handleKeyDown(key(ch));
    ui.handleKeyDown(key('Enter'));
    expect(beeps(log).at(-1)).toBe(false);
    expect(shown('pos-error')).toBe(true);
    expect(document.getElementById('pos-error')!.textContent).toContain(order.orderNumber.toUpperCase());
    ui.handleKeyDown(key('Backspace'));
    ui.handleKeyDown(key('Backspace'));
    expect(document.getElementById('pos-display')!.textContent).toBe('주문번호 입력');

    // the on-screen keypad types the same characters
    const pad = document.getElementById('pos-modal')!;
    for (const ch of order.orderNumber.toUpperCase()) {
      const btn = pad.querySelector<HTMLButtonElement>(`[data-key="${ch}"]`);
      if (btn) btn.click();
      else ui.handleKeyDown(key(ch));
    }
    pad.querySelector<HTMLButtonElement>('[data-key="enter"]')!.click();
    expect(log.filter((l) => l[0] === 'onPosSuccess')).toEqual([['onPosSuccess', order.id]]);
    expect(ui.activeModal).toBe('none');
  });

  it('POS without the phone: the hint says the number cannot be looked up', () => {
    ui.openPosKeypad(newDelivery().availableOrders[0], false);
    expect(document.getElementById('pos-order-hint')!.textContent).toContain('휴대폰이 오토바이에');
  });

  it('PIN: a wrong pattern clears the pad; the right pattern opens the lobby', () => {
    const order = newDelivery().availableOrders[0];
    ui.openPinKeypad(order, true);
    expect(document.getElementById('pin-code-hint')!.textContent).toContain(order.doorPinLabel);
    ui.handleKeyDown(key('1'));
    ui.handleKeyDown(key('Enter'));
    expect(shown('pin-error')).toBe(true);
    expect(document.getElementById('pin-display')!.textContent).toBe('패턴 입력');
    const keyOf: Record<string, string> = { '🔔': 'b', '🔑': 'k', '📞': 'c' };
    for (const t of Array.from(order.doorPin)) ui.handleKeyDown(key(keyOf[t] ?? t));
    ui.handleKeyDown(key('Enter'));
    expect(log.filter((l) => l[0] === 'onPinSuccess')).toEqual([['onPinSuccess', order.id]]);
    expect(ui.activeModal).toBe('none');
  });

  it('Esc closes a keypad; a held key types once', () => {
    ui.openPosKeypad(newDelivery().availableOrders[0], true);
    ui.handleKeyDown(key('A'));
    ui.handleKeyDown(key('A', { repeat: true }));
    expect(document.getElementById('pos-display')!.textContent).toBe('A');
    ui.handleKeyDown(key('Escape'));
    expect(shown('pos-modal')).toBe(false);
  });
});

describe('cargo box (DOM)', () => {
  it('slot buttons and number keys act on that slot; E / Esc close', () => {
    loadGamePageDom();
    const log: unknown[][] = [];
    const ui = new ModalUi(recordingCallbacks(log));
    const dm = newDelivery();
    const o = dm.availableOrders[0];
    dm.acceptOrder(o.id);
    dm.completePosPickup(o.id, false); // food in hand
    ui.openCargoBoxModal(dm, 0, 0);
    expect(shown('cargo-modal')).toBe(true);
    expect(ui.cargoTitle.textContent).toContain('0 / 3');
    const load = ui.cargoSlotsList.querySelector<HTMLButtonElement>('[data-slot="1"]:not([disabled])')!;
    load.click();
    ui.handleKeyDown(key('3'));
    expect(log).toEqual([
      ['onCargoSlotAction', 1],
      ['onCargoSlotAction', 2],
    ]);
    ui.handleKeyDown(key('e'));
    expect(ui.activeModal).toBe('none');
  });
});

describe('fuel pump (DOM)', () => {
  beforeEach(() => {
    loadGamePageDom();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('sells only what the wallet covers', () => {
    expect(fuelPurchase(40, 1_000_000)).toEqual({ added: 60, cost: fullTankCost(40).cost, partial: false });
    const part = fuelPurchase(40, 1_000);
    expect(part.partial).toBe(true);
    expect(part.cost).toBeLessThanOrEqual(1_000);
    expect(part.added).toBe(Math.floor(1_000 / FUEL_PRICE_PER_PERCENT));
    expect(fuelPurchase(40, 50)).toEqual({ added: 0, cost: 0, partial: true });
  });

  it('pumps, pays once and closes; cannot be closed while pumping; no money no pump', () => {
    const log: unknown[][] = [];
    const ui = new ModalUi(recordingCallbacks(log));
    ui.openFuelModal(40, 1_000);
    const btn = document.getElementById('fuel-start-btn') as HTMLButtonElement;
    expect(btn.textContent).toContain('잔액만큼');
    ui.handleKeyDown(key('Enter'));
    ui.handleKeyDown(key('Escape')); // pumping: ignored
    expect(ui.activeModal).toBe('fuel');
    vi.advanceTimersByTime(3_000);
    const paid = log.filter((l) => l[0] === 'onFuelComplete');
    expect(paid).toEqual([['onFuelComplete', fuelPurchase(40, 1_000).added, fuelPurchase(40, 1_000).cost]]);
    expect(ui.activeModal).toBe('none');

    ui.openFuelModal(40, 50);
    expect(btn.disabled).toBe(true);
    ui.handleKeyDown(key('Enter'));
    vi.advanceTimersByTime(3_000);
    expect(log.filter((l) => l[0] === 'onFuelComplete')).toHaveLength(1);
  });
});
