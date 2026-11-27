import { GameContext } from './GameContext';
import { WeatherMode } from '../types';

/**
 * Applies the game clock to the world and the delivery economy (called every frame and right after `N`):
 * dusk / dawn lighting, night surcharge + automatic headlights after sunset, rush-hour demand phases
 * (call frequency, +₩1,000 peak surcharge, slower kitchens) and the HUD / phone clock.
 */
export function applyGameClock(ctx: GameContext, announce = true, dtGameMin = 0): void {
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

  // Weather changes on its own as game time passes (clock jumps with N do not skip it)
  const nextWeather = ctx.weatherSchedule.step(dtGameMin);
  if (nextWeather) setWeatherMode(ctx, nextWeather, announce ? 'auto' : 'silent');
}

const WEATHER_MESSAGES: Record<'auto' | 'manual', Record<WeatherMode, string>> = {
  auto: {
    rain: '🌧️ 비가 내리기 시작했어요! 신규 콜 우천 할증 +₩1,500 · 빗길 맨홀·횡단보도 미끄럼 주의',
    cloudy: '☁️ 하늘이 흐려졌어요',
    clear: '☀️ 날이 갰어요 · 노면이 마르고 있어요',
  },
  manual: {
    rain: '🌧️ 비(우천) 모드! 빗길 맨홀·횡단보도 슬립 주의 · 신규 콜 우천 할증 +₩1,500!',
    cloudy: '☁️ 흐림 모드 (조명 톤 다운)',
    clear: '☀️ 맑음 모드 (건조 노면)',
  },
};

/**
 * Applies a weather change everywhere (rain particles / audio, sky and wet roads, rain surcharge on new calls,
 * automatic headlights in rain). `manual` = U key (the schedule then holds it for a while).
 */
export function setWeatherMode(ctx: GameContext, mode: WeatherMode, source: 'auto' | 'manual' | 'silent'): void {
  const { weather, world, delivery, scooterPhysics, hud, voiceNav, weatherSchedule } = ctx;
  weather.setMode(mode);
  world.setWeather(mode);
  delivery.setWeatherRaining(mode === 'rain');
  if (mode === 'rain') scooterPhysics.state.headlights = true;
  if (source === 'manual') weatherSchedule.override(mode);
  if (source === 'silent') return;
  hud.showToast(WEATHER_MESSAGES[source][mode], 3800);
  if (source === 'auto' && mode === 'rain') voiceNav.speak('비가 내리기 시작했습니다. 빗길 운전에 주의하세요.');
}
