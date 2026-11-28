import { describe, expect, it } from 'vitest';
import { SEASON_DAYS, dayInSeason, seasonOfDay } from './seasons';
import { WeatherSchedule } from './WeatherSchedule';
import { DEMAND_EVENTS, activeDemandEvents, pickMenu } from '../delivery/demandEvents';
import type { WeatherMode } from '../types';

function seeded(seed: number): () => number {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

/** Share of game time in each weather over 60 days of a season */
function weatherShares(day: number): Record<WeatherMode, number> {
  const w = new WeatherSchedule('clear', seeded(11));
  w.setSeason(seasonOfDay(day));
  const minutes: Record<WeatherMode, number> = { clear: 0, cloudy: 0, rain: 0, snow: 0 };
  const total = 60 * 1440;
  for (let m = 0; m < total; m++) {
    w.step(1);
    minutes[w.mode]++;
  }
  for (const k of Object.keys(minutes) as WeatherMode[]) minutes[k] /= total;
  return minutes;
}

describe('seasons', () => {
  it('turn every week: 가을 -> 겨울 -> 봄 -> 여름 -> 가을', () => {
    expect(SEASON_DAYS).toBe(7);
    expect([1, 7, 8, 15, 22, 29].map((d) => seasonOfDay(d).id)).toEqual([
      'autumn',
      'autumn',
      'winter',
      'spring',
      'summer',
      'autumn',
    ]);
    expect(dayInSeason(8)).toBe(1);
    expect(dayInSeason(14)).toBe(7);
  });

  it('snow only in winter (and more often than rain there); summer brings the most (short) showers', () => {
    const autumn = weatherShares(1);
    const winter = weatherShares(8);
    const summer = weatherShares(22);
    expect(autumn.snow).toBe(0);
    expect(summer.snow).toBe(0);
    expect(winter.snow).toBeGreaterThan(winter.rain);
    expect(winter.snow).toBeGreaterThan(0.05);
    // more rain spells in summer, each about half as long
    expect(summer.rain).toBeGreaterThan(0.05);
  });

  it('each season (but autumn) has its own event call, and it changes what people order', () => {
    expect(activeDemandEvents(false, false, '', false, 'winter').map((e) => e.id)).toEqual(['winter_snack']);
    expect(activeDemandEvents(false, false, '', false, 'spring').map((e) => e.id)).toEqual(['spring_picnic']);
    expect(activeDemandEvents(false, false, '', false, 'summer').map((e) => e.id)).toEqual(['summer_cool']);
    expect(activeDemandEvents(false, false, '', false, 'autumn')).toEqual([]);
    // snowing in winter: the snow soup first, then the winter snack
    expect(activeDemandEvents(false, false, '', true, 'winter').map((e) => e.id)).toEqual([
      'snow_warm',
      'winter_snack',
    ]);
    const menus = ['고기만두', '짜장면', '김치찌개', '탕수육'];
    const rand = seeded(3);
    let dumplings = 0;
    for (let i = 0; i < 400; i++) if (pickMenu(menus, [DEMAND_EVENTS.winter_snack], rand) === '고기만두') dumplings++;
    expect(dumplings / 400).toBeGreaterThan(0.45);
    expect(DEMAND_EVENTS.summer_cool.menu.test('물냉면')).toBe(true);
    expect(DEMAND_EVENTS.spring_picnic.menu.test('참치김밥')).toBe(true);
  });
});
