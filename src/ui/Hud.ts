import { PlayerState } from '../player/PlayerController';
import { DemandPhase } from '../game/GameClock';
import { ScooterState } from '../vehicle/ScooterPhysics';
import { CityMapInfo } from '../world/CityWorld';
import {
  CustomerChatEvent,
  DeliveryManager,
  NavigationPlan,
} from '../delivery/DeliveryManager';
import { DispatchOffer } from '../delivery/OrderDispatchManager';
import { SignalStateSnapshot } from '../world/TrafficSystem';
import { PhoneCallbacks, PhoneMap, PhonePlacement } from './PhoneMap';
import { WeatherMode } from '../types';
import { SpeedCameraTriggerEvent } from '../world/RoadHazardManager';
import { ElevatorPhase } from '../world/CorridorRoom';

export interface InteractionContext {
  /** Nearest gas station while fuel is low (null otherwise) */
  nearestGas: { name: string; dist: number } | null;
  nearCargoBox: boolean;
  nearGasPump: boolean;
  scooterOnGasPad: boolean;
  nearRepairShop: boolean;
  scooterOnRepairPad: boolean;
  nearConvenienceStore: boolean;
  nearCorridorTargetDoor: boolean;
  nearCorridorElevator: boolean;
  insideElevatorCabin: boolean;
  elevatorPhase: ElevatorPhase;
  elevatorCurrentFloor: number;
  elevatorTargetFloor: number;
  elevatorDoorsOpen: boolean;
  isVillaCorridor: boolean;
  villaCurrentFloor: number;
  visorWetHint: boolean;
  modalOpen: boolean;
}

import {
  showToast as showToastFn,
  showAccidentBanner as showAccidentBannerFn,
  triggerSpeedCameraFlash as triggerSpeedCameraFlashFn,
  showFineTicketPopup as showFineTicketPopupFn,
  hideFineTicketPopup as hideFineTicketPopupFn,
  showCustomerChatPopup as showCustomerChatPopupFn,
  hideCustomerChatPopup as hideCustomerChatPopupFn,
} from './hud/hudPopups';
import {
  computePrompt as computePromptFn,
} from './hud/hudPrompt';

import { syncMissionHud, syncRidingCluster, syncRidingWarning, syncStatusPills } from './hud/hudStatus';

export class Hud {
  /** @internal hud/* */
  readonly modeBadge = document.getElementById('mode-badge')!;
  /** @internal hud/* */
  readonly tierBadge = document.getElementById('tier-badge')!;
  /** @internal hud/* */
  readonly ratingBadge = document.getElementById('rating-badge')!;
  /** @internal hud/* */
  readonly buffBadge = document.getElementById('buff-badge')!;
  /** @internal hud/* */
  readonly weatherBadge = document.getElementById('weather-badge')!;
  private readonly clockBadge = document.getElementById('clock-badge')!;
  private lastClockText = '';
  private readonly helpPanel = document.getElementById('help-panel')!;
  private readonly toggleHelpBtn = document.getElementById('toggle-help-btn')!;

