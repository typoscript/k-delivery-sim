/**
 * Seasons: every SEASON_DAYS working days the season turns (가을 -> 겨울 -> 봄 -> 여름 -> 가을 ...), starting in
 * autumn on day 1. A season sets how often clouds turn into rain or snow (snow only in winter, short showers in
 * summer) and which seasonal event call runs (see demandEvents). Pure logic, unit tested.
 */

export type SeasonId = 'autumn' | 'winter' | 'spring' | 'summer';

export interface SeasonSpec {
  id: SeasonId;
  label: string;
  emoji: string;
  /** Chance that clouds turn into rain / snow (the rest clears up) */
  rainChance: number;
  snowChance: number;
  /** Rain lasts this much of its usual length (summer showers are short) */
  rainDurationMul: number;
  /** One-line description for the new-season toast */
  note: string;
  /** When dawn and dusk begin (game minutes): long summer days, short winter days */
  sun: { dawnStart: number; duskStart: number };
}

/** Working days per season (a week, like the weekly goals) */
export const SEASON_DAYS = 7;

export const SEASONS: readonly SeasonSpec[] = [
  {
    id: 'autumn',
    label: '가을',
    emoji: '🍂',
    rainChance: 0.3,
    snowChance: 0,
    rainDurationMul: 1,
    sun: { dawnStart: 6 * 60, duskStart: 18 * 60 },
    note: '맑은 날이 많아요',
  },
  {
    id: 'winter',
    label: '겨울',
    emoji: '❄️',
    rainChance: 0.12,
    snowChance: 0.45,
    rainDurationMul: 1,
    sun: { dawnStart: 6 * 60 + 50, duskStart: 17 * 60 + 10 },
    note: '눈이 자주 와요 · 따끈한 분식 주문 증가',
  },
  {
    id: 'spring',
    label: '봄',
    emoji: '🌸',
    rainChance: 0.4,
    snowChance: 0,
    rainDurationMul: 1,
    sun: { dawnStart: 5 * 60 + 40, duskStart: 18 * 60 + 50 },
    note: '봄비가 내려요 · 나들이 도시락 주문 증가',
  },
  {
    id: 'summer',
    label: '여름',
    emoji: '☀️',
    rainChance: 0.6,
    snowChance: 0,
    rainDurationMul: 0.5,
    sun: { dawnStart: 4 * 60 + 50, duskStart: 19 * 60 + 30 },
    note: '짧은 소나기가 잦아요 · 시원한 메뉴 주문 증가',
  },
];

/** Season of a working day (day 1 = the first day of autumn) */
export function seasonOfDay(day: number): SeasonSpec {
  const idx = Math.floor((Math.max(1, Math.floor(day)) - 1) / SEASON_DAYS) % SEASONS.length;
  return SEASONS[idx];
}

/** Which day of its season a working day is (1..SEASON_DAYS) */
export function dayInSeason(day: number): number {
  return ((Math.max(1, Math.floor(day)) - 1) % SEASON_DAYS) + 1;
}
