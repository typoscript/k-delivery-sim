import { describe, expect, it } from 'vitest';
import { CLEAN_GOAL, DELIVERIES_GOAL, ROTATING_GOALS, SAFE_GOAL, ShiftGoalId, goalsForDay, goalsToAward, shiftGoalStatuses } from './ShiftDay';

const DISTRICTS = [
  { id: 'ingye', label: '인계동' },
  { id: 'gwanggyo', label: '광교' },
];

const state = (completedCount: number, counters: Record<string, number> = {}, accidents = 0, claimed: ShiftGoalId[] = []) => ({
  completedCount,
  pedestrianAccidentCount: accidents,
  counters,
  claimed: new Set(claimed),
});

describe('daily goals', () => {
  it('every day has 배달 3건 first, two different rotating goals, and the two clock-out goals last', () => {
    for (let day = 1; day <= 60; day++) {
      const g = goalsForDay(day, DISTRICTS);
      expect(g).toHaveLength(5);
      expect(g[0]).toBe(DELIVERIES_GOAL);
      expect(g[3]).toBe(SAFE_GOAL);
      expect(g[4]).toBe(CLEAN_GOAL);
      expect(g[1].id).not.toBe(g[2].id);
    }
    expect(goalsForDay(7, DISTRICTS)).toEqual(goalsForDay(7, DISTRICTS)); // same day, same goals
  });

  it('rotates through the whole pool, district goals included', () => {
    const seen = new Set<string>();
    for (let day = 1; day <= 200; day++) for (const g of goalsForDay(day, DISTRICTS)) seen.add(g.id);
    for (const g of ROTATING_GOALS) expect(seen.has(g.id)).toBe(true);
    expect(seen.has('district:gwanggyo')).toBe(true);
    const district = goalsForDay(1, DISTRICTS).concat(...Array.from({ length: 50 }, (_, i) => goalsForDay(i + 2, DISTRICTS))).find((g) => g.id === 'district:gwanggyo')!;
    expect(district.title).toBe('광교에서 배달 3건');
  });

  it('rotating goals read their counter; the clock-out goal only pays at clock-out', () => {
    const goals = [DELIVERIES_GOAL, ROTATING_GOALS.find((g) => g.id === 'villa')!, SAFE_GOAL];
    expect(goalsToAward(goals, state(3, { villa: 1 }), 'delivery').map((g) => g.id)).toEqual(['deliveries']);
    expect(goalsToAward(goals, state(3, { villa: 2 }, 0, ['deliveries']), 'delivery').map((g) => g.id)).toEqual(['villa']);
    expect(goalsToAward(goals, state(3, {}, 0, ['deliveries']), 'clock_out').map((g) => g.id)).toEqual(['safe']);
    expect(goalsToAward(goals, state(3, {}, 1, ['deliveries']), 'clock_out')).toEqual([]);
  });

  it('never pays a claimed goal twice and caps progress at the target', () => {
    const goals = [DELIVERIES_GOAL, ROTATING_GOALS.find((g) => g.id === 'night')!];
    expect(goalsToAward(goals, state(9, { night: 5 }, 0, ['deliveries', 'night']), 'delivery')).toEqual([]);
    const st = shiftGoalStatuses(goals, state(9, { night: 1 }));
    expect(st[0].current).toBe(3);
    expect(st[0].progressPct).toBe(100);
    expect(st[1].progressPct).toBe(50);
  });
});

describe('goals that can no longer be met today', () => {
  it('an accident fails 무사고 퇴근, a traffic violation fails 무위반 퇴근', () => {
    const goals = goalsForDay(1, DISTRICTS);
    const st = (accidents: number, violations: number) =>
      shiftGoalStatuses(goals, { completedCount: 1, pedestrianAccidentCount: accidents, counters: { _violations: violations }, claimed: new Set() });
    const by = (s: ReturnType<typeof st>, id: string) => s.find((g) => g.id === id)!;
    expect(by(st(0, 0), 'safe').failed).toBe(false);
    expect(by(st(0, 0), 'clean').failed).toBe(false);
    expect(by(st(1, 0), 'safe').failed).toBe(true);
    expect(by(st(1, 0), 'clean').failed).toBe(false);
    expect(by(st(0, 2), 'clean').failed).toBe(true);
    expect(st(1, 2).filter((g) => g.failed).map((g) => g.id)).toEqual(['safe', 'clean']);
  });
});
