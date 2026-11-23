import { PlayerState } from '../player/PlayerController';
import { ScooterState } from '../vehicle/ScooterPhysics';
import { CityMapInfo } from '../world/CityWorld';
import {
  CARGO_SLOT_COUNT,
  DeliveryManager,
  MAX_CONCURRENT_ORDERS,
  NavigationPlan,
} from '../delivery/DeliveryManager';
import { SignalStateSnapshot } from '../world/TrafficSystem';
import { PhoneCallbacks, PhoneMap, PhonePlacement } from './PhoneMap';
import { WeatherMode } from '../types';

export interface InteractionContext {
  nearCargoBox: boolean;
  nearCorridorTargetDoor: boolean;
  nearCorridorElevator: boolean;
  modalOpen: boolean;
}

export class Hud {
  private readonly modeBadge = document.getElementById('mode-badge')!;
  private readonly weatherBadge = document.getElementById('weather-badge')!;
  private readonly helpPanel = document.getElementById('help-panel')!;
  private readonly toggleHelpBtn = document.getElementById('toggle-help-btn')!;

  private readonly interactPrompt = document.getElementById('interact-prompt')!;
  private readonly slipWarningEl = document.getElementById('slip-warning')!;
  private readonly toast = document.getElementById('toast')!;

  private readonly ridingCluster = document.getElementById('riding-cluster')!;
  private readonly speedVal = document.getElementById('speed-val')!;
  private readonly leanVal = document.getElementById('lean-val')!;
  private readonly leanBar = document.getElementById('lean-bar')!;

  private readonly indLeft = document.getElementById('ind-left')!;
  private readonly indRight = document.getElementById('ind-right')!;
  private readonly indLight = document.getElementById('ind-light')!;
  private readonly indTime = document.getElementById('ind-time')!;
  private readonly indAudio = document.getElementById('ind-audio')!;

  public readonly phoneMap: PhoneMap;
  private toastTimer: number | null = null;

  constructor(phoneCallbacks: PhoneCallbacks, onToggleWeather?: () => void) {
    this.phoneMap = new PhoneMap(phoneCallbacks);
    this.toggleHelpBtn.addEventListener('click', () => this.toggleHelp());
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

  public update(
    player: PlayerState,
    scooter: ScooterState,
    delivery: DeliveryManager,
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
      this.modeBadge.textContent = `🏢 실내 복도 (${ordNo}${unit})`;
      this.modeBadge.className = 'mode-pill foot';
    } else if (player.mode === 'knockdown') {
      this.modeBadge.textContent = '💥 전도! 일어나는 중';
      this.modeBadge.className = 'mode-pill danger';
    } else if (isRiding) {
      this.modeBadge.textContent =
        loadedCount > 0
          ? `🛵 라이딩 · 📦 배달통 ${loadedCount}/${CARGO_SLOT_COUNT}칸`
          : activeCount > 0
            ? `🛵 라이딩 · 묶음 ${activeCount}/${MAX_CONCURRENT_ORDERS}건`
            : '🛵 1인칭 라이딩';
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

    this.ridingCluster.classList.toggle('hidden', !isRiding);
    const showSlip = isRiding && (scooter.slipWarning || scooter.wetSlipWarning !== 'none');
    if (showSlip) {
      if (scooter.wetSlipWarning === 'manhole') {
        this.slipWarningEl.textContent =
          '⚠ 빗길 금속 맨홀 뚜껑! 브레이크·급회전 시 접지력 상실로 전도됩니다!';
      } else if (scooter.wetSlipWarning === 'crosswalk_paint') {
        this.slipWarningEl.textContent =
          '⚠ 빗길 횡단보도 페인트선! 감속·직진 통과하지 않으면 미끄러집니다!';
      } else {
        this.slipWarningEl.textContent = '⚠ 코너 기울기 과다! 감속하지 않으면 넘어집니다!';
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

    // --- Inside Underground Corridor ---
    const corridorM = delivery.getCorridorMission();
    if (player.inCorridor && corridorM) {
      if (corridorM.phase === 'in_corridor' && ctx.nearCorridorTargetDoor) {
        return `<kbd>E</kbd> ${corridorM.order.unitNumber} 문 앞 발매트에 [#${corridorM.order.orderNumber}] 내려놓기`;
      }
      if (corridorM.phase === 'corridor_exit' && ctx.nearCorridorElevator) {
        return '<kbd>E</kbd> 🛗 엘리베이터 타고 1층으로 내려가기';
      }
      return null;
    }

    const carrying = delivery.getCarryingMission();
    const loadedCount = delivery.getLoadedCargoCount();

    // --- Outdoor On-Foot Interactions ---
    if (!isRiding) {
      // 1. Outdoor Shop Pickup POS
      const shopM = delivery.getMissionNearShopPickup(player.x, player.z);
      if (shopM) {
        if (carrying) {
          return `🛍️ [#${carrying.order.orderNumber}] 휴대 중 — 먼저 오토바이 배달통에 <kbd>E</kbd> 적재`;
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
          return `<kbd>E</kbd> 🛗 엘리베이터 탑승 (${lobbyM.order.unitNumber} 이동)`;
        }
      }
    }

    // --- Outdoor Riding Contextual Hints ---
    if (isRiding && Math.abs(scooter.speed) <= 4.2) {
      const shopM = delivery.getMissionNearShopPickup(player.x, player.z);
      if (shopM) {
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
