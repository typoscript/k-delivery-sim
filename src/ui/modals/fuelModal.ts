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

  public open(currentFuel: number): void {
    this.isFueling = false;
    this.startPct = Math.round(currentFuel);
    const { needed, cost } = fullTankCost(currentFuel);
    this.cost = cost;
    this.setLevel(this.startPct);
    this.statusEl.textContent = `가득 주유 시 +${needed}% 보충 (₩${FUEL_PRICE_PER_PERCENT} / 1%)`;
    this.costEl.textContent = `₩${cost.toLocaleString()}`;
    this.startBtn.disabled = false;
    this.startBtn.textContent = '⛽ 가득 주유 시작 (E / Enter)';
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
    if (this.isFueling) return;
    this.isFueling = true;
    this.startBtn.disabled = true;
    this.startBtn.textContent = '⛽ 주유 중...';
    this.statusEl.textContent = '연료를 주입하고 있습니다...';

    const startPct = this.startPct;
    const totalNeeded = Math.max(1, 100 - startPct);
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
      this.statusEl.textContent = '💳 결제가 완료되었습니다! (100% 가득 주유 완료)';
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
