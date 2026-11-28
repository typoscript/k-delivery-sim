import { GameContext } from './GameContext';
import { WeatherMode } from '../types';
import { DEMAND_EVENTS, DemandEventSpec, SEASON_EVENTS } from '../delivery/demandEvents';
import { seasonOfDay } from './seasons';
import { blackIceActive } from '../world/blackIce';
import { ION_DRINK_COST, heatwaveActive } from './heatwave';

/** "🍲 국물 주문 증가 (안 쏟고 배달 시 +₩1,000)" */
const eventNote = (e: DemandEventSpec) =>
  `${e.icon} ${e.menuNoun} 주문 증가 (${e.conditionText} +₩${e.bonus.toLocaleString()})`;

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
          ? `🌙 ${clock.label} 해가 졌어요 · 신규 콜 심야 할증 +₩1,200 · 헤드라이트 자동 점등 · ${eventNote(DEMAND_EVENTS.late_snack)}`
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
      ctx.audio.playPeakRushJingle();
      hud.flashClock();
      hud.showToast(
        `${phase.emoji} ${phase.label} 시작! 콜이 2배 넘게 빨리 들어오고 건당 +₩${phase.peakBonus.toLocaleString()} 피크 할증 (매장 조리는 조금 더 걸려요)${
          phase.id === 'lunch_peak' ? ` · ${eventNote(DEMAND_EVENTS.lunch_meal)}` : ''
        }`,
        4800
      );
      voiceNav.speak(`${phase.label} 시간입니다. 주문이 많아집니다.`);
    } else if (announce && wasPeak) {
      ctx.audio.playPeakEndChime();
      hud.showToast(
        `${prevLabel} 종료 · ${phase.emoji} ${phase.label} 시간대${phase.id === 'afternoon' ? ` · ${eventNote(DEMAND_EVENTS.cafe_time)}` : ''}`,
        phase.id === 'afternoon' ? 4200 : 3200
      );
    } else if (announce && phase.id === 'dawn') {
      hud.showToast(
        `🌌 자정이 지났어요 · 콜이 뜸해져요. 휴대폰 [수익] 탭의 🏁 퇴근하기로 ${delivery.shiftDay}일차를 마감하고 다음 날 출근할 수 있어요`,
        5600
      );
    }
  }

  // Season of the working day: weather odds + seasonal event call (announced when it turns)
  const season = seasonOfDay(delivery.shiftDay);
  if (delivery.season !== season.id) {
    const first = delivery.season === null;
    delivery.setSeason(season.id);
    ctx.weatherSchedule.setSeason(season);
    world.setSeason(season.id);
    if (announce && !first) {
      const ev = SEASON_EVENTS[season.id];
      hud.showToast(
        `${season.emoji} ${season.label}이 왔어요! ${season.note}${ev ? ` · ${eventNote(DEMAND_EVENTS[ev])}` : ''}`,
        5200
      );
    }
  }
  // Winter nights / mornings: shaded side streets and ramps freeze into black ice
  const icy = blackIceActive(season.id, world.isNight, clock.minute);
  const wasIcy = world.blackIce.isActive;
  world.blackIce.set(delivery.shiftDay, icy); // cheap when nothing changed; a new working day freezes other spots
  if (announce && icy && !wasIcy) {
    hud.showToast(
      '🧊 영하의 겨울 밤 · 그늘진 골목과 램프에 블랙아이스! 휴대폰 지도의 🧊 표시 구간에선 브레이크·급회전 금지',
      5200
    );
    voiceNav.speak('노면 결빙 주의. 그늘진 골목에 블랙아이스가 있습니다.');
  }
  // Summer heatwave afternoons: stamina and chilled food suffer outdoors
  const hot = heatwaveActive(season.id, world.weatherMode, clock.minute);
  if (hot !== delivery.heatwave) {
    delivery.heatwave = hot;
    ctx.playerCtrl.heatwave = hot;
    hud.heatwave = hot;
    if (announce) {
      hud.showToast(
        hot
          ? `🥵 폭염! 한낮 땡볕에 걸으면 체력이 닳고 보냉 음식이 빨리 미지근해져요 · 편의점 ❄️ 얼음 이온음료(₩${ION_DRINK_COST.toLocaleString()})로 3분간 더위 무시`
          : '🌤️ 한낮 더위가 한풀 꺾였어요',
        hot ? 5200 : 2600
      );
      if (hot) voiceNav.speak('폭염 경보입니다. 체력과 보냉 음식에 주의하세요.');
    }
  }
  hud.setClock(clock.label, phase, delivery.shiftDay, season.emoji);

  // Weather changes on its own as game time passes (clock jumps with N do not skip it)
  const nextWeather = ctx.weatherSchedule.step(dtGameMin);
  if (nextWeather) setWeatherMode(ctx, nextWeather, announce ? 'auto' : 'silent');
}

const WEATHER_MESSAGES: Record<'auto' | 'manual', Record<WeatherMode, string>> = {
  auto: {
    rain: `🌧️ 비가 내리기 시작했어요! 신규 콜 우천 할증 +₩1,500 · ${eventNote(DEMAND_EVENTS.rain_soup)} · 빗길 미끄럼 주의`,
    cloudy: '☁️ 하늘이 흐려졌어요',
    clear: '☀️ 날이 갰어요 · 노면이 마르고 있어요',
    snow: `❄️ 눈이 내리기 시작했어요! 신규 콜 강설 할증 +₩2,000 · ${eventNote(DEMAND_EVENTS.snow_warm)} · 눈길 미끄럼 주의`,
  },
  manual: {
    rain: `🌧️ 비(우천) 모드! 빗길 맨홀·횡단보도 슬립 주의 · 신규 콜 우천 할증 +₩1,500 · ${eventNote(DEMAND_EVENTS.rain_soup)}`,
    cloudy: '☁️ 흐림 모드 (조명 톤 다운)',
    clear: '☀️ 맑음 모드 (건조 노면)',
    snow: `❄️ 눈 모드! 눈길은 빗길보다 더 미끄러워요 · 신규 콜 강설 할증 +₩2,000 · ${eventNote(DEMAND_EVENTS.snow_warm)}`,
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
  ctx.traffic.setWeather(mode);
  ctx.pedestrians.setWeather(mode);
  delivery.setWeatherPrecipitation(mode === 'rain' || mode === 'snow' ? mode : null);
  if (mode === 'rain' || mode === 'snow') scooterPhysics.state.headlights = true;
  if (source === 'manual') weatherSchedule.override(mode);
  if (source === 'silent') return;
  hud.showToast(WEATHER_MESSAGES[source][mode], 3800);
  if (source === 'auto' && mode === 'rain') {
    ctx.audio.playThunderRumble();
    voiceNav.speak('비가 내리기 시작했습니다. 빗길 운전에 주의하세요.');
  }
  if (source === 'auto' && mode === 'snow') voiceNav.speak('눈이 내리기 시작했습니다. 눈길 운전에 주의하세요.');
}