  private readonly interactPrompt = document.getElementById('interact-prompt')!;
  /** @internal hud/* */
  readonly slipWarningEl = document.getElementById('slip-warning')!;
  /** @internal hud/* */
  readonly accidentBanner = document.getElementById('accident-banner')!;
  /** @internal hud/* */
  readonly accidentBannerDetail = document.getElementById('accident-banner-detail')!;
  /** @internal hud/* */
  readonly speedCamFlash = document.getElementById('speed-cam-flash')!;
  /** @internal hud/* */
  readonly fineTicketEl = document.getElementById('fine-ticket-popup')!;
  private readonly ftCloseBtn = document.getElementById('ft-close-btn')!;
  /** @internal hud/* */
  readonly ftViolationEl = document.getElementById('ft-violation')!;
  /** @internal hud/* */
  readonly ftLocationEl = document.getElementById('ft-location')!;
  /** @internal hud/* */
  readonly ftSpeedEl = document.getElementById('ft-speed')!;
  /** @internal hud/* */
  readonly ftTimeEl = document.getElementById('ft-time')!;
  /** @internal hud/* */
  readonly ftAmountEl = document.getElementById('ft-amount')!;
  /** @internal hud/* */
  readonly chatPopupEl = document.getElementById('customer-chat-popup')!;
  /** @internal hud/* */
  readonly ccSenderEl = document.getElementById('cc-sender')!;
  /** @internal hud/* */
  readonly ccTitleEl = document.getElementById('cc-title')!;
  /** @internal hud/* */
  readonly ccMessageEl = document.getElementById('cc-message')!;
  /** @internal hud/* */
  readonly ccEffectEl = document.getElementById('cc-effect')!;
  private readonly ccCloseBtn = document.getElementById('cc-close-btn')!;
  /** @internal hud/* */
  readonly villaStairHud = document.getElementById('villa-stair-hud')!;
  /** @internal hud/* */
  readonly vsFloorText = document.getElementById('vs-floor-text')!;
  /** @internal hud/* */
  readonly vsStaminaVal = document.getElementById('vs-stamina-val')!;
  /** @internal hud/* */
  readonly vsStaminaFill = document.getElementById('vs-stamina-fill')!;
  /** @internal hud/* */
  readonly visorWipeHint = document.getElementById('visor-wipe-hint')!;
  /** @internal hud/* */
  readonly toast = document.getElementById('toast')!;
  /** @internal hud/* */
  readonly cookingHudBar = document.getElementById('cooking-hud-bar')!;
  /** @internal hud/* */
  readonly cookingHudTitle = document.getElementById('cooking-hud-title')!;
  /** @internal hud/* */
  readonly cookingHudSub = document.getElementById('cooking-hud-sub')!;
  /** @internal hud/* */
  readonly cookingHudFill = document.getElementById('cooking-hud-fill')!;

  private readonly ridingCluster = document.getElementById('riding-cluster')!;
  /** @internal hud/* */
  readonly speedVal = document.getElementById('speed-val')!;
  /** @internal hud/* */
  readonly leanVal = document.getElementById('lean-val')!;
  /** @internal hud/* */
  readonly leanBar = document.getElementById('lean-bar')!;
  /** @internal hud/* */
  readonly fuelVal = document.getElementById('fuel-val')!;
  /** @internal hud/* */
  readonly fuelBar = document.getElementById('fuel-bar')!;
  /** @internal hud/* */
  readonly damageBadge = document.getElementById('damage-badge')!;

  /** @internal hud/* */
  readonly indLeft = document.getElementById('ind-left')!;
  /** @internal hud/* */
  readonly indRight = document.getElementById('ind-right')!;
  /** @internal hud/* */
  readonly indLight = document.getElementById('ind-light')!;
  /** @internal hud/* */
  readonly indTime = document.getElementById('ind-time')!;
  /** @internal hud/* */
  readonly indAudio = document.getElementById('ind-audio')!;

  public readonly phoneMap: PhoneMap;
  /** @internal hud/* */
  toastTimer: number | null = null;
  /** @internal hud/* */
  accidentBannerTimer: number | null = null;
  /** @internal hud/* */
  fineTicketTimer: number | null = null;
  /** @internal hud/* */
  chatPopupTimer: number | null = null;

  constructor(phoneCallbacks: PhoneCallbacks, onToggleWeather?: () => void) {
    this.phoneMap = new PhoneMap(phoneCallbacks);
    this.toggleHelpBtn.addEventListener('click', () => this.toggleHelp());
    this.ftCloseBtn.addEventListener('click', () => this.hideFineTicketPopup());
    this.ccCloseBtn.addEventListener('click', () => this.hideCustomerChatPopup());
    if (onToggleWeather) {
      this.weatherBadge.addEventListener('click', () => onToggleWeather());
    }
  }

  public toggleHelp(): void {
    this.helpPanel.classList.toggle('collapsed');
  }

  public togglePhonePlacement(
    isRiding: boolean,
    nearScooter: boolean
  ): { placement: PhonePlacement; anim?: 'mount' | 'unmount'; blocked?: boolean; message: string } {
    return this.phoneMap.toggleWithTab(isRiding, nearScooter);
  }

  public togglePhoneZoom(isRiding: boolean): { zoomed: boolean; message: string } {
    return this.phoneMap.toggleZoom(isRiding);
  }

