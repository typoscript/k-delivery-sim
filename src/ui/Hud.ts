import { PlayerState } from '../player/PlayerController';
import { DemandPhase } from '../game/GameClock';
import { ScooterState } from '../vehicle/ScooterPhysics';
import { SCOOTER_MODELS } from '../vehicle/ScooterModels';
import { CityMapInfo } from '../world/CityWorld';
import {
  CARGO_SLOT_COUNT,
  CustomerChatEvent,
  DeliveryManager,
  MAX_CONCURRENT_ORDERS,
  NavigationPlan,
} from '../delivery/DeliveryManager';
import { DispatchOffer } from '../delivery/OrderDispatchManager';
import { SignalStateSnapshot } from '../world/TrafficSystem';
import { PhoneCallbacks, PhoneMap, PhonePlacement } from './PhoneMap';
import { WeatherMode } from '../types';
import { SpeedCameraTriggerEvent } from '../world/RoadHazardManager';
import { ElevatorPhase } from '../world/CorridorRoom';

export interface InteractionContext {
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

export class Hud {
  private readonly modeBadge = document.getElementById('mode-badge')!;
  private readonly tierBadge = document.getElementById('tier-badge')!;
  private readonly ratingBadge = document.getElementById('rating-badge')!;
  private readonly buffBadge = document.getElementById('buff-badge')!;
  private readonly weatherBadge = document.getElementById('weather-badge')!;
  private readonly clockBadge = document.getElementById('clock-badge')!;
  private lastClockText = '';
  private readonly helpPanel = document.getElementById('help-panel')!;
  private readonly toggleHelpBtn = document.getElementById('toggle-help-btn')!;

  private readonly interactPrompt = document.getElementById('interact-prompt')!;
  private readonly slipWarningEl = document.getElementById('slip-warning')!;
  private readonly accidentBanner = document.getElementById('accident-banner')!;
  private readonly accidentBannerDetail = document.getElementById('accident-banner-detail')!;
  private readonly speedCamFlash = document.getElementById('speed-cam-flash')!;
  private readonly fineTicketEl = document.getElementById('fine-ticket-popup')!;
  private readonly ftCloseBtn = document.getElementById('ft-close-btn')!;
  private readonly ftViolationEl = document.getElementById('ft-violation')!;
  private readonly ftLocationEl = document.getElementById('ft-location')!;
  private readonly ftSpeedEl = document.getElementById('ft-speed')!;
  private readonly ftTimeEl = document.getElementById('ft-time')!;
  private readonly ftAmountEl = document.getElementById('ft-amount')!;
  private readonly chatPopupEl = document.getElementById('customer-chat-popup')!;
  private readonly ccSenderEl = document.getElementById('cc-sender')!;
  private readonly ccTitleEl = document.getElementById('cc-title')!;
  private readonly ccMessageEl = document.getElementById('cc-message')!;
  private readonly ccEffectEl = document.getElementById('cc-effect')!;
  private readonly ccCloseBtn = document.getElementById('cc-close-btn')!;
  private readonly villaStairHud = document.getElementById('villa-stair-hud')!;
  private readonly vsFloorText = document.getElementById('vs-floor-text')!;
  private readonly vsStaminaVal = document.getElementById('vs-stamina-val')!;
  private readonly vsStaminaFill = document.getElementById('vs-stamina-fill')!;
  private readonly visorWipeHint = document.getElementById('visor-wipe-hint')!;
  private readonly toast = document.getElementById('toast')!;
  private readonly cookingHudBar = document.getElementById('cooking-hud-bar')!;
  private readonly cookingHudTitle = document.getElementById('cooking-hud-title')!;
  private readonly cookingHudSub = document.getElementById('cooking-hud-sub')!;
  private readonly cookingHudFill = document.getElementById('cooking-hud-fill')!;

