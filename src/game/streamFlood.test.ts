import { afterEach, describe, expect, it } from 'vitest';
import { CLOSE_LEVEL, MONSOON_RISE_MUL, OPEN_LEVEL, RISE_PER_MIN, StreamFlood } from './streamFlood';
import { pickLocalCustomer, riversideAccess } from '../delivery/localPairing';
import { floodGeometry, FLOOD_Y } from '../world/floodOverlay';
import { buildWeatherReport } from './weatherReport';
import type { DeliveryLocation } from '../types';

afterEach(() => {
  riversideAccess.closed = false;
});

describe('streams rise in the rain', () => {
  it('closes the walkways after hours of rain (sooner in 장마) and reopens once the water falls', () => {
    const f = new StreamFlood();
    let closedAt = -1;
    for (let m = 1; m <= 300 && closedAt < 0; m++) if (f.step(1, true, false) === 'closed') closedAt = m;
    // about 1.5 game hours of rain (float steps may take one more minute)
    expect(Math.abs(closedAt - CLOSE_LEVEL / RISE_PER_MIN)).toBeLessThanOrEqual(1);
    expect(f.rising).toBe(false); // closed, not "rising"
    const monsoon = new StreamFlood();
    let mAt = -1;
    for (let m = 1; m <= 300 && mAt < 0; m++) if (monsoon.step(1, true, true) === 'closed') mAt = m;
    expect(mAt).toBeLessThan(closedAt / MONSOON_RISE_MUL + 2);
    // a short dry spell does not reopen it (hysteresis), a long one does
    expect(f.step(10, false, false)).toBeNull();
    let openedAfter = 10;
    while (f.step(1, false, false) !== 'opened') openedAfter++;
    expect(f.level).toBeLessThanOrEqual(OPEN_LEVEL);
    expect(openedAfter).toBeGreaterThan(60);
  });

  it('no new bench calls while closed', () => {
    const shop = { x: 0, z: 0 };
    const res = (id: string, x: number, kind?: 'riverside'): DeliveryLocation => ({
      id,
      name: id,
      x,
      z: 0,
      type: 'residential',
      emoji: '',
      ...(kind ? { residenceKind: kind } : {}),
    });
    const list = [res('a', 300), res('b', 400), res('c', 500), res('bench', 350, 'riverside')];
    riversideAccess.closed = true;
    for (let i = 0; i < 20; i++) expect(pickLocalCustomer(list, shop, () => i / 20).id).not.toBe('bench');
    riversideAccess.closed = false;
    expect(list.map((_, i) => pickLocalCustomer(list, shop, () => i / 4 + 0.01).id)).toContain('bench');
  });

  it('the flood sheet covers the walkways but not a road across the stream', () => {
    const stream = { name: '수원천', width: 10, pts: [[0, 0], [0, 100]] as Array<[number, number]> };
    const all = floodGeometry([stream])!;
    const road = (_x: number, z: number) => Math.abs(z - 50) - 6;
    const cut = floodGeometry([stream], road)!;
    expect(cut.attributes.position.count).toBeLessThan(all.attributes.position.count);
    const ys = new Set(Array.from(all.attributes.position.array).filter((_, i) => i % 3 === 1));
    expect(ys.size).toBe(1);
    expect([...ys][0]).toBeCloseTo(FLOOD_Y);
    const xs = Array.from(all.attributes.position.array).filter((_, i) => i % 3 === 0);
    expect(Math.max(...xs)).toBeGreaterThan(5 + 1.8); // wider than the water: over the walkways
    expect(floodGeometry([])).toBeNull();
  });

  it('the weather app says so', () => {
    const base = { workDay: 3, minute: 13 * 60, mode: 'rain', forecast: [], heatwave: false, blackIce: false, puddles: 0, night: false } as const;
    const titles = (streams: 'closed' | 'rising' | 'normal') => buildWeatherReport({ ...base, streams } as never).alerts.map((a) => a.title);
    expect(titles('closed')).toContain('하천 산책로 통제');
    expect(titles('rising')).toContain('하천 수위 상승');
    expect(titles('normal').some((t) => t.startsWith('하천'))).toBe(false);
  });
});
