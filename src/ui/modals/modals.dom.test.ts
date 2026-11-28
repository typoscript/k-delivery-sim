// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { loadGamePageDom } from '../../test/domFixture';
import { ModalUi, ModalCallbacks } from '../ModalUi';
import { DeliveryManager, REPAIR_COST_PER_DAMAGE_STAGE } from '../../delivery/DeliveryManager';
import { RIDER_UPGRADE_LIST, RiderCareerSave } from '../../delivery/RiderCareer';
import { SCOOTER_MODEL_LIST } from '../../vehicle/ScooterModels';
import { modalCallbacks } from '../../game/app/modalCallbacks';
import type { AppRefs } from '../../game/app/appRefs';
import { DeliveryLocation } from '../../types';

/** Records every callback call as [name, ...args] */
function recordingCallbacks(log: unknown[][]): ModalCallbacks {
  return new Proxy({} as ModalCallbacks, {
    get:
      (_t, k) =>
      (...args: unknown[]) =>
        log.push([k, ...args]),
  });
}

const career = (wallet: number): RiderCareerSave => ({
  walletBalance: wallet,
  lifetimeCompleted: 0,
  riderRating: 5,
  upgrades: [],
  reviews: [],
  shopPickupCounts: {},
  customerDeliveryCounts: {},
  shopNames: {},
});
const garage = () => ({
  modelId: SCOOTER_MODEL_LIST[0].id,
  paintId: 'mint' as never,
  ownedModels: [SCOOTER_MODEL_LIST[0].id],
  ownedPaints: [],
});
const key = (k: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent('keydown', { key: k, code: k === ' ' ? 'Space' : `Key${k.toUpperCase()}`, ...init });
const shown = (id: string) => !document.getElementById(id)!.classList.contains('hidden');

describe('service modals (DOM)', () => {
  let log: unknown[][];
  let ui: ModalUi;
  beforeEach(() => {
    loadGamePageDom();
    log = [];
    ui = new ModalUi(recordingCallbacks(log));
  });

  it('repair shop: shows the damage price, the confirm button pays it and closes; nothing to fix hides it', () => {
    ui.openRepairModal(2, 3, garage(), career(50_000));
    expect(ui.activeModal).toBe('repair');
    expect(shown('repair-modal')).toBe(true);
    expect(ui.repairCostEl.textContent).toBe(`₩${(2 * REPAIR_COST_PER_DAMAGE_STAGE).toLocaleString()}`);
    expect(ui.repairWalletChip.textContent).toContain('50,000');
    ui.repairConfirmBtn.click();
    expect(log).toEqual([['onRepairConfirm', 2 * REPAIR_COST_PER_DAMAGE_STAGE]]);
    expect(ui.activeModal).toBe('none');
    expect(ui.repairBackdrop.classList.contains('hidden')).toBe(true);

    ui.openRepairModal(0, 0, garage(), career(50_000));
    expect(ui.repairConfirmBtn.classList.contains('hidden')).toBe(true);
    // Enter does not charge a repair when there is nothing to repair
    ui.handleKeyDown(key('Enter'));
    expect(log).toHaveLength(1);
  });

  it('repair shop: upgrade and bike buttons pass their price; the modal stays open', () => {
    ui.openRepairModal(0, 0, garage(), career(0));
    const upg = ui.repairUpgradeList.querySelector<HTMLButtonElement>(
      `[data-upgrade-id="${RIDER_UPGRADE_LIST[0].id}"]`,
    )!;
    upg.click();
    expect(log[0]).toEqual(['onBuyUpgrade', RIDER_UPGRADE_LIST[0].id, RIDER_UPGRADE_LIST[0].price]);
    const bike = ui.repairBikeList.querySelector<HTMLButtonElement>(`[data-bike-model="${SCOOTER_MODEL_LIST[1].id}"]`)!;
    bike.click();
    expect(log[1]).toEqual(['onSelectBikeModel', SCOOTER_MODEL_LIST[1].id, Number(bike.dataset.cost)]);
    expect(ui.activeModal).toBe('repair');
  });

  it('convenience store: item buttons and number keys buy at the same prices; Esc closes', () => {
    ui.openConvenienceModal(40, 70);
    expect(ui.cvsStatusBar.textContent).toContain('체력 40%');
    const buttons = [...ui.cvsBackdrop.querySelectorAll<HTMLButtonElement>('button[data-item]')];
    const priceOf = Object.fromEntries(buttons.map((b) => [b.dataset.item!, Number(b.dataset.cost)]));
    expect(Object.keys(priceOf).sort()).toEqual(['energy_drink', 'iced_coffee', 'ion_drink', 'power_bank']);

    buttons.find((b) => b.dataset.item === 'iced_coffee')!.click();
    expect(log.pop()).toEqual(['onConvenienceBuy', 'iced_coffee', priceOf.iced_coffee]);
    expect(ui.activeModal).toBe('none');

    // keys 1-4 charge exactly what the buttons show
    const keyItems = ['energy_drink', 'iced_coffee', 'power_bank', 'ion_drink'];
    keyItems.forEach((item, i) => {
      ui.openConvenienceModal(40, 70);
      expect(ui.handleKeyDown(key(String(i + 1)))).toBe(true);
      expect(log.pop()).toEqual(['onConvenienceBuy', item, priceOf[item]]);
    });

    ui.openConvenienceModal(40, 70);
    ui.handleKeyDown(key('Escape'));
    expect(ui.activeModal).toBe('none');
    expect(log).toHaveLength(0);
  });

  it('a held key (auto-repeat) never buys or closes', () => {
    ui.openConvenienceModal(40, 70);
    expect(ui.handleKeyDown(key('1', { repeat: true }))).toBe(true);
    expect(ui.handleKeyDown(key('Escape', { repeat: true }))).toBe(true);
    expect(ui.activeModal).toBe('convenience');
    expect(log).toHaveLength(0);
  });

  it('settlement: shows the earnings, confirm (button or Enter) closes and returns to the corridor', () => {
    const loc = (id: string, x: number, type: 'shop' | 'residential'): DeliveryLocation => ({
      id,
      name: id,
      x,
      z: 0,
      type,
      emoji: '',
      menus: type === 'shop' ? ['제육볶음 정식'] : undefined,
    });
    const dm = new DeliveryManager([loc('s1', 0, 'shop'), loc('s2', 40, 'shop'), loc('r1', 300, 'residential')]);
    const o = dm.availableOrders[0];
    dm.acceptOrder(o.id);
    dm.completePosPickup(o.id, false);
    dm.loadFoodIntoCargoSlot(0);
    dm.unloadFoodFromCargoSlot(0);
    dm.unlockLobbyDoor(o.id);
    dm.enterCorridor(o.id);
    dm.placeFoodAtDoor();
    const result = dm.completePhotoSettlement()!;

    ui.showSettlement(result, 'data:image/png;base64,');
    expect(ui.activeModal).toBe('settlement');
    expect(ui.isBlockingMovement()).toBe(true);
    expect(ui.settlementTotal.textContent).toBe(`+₩${result.earned.toLocaleString()}`);
    expect(ui.settlementRoute.textContent).toContain(`#${result.order.orderNumber}`);
    document.getElementById('settlement-ok-btn')!.click();
    expect(log).toEqual([['onSettlementClose']]);
    expect(ui.activeModal).toBe('none');

    ui.showSettlement(result, 'data:image/png;base64,');
    ui.handleKeyDown(key('Enter', { repeat: true })); // held from the shutter: ignored
    expect(ui.activeModal).toBe('settlement');
    ui.handleKeyDown(key('Enter'));
    expect(log).toEqual([['onSettlementClose'], ['onSettlementClose']]);
  });
});

describe('purchases check the wallet (modal callbacks)', () => {
  /** AppRefs stand-in: every system method is recorded; the wallet holds `wallet` */
  function refs(wallet: number, calls: string[]): AppRefs {
    const sys = (name: string): unknown =>
      new Proxy(() => {}, {
        get: (_t, k) => (k === 'state' ? { damageLevel: 0, crashCount: 0 } : sys(`${name}.${String(k)}`)),
        apply: () => {
          calls.push(name);
          return name.endsWith('hasUpgrade') ? false : true;
        },
      });
    return new Proxy({} as AppRefs, {
      get: (_t, k) => {
        if (k === 'rejectIfInsufficientFunds')
          return (cost: number) => {
            calls.push(`reject?${cost}`);
            return cost > wallet;
          };
        if (k === 'bikeGarage') return garage();
        return sys(String(k));
      },
    });
  }
  const charged = (calls: string[]) =>
    calls.filter((c) => /record\w*Expense|buyUpgrade|repairVehicle|applyConvenienceDrink|rechargeBatteryFull/.test(c));

  it('short of money: repair, convenience store, upgrades and bikes are refused without charging', () => {
    const calls: string[] = [];
    const cb = modalCallbacks(refs(500, calls));
    cb.onRepairConfirm(2 * REPAIR_COST_PER_DAMAGE_STAGE);
    cb.onConvenienceBuy('energy_drink', 1500);
    cb.onBuyUpgrade(RIDER_UPGRADE_LIST[0].id, RIDER_UPGRADE_LIST[0].price);
    cb.onSelectBikeModel(SCOOTER_MODEL_LIST[1].id, 90_000);
    expect(charged(calls)).toEqual([]);
    expect(calls.filter((c) => c.startsWith('reject?'))).toHaveLength(4);
  });

  it('with enough money the purchase goes through', () => {
    const calls: string[] = [];
    const cb = modalCallbacks(refs(1_000_000, calls));
    cb.onRepairConfirm(2 * REPAIR_COST_PER_DAMAGE_STAGE);
    cb.onConvenienceBuy('power_bank', 2000);
    expect(charged(calls)).toEqual([
      'scooterPhysics.repairVehicle',
      'delivery.recordRepairExpense',
      'delivery.recordConvenienceExpense',
      'hud.phoneMap.rechargeBatteryFull',
    ]);
  });
});
