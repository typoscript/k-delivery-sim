import { DEMAND_EVENTS } from '../../delivery/demandEvents';
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

/** Plain-text tag for a demand event order, e.g. "🍲비 오는 날 국물 +₩1,000 (안 쏟고 배달 시)" */
export function eventOrderTag(o: DeliveryOrder): string {
  if (!o.demandEvent) return '';
  const e = DEMAND_EVENTS[o.demandEvent];
  return `${e.icon}${e.label} +₩${(o.eventBonus ?? 0).toLocaleString()} (${e.conditionText})`;
}

/** Short chip text of an event order: its icon and surcharge, e.g. "🍲+1천" (the full tag is the chip's tooltip) */
export function eventOrderShort(o: DeliveryOrder): string {
  if (!o.demandEvent) return '';
  const won = o.eventBonus ?? 0;
  const amount = won < 1000 ? `${won}` : won % 1000 === 0 ? `${won / 1000}천` : `${(won / 1000).toFixed(1)}천`;
  return `${DEMAND_EVENTS[o.demandEvent].icon}+${amount}`;
}

/** HTML chip for a demand event order (call list / dispatch popup): short, the full condition on hover */
export function eventOrderChip(o: DeliveryOrder): string {
  return o.demandEvent
    ? ` <span class="event-order-tag ${o.demandEvent}" title="${eventOrderTag(o)}">${eventOrderShort(o)}</span>`
    : '';
}

/** HTML chip for a regular customer (단골 고객) */
export function regularCustomerChip(o: DeliveryOrder): string {
  return o.regularCustomer
    ? ` <span class="regular-customer-tag">⭐단골 고객 팁 +₩${REGULAR_CUSTOMER_TIP.toLocaleString()}</span>`
    : '';
}

/** Total shown on call cards: fee + surcharges stamped on the order */
export function orderDisplayFee(o: DeliveryOrder): number {
  return o.baseFee + o.rainBonus + o.nightBonus + (o.peakBonus ?? 0) + (o.specialBonus ?? 0) + (o.eventBonus ?? 0);
}
