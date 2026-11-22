import { PlayerState } from '../player/PlayerController';
import { ScooterState } from '../vehicle/ScooterPhysics';
import { CityMapInfo } from '../world/CityWorld';
import { DeliveryManager } from '../delivery/DeliveryManager';
import { SignalStateSnapshot } from '../world/TrafficSystem';
import { PhoneCallbacks, PhoneMap, PhonePlacement } from './PhoneMap';

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

  public togglePhonePlacement(isRiding: boolean): { placement: PhonePlacement; message: string } {
    return this.phoneMap.toggleWithTab(isRiding);
  }

  public stowPhoneToPocket(): void {
    this.phoneMap.setPlacement('pocket');
  }

  public showToast(message: string, durationMs = 2600): void {
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
    mapInfo: CityMapInfo
  ): void {
    const isRiding = player.mode === 'riding';

    if (player.mode === 'knockdown') {
      this.modeBadge.textContent = '💥 전도! 일어나는 중';
      this.modeBadge.className = 'mode-pill danger';
    } else if (isRiding) {
      this.modeBadge.textContent = '🛵 1인칭 라이딩';
      this.modeBadge.className = 'mode-pill riding';
    } else {
      this.modeBadge.textContent = '🚶 1인칭 도보';
      this.modeBadge.className = 'mode-pill foot';
    }

    this.ridingCluster.classList.toggle('hidden', !isRiding);

    // Slip / Over-lean warning banner
    this.slipWarningEl.classList.toggle('hidden', !(isRiding && scooter.slipWarning));

    // Context-sensitive GTA interaction prompt (Priority: Delivery Pickup/Dropoff -> Mount/Dismount)
    const inTarget = delivery.isInsideTargetZone(player.x, player.z);
    const active = delivery.activeMission;

    if (player.mode === 'knockdown') {
      this.interactPrompt.classList.add('hidden');
    } else if (inTarget && active) {
      if (!isRiding) {
        this.interactPrompt.innerHTML =
          active.phase === 'pickup'
            ? `<kbd>E</kbd> ${active.order.shop.emoji} ${active.order.menuName} 픽업`
            : `<kbd>E</kbd> ${active.order.customer.emoji} 문 앞 배달 완료`;
      } else {
        this.interactPrompt.innerHTML = '<kbd>F</kbd> 하차 후 픽업 / 배달 진행';
      }
      this.interactPrompt.classList.remove('hidden');
    } else if (!isRiding && player.canMountScooter) {
      this.interactPrompt.innerHTML = scooter.crashed
        ? '<kbd>F</kbd> 넘어진 오토바이 일으켜 탑승'
        : '<kbd>F</kbd> 배달 오토바이 탑승';
      this.interactPrompt.classList.remove('hidden');
    } else if (isRiding && Math.abs(scooter.speed) <= 4.2) {
      this.interactPrompt.innerHTML = '<kbd>F</kbd> 오토바이 하차';
      this.interactPrompt.classList.remove('hidden');
    } else {
      this.interactPrompt.classList.add('hidden');
    }

    if (isRiding) {
      this.speedVal.textContent = String(Math.round(Math.abs(scooter.speed) * 3.6));

      // Live cornering lean angle & grip meter
      const leanDeg = Math.round((Math.abs(scooter.leanAngle) * 180) / Math.PI);
      const leanDir = scooter.leanAngle < -0.05 ? '좌 ' : scooter.leanAngle > 0.05 ? '우 ' : '';
      this.leanVal.textContent = `${leanDir}${leanDeg}°`;
      const riskPct = Math.min(100, Math.round(scooter.leanRisk * 100));
      this.leanBar.style.width = `${riskPct}%`;
      this.leanBar.className =
        riskPct >= 75 ? 'lean-fill danger' : riskPct >= 45 ? 'lean-fill warn' : 'lean-fill safe';

      const blinkOn = Math.floor(elapsedTime * 2.5) % 2 === 0;
      this.indLeft.className =
        (scooter.leftBlinker || scooter.hazard) && blinkOn ? 'ind active-amber' : 'ind';
      this.indRight.className =
        (scooter.rightBlinker || scooter.hazard) && blinkOn ? 'ind active-amber' : 'ind';
      this.indLight.className = scooter.headlights ? 'ind active-amber' : 'ind';
      this.indTime.className = isNight ? 'ind active-blue' : 'ind';
      this.indTime.textContent = isNight ? '밤' : '낮';
      this.indAudio.className = isMuted ? 'ind active-red' : 'ind';
      this.indAudio.textContent = isMuted ? '음소거' : '사운드';
    }

    this.phoneMap.update(player, scooter, delivery, signalState, isNight, elapsedTime, mapInfo);
  }
}
