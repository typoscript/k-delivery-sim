import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadRiderCareer, localDateKey, saveRiderCareer } from './RiderCareer';

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  };
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

const writeRaw = (value: unknown) => {
  // Save once to discover the storage key, then overwrite it with raw test data
  saveRiderCareer(loadRiderCareer());
  const key = [...store.keys()][0];
  store.set(key, JSON.stringify(value));
};

describe('loadRiderCareer', () => {
  it('returns a clean fallback when nothing is saved', () => {
    const c = loadRiderCareer();
    expect(c.walletBalance).toBe(0);
    expect(c.reviews).toEqual([]);
    expect(c.dailyMission).toBeUndefined();
  });

  it('survives corrupted JSON', () => {
    writeRaw({});
    const key = [...store.keys()][0];
    store.set(key, '{not json');
    expect(loadRiderCareer().walletBalance).toBe(0);
  });

  it('clamps review stars to 1..5 and repairs missing tags', () => {
    writeRaw({
      reviews: [
        { comment: 'a', stars: 9, shopName: 's' },
        { comment: 'b', stars: 2.6, shopName: 's', tags: ['#ok', 3] },
        { comment: 'c', stars: Number.NaN, shopName: 's' },
      ],
    });
    const reviews = loadRiderCareer().reviews;
    expect(reviews).toHaveLength(2);
    expect(reviews[0].stars).toBe(5);
    expect(reviews[0].tags).toEqual([]);
    expect(reviews[1].stars).toBe(3);
    expect(reviews[1].tags).toEqual(['#ok']);
    // Rendering must not throw for any loaded review
    for (const r of reviews) expect(() => '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars)).not.toThrow();
  });

  it('round-trips daily mission progress', () => {
    const c = loadRiderCareer();
    c.dailyMission = { date: localDateKey(), progress: 3, claimed: true };
    saveRiderCareer(c);
    expect(loadRiderCareer().dailyMission).toEqual({ date: localDateKey(), progress: 3, claimed: true });
  });

  it('ignores a malformed daily mission entry', () => {
    writeRaw({ dailyMission: { date: 5, progress: 'x' } });
    expect(loadRiderCareer().dailyMission).toBeUndefined();
  });
});

describe('localDateKey', () => {
  it('formats local dates as YYYY-MM-DD', () => {
    expect(localDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