  public stowPhoneToPocket(): void {
    this.phoneMap.setPlacement('pocket');
  }

  public showToast(message: string, durationMs = 2800): void {
    showToastFn(this, message, durationMs);
  }

  /** Displays prominent top emergency banner: "보행자 접촉 사고 발생!" */
  public showAccidentBanner(
    fine: number,
    ratingLoss: number,
    newRating: number,
    durationMs = 5500
  ): void {
    showAccidentBannerFn(this, fine, ratingLoss, newRating, durationMs);
  }

  /** Brief white strobe flash when caught by a roadside speed/red-light enforcement camera */
  public triggerSpeedCameraFlash(): void {
    triggerSpeedCameraFlashFn(this);
  }

  /** Displays non-blocking Korean Police Traffic Violation Ticket Notice Popup Card */
  public showFineTicketPopup(ev: SpeedCameraTriggerEvent, durationMs = 6200): void {
    showFineTicketPopupFn(this, ev, durationMs);
  }

  public hideFineTicketPopup(): void {
    hideFineTicketPopupFn(this);
  }

  /** Displays non-blocking Korean Messenger Customer Chat Event Popup */
  public showCustomerChatPopup(ev: CustomerChatEvent, durationMs = 6800): void {
    showCustomerChatPopupFn(this, ev, durationMs);
  }

  public hideCustomerChatPopup(): void {
    hideCustomerChatPopupFn(this);
  }

  /** Briefly pulses the clock pill (a lunch / dinner rush just started) */
  public flashClock(): void {
    this.clockBadge.classList.remove('flash');
    void this.clockBadge.offsetWidth;
    this.clockBadge.classList.add('flash');
    window.setTimeout(() => this.clockBadge.classList.remove('flash'), 2600);
  }

  /** Game clock pill (time + demand phase) and the smartphone status-bar clock */
  public setClock(label: string, phase: DemandPhase, day: number, seasonEmoji = ''): void {
    const dayText = seasonEmoji ? `${seasonEmoji} ${day}일차` : `${day}일차`;
    const text = phase.isPeak
      ? `${dayText} 🕐 ${label} · ${phase.emoji} ${phase.label} +₩${phase.peakBonus.toLocaleString()}`
      : `${dayText} 🕐 ${label} · ${phase.emoji} ${phase.label}`;
    this.phoneMap.clockLabel = label;
    if (text === this.lastClockText) return;
    this.lastClockText = text;
    this.clockBadge.textContent = text;
    const flashing = this.clockBadge.classList.contains('flash');
    this.clockBadge.className = phase.isPeak ? 'clock-pill peak' : phase.id === 'dawn' || phase.id === 'evening' ? 'clock-pill night' : 'clock-pill';
    if (flashing) this.clockBadge.classList.add('flash');
  }

  public update(
    player: PlayerState,
    scooter: ScooterState,
    delivery: DeliveryManager,
    activeOffer: DispatchOffer | null,
    navPlan: NavigationPlan,
    signalState: SignalStateSnapshot,
    isNight: boolean,
    weatherMode: WeatherMode,
    isMuted: boolean,
    elapsedTime: number,
    mapInfo: CityMapInfo,
    ctx: InteractionContext
  ): void {
    const isRiding = player.mode === 'riding';

    syncStatusPills(this, player, scooter, delivery, weatherMode, ctx);

    syncMissionHud(this, player, delivery, ctx);

    this.ridingCluster.classList.toggle('hidden', !isRiding);
    syncRidingWarning(this, player, scooter, delivery, ctx);

    const promptHtml = computePromptFn(player, scooter, delivery, navPlan, ctx);
    if (promptHtml && !ctx.modalOpen) {
      this.interactPrompt.innerHTML = promptHtml;
      this.interactPrompt.classList.remove('hidden');
    } else {
      this.interactPrompt.classList.add('hidden');
    }

    if (isRiding) syncRidingCluster(this, scooter, ctx, elapsedTime, isNight, isMuted);

    this.phoneMap.update(
      player,
      scooter,
      delivery,
      activeOffer,
      navPlan,
      signalState,
      isNight,
      elapsedTime,
      mapInfo
    );
  }

}