  private readonly ridingCluster = document.getElementById('riding-cluster')!;
  private readonly speedVal = document.getElementById('speed-val')!;
  private readonly leanVal = document.getElementById('lean-val')!;
  private readonly leanBar = document.getElementById('lean-bar')!;
  private readonly fuelVal = document.getElementById('fuel-val')!;
  private readonly fuelBar = document.getElementById('fuel-bar')!;
  private readonly damageBadge = document.getElementById('damage-badge')!;

  private readonly indLeft = document.getElementById('ind-left')!;
  private readonly indRight = document.getElementById('ind-right')!;
  private readonly indLight = document.getElementById('ind-light')!;
  private readonly indTime = document.getElementById('ind-time')!;
  private readonly indAudio = document.getElementById('ind-audio')!;

  public readonly phoneMap: PhoneMap;
  private toastTimer: number | null = null;
  private accidentBannerTimer: number | null = null;
  private fineTicketTimer: number | null = null;
  private chatPopupTimer: number | null = null;

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
    this.toast.textContent = message;
    this.toast.classList.remove('hidden');
    if (this.toastTimer !== null) {
      window.clearTimeout(this.toastTimer);
    }
    this.toastTimer = window.setTimeout(() => {
      this.toast.classList.add('hidden');
      this.toastTimer = null;
    }, durationMs);
  }

  /** Displays prominent top emergency banner: "보행자 접촉 사고 발생!" */
  public showAccidentBanner(
    fine: number,
    ratingLoss: number,
    newRating: number,
    durationMs = 5500
  ): void {
    this.accidentBannerDetail.textContent = `과태료·합의금 -₩${fine.toLocaleString()} 즉시 차감 · 기사 신뢰 평점 -${ratingLoss.toFixed(1)}점 (현재 ★ ${newRating.toFixed(1)})`;
    this.accidentBanner.classList.remove('hidden');
    if (this.accidentBannerTimer !== null) {
      window.clearTimeout(this.accidentBannerTimer);
    }
    this.accidentBannerTimer = window.setTimeout(() => {
      this.accidentBanner.classList.add('hidden');
      this.accidentBannerTimer = null;
    }, durationMs);
  }

  /** Brief white strobe flash when caught by a roadside speed/red-light enforcement camera */
  public triggerSpeedCameraFlash(): void {
    this.speedCamFlash.classList.remove('hidden', 'active');
    void this.speedCamFlash.offsetWidth;
    this.speedCamFlash.classList.add('active');
    window.setTimeout(() => {
      this.speedCamFlash.classList.remove('active');
      this.speedCamFlash.classList.add('hidden');
    }, 390);
  }

  /** Displays non-blocking Korean Police Traffic Violation Ticket Notice Popup Card */
  public showFineTicketPopup(ev: SpeedCameraTriggerEvent, durationMs = 6200): void {
    const now = new Date();
    const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    this.ftViolationEl.textContent =
      ev.kind === 'patrol_speeding'
        ? `🚓 순찰차 현장 과속 단속 (제한 ${ev.limitKmh}km/h 초과)`
        : ev.kind === 'red_light'
          ? '📸 무인 신호위반 단속 카메라 적발'
          : `📸 무인 과속 단속 (제한 ${ev.limitKmh}km/h 초과)`;
    this.ftLocationEl.textContent = ev.label;
    this.ftSpeedEl.textContent = `${ev.measuredKmh} km/h (제한 ${ev.limitKmh})`;
    this.ftTimeEl.textContent = ts;
    this.ftAmountEl.textContent = `-₩${ev.fine.toLocaleString()}`;

    this.fineTicketEl.classList.remove('hidden');
    if (this.fineTicketTimer !== null) {
      window.clearTimeout(this.fineTicketTimer);
    }
    this.fineTicketTimer = window.setTimeout(() => {
      this.hideFineTicketPopup();
    }, durationMs);
  }

