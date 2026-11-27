/** Phone battery: drain by use, wireless charging on the handlebar mount, low / dead warnings */
import type { PhoneMap } from '../PhoneMap';
import { clamp } from '../../types';

/**
 * Steps realistic smartphone battery drain (on-foot/zoomed) and handlebar-mount wireless charging!
 * Mounting phone (`Tab`) with scooter engine ON rapidly recharges via wireless charging dock.
 */
export function stepBattery(
  host: PhoneMap,
  dt: number,
  scooterEngineOn: boolean,
  onWirelessChargeStart?: () => void,
  onLowBattery?: () => void,
  onBatteryDead?: () => void,
  chargeSpeedMul = 1.0,
): void {
  const clampedDt = Math.min(dt, 0.05);
  const chargingNow = host.placement === 'mounted' && scooterEngineOn;

  if (chargingNow && !host.isWirelessCharging && host.battery < 99.5) {
    onWirelessChargeStart?.();
  }
  host.isWirelessCharging = chargingNow;

  if (chargingNow) {
    host.battery = clamp(host.battery + 4.4 * chargeSpeedMul * clampedDt, 0, 100);
    if (host.battery > 18) host.lowBatteryWarned = false;
    if (host.battery > 3) host.deadBatteryWarned = false;
  } else {
    const drainRate = host.isZoomed ? 0.85 : host.placement === 'in_hand' ? 0.52 : 0.14;
    host.battery = clamp(host.battery - drainRate * clampedDt, 0, 100);
  }

  if (host.battery <= 15 && host.battery > 0 && !host.lowBatteryWarned && !chargingNow) {
    host.lowBatteryWarned = true;
    onLowBattery?.();
  }
  if (host.battery <= 0.05 && !host.deadBatteryWarned && !chargingNow) {
    host.deadBatteryWarned = true;
    onBatteryDead?.();
  }

  // Sync zoomed smartphone status bar & depleted lock overlay
  const pct = Math.round(host.battery);
  host.battPctEl.textContent = chargingNow ? `⚡${pct}%` : `${pct}%`;
  host.battFillEl.style.width = `${Math.max(4, pct)}%`;
  host.battWrapEl.classList.toggle('charging', chargingNow);
  host.battWrapEl.classList.toggle('low', !chargingNow && pct <= 15);
  host.deadOverlayEl.classList.toggle('hidden', host.battery > 0.05);
}

export function rechargeBatteryFull(host: PhoneMap): void {
  host.battery = 100;
  host.lowBatteryWarned = false;
  host.deadBatteryWarned = false;
  host.last3DRenderTime = -1;
  host.lastZoomMapRenderTime = -1;
}
