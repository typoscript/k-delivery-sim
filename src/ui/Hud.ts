import { PlayerState } from '../player/PlayerController';
import { ScooterState } from '../vehicle/ScooterPhysics';
import { CityMapInfo } from '../world/CityWorld';
import { DeliveryManager } from '../delivery/DeliveryManager';
import { SignalStateSnapshot } from '../world/TrafficSystem';
import { PhoneCallbacks, PhoneMap, PhonePlacement } from './PhoneMap';

export interface InteractionContext {
  nearCargoBox: boolean;
  nearCorridorTargetDoor: boolean;
  nearCorridorElevator: boolean;
  modalOpen: boolean;
}

export class Hud {
  private readonly modeBadge = document.getElementById('mode-badge')!;
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

  constructor(phoneCallbacks: PhoneCallbacks) {
    this.phoneMap = new PhoneMap(phoneCallbacks);
    this.toggleHelpBtn.addEventListener('click', () => this.toggleHelp());
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
    signalState: SignalStateSnapshot,
    isNight: boolean,
    isMuted: boolean,
    elapsedTime: number,
    mapInfo: CityMapInfo,
    ctx: InteractionContext
  ): void {
    const isRiding = player.mode === 'riding';

    if (player.inCorridor) {
      const unit = delivery.activeMission?.order.unitNumber ?? '';
      this.modeBadge.textContent = `🏢 실내 복도 (${unit})`;
      this.modeBadge.className = 'mode-pill foot';
    } else if (player.mode === 'knockdown') {
      this.modeBadge.textContent = '💥 전도! 일어나는 중';
      this.modeBadge.className = 'mode-pill danger';
    } else if (isRiding) {
      this.modeBadge.textContent = delivery.isCargoLoaded()
        ? '🛵 라이딩 · 📦 배달통 적재됨'
        : '🛵 1인칭 라이딩';
      this.modeBadge.className = 'mode-pill riding';
    } else if (delivery.isCarryingFood()) {
      this.modeBadge.textContent = '🛍️ 도보 · 음식 들고 이동 중';
      this.modeBadge.className = 'mode-pill riding';
    } else {
      this.modeBadge.textContent = '🚶 1인칭 도보';
      this.modeBadge.className = 'mode-pill foot';
    }

    this.ridingCluster.classList.toggle('hidden', !isRiding);
    this.slipWarningEl.classList.toggle('hidden', !(isRiding && scooter.slipWarning));

    // Context-sensitive GTA interaction prompt
    const promptHtml = this.computePrompt(player, scooter, delivery, ctx);
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

    this.phoneMap.update(player, scooter, delivery, signalState, isNight, elapsedTime, mapInfo);
  }

  private computePrompt(
    player: PlayerState,
    scooter: ScooterState,
    delivery: DeliveryManager,
    ctx: InteractionContext
  ): string | null {
    if (player.mode === 'knockdown') return null;

    const m = delivery.activeMission;
    const isRiding = player.mode === 'riding';

    // --- Inside Underground Corridor ---
    if (player.inCorridor && m) {
      if (m.phase === 'in_corridor' && ctx.nearCorridorTargetDoor) {
        return `<kbd>E</kbd> ${m.order.unitNumber} 문 앞 발매트에 음식 내려놓기`;
      }
      if (m.phase === 'corridor_exit' && ctx.nearCorridorElevator) {
        return '<kbd>E</kbd> 🛗 엘리베이터 타고 1층으로 내려가기';
      }
      return null;
    }

    // --- Outdoor Mission Interactions ---
    if (m && !isRiding) {
      if (m.phase === 'to_pickup' && delivery.isNearShopPickup(player.x, player.z)) {
        return `<kbd>E</kbd> ${m.order.shop.emoji} 야외 픽업 POS 열기 (주문번호: ${m.order.orderNumber})`;
      }
      if (m.phase === 'carrying_to_box' && ctx.nearCargoBox) {
        return '<kbd>E</kbd> 📦 오토바이 배달통에 음식 적재';
      }
      if (m.phase === 'cargo_loaded' && ctx.nearCargoBox) {
        return '<kbd>E</kbd> 🛍️ 오토바이 배달통에서 음식 꺼내기';
      }
      if (m.phase === 'carrying_to_lobby' && delivery.isNearCustomerLobby(player.x, player.z)) {
        return `<kbd>E</kbd> 🔑 ${m.order.customer.name} 공동현관 비밀번호 입력`;
      }
      if (m.phase === 'lobby_unlocked' && delivery.isNearCustomerLobby(player.x, player.z)) {
        return `<kbd>E</kbd> 🛗 엘리베이터 탑승 (${m.order.unitNumber} 이동)`;
      }
    }

    if (m && isRiding && Math.abs(scooter.speed) <= 4.2) {
      if (m.phase === 'to_pickup' && delivery.isNearShopPickup(player.x, player.z)) {
        return '<kbd>F</kbd> 하차 후 야외 픽업대에서 픽업';
      }
      if (
        m.phase === 'cargo_loaded' &&
        (delivery.getDistanceToOutdoorTarget(player.x, player.z) ?? 999) < 12
      ) {
        return '<kbd>F</kbd> 하차 후 뒤편 배달통에서 음식 꺼내기';
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