  public hideFineTicketPopup(): void {
    this.fineTicketEl.classList.add('hidden');
    if (this.fineTicketTimer !== null) {
      window.clearTimeout(this.fineTicketTimer);
      this.fineTicketTimer = null;
    }
  }

  /** Displays non-blocking Korean Messenger Customer Chat Event Popup */
  public showCustomerChatPopup(ev: CustomerChatEvent, durationMs = 6800): void {
    this.ccSenderEl.textContent = `💬 고객 메시지 · #${ev.orderNumber} (${ev.customerName})`;
    this.ccTitleEl.textContent = ev.title;
    this.ccMessageEl.textContent = ev.message;
    this.ccEffectEl.textContent = ev.effectBadge;
    this.chatPopupEl.classList.remove('hidden');

    if (this.chatPopupTimer !== null) {
      window.clearTimeout(this.chatPopupTimer);
    }
    this.chatPopupTimer = window.setTimeout(() => {
      this.hideCustomerChatPopup();
    }, durationMs);
  }

  public hideCustomerChatPopup(): void {
    this.chatPopupEl.classList.add('hidden');
    if (this.chatPopupTimer !== null) {
      window.clearTimeout(this.chatPopupTimer);
      this.chatPopupTimer = null;
    }
  }

  /** Briefly pulses the clock pill (a lunch / dinner rush just started) */
  public flashClock(): void {
    this.clockBadge.classList.remove('flash');
    void this.clockBadge.offsetWidth;
    this.clockBadge.classList.add('flash');
    window.setTimeout(() => this.clockBadge.classList.remove('flash'), 2600);
  }

