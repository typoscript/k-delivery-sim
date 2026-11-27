import { describe, expect, it } from 'vitest';
import { computeReputation } from './reputation';

describe('rider reputation', () => {
  it('needs a few reviews before it rises above normal', () => {
    expect(computeReputation([], 5).tier).toBe('normal');
    expect(computeReputation([5, 5], 5).tier).toBe('normal');
    expect(computeReputation([5, 5, 5], 5).tier).toBe('top');
  });

  it('great reviews and a clean record bring better calls; bad ones fewer', () => {
    const top = computeReputation([5, 5, 4, 5, 5], 5);
    expect(top.tier).toBe('top');
    expect(top.specialChanceMul).toBeGreaterThan(1);
    expect(top.offerIntervalMul).toBeLessThan(1);
    expect(computeReputation([5, 4, 4, 5], 4.5).tier).toBe('good');
    const low = computeReputation([2, 3, 3, 4], 5);
    expect(low.tier).toBe('low');
    expect(low.specialChanceMul).toBeLessThan(1);
    expect(low.offerIntervalMul).toBeGreaterThan(1);
  });

  it('pedestrian accidents (trust rating) drag it down and only recent reviews count', () => {
    expect(computeReputation([5, 5, 5, 5], 2.5).tier).toBe('low');
    expect(computeReputation([5, 5, 5, 5], 4.0).tier).toBe('good');
    const old = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 1, 1, 1, 1, 1];
    expect(computeReputation(old, 5).tier).toBe('top'); // the 1-star reviews are older than the window
    expect(computeReputation(old, 5).recentStars).toBe(5);
  });
});
