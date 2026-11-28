import { ShiftSave, parseShiftSave } from './ShiftDay';
import { DayRecord, parseCountMap, parseDayHistory } from './careerHistory';
import { RIDER_UPGRADES, UpgradeId } from './riderCatalog';
import type { CustomerReview } from './customerReviews';

// Catalogs (upgrades, tiers) and the review generator live in their own modules; re-exported so imports stay put
export * from './riderCatalog';
export * from './customerReviews';

export const REGULAR_SHOP_THRESHOLD = 2; // 같은 매장 2회 이상 픽업 시 단골 매장 등극!
export const MAX_STORED_REVIEWS = 25;

export interface RiderCareerSave {
  walletBalance: number;
  lifetimeCompleted: number;
  riderRating: number;
  upgrades: UpgradeId[];
  reviews: CustomerReview[];
  shopPickupCounts: Record<string, number>;
  /** Completed deliveries per customer location (단골 고객 after REGULAR_CUSTOMER_THRESHOLD) */
  customerDeliveryCounts: Record<string, number>;
  shopNames: Record<string, string>;
  /** Current working day on the game clock (day, time, ledger, goals) so a reload resumes the same shift */
  shift?: ShiftSave;
  /** Finished working days (oldest first, newest MAX_DAY_HISTORY) */
  history?: DayRecord[];
  /** Lifetime totals of the daily goal counters (villa, rain, far, district:<id> ...) */
  lifetimeCounters?: Record<string, number>;
  /** Unlocked achievement id -> working day it was unlocked */
  achievements?: Record<string, number>;
}

/** Local calendar date key (YYYY-MM-DD) for daily mission persistence */
export function localDateKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const CAREER_STORAGE_KEY = 'k_delivery_rider_career_v1';
const VALID_UPGRADE_IDS = new Set<string>(Object.keys(RIDER_UPGRADES));

export function loadRiderCareer(): RiderCareerSave {
  const fallback: RiderCareerSave = {
    walletBalance: 0,
    lifetimeCompleted: 0,
    riderRating: 5.0,
    upgrades: [],
    reviews: [],
    shopPickupCounts: {},
    customerDeliveryCounts: {},
    shopNames: {},
  };
  try {
    const raw = window.localStorage.getItem(CAREER_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<RiderCareerSave>;
    const walletBalance =
      typeof parsed.walletBalance === 'number' && Number.isFinite(parsed.walletBalance)
        ? Math.round(parsed.walletBalance)
        : 0;
    const lifetimeCompleted =
      typeof parsed.lifetimeCompleted === 'number' && Number.isFinite(parsed.lifetimeCompleted)
        ? Math.max(0, Math.floor(parsed.lifetimeCompleted))
        : 0;
    const riderRating =
      typeof parsed.riderRating === 'number' && Number.isFinite(parsed.riderRating)
        ? Math.max(0, Math.min(5.0, Math.round(parsed.riderRating * 10) / 10))
        : 5.0;
    const upgrades: UpgradeId[] = Array.isArray(parsed.upgrades)
      ? Array.from(
          new Set(parsed.upgrades.filter((u): u is UpgradeId => typeof u === 'string' && VALID_UPGRADE_IDS.has(u)))
        )
      : [];
    const reviews: CustomerReview[] = Array.isArray(parsed.reviews)
      ? parsed.reviews
          .filter(
            (r): r is CustomerReview =>
              !!r &&
              typeof r === 'object' &&
              typeof r.comment === 'string' &&
              typeof r.stars === 'number' &&
              Number.isFinite(r.stars) &&
              typeof r.shopName === 'string'
          )
          .slice(0, MAX_STORED_REVIEWS)
          .map((r) => ({
            ...r,
            stars: Math.max(1, Math.min(5, Math.round(r.stars))),
            tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string') : [],
          }))
      : [];
    const positiveCounts = (raw: unknown): Record<string, number> => {
      const out: Record<string, number> = {};
      if (raw && typeof raw === 'object') {
        for (const [k, v] of Object.entries(raw)) {
          if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = Math.floor(v);
        }
      }
      return out;
    };
    const shopPickupCounts = positiveCounts(parsed.shopPickupCounts);
    const customerDeliveryCounts = positiveCounts(parsed.customerDeliveryCounts);
    const shopNames: Record<string, string> = {};
    if (parsed.shopNames && typeof parsed.shopNames === 'object') {
      for (const [k, v] of Object.entries(parsed.shopNames)) {
        if (typeof v === 'string' && v.length > 0) {
          shopNames[k] = v;
        }
      }
    }
    const shift = parseShiftSave(parsed.shift);
    return {
      history: parseDayHistory(parsed.history),
      lifetimeCounters: parseCountMap(parsed.lifetimeCounters),
      achievements: parseCountMap(parsed.achievements),
      walletBalance,
      lifetimeCompleted,
      riderRating,
      upgrades,
      reviews,
      shopPickupCounts,
      customerDeliveryCounts,
      shopNames,
      shift,
    };
  } catch {
    return fallback;
  }
}

export function saveRiderCareer(career: RiderCareerSave): void {
  try {
    window.localStorage.setItem(CAREER_STORAGE_KEY, JSON.stringify(career));
  } catch {
    // ignore storage quota errors
  }
}
