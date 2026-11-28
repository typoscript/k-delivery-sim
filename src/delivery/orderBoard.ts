/** Open order board: surcharges, filling / refreshing the call list, accepting calls and rival steals */
import type { DeliveryManager } from './DeliveryManager';
import { activeDemandEvents } from './demandEvents';
import { pickLocalCustomer, pickLocalShop } from './localPairing';
import {
  DeliveryOrder,
  MAX_CONCURRENT_ORDERS,
  NIGHT_SURCHARGE_BONUS,
  RAIN_SURCHARGE_BONUS,
  SNOW_SURCHARGE_BONUS,
} from './deliveryTypes';
import {
  OrderSurcharges,
  buildDeliveryOrder,
  createActiveMission,
  pickOrderNumber,
  rollSpecialOrder,
} from './orderFactory';

export function orderSurcharges(host: DeliveryManager): OrderSurcharges {
  return {
    rainBonus: host.isWeatherSnowing ? SNOW_SURCHARGE_BONUS : host.isWeatherRaining ? RAIN_SURCHARGE_BONUS : 0,
    ...(host.isWeatherSnowing ? { snowDay: true } : {}),
    nightBonus: host.isNightMode ? NIGHT_SURCHARGE_BONUS : 0,
    peakBonus: host.demandPhase.peakBonus,
    events: activeDemandEvents(
      host.isWeatherRaining,
      host.isNightMode,
      host.demandPhase.id,
      host.isWeatherSnowing,
      host.season,
    ),
  };
}

/** Adds local shop -> customer calls (alternating 한집 / 알뜰) until the board holds 4, skipping duplicate pairs */
export function fillOrderBoard(
  host: DeliveryManager,
  board: DeliveryOrder[],
  usedPairs: Set<string>,
  usedNumbers: Set<string>,
  maxAttempts: number,
): void {
  let attempts = 0;
  while (board.length < 4 && attempts < maxAttempts) {
    attempts++;
    const shop = pickLocalShop(host.shops, host.refX, host.refZ);
    const customer = pickLocalCustomer(host.residences, shop);
    const key = `${shop.id}-${customer.id}`;
    if (usedPairs.has(key)) continue;
    usedPairs.add(key);
    const type = board.length % 2 === 0 ? 'SINGLE' : 'ALTTLE_BUNDLE';
    board.push(
      buildDeliveryOrder({
        id: `ORD-${host.orderSeq++}`,
        orderNumber: pickOrderNumber(usedNumbers, ['A-', 'B-', 'C-'], `D-${10 + (host.orderSeq % 89)}`),
        type,
        shop,
        customer,
        surcharges: host.orderSurcharges(),
        special:
          type === 'SINGLE'
            ? rollSpecialOrder(
                host.isNightMode,
                host.demandPhase.isPeak,
                Math.random,
                host.getReputation().specialChanceMul,
              )
            : undefined,
        regularCustomer: host.isRegularCustomer(customer.id),
      }),
    );
  }
}

export function refreshAvailableOrders(host: DeliveryManager): void {
  const orders: DeliveryOrder[] = [];
  const usedPairs = new Set<string>(host.activeMissions.map((m) => `${m.order.shop.id}-${m.order.customer.id}`));
  const usedNumbers = new Set<string>(host.activeMissions.map((m) => m.order.orderNumber));
  host.fillOrderBoard(orders, usedPairs, usedNumbers, 45);
  host.availableOrders = orders;
}

export function acceptOrder(host: DeliveryManager, orderId: string): DeliveryOrder | null {
  if (!host.canAcceptMoreOrders()) return null;
  const found = host.availableOrders.find((o) => o.id === orderId);
  if (!found) return null;

  host.activeMissions.push(createActiveMission(found, performance.now()));
  host.availableOrders = host.availableOrders.filter((o) => o.id !== orderId);

  // Keep at least 3 fresh calls ready so bundled pickups feel lively
  if (host.availableOrders.length < 2) {
    host.replenishAvailableOrders();
  }
  host.invalidateNavCache();
  return found;
}

/** Accepts 1 (SINGLE) or 2 (ALTTLE_BUNDLE) orders simultaneously from OrderDispatchManager */
export function acceptDispatchedOffer(host: DeliveryManager, orders: DeliveryOrder[]): boolean {
  if (orders.length === 0) return false;
  if (host.activeMissions.length + orders.length > MAX_CONCURRENT_ORDERS) {
    return false;
  }
  const now = performance.now();
  for (const o of orders) {
    host.activeMissions.push(createActiveMission(o, now));
  }
  host.invalidateNavCache();
  return true;
}

/** @internal missionSteps / missionQueries */
export function replenishAvailableOrders(host: DeliveryManager): void {
  const usedPairs = new Set<string>([
    ...host.activeMissions.map((m) => `${m.order.shop.id}-${m.order.customer.id}`),
    ...host.availableOrders.map((o) => `${o.shop.id}-${o.customer.id}`),
  ]);
  const usedNumbers = new Set<string>([
    ...host.activeMissions.map((m) => m.order.orderNumber),
    ...host.availableOrders.map((o) => o.orderNumber),
  ]);
  host.fillOrderBoard(host.availableOrders, usedPairs, usedNumbers, 35);
}

/** A rival rider took this call off the board: it disappears and the board refills */
export function takeAvailableOrderByRival(host: DeliveryManager, orderId: string): DeliveryOrder | null {
  const order = host.availableOrders.find((o) => o.id === orderId);
  if (!order) return null;
  host.availableOrders = host.availableOrders.filter((o) => o.id !== orderId);
  host.replenishAvailableOrders();
  return order;
}
