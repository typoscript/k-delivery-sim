import { afterEach, describe, expect, it } from 'vitest';
import { DEMAND_EVENTS, eventBonusEarned, eventForOrder, isOutingTime, pickMenu } from './demandEvents';
import { OUTING_WEIGHT, pickLocalCustomer, riversideAccess } from './localPairing';
import { relocateBenchOrders, relocatedSpot } from './riversideHandoff';
import { DeliveryManager } from './DeliveryManager';
import { buildWeatherReport } from '../game/weatherReport';
import type { DeliveryLocation } from '../types';

afterEach(() => {
  riversideAccess.closed = false;
  riversideAccess.outing = false;
});

const res = (id: string, x: number, kind?: 'riverside'): DeliveryLocation => ({
  id,
  name: id,
  x,
  z: 0,
  type: 'residential',
  emoji: '',
  ...(kind ? { residenceKind: kind } : {}),
});

describe('🌿 나들이 콜', () => {
  it('runs on clear weekend afternoons with the walkways open', () => {
    expect(isOutingTime(6, 14 * 60, false, false, false)).toBe(true);
    expect(isOutingTime(14, 17 * 60 + 59, false, false, false)).toBe(true); // day 14 = 7th of week 2
    expect(isOutingTime(5, 14 * 60, false, false, false)).toBe(false); // weekday
    expect(isOutingTime(6, 12 * 60, false, false, false)).toBe(false); // morning
    expect(isOutingTime(6, 14 * 60, true, false, false)).toBe(false); // rain
    expect(isOutingTime(6, 14 * 60, false, false, true)).toBe(false); // flooded
  });

  it('bench orders join it whatever the menu; menus are not biased by it', () => {
    const events = [DEMAND_EVENTS.riverside_outing];
    expect(eventForOrder('제육볶음 정식', res('b', 0, 'riverside'), events)?.id).toBe('riverside_outing');
    expect(eventForOrder('제육볶음 정식', res('a', 0), events)).toBeNull();
    // a bench customer's order is a 나들이 콜 even when its menu belongs to another event
    const both = [DEMAND_EVENTS.autumn_baseball, DEMAND_EVENTS.riverside_outing];
    expect(eventForOrder('후라이드 치킨', res('b', 0, 'riverside'), both)?.id).toBe('riverside_outing');
    expect(eventForOrder('후라이드 치킨', res('a', 0), both)?.id).toBe('autumn_baseball');
    let draws = 0;
    expect(pickMenu(['a', 'b'], events, () => (draws++, 0.1))).toBe('a');
    expect(draws).toBe(1); // same single draw as with no events
    // paid only on time
    const order = { demandEvent: 'riverside_outing' as const, eventBonus: 1000 };
    expect(eventBonusEarned({ foodIntegrity: 100, foodTemp: 100, remainingTimeSec: 10, order })).toBe(1000);
    expect(eventBonusEarned({ foodIntegrity: 100, foodTemp: 100, remainingTimeSec: 0, order })).toBe(0);
  });

  it('makes bench customers more likely', () => {
    const list = [res('a', 300), res('b', 400), res('c', 500), res('bench', 350, 'riverside')];
    const share = () => {
      let n = 0;
      for (let i = 0; i < 400; i++) if (pickLocalCustomer(list, { x: 0, z: 0 }, () => (i + 0.5) / 400).id === 'bench') n++;
      return n / 400;
    };
    const normal = share();
    riversideAccess.outing = true;
    // 1 bench among 4 customers: 1/4 normally, OUTING_WEIGHT/(OUTING_WEIGHT + 3) during the outing
    expect(normal).toBeCloseTo(0.25, 1);
    expect(share()).toBeCloseTo(OUTING_WEIGHT / (OUTING_WEIGHT + 3), 1);
  });

  it('the weather app says so', () => {
    const base = { workDay: 6, minute: 14 * 60, mode: 'clear', forecast: [], heatwave: false, blackIce: false, puddles: 0, night: false } as const;
    expect(buildWeatherReport({ ...base, outing: true } as never).alerts.some((a) => a.title.startsWith('나들이 콜'))).toBe(true);
  });
});

describe('flooded benches', () => {
  const road = (_x: number, z: number) => Math.abs(z - 30) - 5; // a road 30 m north of the bench

  it('the customer moves to the nearest sidewalk spot', () => {
    const spot = relocatedSpot({ x: 0, z: 0 }, road)!;
    const c = road(spot.x, spot.z);
    expect(c).toBeGreaterThanOrEqual(1.5);
    expect(c).toBeLessThanOrEqual(4);
    expect(Math.hypot(spot.x, spot.z)).toBeLessThan(30);
    expect(relocatedSpot({ x: 0, z: 0 }, () => 100)).toBeNull();
  });

  it('bench orders on their way move and the customer messages; a moved order is not moved again', () => {
    const shop: DeliveryLocation = { id: 's1', name: 's1', x: 0, z: 200, type: 'shop', emoji: '', menus: ['김밥'] };
    const bench = { ...res('bench', 0, 'riverside'), facingHeading: 0 };
    const dm = new DeliveryManager([shop, { ...shop, id: 's2', x: 40 }, bench]);
    const o = dm.availableOrders.find((x) => x.customer.id === 'bench')!;
    dm.acceptOrder(o.id);
    expect(relocateBenchOrders(dm, road)).toBe(1);
    const c = dm.getMissionById(o.id)!.order.customer;
    expect(c.relocated).toBe(true);
    expect(c.name).toContain('앞 인도');
    expect(road(c.x, c.z)).toBeGreaterThanOrEqual(1.5);
    expect(dm.messenger.get(`c:${o.id}`)!.messages.at(-1)!.text).toContain('인도');
    expect(relocateBenchOrders(dm, road)).toBe(0);
  });
});
