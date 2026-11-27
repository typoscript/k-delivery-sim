import { describe, expect, it } from 'vitest';
import {
  DAY_JUMP_MINUTE,
  DEMAND_PHASES,
  GameClock,
  NIGHT_JUMP_MINUTE,
  PEAK_SURCHARGE_BONUS,
  SHIFT_START_MINUTE,
  demandPhaseAt,
  formatClock,
  isNightAt,
  nightnessAt,
} from './GameClock';

const hm = (h: number, m = 0) => h * 60 + m;

describe('GameClock time of day', () => {
  it('formats and wraps around midnight', () => {
    expect(formatClock(hm(9, 5))).toBe('09:05');
    expect(formatClock(hm(23, 59) + 2)).toBe('00:01');
    expect(formatClock(-30)).toBe('23:30');
    const c = new GameClock(hm(23, 59));
    c.advance(2); // 1 real second = 1 game minute
    expect(c.label).toBe('00:01');
  });

  it('is day at noon, night at midnight, and ramps smoothly through dusk and dawn', () => {
    expect(nightnessAt(hm(12))).toBe(0);
    expect(nightnessAt(hm(0))).toBe(1);
    expect(nightnessAt(hm(18, 30))).toBe(0);
    expect(nightnessAt(hm(19, 30))).toBe(1);
    expect(nightnessAt(hm(19))).toBeCloseTo(0.5);
    expect(nightnessAt(hm(6))).toBeCloseTo(0.5);
    // monotonic through dusk, no jumps
    let prev = 0;
    for (let m = hm(18, 30); m <= hm(19, 30); m++) {
      const n = nightnessAt(m);
      expect(n).toBeGreaterThanOrEqual(prev);
      expect(n - prev).toBeLessThan(0.05);
      prev = n;
    }
    expect(isNightAt(hm(18, 50))).toBe(false);
    expect(isNightAt(hm(19, 10))).toBe(true);
    expect(isNightAt(hm(5, 50))).toBe(true);
    expect(isNightAt(hm(6, 10))).toBe(false);
  });

  it('N skips to the evening by day and to the morning by night', () => {
    const c = new GameClock(hm(12));
    expect(c.toggleDayNight()).toBe(true);
    expect(c.minute).toBe(NIGHT_JUMP_MINUTE);
    expect(c.toggleDayNight()).toBe(false);
    expect(c.minute).toBe(DAY_JUMP_MINUTE);
  });
});

describe('demand phases', () => {
  it('cover the whole day without gaps or overlaps', () => {
    for (let m = 0; m < 1440; m++) {
      expect(DEMAND_PHASES.filter((p) => m >= p.startMin && m < p.endMin)).toHaveLength(1);
    }
  });

  it('lunch and dinner rushes bring calls faster with a surcharge; dawn is slow', () => {
    for (const t of [hm(12), hm(18, 30)]) {
      const p = demandPhaseAt(t);
      expect(p.isPeak).toBe(true);
      expect(p.peakBonus).toBe(PEAK_SURCHARGE_BONUS);
      expect(p.offerIntervalMul).toBeLessThan(0.5);
      expect(p.cookingMul).toBeGreaterThan(1);
    }
    expect(demandPhaseAt(hm(15)).isPeak).toBe(false);
    expect(demandPhaseAt(hm(15)).peakBonus).toBe(0);
    expect(demandPhaseAt(hm(3)).offerIntervalMul).toBeGreaterThan(1.5);
  });

  it('the shift starts shortly before the lunch rush', () => {
    expect(demandPhaseAt(SHIFT_START_MINUTE).isPeak).toBe(false);
    expect(demandPhaseAt(SHIFT_START_MINUTE + 25).id).toBe('lunch_peak');
  });
});
