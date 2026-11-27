import { ActiveMission, BASE_FLAT_FEE, OPTIMAL_TEMP_BONUS, VILLA_STAIR_BONUS } from './deliveryTypes';

/** Itemized pay for one delivered order (all parts already rounded; `earned` is their exact sum) */
export interface SettlementPay {
  /** Base flat fee part (한집 ₩4,500 / 알뜰 ₩2,800) and the distance surcharge part of baseFee */
  basePart: number;
  distPart: number;
  /** Food damage deduction from the base fee (integrity below 100%) */
  damageDed: number;
  /** Safety tip (₩500 / ₩200 / ₩0 by integrity, halved for lukewarm food) and what was lost from ₩500 */
  tip: number;
  tipPenalty: number;
  tempBonus: number;
  villaStairBonus: number;
  promisedTipBonus: number;
  rainBonus: number;
  nightBonus: number;
  peakBonus: number;
  tierBonus: number;
  earned: number;
}

const MAX_SAFETY_TIP = 500;

/**
 * Pay for a delivered order. The payout is the exact sum of the itemized parts so the daily ledger's
 * net profit always matches the real wallet change (no independent ±₩100 rounding drift).
 */
export function computeSettlementPay(m: ActiveMission, tierBonus: number): SettlementPay {
  const o = m.order;
  const baseTip = m.foodIntegrity >= 95 ? MAX_SAFETY_TIP : m.foodIntegrity >= 70 ? 200 : 0;
  // Cold / melted or lukewarm food (< 50%) forfeits half of the safety tip
  const tip = m.foodTemp < 50 ? Math.round((baseTip * 0.5) / 100) * 100 : baseTip;
  const tempBonus = m.foodTemp >= 80 ? OPTIMAL_TEMP_BONUS : 0;
  const villaStairBonus = o.customer.residenceKind === 'walkup_villa' ? VILLA_STAIR_BONUS : 0;
  const promisedTipBonus = m.promisedExtraTip > 0 && m.foodIntegrity >= 85 ? m.promisedExtraTip : 0;
  const peakBonus = o.peakBonus ?? 0;
  const damageDed = Math.max(0, Math.round((o.baseFee * (1 - m.foodIntegrity / 100)) / 100) * 100);
  // SINGLE ₩4,500 vs ALTTLE ₩2,800 base flat fee; anything above it is the distance surcharge
  const basePart = Math.min(o.baseFee, o.baseFlatFee || BASE_FLAT_FEE);
  const distPart = Math.max(0, o.baseFee - basePart);
  const earned =
    o.baseFee - damageDed + tip + o.rainBonus + o.nightBonus + peakBonus + tierBonus + tempBonus + villaStairBonus + promisedTipBonus;
  return {
    basePart,
    distPart,
    damageDed,
    tip,
    tipPenalty: MAX_SAFETY_TIP - tip,
    tempBonus,
    villaStairBonus,
    promisedTipBonus,
    rainBonus: o.rainBonus,
    nightBonus: o.nightBonus,
    peakBonus,
    tierBonus,
    earned,
  };
}
