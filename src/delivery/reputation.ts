/**
 * Rider reputation (평판): recent customer review stars + the rider trust rating decide how good the calls are.
 * Good riders get special orders (higher pay) more often and calls a little faster; a poor reputation means
 * fewer specials and longer waits between calls. Pure, unit tested.
 */

export type ReputationTier = 'top' | 'good' | 'normal' | 'low';

export interface Reputation {
  tier: ReputationTier;
  icon: string;
  label: string;
  /** Multiplier on the chance that a 한집배달 call is a special order */
  specialChanceMul: number;
  /** Multiplier on the wait between call offers (< 1 = faster) */
  offerIntervalMul: number;
  /** Average of the recent review stars considered (null when there are none yet) */
  recentStars: number | null;
  description: string;
}

/** Tiers from worst to best */
export const REPUTATION_ORDER: readonly ReputationTier[] = ['low', 'normal', 'good', 'top'];

/** How many of the newest reviews count */
export const REPUTATION_REVIEW_WINDOW = 10;

const TIERS: Record<ReputationTier, Omit<Reputation, 'recentStars'>> = {
  top: { tier: 'top', icon: '🏅', label: '평판 최우수', specialChanceMul: 1.8, offerIntervalMul: 0.85, description: '특별 주문이 훨씬 자주 오고 콜 간격이 짧아요' },
  good: { tier: 'good', icon: '👍', label: '평판 우수', specialChanceMul: 1.3, offerIntervalMul: 0.95, description: '특별 주문이 조금 더 자주 와요' },
  normal: { tier: 'normal', icon: '🙂', label: '평판 보통', specialChanceMul: 1, offerIntervalMul: 1, description: '평균 별점 4.3 이상이면 좋은 콜이 늘어요' },
  low: { tier: 'low', icon: '⚠️', label: '평판 낮음', specialChanceMul: 0.4, offerIntervalMul: 1.4, description: '콜이 뜸하고 특별 주문이 줄어요 · 음식 상태와 시간을 지켜 별점을 올리세요' },
};

/**
 * @param recentStars newest-first review stars (only the first REPUTATION_REVIEW_WINDOW count)
 * @param riderRating trust rating 0..5 (drops with pedestrian accidents)
 */
export function computeReputation(recentStars: readonly number[], riderRating: number): Reputation {
  const window = recentStars.slice(0, REPUTATION_REVIEW_WINDOW);
  const avg = window.length > 0 ? window.reduce((a, b) => a + b, 0) / window.length : null;
  let tier: ReputationTier;
  if (riderRating < 3 || (avg !== null && avg < 3.5)) tier = 'low';
  else if (avg === null || window.length < 3) tier = 'normal'; // not enough reviews yet
  else if (avg >= 4.6 && riderRating >= 4.5) tier = 'top';
  else if (avg >= 4.3 && riderRating >= 4) tier = 'good';
  else tier = 'normal';
  return { ...TIERS[tier], recentStars: avg === null ? null : Math.round(avg * 10) / 10 };
}
