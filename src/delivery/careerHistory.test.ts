import { describe, expect, it } from 'vitest';
import {
  CareerStats,
  DayRecord,
  MAX_DAY_HISTORY,
  STAR_COUNT_COUNTER,
  STAR_SUM_COUNTER,
  achievementStatuses,
  appendDay,
  bestDay,
  makeDayRecord,
  newlyUnlocked,
  parseCountMap,
  parseDayHistory,
  safeDayStreak,
} from './careerHistory';

const day = (d: number, deliveries: number, net: number, accidents = 0): DayRecord => ({
  day: d,
  deliveries,
  income: net,
  expenses: 0,
  net,
  avgStars: null,
  goalsMet: 0,
  goalsTotal: 4,
  accidents,
});

const stats = (over: Partial<CareerStats> = {}): CareerStats => ({
  lifetimeCompleted: 0,
  counters: {},
  history: [],
  districtIds: ['ingye', 'gwanggyo'],
  ...over,
});

describe('career history', () => {
  it('makes a day record with the average review stars', () => {
    const rec = makeDayRecord({
      day: 3,
      completedCount: 4,
      grossIncome: 21000.4,
      totalExpenses: 3000,
      netProfit: 18000.4,
      pedestrianAccidentCount: 0,
      goalsMet: 2,
      goalsTotal: 4,
      counters: { [STAR_SUM_COUNTER]: 18, [STAR_COUNT_COUNTER]: 4 },
    });
    expect(rec).toMatchObject({ day: 3, deliveries: 4, net: 18000, avgStars: 4.5, goalsMet: 2 });
    expect(makeDayRecord({ ...rec, completedCount: 0, grossIncome: 0, totalExpenses: 0, netProfit: 0, pedestrianAccidentCount: 0, counters: {} }).avgStars).toBeNull();
  });

  it('keeps days sorted, replaces the same day and caps the length', () => {
    let h: DayRecord[] = [];
    for (let d = 1; d <= MAX_DAY_HISTORY + 5; d++) h = appendDay(h, day(d, 3, d * 100));
    expect(h).toHaveLength(MAX_DAY_HISTORY);
    expect(h[0].day).toBe(6);
    h = appendDay(h, day(10, 9, 1));
    expect(h.filter((d) => d.day === 10)).toEqual([day(10, 9, 1)]);
    expect(h.map((d) => d.day)).toEqual([...h.map((d) => d.day)].sort((a, b) => a - b));
  });

  it('counts the accident-free streak from the newest day back', () => {
    const h = [day(1, 5, 1), day(2, 5, 1, 1), day(3, 3, 1), day(4, 4, 1)];
    expect(safeDayStreak(h)).toBe(2);
    expect(safeDayStreak([...h, day(5, 2, 1)])).toBe(0); // too few deliveries breaks it
    expect(bestDay([day(1, 1, 500), day(2, 1, 9000), day(3, 1, -200)])?.day).toBe(2);
  });

  it('unlocks achievements from lifetime counters, streaks and districts', () => {
    expect(newlyUnlocked(stats(), {})).toEqual([]);
    const s = stats({
      lifetimeCompleted: 50,
      counters: { far: 1, 'district:ingye': 3, 'district:gwanggyo': 1 },
      history: [day(1, 3, 1000), day(2, 3, 52000), day(3, 4, 1000)],
    });
    const ids = newlyUnlocked(s, {}).map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['first', 'd50', 'far', 'safe3', 'bigday', 'everywhere']));
    expect(ids).not.toContain('d200');
    expect(ids).not.toContain('safe7');
    // Already recorded ones are not announced again
    expect(newlyUnlocked(s, { first: 1, d50: 2 }).map((a) => a.id)).not.toContain('first');

    const st = achievementStatuses(stats({ lifetimeCompleted: 120 }), { first: 2 });
    expect(st.find((a) => a.id === 'first')).toMatchObject({ unlocked: true, unlockedDay: 2 });
    expect(st.find((a) => a.id === 'd200')).toMatchObject({ unlocked: false, current: 120, target: 200 });
  });

  it('validates saved history and counter maps', () => {
    const h = parseDayHistory([
      { day: 2, deliveries: 3, net: 1000, avgStars: 9, goalsMet: 7, goalsTotal: 4, accidents: -1 },
      { day: 1, deliveries: 2.7, net: 500 },
      { day: 'x', deliveries: 1, net: 1 },
      null,
      { day: 2, deliveries: 5, net: 2000 },
    ]);
    expect(h.map((d) => d.day)).toEqual([1, 2]);
    expect(h[0].deliveries).toBe(2);
    expect(h[1]).toMatchObject({ deliveries: 5, net: 2000, avgStars: null });
    expect(parseDayHistory('nope')).toEqual([]);
    expect(parseCountMap({ far: 2.9, villa: -1, bad: 'x', ['k'.repeat(80)]: 3 })).toEqual({ far: 2 });
    expect(parseCountMap([1, 2])).toEqual({});
  });
});
