import { DeliveryOrder, REGULAR_CUSTOMER_TIP, SPECIAL_ORDERS } from '../../delivery/DeliveryManager';

/** Plain-text tag for a special order, e.g. "⏱️급한 배달 +₩3,000 (150초 내)" */
export function specialOrderTag(o: DeliveryOrder): string {
  if (!o.special) return '';
  const s = SPECIAL_ORDERS[o.special];
  const cond = o.special === 'urgent' ? ` (${s.timeLimitSec}초 내)` : '';
  return `${s.icon}${s.label} +₩${(o.specialBonus ?? 0).toLocaleString()}${cond}`;
}

/** HTML chip for a special order (call list / dispatch popup) */
export function specialOrderChip(o: DeliveryOrder): string {
  return o.special ? ` <span class="special-order-tag ${o.special}">${specialOrderTag(o)}</span>` : '';
}

/** HTML chip for a regular customer (단골 고객) */
export function regularCustomerChip(o: DeliveryOrder): string {
  return o.regularCustomer
    ? ` <span class="regular-customer-tag">⭐단골 고객 팁 +₩${REGULAR_CUSTOMER_TIP.toLocaleString()}</span>`
    : '';
}

/** Total shown on call cards: fee + surcharges stamped on the order */
export function orderDisplayFee(o: DeliveryOrder): number {
  return o.baseFee + o.rainBonus + o.nightBonus + (o.peakBonus ?? 0) + (o.specialBonus ?? 0);
}
