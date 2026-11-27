import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadRiderCareer, localDateKey, saveRiderCareer } from './RiderCareer';
import { emptyShift } from './ShiftDay';

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
    expect(c.shift).toBeUndefined();
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

  it('round-trips the current shift (day, clock, goals, ledger)', () => {
    const c = loadRiderCareer();
    const shift = emptyShift(4, 13 * 60 + 5);
    shift.counters = { peak: 2, 'district:gwanggyo': 1 };
    shift.claimed = ['deliveries', 'peak'];
    shift.ledger.completedCount = 5;
    shift.ledger.peakBonusTotal = 2000;
    c.shift = shift;
    saveRiderCareer(c);
    expect(loadRiderCareer().shift).toEqual(shift);
  });

  it('repairs or drops a malformed shift entry', () => {
    writeRaw({ shift: { day: 'x', clockMinute: 5 } });
    expect(loadRiderCareer().shift).toBeUndefined();
    writeRaw({ shift: { day: 0, clockMinute: 1500, claimed: ['peak', 'bogus', 'peak'], ledger: { tipTotal: 'a', fineExpense: 1000.4 } } });
    const s = loadRiderCareer().shift!;
    expect(s.day).toBe(1);
    expect(s.clockMinute).toBe(60);
    expect(s.claimed).toEqual(['peak', 'bogus']); // de-duplicated; unknown ids are harmless
    expect(s.ledger.tipTotal).toBe(0);
    expect(s.ledger.fineExpense).toBe(1000);
    expect(s.counters).toEqual({});
  });

  it('migrates the old rush-hour count into the goal counters', () => {
    writeRaw({ shift: { day: 3, clockMinute: 700, peakDeliveries: 2, claimed: [], ledger: {} } });
    expect(loadRiderCareer().shift!.counters).toEqual({ peak: 2 });
  });
});

describe('localDateKey', () => {
  it('formats local dates as YYYY-MM-DD', () => {
    expect(localDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
