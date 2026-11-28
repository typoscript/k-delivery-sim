/** Delivery completion: the doorstep photo settlement (pay, tips, reviews, regulars, records) */
import { isMonsoonDay } from '../game/seasons';
import type { DeliveryManager } from './DeliveryManager';
import { generateCustomerReview } from './RiderCareer';
import { SettlementResult } from './deliveryTypes';
import { STAR_COUNT_COUNTER, STAR_SUM_COUNTER } from './careerHistory';
import { computeSettlementPay } from './settlementPay';
import { settlementGoalCounters } from './shiftProgress';
import { ratingAfterReview, reviewInputFor } from './riderRecords';

/** Called when photo shutter is pressed (PHOTO_DOOR) or after knock/face-to-face completion! */
export function completePhotoSettlement(host: DeliveryManager): SettlementResult | null {
  const m = host.getCorridorMission();
  if (!m || (m.phase !== 'photo_mode' && m.phase !== 'knock_waiting' && m.phase !== 'meet_waiting')) {
    return null;
  }

  const prevTier = host.getCurrentTier();
  const pay = computeSettlementPay(m, prevTier.bonusPerDelivery);
  const {
    tip,
    tipPenalty,
    tempBonus,
    villaStairBonus,
    walkInBonus,
    replyTip,
    promisedTipBonus,
    rainBonus,
    nightBonus,
    peakBonus,
    specialBonus,
    regularCustomerTip,
    eventBonus,
    tierBonus,
    earned,
  } = pay;

  // Itemized daily ledger
  host.baseFeeTotal += pay.basePart;
  host.distanceBonusTotal += pay.distPart;
  host.rainBonusTotal += rainBonus;
  host.nightBonusTotal += nightBonus;
  host.peakBonusTotal += peakBonus;
  host.specialBonusTotal += specialBonus + regularCustomerTip;
  host.eventBonusTotal += eventBonus;
  host.tierBonusTotal += tierBonus;
  // 단골 고객: count completed deliveries per customer location
  host.records.recordCustomerDelivery(m.order.customer.id);
  host.tipTotal += tip + tempBonus + villaStairBonus + walkInBonus + replyTip + promisedTipBonus;
  host.damageDeductionTotal += pay.damageDed;

  host.totalEarnings += earned;
  host.completedCount += 1;
  host.lifetimeCompleted += 1;
  // Counters for today's rotating goals
  for (const key of settlementGoalCounters(m, pay, undefined, {
    season: host.season,
    monsoon: isMonsoonDay(host.shiftDay),
    heatwave: host.heatwave,
  }))
    host.progress.bump(key);
  const nextTier = host.getCurrentTier();
  const tierPromotedTo = nextTier.id !== prevTier.id ? nextTier : null;

  // Daily goals (배달 3건 + today's two rotating goals) pay out the moment they are reached
  const { goals: goalsCompleted, bonus: missionBonusAwarded } = host.awardDueGoals('delivery');
  const missionJustCompleted = goalsCompleted.length > 0;

  const now = new Date();
  const completedAt = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const review = generateCustomerReview(reviewInputFor(m, rainBonus > 0, nightBonus > 0, completedAt));
  host.records.addReview(review);
  host.progress.bump(STAR_SUM_COUNTER, review.stars);
  host.progress.bump(STAR_COUNT_COUNTER);
  // Smoothly adjust trust rating from clean 5-star or damaged 1~2-star customer reviews
  host.riderRating = ratingAfterReview(host.riderRating, m.foodIntegrity, review.stars);
  host.persistCareer();

  host.completedMissions.unshift({
    order: m.order,
    earned,
    foodIntegrity: Math.round(m.foodIntegrity),
    completedAt,
  });
  if (host.completedMissions.length > 12) {
    host.completedMissions.length = 12;
  }

  const result: SettlementResult = {
    order: m.order,
    baseFee: m.order.baseFee,
    rainBonus,
    nightBonus,
    peakBonus,
    specialBonus,
    regularCustomerTip,
    eventBonus,
    damageDeduction: pay.damageDed,
    tierBonus,
    tierPromotedTo,
    foodIntegrity: Math.round(m.foodIntegrity),
    foodTemp: Math.round(m.foodTemp),
    spillDamageAccum: Math.round(m.spillDamageAccum),
    tempBonus,
    villaStairBonus,
    walkInBonus,
    replyTip,
    promisedTipBonus,
    tip,
    tipPenalty,
    earned,
    totalEarnings: host.totalEarnings,
    completedCount: host.completedCount,
    missionJustCompleted,
    missionBonusAwarded,
    goalsCompleted,
    review,
  };

  m.phase = 'corridor_exit';
  return result;
}
