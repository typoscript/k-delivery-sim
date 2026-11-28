import { describe, expect, it } from 'vitest';
import { buildWeatherReport, todaysEventCalls } from './weatherReport';
import { weatherAppHtml } from '../ui/phone/weatherApp';
import { eventOrderChip, eventOrderShort } from '../ui/phone/orderTags';

const base = {
  workDay: 6,
  minute: 12 * 60,
  mode: 'clear',
  forecast: [],
  heatwave: false,
  blackIce: false,
  puddles: 0,
  night: false,
} as const;

describe('오늘의 이벤트 콜', () => {
  it("lists the day's event calls with when they run, the running ones first", () => {
    const lunch = todaysEventCalls({ ...base } as never, 'spring', 18 * 60);
    // spring weekend noon: the season's picnic boxes and the lunch rush run now
    expect(lunch.filter((e) => e.now).map((e) => e.label)).toEqual(['봄 나들이 도시락', '점심 든든 한 끼']);
    const labels = lunch.map((e) => e.label);
    expect(labels).toContain('나들이 콜'); // weekend: the riverside outing is listed
    expect(lunch[0].now).toBe(true);
    // running ones first: no running event after a not-running one
    const firstIdle = lunch.findIndex((e) => !e.now);
    expect(lunch.slice(firstIdle).every((e) => !e.now)).toBe(true);
    // a weekday has no outing; a rainy night runs the soups and the snacks
    const night = todaysEventCalls({ ...base, workDay: 3, minute: 22 * 60, mode: 'rain', night: true } as never, 'autumn', 17 * 60);
    expect(night.map((e) => e.label)).not.toContain('나들이 콜');
    expect(night.filter((e) => e.now).map((e) => e.icon)).toEqual(expect.arrayContaining(['🍲', '🍗']));
  });

  it('the weather app shows the card', () => {
    const html = weatherAppHtml(buildWeatherReport({ ...base } as never));
    expect(html).toContain('오늘의 이벤트 콜');
    expect(html).toContain('지금');
  });

  it('call cards show a short chip, the full condition on hover', () => {
    const o = { demandEvent: 'rain_soup', eventBonus: 1000 } as never;
    expect(eventOrderShort(o)).toBe('🍲+1천');
    expect(eventOrderChip(o)).toContain('title="🍲');
    expect(eventOrderShort({ demandEvent: 'cafe_time', eventBonus: 600 } as never)).toBe('☕+600');
    expect(eventOrderShort({ demandEvent: 'rain_soup', eventBonus: 1500 } as never)).toBe('🍲+1.5천');
  });
});
