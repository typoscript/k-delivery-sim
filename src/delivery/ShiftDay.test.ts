import { describe, expect, it } from 'vitest';
import { ShiftGoalId, goalsToAward, shiftGoalStatuses } from './ShiftDay';

const state = (completedCount: number, peakDeliveries: number, accidents = 0, claimed: ShiftGoalId[] = []) => ({
  completedCount,
  peakDeliveries,
  pedestrianAccidentCount: accidents,
  claimed: new Set(claimed),
});

describe('shift goals', () => {
  it('the accident-free goal is only paid at clock-out', () => {
    expect(goalsToAward(state(3, 0), 'delivery').map((g) => g.id)).toEqual(['deliveries']);
    expect(goalsToAward(state(3, 0, 0, ['deliveries']), 'clock_out').map((g) => g.id)).toEqual(['safe']);
    expect(goalsToAward(state(3, 0, 1, ['deliveries']), 'clock_out')).toEqual([]);
  });

  it('never pays a claimed goal twice and caps progress at the target', () => {
    expect(goalsToAward(state(9, 5, 0, ['deliveries', 'peak']), 'delivery')).toEqual([]);
    const st = shiftGoalStatuses(state(9, 1));
    expect(st[0].current).toBe(3);
    expect(st[0].progressPct).toBe(100);
    expect(st[1].progressPct).toBe(50);
  });
});