  /** Game clock pill (time + demand phase) and the smartphone status-bar clock */
  public setClock(label: string, phase: DemandPhase, day: number): void {
    const text = phase.isPeak
      ? `${day}일차 🕐 ${label} · ${phase.emoji} ${phase.label} +₩${phase.peakBonus.toLocaleString()}`
      : `${day}일차 🕐 ${label} · ${phase.emoji} ${phase.label}`;
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

    // Update Rider Career Tier & Persistent Wallet Pill
    const tier = delivery.getCurrentTier();
    const shortTier = tier.name.replace(' 라이더', '');
    this.tierBadge.textContent = `${tier.icon} ${shortTier} · ₩${delivery.totalEarnings.toLocaleString()}`;
    this.tierBadge.style.borderColor = tier.color;
    this.tierBadge.title = `${tier.icon} ${tier.name} (누적 ${delivery.lifetimeCompleted}건 · 건당 보너스 +₩${tier.bonusPerDelivery.toLocaleString()})`;

    // Update Rider Trust Rating badge (★ 5.0 -> drops -1.0 per pedestrian accident)
    const rating = delivery.riderRating;
    const rep = delivery.getReputation();
    this.ratingBadge.textContent = `★ ${rating.toFixed(1)} · ${rep.icon}`;
    this.ratingBadge.title = `신뢰 평점 ${rating.toFixed(1)} · 최근 별점 ${rep.recentStars ?? '-'} → ${rep.label}: ${rep.description}`;
    this.ratingBadge.className =
      rating <= 2.5 ? 'rating-pill danger' : rating < 4.5 ? 'rating-pill warn' : 'rating-pill';

    // Update convenience store beverage buff pill (Energy Drink / Iced Coffee)
    if (player.energyBuffTimer > 0) {
      this.buffBadge.textContent = `⚡ 에너지 ${Math.ceil(player.energyBuffTimer)}s`;
      this.buffBadge.classList.remove('hidden');
    } else if (player.coffeeBuffTimer > 0) {
      this.buffBadge.textContent = `☕ 카페인 ${Math.ceil(player.coffeeBuffTimer)}s`;
      this.buffBadge.classList.remove('hidden');
    } else {
      this.buffBadge.classList.add('hidden');
    }

    // Update top-left weather pill
    if (weatherMode === 'rain') {
      this.weatherBadge.textContent = '🌧️ 비 · 할증+₩1,500';
      this.weatherBadge.className = 'weather-pill rain';
    } else if (weatherMode === 'cloudy') {
      this.weatherBadge.textContent = '☁️ 흐림';
      this.weatherBadge.className = 'weather-pill cloudy';
    } else {
      this.weatherBadge.textContent = '☀️ 맑음';
      this.weatherBadge.className = 'weather-pill clear';
    }
    const carrying = delivery.getCarryingMission();
    const corridorM = delivery.getCorridorMission();
    const loadedCount = delivery.getLoadedCargoCount();
    const activeCount = delivery.activeMissions.length;

    if (player.inCorridor) {
      const unit = corridorM?.order.unitNumber ?? '';
      const ordNo = corridorM ? `#${corridorM.order.orderNumber} ` : '';
      if (ctx.isVillaCorridor) {
        this.modeBadge.textContent = `🏠 원룸·빌라 계단 ${ctx.villaCurrentFloor}F (${ordNo}${unit})`;
      } else if (ctx.insideElevatorCabin) {
        const dir =
          ctx.elevatorPhase === 'moving_up'
            ? '▲ '
            : ctx.elevatorPhase === 'moving_down'
              ? '▼ '
              : '';
        this.modeBadge.textContent = `🛗 엘리베이터 ${dir}${ctx.elevatorCurrentFloor}F (목표 ${ctx.elevatorTargetFloor}F)`;
      } else {
        this.modeBadge.textContent = `🏢 아파트 ${ctx.elevatorCurrentFloor}F 복도 (${ordNo}${unit})`;
      }
      this.modeBadge.className = 'mode-pill foot';
    } else if (player.mode === 'knockdown') {
      this.modeBadge.textContent = '💥 전도! 일어나는 중';
      this.modeBadge.className = 'mode-pill danger';
    } else if (isRiding) {
      const bikeSpec = SCOOTER_MODELS[scooter.modelId];
      this.modeBadge.textContent =
        loadedCount > 0
          ? `${bikeSpec.icon} ${bikeSpec.shortBadge} · 📦 배달통 ${loadedCount}/${CARGO_SLOT_COUNT}칸`
          : activeCount > 0
            ? `${bikeSpec.icon} ${bikeSpec.shortBadge} · 묶음 ${activeCount}/${MAX_CONCURRENT_ORDERS}건`
            : `${bikeSpec.icon} ${bikeSpec.shortBadge} 라이딩`;
      this.modeBadge.className = 'mode-pill riding';
    } else if (carrying) {
      this.modeBadge.textContent = `🛍️ 도보 · [#${carrying.order.orderNumber}] 음식 휴대 중`;
      this.modeBadge.className = 'mode-pill riding';
    } else if (activeCount > 0) {
      this.modeBadge.textContent = `🚶 도보 · 묶음 ${activeCount}/${MAX_CONCURRENT_ORDERS} (적재 ${loadedCount})`;
      this.modeBadge.className = 'mode-pill foot';
    } else {
      this.modeBadge.textContent = '🚶 1인칭 도보';
      this.modeBadge.className = 'mode-pill foot';
    }

    // Top HUD Yellow Cooking Delay Countdown Gauge (visible outdoors & non-blocking!)
    const cookM = !player.inCorridor ? delivery.getPrimaryCookingMission() : null;
    if (cookM) {
      this.cookingHudBar.classList.remove('hidden');
      if (cookM.phase === 'cooking_wait') {
        const rem = Math.max(1, Math.ceil(cookM.cookingRemainingSec));
        const pct =
          cookM.cookingDurationSec > 0
            ? Math.max(0, Math.min(100, (cookM.cookingRemainingSec / cookM.cookingDurationSec) * 100))
            : 0;
        this.cookingHudBar.classList.remove('ready');
        this.cookingHudTitle.textContent = `🍳 ${cookM.order.shop.name} [#${cookM.order.orderNumber}] 조리 중 (남은 시간: ${rem}초)`;
        this.cookingHudSub.textContent = '이동·탑승(F)·폰(Tab/V) 자유 조작';
        this.cookingHudFill.style.width = `${pct.toFixed(1)}%`;
      } else {
        this.cookingHudBar.classList.add('ready');
        this.cookingHudTitle.textContent = `🔔 ${cookM.order.shop.name} [#${cookM.order.orderNumber}] 음식이 준비되었습니다!`;
        this.cookingHudSub.textContent = '픽업대 트레이 [E] 수령';
        this.cookingHudFill.style.width = '100%';
      }
    } else {
      this.cookingHudBar.classList.add('hidden');
    }

    // Walk-up Villa Stairwell Floor & Stamina HUD
    if (player.inCorridor && ctx.isVillaCorridor && corridorM) {
      this.villaStairHud.classList.remove('hidden');
      const stPct = Math.round(player.stamina);
      this.vsFloorText.textContent =
        corridorM.phase === 'corridor_exit'
          ? `🏠 원룸·빌라 ${ctx.villaCurrentFloor}F · 1F 출구로 하강`
          : `🏠 원룸·빌라 ${ctx.villaCurrentFloor}F · 목표 ${corridorM.order.unitNumber}`;
      this.vsStaminaVal.textContent = stPct < 20 ? `😮‍💨 숨참 (${stPct}%)` : `체력 ${stPct}%`;
      this.vsStaminaFill.style.width = `${stPct}%`;
      this.vsStaminaFill.className =
        stPct < 25 ? 'vs-fill danger' : stPct < 55 ? 'vs-fill warn' : 'vs-fill';
    } else {
      this.villaStairHud.classList.add('hidden');
    }

    // Rainy Helmet Visor Wipe Hint Chip ([G] to wipe visor)
    this.visorWipeHint.classList.toggle('hidden', !ctx.visorWetHint || ctx.modalOpen || player.inCorridor);

    this.ridingCluster.classList.toggle('hidden', !isRiding);
    const showSlip =
      isRiding &&
      (scooter.outOfFuel ||
        scooter.slipWarning ||
        scooter.wetSlipWarning !== 'none' ||
        delivery.activeSpillWarning);
    if (showSlip) {
      if (scooter.outOfFuel) {
        this.slipWarningEl.textContent =
          SCOOTER_MODELS[scooter.modelId].isElectric
            ? '⚡ EV 배터리 방전! 하차(F) 후 K-오일 충전소에서 급속 충전하세요!'
            : '⛽ 연료 고갈! 가속 불가 — 하차(F) 후 K-오일 주유소에서 주유하세요!';
      } else if (scooter.wetSlipWarning === 'manhole') {
        this.slipWarningEl.textContent =
          '⚠ 빗길 금속 맨홀 뚜껑! 브레이크·급회전 시 접지력 상실로 전도됩니다!';
      } else if (scooter.wetSlipWarning === 'crosswalk_paint') {
        this.slipWarningEl.textContent =
          '⚠ 빗길 횡단보도 페인트선! 감속·직진 통과하지 않으면 미끄러집니다!';
      } else if (scooter.slipWarning) {
        this.slipWarningEl.textContent = '⚠ 코너 기울기 과다! 감속하지 않으면 넘어집니다!';
      } else {
        this.slipWarningEl.textContent =
          '🍲 국물·음료 출렁임 주의! 코너 감속·급제동을 줄여 음식 파손을 막으세요!';
      }
    }
    this.slipWarningEl.classList.toggle('hidden', !showSlip);

    const promptHtml = this.computePrompt(player, scooter, delivery, navPlan, ctx);
    if (promptHtml && !ctx.modalOpen) {
      this.interactPrompt.innerHTML = promptHtml;
      this.interactPrompt.classList.remove('hidden');
    } else {
      this.interactPrompt.classList.add('hidden');
    }

    if (isRiding) {
      this.speedVal.textContent = String(Math.round(Math.abs(scooter.speed) * 3.6));

      const leanDeg = Math.round((Math.abs(scooter.leanAngle) * 180) / Math.PI);
      const leanDir = scooter.leanAngle < -0.05 ? '좌 ' : scooter.leanAngle > 0.05 ? '우 ' : '';
      this.leanVal.textContent = `${leanDir}${leanDeg}°`;
      const riskPct = Math.min(100, Math.round(scooter.leanRisk * 100));
      this.leanBar.style.width = `${riskPct}%`;
      this.leanBar.className =
        riskPct >= 75 ? 'lean-fill danger' : riskPct >= 45 ? 'lean-fill warn' : 'lean-fill safe';

      const fuelPct = Math.round(scooter.fuel);
      this.fuelVal.textContent = scooter.outOfFuel ? '고갈 (0%)' : `${fuelPct}%`;
      this.fuelBar.style.width = `${fuelPct}%`;
      this.fuelBar.className =
        scooter.lowFuelWarning ? 'lean-fill danger' : fuelPct <= 30 ? 'lean-fill warn' : 'lean-fill safe';

      if (scooter.damageLevel > 0) {
        this.damageBadge.textContent = `🔧 파손 -${scooter.damageLevel * 10}%`;
        this.damageBadge.classList.remove('hidden');
      } else {
        this.damageBadge.classList.add('hidden');
      }

      const blinkOn = Math.floor(elapsedTime * 2.5) % 2 === 0;
      this.indLeft.className =
        (scooter.leftBlinker || scooter.hazard) && blinkOn
          ? 'ind ind-blink active-amber'
          : 'ind ind-blink';
      this.indRight.className =
        (scooter.rightBlinker || scooter.hazard) && blinkOn
          ? 'ind ind-blink active-amber'
          : 'ind ind-blink';
      this.indLight.className = scooter.headlights ? 'ind active-amber' : 'ind';
      this.indTime.className = isNight ? 'ind active-blue' : 'ind';
      this.indTime.textContent = isNight ? '밤' : '낮';
      this.indAudio.className = isMuted ? 'ind active-red' : 'ind';
      this.indAudio.textContent = isMuted ? '음소거' : '사운드';
    }

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

  private computePrompt(
    player: PlayerState,
    scooter: ScooterState,
    delivery: DeliveryManager,
    navPlan: NavigationPlan,
    ctx: InteractionContext
  ): string | null {
    if (player.mode === 'knockdown') return null;

    const isRiding = player.mode === 'riding';

    // --- Inside Underground Corridor (Apartment Real 3D Elevator OR 원룸·빌라 Stairwell) ---
    const corridorM = delivery.getCorridorMission();
    if (player.inCorridor && corridorM) {
      // Real 3D Apartment Elevator Cabin Prompts!
      if (!ctx.isVillaCorridor) {
        if (ctx.elevatorPhase === 'moving_up') {
          return `🛗 엘리베이터 상승 중... ▲ ${ctx.elevatorCurrentFloor}F / 목표 ${ctx.elevatorTargetFloor}F`;
        }
        if (ctx.elevatorPhase === 'moving_down') {
          return `🛗 엘리베이터 하강 중... ▼ ${ctx.elevatorCurrentFloor}F → 1F 로비`;
        }
        if (ctx.insideElevatorCabin && ctx.elevatorPhase === 'idle_1f') {
          return `<kbd>E</kbd> 🛗 엘리베이터 [${ctx.elevatorTargetFloor}층] 버튼 누르기 (${corridorM.order.unitNumber})`;
        }
        if (ctx.insideElevatorCabin && corridorM.phase === 'in_corridor' && ctx.elevatorDoorsOpen) {
          return `🚶 ${ctx.elevatorCurrentFloor}층 도착! 앞으로 걸어 나가 ${corridorM.order.unitNumber}로 이동하세요`;
        }
        if (corridorM.phase === 'corridor_exit') {
          if (ctx.insideElevatorCabin) {
            return `<kbd>E</kbd> 🛗 엘리베이터 [1층] 버튼 누르기 (1층 로비로 하강)`;
          }
          if (ctx.nearCorridorElevator) {
            return ctx.elevatorDoorsOpen
              ? '🚶 엘리베이터 안으로 걸어 들어가 [1층] 버튼을 누르세요'
              : '<kbd>E</kbd> 🛗 엘리베이터 호출 버튼 누르기 (문 열기)';
          }
        }
      }

      if (corridorM.phase === 'in_corridor' && ctx.nearCorridorTargetDoor) {
        const inst = corridorM.order.deliveryInstruction;
        if (inst === 'KNOCK_DOOR') {
          return `<kbd>E</kbd> ✊ ${corridorM.order.unitNumber} 문 노크(똑똑똑) 후 음식 내려놓기`;
        }
        if (inst === 'MEET_FACE') {
          return `<kbd>E</kbd> 🔔 ${corridorM.order.unitNumber} 인터폰 벨 누르기 (직접 대면 수령)`;
        }
        return `<kbd>E</kbd> 📸 ${corridorM.order.unitNumber} 문 앞 발매트에 [#${corridorM.order.orderNumber}] 내려놓기`;
      }
      if (corridorM.phase === 'knock_waiting') {
        return '✊ 똑똑똑! 문 앞에 내려놓았습니다 — 배달 완료 처리 중...';
      }
      if (corridorM.phase === 'meet_waiting') {
        return '🔔 "누구세요? 배달이요!" — 고객이 문을 열고 수령 중...';
      }
      if (corridorM.phase === 'corridor_exit' && ctx.nearCorridorElevator && ctx.isVillaCorridor) {
        return '<kbd>E</kbd> 🚪 원룸·빌라 1층 현관 출구로 나가기';
      }
      return null;
    }

    const carrying = delivery.getCarryingMission();
    const loadedCount = delivery.getLoadedCargoCount();

    // --- Outdoor On-Foot Interactions ---
    if (!isRiding) {
      // 0. Service Stations (Gas Station & Motorcycle Repair Center — encapsulated away from delivery E zones)
      if (ctx.nearGasPump) {
        return ctx.scooterOnGasPad
          ? `<kbd>E</kbd> ⛽ 셀프 주유기 열기 (현재 연료 ${Math.round(scooter.fuel)}%)`
          : '⛽ 오토바이를 주유소 노란 주유 패드 위에 세운 뒤 주유하세요';
      }
      if (ctx.nearRepairShop) {
        return scooter.damageLevel > 0
          ? `<kbd>E</kbd> 🔧 번개 오토바이 센터 (${scooter.damageLevel}단계 수리 · 기종 · 도색 · 장비 업그레이드)`
          : `<kbd>E</kbd> 🔧 번개 오토바이 센터 (기종 변경 · 커스텀 도색 · 성능 업그레이드)`;
      }
      if (ctx.nearConvenienceStore) {
        return `<kbd>E</kbd> 🏪 K-24 편의점 이용 (에너지드링크 · 아메리카노 · 보조배터리)`;
      }

      // 1. Outdoor Shop Pickup POS / Cooking Wait / Ready Tray Pickup
      const shopM = delivery.getMissionNearShopPickup(player.x, player.z);
      if (shopM) {
        if (shopM.phase === 'cooking_wait') {
          const sec = Math.max(1, Math.ceil(shopM.cookingRemainingSec));
          return `🍳 ${shopM.order.shop.name} [#${shopM.order.orderNumber}] 조리 중 (남은 시간: ${sec}초) — 대기 중 자유 이동·탑승 가능`;
        }
        if (carrying) {
          return `🛍️ [#${carrying.order.orderNumber}] 휴대 중 — 먼저 오토바이 배달통에 <kbd>E</kbd> 적재`;
        }
        if (shopM.phase === 'pickup_ready') {
          return `<kbd>E</kbd> 🛍️ 픽업대 트레이에서 [#${shopM.order.orderNumber}] 음식 수령하기`;
        }
        return `<kbd>E</kbd> ${shopM.order.shop.emoji} 야외 픽업 POS 열기 (주문번호: ${shopM.order.orderNumber})`;
      }

      // 2. Rear Scooter 3-Slot Cargo Box
      if (ctx.nearCargoBox && (carrying !== null || loadedCount > 0)) {
        if (carrying && (carrying.phase === 'carrying_to_box' || carrying.phase === 'carrying_to_lobby')) {
          return `<kbd>E</kbd> 📦 배달통 슬롯 열기 ([#${carrying.order.orderNumber}] 적재 · ${loadedCount}/${CARGO_SLOT_COUNT})`;
        }
        return `<kbd>E</kbd> 📦 배달통 슬롯 열기 (적재 ${loadedCount}/${CARGO_SLOT_COUNT}칸 · 꺼내기)`;
      }

      // 3. Customer Lobby Entrance PIN / Elevator
      const lobbyM = delivery.getMissionNearCustomerLobby(player.x, player.z);
      if (lobbyM) {
        if (lobbyM.phase === 'carrying_to_lobby') {
          return `<kbd>E</kbd> 🔑 ${lobbyM.order.customer.name} 공동현관 PIN 입력 ([#${lobbyM.order.orderNumber}])`;
        }
        if (lobbyM.phase === 'lobby_unlocked') {
          if (lobbyM.order.customer.residenceKind === 'walkup_villa') {
            return `<kbd>E</kbd> 🪜 원룸·빌라 1층 진입 → 계단 오르기 (${lobbyM.order.unitNumber} · 수고비 +₩500)`;
          }
          return `<kbd>E</kbd> 🛗 아파트 1층 엘리베이터 탑승 (${lobbyM.order.unitNumber})`;
        }
      }
    }

    // --- Outdoor Riding Contextual Hints ---
    if (isRiding && Math.abs(scooter.speed) <= 4.2) {
      const shopM = delivery.getMissionNearShopPickup(player.x, player.z);
      if (shopM) {
        if (shopM.phase === 'pickup_ready') {
          return `<kbd>F</kbd> 하차 후 트레이에서 [#${shopM.order.orderNumber}] 음식 수령`;
        }
        if (shopM.phase === 'cooking_wait') {
          return `🍳 ${shopM.order.shop.name} 조리 중 (${Math.ceil(shopM.cookingRemainingSec)}초) · <kbd>F</kbd> 하차`;
        }
        return `<kbd>F</kbd> 하차 후 ${shopM.order.shop.name} 픽업 ([#${shopM.order.orderNumber}])`;
      }
      if (
        loadedCount > 0 &&
        navPlan.focusMission?.phase === 'cargo_loaded' &&
        (navPlan.guidance?.totalDistance ?? 999) < 16
      ) {
        return `<kbd>F</kbd> 하차 후 배달통에서 [#${navPlan.focusMission.order.orderNumber}] 꺼내기`;
      }
    }

    // --- Scooter Mount / Dismount Prompts ---
    if (!isRiding && player.canMountScooter) {
      if (delivery.isCarryingFood()) {
        return '🚫 음식 든 채 운전 불가 — 뒤편 배달통에서 <kbd>E</kbd> 적재';
      }
      return scooter.crashed
        ? '<kbd>F</kbd> 넘어진 오토바이 일으켜 탑승'
        : '<kbd>F</kbd> 배달 오토바이 탑승';
    }

    if (isRiding && Math.abs(scooter.speed) <= 4.2) {
      return '<kbd>F</kbd> 오토바이 하차';
    }

    return null;
  }
}
