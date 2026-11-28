/**
 * What the phone's weather app shows (날씨 앱): the current weather and temperature, the season and its day, sunrise
 * and sunset, today's warnings (폭염 · 결빙 · 장마 · 물웅덩이 · 할증), an hourly forecast and tomorrow's outlook.
 * The weather is only told through this app (the HUD has no weather badge), so everything the rider needs to plan
 * a shift is here. Pure logic from the game state, unit tested.
 */
import type { WeatherMode } from '../types';
import { DEMAND_EVENTS, SEASON_EVENTS } from '../delivery/demandEvents';
import { RAIN_SURCHARGE_BONUS, SNOW_SURCHARGE_BONUS } from '../delivery/deliveryTypes';
import { HEAT_END_MIN, HEAT_START_MIN, ION_DRINK_COST } from './heatwave';
import { SEASON_DAYS, SeasonId, dayInSeason, isMonsoonDay, seasonOfDay, weatherOddsOfDay } from './seasons';
import { WeatherSchedule } from './WeatherSchedule';

export const WEATHER_ICON: Record<WeatherMode, string> = { clear: '☀️', cloudy: '☁️', rain: '🌧️', snow: '❄️' };
export const WEATHER_LABEL: Record<WeatherMode, string> = { clear: '맑음', cloudy: '흐림', rain: '비', snow: '눈' };

export interface WeatherAlert {
  icon: string;
  title: string;
  detail: string;
  level: 'danger' | 'warn' | 'info';
}

export interface WeatherReport {
  mode: WeatherMode;
  icon: string;
  label: string;
  tempC: number;
  season: { id: SeasonId; label: string; emoji: string; day: number; days: number };
  workDay: number;
  clock: string;
  sunrise: string;
  sunset: string;
  alerts: WeatherAlert[];
  hourly: Array<{ label: string; mode: WeatherMode; icon: string; tempC: number }>;
  tomorrow: {
    seasonLabel: string;
    seasonEmoji: string;
    monsoon: boolean;
    rainPct: number;
    snowPct: number;
    note: string;
  };
}

/** Input from the running game */
export interface WeatherReportInput {
  workDay: number;
  /** Minute of the day (0..1440) */
  minute: number;
  mode: WeatherMode;
  /** The schedule's forecast for the next hours (index 0 = in an hour) */
  forecast: readonly WeatherMode[];
  heatwave: boolean;
  blackIce: boolean;
  /** Only the bridges are frozen (sunset / late morning), not the shaded streets */
  blackIceBridgesOnly?: boolean;
  /** Stream walkways: under water and closed, the water rising toward that, or normal */
  streams?: 'closed' | 'rising' | 'normal';
  /** Puddles on the road right now */
  puddles: number;
  /** Is it night now (sunset passed) */
  night: boolean;
  /** Weather gear the rider owns (the app suggests what is missing) */
  gear?: { raincoat: boolean; winterGear: boolean };
}

/** At or below this the air is freezing for a rider without winter gear */
export const COLD_TEMP_C = 2;

const BASE_TEMP: Record<SeasonId, number> = { spring: 14, summer: 28, autumn: 15, winter: -1 };
const SWING: Record<SeasonId, number> = { spring: 6, summer: 5, autumn: 6, winter: 5 };

