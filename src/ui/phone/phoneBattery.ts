/** Phone battery: drain by use, wireless charging on the handlebar mount, low / dead warnings */
import type { PhoneMap } from '../PhoneMap';
import { clamp } from '../../types';
import type { PhoneApp } from './weatherApp';
import type { PhonePlacement } from './types';

/**
 * How hard each app works the phone while it is out: the delivery app runs GPS + the live map, the others are light
 * screens (in the pocket only background GPS runs)
 */
export const APP_DRAIN_MUL: Record<PhoneApp, number> = { delivery: 1, weather: 0.45, messenger: 0.5, bank: 0.4 };
/** At or below this the phone goes into power saving (slower drain, slower screen refresh) */
export const POWER_SAVE_PCT = 15;
export const POWER_SAVE_DRAIN_MUL = 0.6;

/** Battery drain (% per second) for how the phone is used */
export function batteryDrainRate(
  placement: PhonePlacement,
  zoomed: boolean,
  app: PhoneApp,
  powerSave: boolean,
): number {
  const base = zoomed ? 0.85 : placement === 'in_hand' ? 0.52 : 0.14;
  const appMul = placement === 'pocket' && !zoomed ? 1 : APP_DRAIN_MUL[app];
  return base * appMul * (powerSave ? POWER_SAVE_DRAIN_MUL : 1);
}

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
    const drainRate = batteryDrainRate(host.placement, host.isZoomed, host.app, host.powerSave);
    host.battery = clamp(host.battery - drainRate * clampedDt, 0, 100);
  }

  // power saving below 15% (until charged back above it)
  const saving = !chargingNow && host.battery <= POWER_SAVE_PCT && host.battery > 0;
  if (saving !== host.powerSave) {
    host.powerSave = saving;
    host.phoneEl.classList.toggle('power-save', saving);
  }
  if (host.battery <= POWER_SAVE_PCT && host.battery > 0 && !host.lowBatteryWarned && !chargingNow) {
    host.lowBatteryWarned = true;
    host.notify(
      '🪫',
      '배터리',
      `배터리 ${Math.round(host.battery)}% · 절전 모드 켜짐 (화면 어둡게·갱신 느리게). 날씨·뱅크·메신저 앱은 지도보다 배터리를 덜 써요 · 거치대에 꽂으면 충전`,
    );
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
