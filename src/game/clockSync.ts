import { GameContext } from './GameContext';

/**
 * Applies the game clock to the world and the delivery economy (called every frame and right after `N`):
 * dusk / dawn lighting, night surcharge + automatic headlights after sunset, rush-hour demand phases
 * (call frequency, +₩1,000 peak surcharge, slower kitchens) and the HUD / phone clock.
 */
export function applyGameClock(ctx: GameContext, announce = true): void {
  const { clock, world, delivery, scooterPhysics, hud, voiceNav } = ctx;
  delivery.shiftClockMinute = clock.minute;
  const night = world.setNightness(clock.nightness);
  if (delivery.isNightMode !== night) {
    delivery.setNightMode(night);
    if (night) scooterPhysics.state.headlights = true;
    if (announce) {
      hud.showToast(
        night
          ? `🌙 ${clock.label} 해가 졌어요 · 신규 콜 심야 할증 +₩1,200 · 헤드라이트 자동 점등`
          : `🌅 ${clock.label} 날이 밝았어요 · 주간 운행`,
        3600
      );
    }
  }

  const phase = clock.phase;
  if (delivery.demandPhase.id !== phase.id) {
    const wasPeak = delivery.demandPhase.isPeak;
    const prevLabel = delivery.demandPhase.label;
    delivery.setDemandPhase(phase);
    if (announce && phase.isPeak) {
      hud.showToast(
        `${phase.emoji} ${phase.label} 시작! 콜이 2배 넘게 빨리 들어오고 건당 +₩${phase.peakBonus.toLocaleString()} 피크 할증 (매장 조리는 조금 더 걸려요)`,
        4800
      );
      voiceNav.speak(`${phase.label} 시간입니다. 주문이 많아집니다.`);
    } else if (announce && wasPeak) {
      hud.showToast(`${prevLabel} 종료 · ${phase.emoji} ${phase.label} 시간대`, 3200);
    } else if (announce && phase.id === 'dawn') {
      hud.showToast(
        `🌌 자정이 지났어요 · 콜이 뜸해져요. 휴대폰 [수익] 탭의 🏁 퇴근하기로 ${delivery.shiftDay}일차를 마감하고 다음 날 출근할 수 있어요`,
        5600
      );
    }
  }

  hud.setClock(clock.label, phase, delivery.shiftDay);
}