const hhmm = (m: number) => {
  const w = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(w / 60)).padStart(2, '0')}:${String(w % 60).padStart(2, '0')}`;
};

/** Air temperature (°C): the season's base, warmest around 15:00, coolest before dawn; cooler under rain / snow */
export function temperatureAt(season: SeasonId, minute: number, mode: WeatherMode, heatwave = false): number {
  const daily = Math.cos(((minute - 15 * 60) / 1440) * Math.PI * 2);
  let t = BASE_TEMP[season] + SWING[season] * daily;
  if (mode === 'cloudy') t -= 1;
  if (mode === 'rain') t -= 3;
  if (mode === 'snow') t = Math.min(t, -1) - 1;
  if (heatwave) t = Math.max(t, 33 + daily);
  return Math.round(t);
}

const tomorrowCache = new Map<number, { rainPct: number; snowPct: number }>();

/** Share of a day's time it rains / snows with the odds of `day` (fixed-seed sampling, cached per day) */
export function precipitationOdds(day: number): { rainPct: number; snowPct: number } {
  const hit = tomorrowCache.get(day);
  if (hit) return hit;
  const w = new WeatherSchedule('cloudy', 777);
  w.setSeason(weatherOddsOfDay(day));
  let rain = 0;
  let snow = 0;
  const total = 6 * 1440;
  for (let m = 0; m < total; m++) {
    w.step(1);
    if (w.mode === 'rain') rain++;
    else if (w.mode === 'snow') snow++;
  }
  const out = { rainPct: Math.round((rain / total) * 100), snowPct: Math.round((snow / total) * 100) };
  tomorrowCache.set(day, out);
  return out;
}

export function buildWeatherReport(input: WeatherReportInput): WeatherReport {
  const season = seasonOfDay(input.workDay);
  const tempC = temperatureAt(season.id, input.minute, input.mode, input.heatwave);
  const alerts: WeatherAlert[] = [];

  if (input.heatwave) {
    alerts.push({
      icon: '🥵',
      title: '폭염 경보',
      detail: `~${hhmm(HEAT_END_MIN)} 걸으면 체력이 닳고 보냉 음식이 빨리 미지근해져요 · 편의점 얼음 이온음료(₩${ION_DRINK_COST.toLocaleString()})`,
      level: 'danger',
    });
  } else if (season.id === 'summer' && input.mode === 'clear' && input.minute < HEAT_START_MIN) {
    alerts.push({
      icon: '🌡️',
      title: '오후 폭염 주의',
      detail: `맑으면 ${hhmm(HEAT_START_MIN)}~${hhmm(HEAT_END_MIN)} 폭염`,
      level: 'warn',
    });
  }
  if (input.blackIce && input.blackIceBridgesOnly) {
    alerts.push({
      icon: '🧊',
      title: '다리 위 결빙',
      detail:
        input.minute < 12 * 60
          ? '골목은 녹았지만 다리 위는 10시까지 얼어 있어요 · 지도 🧊 다리 구간 주의'
          : `다리 위가 먼저 얼었어요 · ${hhmm(season.sun.duskStart + 30)}부터 그늘진 골목·램프도 얼어요`,
      level: 'danger',
    });
  } else if (input.blackIce) {
    alerts.push({
      icon: '🧊',
      title: '도로 결빙 (블랙아이스)',
      detail: '다리 위와 그늘진 골목·램프가 얼었어요 · 지도 🧊 구간에선 브레이크·급회전 금지',
      level: 'danger',
    });
  } else if (season.id === 'winter' && !input.night) {
    alerts.push({
      icon: '🧊',
      title: '밤사이 결빙 예상',
      detail: `해가 지면(${hhmm(season.sun.duskStart)}) 다리부터, ${hhmm(season.sun.duskStart + 30)}부터 그늘진 골목도 얼어요`,
      level: 'warn',
    });
  }
  if (isMonsoonDay(input.workDay)) {
    alerts.push({
      icon: '☔',
      title: `장마 ${dayInSeason(input.workDay) - 2}일째`,
      detail: '거의 하루 종일 긴 비 · 우천 할증 콜이 이어져요',
      level: 'warn',
    });
  }
  if (input.streams === 'closed') {
    alerts.push({
      icon: '🌊',
      title: '하천 산책로 통제',
      detail: '수위가 올라 산책로·징검다리가 잠겼어요 · 산책로 쉼터 콜 중단 · 비가 그치고 물이 빠지면 풀려요',
      level: 'danger',
    });
  } else if (input.streams === 'rising') {
    alerts.push({
      icon: '🌊',
      title: '하천 수위 상승',
      detail: '비가 계속되면 산책로·징검다리가 통제될 수 있어요',
      level: 'warn',
    });
  }
  if (input.mode === 'rain') {
    alerts.push({
      icon: '🌧️',
      title: `우천 할증 +₩${RAIN_SURCHARGE_BONUS.toLocaleString()}`,
      detail: '신규 콜에 붙어요 · 빗길 맨홀·횡단보도 미끄럼 주의',
      level: 'info',
    });
    if (input.puddles > 0) {
      alerts.push({
        icon: '💧',
        title: '물웅덩이',
        detail: '도로 가장자리 곳곳 · 시속 22km 넘게 지나가면 행인에게 튀어요',
        level: 'warn',
      });
    }
  } else if (input.mode === 'snow') {
    alerts.push({
      icon: '❄️',
      title: `강설 할증 +₩${SNOW_SURCHARGE_BONUS.toLocaleString()}`,
      detail: '눈길은 빗길보다 미끄러워요 · 제동 거리 주의',
      level: 'info',
    });
  }
  // gear the weather calls for
  const gear = input.gear ?? { raincoat: true, winterGear: true };
  const precipNow = input.mode === 'rain' || input.mode === 'snow';
  if (!gear.raincoat) {
    const soon = input.forecast.slice(0, 6).findIndex((m) => m === 'rain' || m === 'snow');
    if (precipNow) {
      alerts.push({
        icon: '🧥',
        title: '우비 없음',
        detail: '비·눈을 맞으면 체력 회복이 느려요 · 정비소 라이더 우비 세트',
        level: 'warn',
      });
    } else if (soon >= 0) {
      alerts.push({
        icon: '🧥',
        title: `${soon + 1}시간 뒤 ${WEATHER_LABEL[input.forecast[soon]]} 예보`,
        detail: '우비를 챙기면 빗속에서도 체력이 그대로예요 (정비소)',
        level: 'info',
      });
    }
  }
  if (!gear.winterGear && tempC <= COLD_TEMP_C) {
    alerts.push({
      icon: '🧤',
      title: `${tempC}°C 추위`,
      detail: '방한 장비가 없으면 체력 회복이 느려요 · 정비소 방한 장갑·넥워머',
      level: 'warn',
    });
  }

  const ev = SEASON_EVENTS[season.id];
  if (ev) {
    const e = DEMAND_EVENTS[ev];
    alerts.push({
      icon: e.icon,
      title: `${season.label} 이벤트 콜 · ${e.label}`,
      detail: `${e.menuNoun} 주문 증가 (${e.conditionText} +₩${e.bonus.toLocaleString()})`,
      level: 'info',
    });
  }

  const hourly = input.forecast.slice(0, 6).map((mode, i) => {
    const m = (Math.floor(input.minute / 60) + i + 1) * 60;
    return {
      label: `${Math.floor((m / 60) % 24)}시`,
      mode,
      icon: WEATHER_ICON[mode],
      tempC: temperatureAt(season.id, m % 1440, mode),
    };
  });

  const next = seasonOfDay(input.workDay + 1);
  const odds = precipitationOdds(input.workDay + 1);
  const nextMonsoon = isMonsoonDay(input.workDay + 1);
  const note =
    next.id !== season.id
      ? `${next.emoji} 내일부터 ${next.label}`
      : nextMonsoon && !isMonsoonDay(input.workDay)
        ? '☔ 내일부터 장마'
        : !nextMonsoon && isMonsoonDay(input.workDay)
          ? '🌤️ 내일 장마 끝'
          : odds.snowPct >= 20
            ? '❄️ 눈 소식'
            : odds.rainPct >= 35
              ? '🌧️ 비 소식'
              : '☀️ 대체로 맑음';

  return {
    mode: input.mode,
    icon: WEATHER_ICON[input.mode],
    label: WEATHER_LABEL[input.mode],
    tempC,
    season: {
      id: season.id,
      label: season.label,
      emoji: season.emoji,
      day: dayInSeason(input.workDay),
      days: SEASON_DAYS,
    },
    workDay: input.workDay,
    clock: hhmm(input.minute),
    sunrise: hhmm(season.sun.dawnStart + 30),
    sunset: hhmm(season.sun.duskStart + 30),
    alerts,
    hourly,
    tomorrow: {
      seasonLabel: next.label,
      seasonEmoji: next.emoji,
      monsoon: nextMonsoon,
      rainPct: odds.rainPct,
      snowPct: odds.snowPct,
      note,
    },
  };
}
