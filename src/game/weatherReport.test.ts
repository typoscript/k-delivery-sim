import { describe, expect, it } from 'vitest';
import { buildWeatherReport, precipitationOdds, temperatureAt } from './weatherReport';
import { weatherAppHtml } from '../ui/phone/weatherApp';
import type { WeatherReportInput } from './weatherReport';

const base: WeatherReportInput = {
  workDay: 1,
  minute: 13 * 60,
  mode: 'clear',
  forecast: ['clear', 'cloudy', 'rain', 'rain', 'cloudy', 'clear'],
  heatwave: false,
  blackIce: false,
  puddles: 0,
  night: false,
};
const titles = (i: Partial<WeatherReportInput>) => buildWeatherReport({ ...base, ...i }).alerts.map((a) => a.title);

describe('weather app report', () => {
  it('temperature: warm summer afternoons, freezing winter nights, cooler under rain', () => {
    expect(temperatureAt('summer', 15 * 60, 'clear')).toBeGreaterThan(30);
    expect(temperatureAt('winter', 4 * 60, 'clear')).toBeLessThan(0);
    expect(temperatureAt('autumn', 15 * 60, 'rain')).toBeLessThan(temperatureAt('autumn', 15 * 60, 'clear'));
    expect(temperatureAt('summer', 14 * 60, 'clear', true)).toBeGreaterThanOrEqual(33);
  });

  it('season, day and sunrise / sunset of the working day', () => {
    const r = buildWeatherReport({ ...base, workDay: 9 });
    expect(r.season).toMatchObject({ id: 'winter', day: 2, days: 7 });
    expect(r.sunset < '18:00').toBe(true); // early winter dusk
    expect(buildWeatherReport({ ...base, workDay: 23 }).sunset > '19:30').toBe(true); // long summer day
  });

  it("today's rider warnings follow the game state", () => {
    expect(titles({ heatwave: true, workDay: 22 })).toContain('폭염 경보');
    expect(titles({ blackIce: true, workDay: 9, night: true })).toContain('도로 결빙 (블랙아이스)');
    expect(titles({ workDay: 9 })).toContain('밤사이 결빙 예상');
    expect(titles({ workDay: 24 }).some((t) => t.startsWith('장마'))).toBe(true);
    expect(titles({ mode: 'rain', puddles: 30 })).toEqual(expect.arrayContaining(['우천 할증 +₩1,500', '물웅덩이']));
    expect(titles({ mode: 'snow', workDay: 9 })).toContain('강설 할증 +₩2,000');
    // the season's event call is always listed (autumn: baseball chicken)
    expect(titles({}).some((t) => t.includes('가을 야구 치맥'))).toBe(true);
  });

  it('hourly forecast from the schedule, and tomorrow (a new season / 장마 is announced)', () => {
    const r = buildWeatherReport(base);
    expect(r.hourly.map((h) => h.mode)).toEqual(base.forecast);
    expect(r.hourly[0].label).toBe('14시');
    expect(buildWeatherReport({ ...base, workDay: 7 }).tomorrow.note).toContain('겨울');
    expect(buildWeatherReport({ ...base, workDay: 23 }).tomorrow.note).toContain('장마');
    const odds = precipitationOdds(24); // a 장마 day
    expect(odds.rainPct).toBeGreaterThan(precipitationOdds(2).rainPct);
  });

  it('the app screen shows the weather, the warnings and tomorrow', () => {
    const html = weatherAppHtml(buildWeatherReport({ ...base, mode: 'rain', puddles: 3 }));
    expect(html).toContain('시간별 예보');
    expect(html).toContain('물웅덩이');
    expect(html).toContain('내일');
    expect(html).toContain('°');
  });
});
