import { FUEL_PRICE_PER_PERCENT } from '../../delivery/DeliveryManager';

export interface FuelModalHost {
  close(): void;
  /** Still the open modal (the pump finishes after a short delay) */
  isOpen(): boolean;
  onFuelTick(): void;
  onFuelComplete(addedPercent: number, cost: number): void;
}

/** Cost of filling the tank from `currentFuel` % (₩100 steps, at least ₩100) */
export function fullTankCost(currentFuel: number): { needed: number; cost: number } {
  const needed = Math.max(1, 100 - Math.round(currentFuel));
  return { needed, cost: Math.max(100, Math.round((needed * FUEL_PRICE_PER_PERCENT) / 100) * 100) };
}

/**
 * What the pump sells: a full tank when the wallet covers it, otherwise as many % as the wallet can pay for
 * (`partial`), nothing (`added` 0) when it can't buy even 1%. The cost never exceeds the wallet.
 */
export function fuelPurchase(currentFuel: number, wallet: number): { added: number; cost: number; partial: boolean } {
  const full = fullTankCost(currentFuel);
  if (wallet >= full.cost) return { added: full.needed, cost: full.cost, partial: false };
  const costOf = (pct: number) => Math.max(100, Math.round((pct * FUEL_PRICE_PER_PERCENT) / 100) * 100);
  let pct = Math.min(full.needed - 1, Math.floor(Math.max(0, wallet) / FUEL_PRICE_PER_PERCENT));
  while (pct > 0 && costOf(pct) > wallet) pct--;
  return pct > 0 ? { added: pct, cost: costOf(pct), partial: true } : { added: 0, cost: 0, partial: true };
}

const PUMP_STEPS = 16;
const PUMP_STEP_MS = 95;

/** Gas station pump: shows the fill-up price, then animates the tank to 100% and pays */
export class FuelModal {
  private readonly backdrop = document.getElementById('fuel-modal')!;
  private readonly pctEl = document.getElementById('fuel-modal-pct')!;
  private readonly barEl = document.getElementById('fuel-modal-bar')!;
  private readonly statusEl = document.getElementById('fuel-modal-status')!;
  private readonly costEl = document.getElementById('fuel-modal-cost')!;
  private readonly startBtn = document.getElementById('fuel-start-btn') as HTMLButtonElement;
  private startPct = 100;
  private added = 0;
  private cost = 0;
  private timer: number | null = null;
  /** Pumping: the modal can't be closed until it finishes */
  public isFueling = false;

  constructor(private readonly host: FuelModalHost) {
    this.backdrop.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target === this.backdrop && !this.isFueling) {
        host.close();
        return;
      }
      const btn = target.closest('button') as HTMLButtonElement | null;
      if (!btn) return;
      if (btn.dataset.action === 'close' && !this.isFueling) host.close();
      else if (btn.dataset.action === 'start_fuel') this.begin();
    });
  }

  /** `wallet`: what the rider can pay (short of a full tank the pump sells only what the wallet covers) */
  public open(currentFuel: number, wallet = Infinity): void {
    this.isFueling = false;
    this.startPct = Math.round(currentFuel);
    const buy = fuelPurchase(currentFuel, wallet);
    this.added = buy.added;
    this.cost = buy.cost;
    this.setLevel(this.startPct);
    this.costEl.textContent = `₩${buy.cost.toLocaleString()}`;
    if (buy.added === 0) {
      this.statusEl.textContent = `💳 지갑 잔액이 부족해요 (1% = ₩${FUEL_PRICE_PER_PERCENT} · 최소 ₩100)`;
      this.startBtn.disabled = true;
      this.startBtn.textContent = '💳 잔액 부족';
    } else if (buy.partial) {
      this.statusEl.textContent = `지갑 잔액만큼 +${buy.added}% 주유 (가득 주유엔 ₩${fullTankCost(currentFuel).cost.toLocaleString()} 필요)`;
      this.startBtn.disabled = false;
      this.startBtn.textContent = `⛽ 잔액만큼 주유 +${buy.added}% (E / Enter)`;
    } else {
      this.statusEl.textContent = `가득 주유 시 +${buy.added}% 보충 (₩${FUEL_PRICE_PER_PERCENT} / 1%)`;
      this.startBtn.disabled = false;
      this.startBtn.textContent = '⛽ 가득 주유 시작 (E / Enter)';
    }
    this.backdrop.classList.remove('hidden');
  }

  /** Stops a running pump and hides the modal */
  public hide(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.isFueling = false;
    this.backdrop.classList.add('hidden');
  }

  public begin(): void {
    if (this.isFueling || this.added <= 0) return;
    this.isFueling = true;
    this.startBtn.disabled = true;
    this.startBtn.textContent = '⛽ 주유 중...';
    this.statusEl.textContent = '연료를 주입하고 있습니다...';

    const startPct = this.startPct;
    const totalNeeded = this.added;
    const totalCost = this.cost;
    let step = 0;
    this.timer = window.setInterval(() => {
      step++;
      this.setLevel(Math.round(startPct + totalNeeded * Math.min(1, step / PUMP_STEPS)));
      if (step % 3 === 1 && step < PUMP_STEPS) this.host.onFuelTick();
      if (step < PUMP_STEPS) return;

      if (this.timer !== null) {
        window.clearInterval(this.timer);
        this.timer = null;
      }
      this.statusEl.textContent =
        startPct + totalNeeded >= 100
          ? '💳 결제가 완료되었습니다! (100% 가득 주유 완료)'
          : `💳 결제가 완료되었습니다! (+${totalNeeded}% · ${startPct + totalNeeded}%)`;
      this.startBtn.textContent = '✓ 결제 완료';
      this.host.onFuelComplete(totalNeeded, totalCost);
      window.setTimeout(() => {
        this.isFueling = false;
        if (this.host.isOpen()) this.host.close();
      }, 720);
    }, PUMP_STEP_MS);
  }

  private setLevel(pct: number): void {
    this.pctEl.textContent = `${pct}%`;
    this.barEl.style.width = `${pct}%`;
  }
}
