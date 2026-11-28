import { describe, expect, it } from 'vitest';
import { ROTATING_WEEK_GOALS, WEEK_DELIVERIES_GOAL, weekGoalProgressPct, weekGoalProgressText, weekGoalStatuses, weekGoalsFor, weekGoalsSummaryText } from './weeklyGoals';
import type { WeekGoalStatus } from './weeklyGoals';
import { weekSummary, DayRecord } from './careerHistory';

const day = (d: number, deliveries: number, net: number, accidents = 0, avgStars: number | null = 4.6): DayRecord => ({
  day: d,
  deliveries,
  income: net,
  expenses: 0,
  net,
  avgStars,
  goalsMet: 0,
  goalsTotal: 4,
  accidents,
});

describe('weekly goals', () => {
  it('every week has the delivery goal plus two different rotating goals, the same after reloads', () => {
    for (let week = 1; week <= 12; week++) {
      const g = weekGoalsFor(week);
      expect(g).toHaveLength(3);
      expect(g[0]).toBe(WEEK_DELIVERIES_GOAL);
      expect(g[1]).not.toBe(g[2]);
      expect(ROTATING_WEEK_GOALS).toContain(g[1]);
      expect(weekGoalsFor(week).map((x) => x.id)).toEqual(g.map((x) => x.id));
    }
    // the rotation actually varies across weeks
    expect(new Set([1, 2, 3, 4, 5, 6, 7, 8].map((w) => weekGoalsFor(w).slice(1).map((x) => x.id).join())).size).toBeGreaterThan(2);
  });

  it('checks a week against every goal kind', () => {
    const full = [1, 2, 3, 4, 5, 6, 7].map((d) => day(d, 4, 32000));
    const w = weekSummary(full, 7);
    const byId = Object.fromEntries(
      [WEEK_DELIVERIES_GOAL, ...ROTATING_WEEK_GOALS].map((g) => [g.id, g.progress(w) >= g.target])
    );
    expect(byId).toEqual({ week_deliveries: true, week_safe: true, week_net: true, week_all_days: true, week_stars: true });
    const weak = weekSummary([day(1, 2, 9000, 1, 3.9), day(3, 3, 12000)], 7);
    expect(weekGoalStatuses(weak).every((g) => !g.met)).toBe(true);
  });

  it('formats progress by unit', () => {
    const [deliveries] = weekGoalStatuses(weekSummary([day(1, 30, 1)], 1));
    expect(weekGoalProgressText(deliveries)).toBe('25/25');
    expect(weekGoalProgressText({ ...deliveries, unit: 'won', current: 152000.4, target: 200000 })).toBe('₩152,000 / ₩200,000');
    expect(weekGoalProgressText({ ...deliveries, unit: 'stars', current: 4.33, target: 4.5 })).toBe('★ 4.3 / 4.5');
    expect(weekGoalProgressText({ ...deliveries, unit: 'stars', current: 0, target: 4.5 })).toBe('★ - / 4.5');
  });
});

describe('week goal display helpers', () => {
  const g = (over: Partial<WeekGoalStatus>): WeekGoalStatus => ({ id: 'week_deliveries', icon: '📦', title: '주간 배달 25건', target: 25, bonus: 20000, current: 18, met: false, unit: 'count', ...over });
  it('progress percent is clamped to 0..100', () => {
    expect(weekGoalProgressPct(g({}))).toBe(72);
    expect(weekGoalProgressPct(g({ current: 40 }))).toBe(100);
    expect(weekGoalProgressPct(g({ current: -3 }))).toBe(0);
    expect(weekGoalProgressPct(g({ unit: 'won', current: 152000, target: 200000 }))).toBe(76);
  });
  it('summary line marks met goals', () => {
    expect(weekGoalsSummaryText([g({}), g({ id: 'week_all_days', icon: '📅', current: 7, target: 7, met: true })])).toBe('📦 18/25 · ✅ 7/7');
  });
});
