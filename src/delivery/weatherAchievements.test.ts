import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  HEAT_COLD_COUNTER,
  MONSOON_COUNTER,
  QUICK_REPLY_COUNTER,
  makeDayRecord,
  parseDayHistory,
  weekSummary,
} from './careerHistory';
import { settlementGoalCounters } from './shiftProgress';
import { ROTATING_WEEK_GOALS } from './weeklyGoals';
import { buildDeliveryOrder, createActiveMission } from './orderFactory';
import type { DeliveryLocation } from '../types';

const shop: DeliveryLocation = {
  id: 's',
  name: '카페',
  x: 0,
  z: 0,
  type: 'shop',
  emoji: '☕',
  menus: ['아이스 아메리카노'],
};
const home: DeliveryLocation = { id: 'h', name: '집', x: 100, z: 0, type: 'residential', emoji: '🏠' };
const mission = () =>
  createActiveMission(
    buildDeliveryOrder({
      id: 'o',
      orderNumber: 'A-1',
      type: 'SINGLE',
      shop,
      customer: home,
      surcharges: { rainBonus: 0, nightBonus: 0, peakBonus: 0 },
    }),
    0,
    () => 0.99,
  );
const pay = { peakBonus: 0, rainBonus: 1500, nightBonus: 0, specialBonus: 0 };

describe('weather and season achievements', () => {
  it('a delivery counts its season, 장마 rain and heatwave chill', () => {
    const m = mission();
    m.foodTemp = 90;
    const keys = settlementGoalCounters(m, pay, () => 'x', { season: 'summer', monsoon: true, heatwave: true });
    expect(keys).toEqual(expect.arrayContaining(['season:summer', MONSOON_COUNTER, HEAT_COLD_COUNTER]));
    m.foodTemp = 50; // gone lukewarm: no heatwave credit
    expect(settlementGoalCounters(m, pay, () => 'x', { heatwave: true })).not.toContain(HEAT_COLD_COUNTER);
    expect(settlementGoalCounters(m, { ...pay, rainBonus: 0 }, () => 'x', { monsoon: true })).not.toContain(
      MONSOON_COUNTER,
    );
  });

  it('사계절 라이더 needs a delivery in every season; the others count their counters', () => {
    const a = (id: string) => ACHIEVEMENTS.find((x) => x.id === id)!;
    const stats = (counters: Record<string, number>) => ({
      lifetimeCompleted: 0,
      counters,
      history: [],
      districtIds: [],
    });
    expect(a('four_seasons').progress(stats({ 'season:autumn': 3, 'season:winter': 1 }))).toBe(2);
    expect(
      a('four_seasons').progress(
        stats({ 'season:autumn': 1, 'season:winter': 1, 'season:spring': 1, 'season:summer': 2 }),
      ),
    ).toBe(4);
    expect(a('reply20').progress(stats({ [QUICK_REPLY_COUNTER]: 7 }))).toBe(7);
    for (const id of ['monsoon', 'heatcool', 'icepass']) expect(a(id)).toBeDefined();
  });

  it('days keep their rain / snow deliveries and quick replies; the week adds them up for the new weekly goals', () => {
    const rec = makeDayRecord({
      day: 3,
      completedCount: 6,
      grossIncome: 50000,
      totalExpenses: 5000,
      netProfit: 45000,
      pedestrianAccidentCount: 0,
      goalsMet: 2,
      goalsTotal: 5,
      counters: { rain: 3, snow: 1, [QUICK_REPLY_COUNTER]: 2 },
    });
    expect(rec).toMatchObject({ weatherDeliveries: 4, quickReplies: 2 });
    const [back] = parseDayHistory(JSON.parse(JSON.stringify([rec])));
    expect(back).toMatchObject({ weatherDeliveries: 4, quickReplies: 2 });
    const w = weekSummary([rec, { ...rec, day: 4 }], 4);
    expect(w).toMatchObject({ weatherDeliveries: 8, quickReplies: 4 });
    const goal = (id: string) => ROTATING_WEEK_GOALS.find((g) => g.id === id)!;
    expect(goal('week_weather').progress(w)).toBe(8);
    expect(goal('week_replies').progress(w)).toBe(4);
  });
});
