import { DeliveryLocation } from '../types';
import {
  ALTTLE_FLAT_FEE,
  ALTTLE_TIME_LIMIT_SEC,
  DeliveryOrder,
  DispatchOrderType,
  SINGLE_FLAT_FEE,
  SINGLE_TIME_LIMIT_SEC,
  SPECIAL_ORDERS,
  SpecialOrderKind,
  classifyMenuFood,
  generateKoreanLobbyPin,
  generateRandomInstruction,
  generateUnitNumberForLocation,
} from './deliveryTypes';

/** Weather / time-of-day surcharges stamped on an order when it is generated */
export interface OrderSurcharges {
  rainBonus: number;
  nightBonus: number;
  peakBonus: number;
}

/** 한집배달 distance surcharge: ₩12 per manhattan metre, rounded to ₩100 (알뜰배달 has none) */
export function singleDistanceBonus(distanceMeters: number): number {
  return Math.round((distanceMeters * 12) / 100) * 100;
}

/**
 * Builds one delivery order between a shop and a customer: random menu, door PIN, delivery instruction and
 * unit number, food physics class, fee (한집 ₩4,500 + distance / 알뜰 ₩2,800) and time limit (300s / 500s).
 * Shared by the phone call board (DeliveryManager) and the 20s dispatch popup (OrderDispatchManager).
 */
export function buildDeliveryOrder(opts: {
  id: string;
  orderNumber: string;
  type: DispatchOrderType;
  shop: DeliveryLocation;
  customer: DeliveryLocation;
  surcharges: OrderSurcharges;
  /** Make it a special order (한집배달 only) */
  special?: SpecialOrderKind;
  regularCustomer?: boolean;
  rand?: () => number;
}): DeliveryOrder {
  const { shop, customer, type } = opts;
  const rand = opts.rand ?? Math.random;
  const spec = opts.special && type === 'SINGLE' ? SPECIAL_ORDERS[opts.special] : null;
  const menus = shop.menus ?? ['배달 음식 세트'];
  const shopMenu = menus[Math.floor(rand() * menus.length)];
  const menuName = spec ? spec.menuFormat(shopMenu) : shopMenu;
  const distanceMeters = Math.round(Math.abs(shop.x - customer.x) + Math.abs(shop.z - customer.z));
  const isSingle = type === 'SINGLE';
  const baseFlatFee = isSingle ? SINGLE_FLAT_FEE : ALTTLE_FLAT_FEE;
  const pin = generateKoreanLobbyPin();
  const food = classifyMenuFood(menuName, shop.id);
  return {
    id: opts.id,
    orderNumber: opts.orderNumber,
    dispatchType: type,
    deliveryInstruction: generateRandomInstruction(),
    baseFlatFee,
    timeLimitSec: spec ? spec.timeLimitSec : isSingle ? SINGLE_TIME_LIMIT_SEC : ALTTLE_TIME_LIMIT_SEC,
    shop,
    customer,
    unitNumber: generateUnitNumberForLocation(customer),
    doorPin: pin.code,
    doorPinLabel: pin.label,
    menuName,
    foodTempType: food.tempType,
    isSpillSensitive: food.isSpillSensitive,
    foodCategoryTag: food.categoryTag,
    baseFee: baseFlatFee + (isSingle ? singleDistanceBonus(distanceMeters) : 0),
    rainBonus: opts.surcharges.rainBonus,
    nightBonus: opts.surcharges.nightBonus,
    peakBonus: opts.surcharges.peakBonus,
    ...(spec ? { special: spec.kind, specialBonus: spec.bonus } : {}),
    ...(opts.regularCustomer ? { regularCustomer: true } : {}),
    distanceMeters,
  };
}

/** Chance that a 한집배달 call is a special order */
export const SPECIAL_ORDER_CHANCE = 0.14;

/**
 * Rolls a special order for a 한집배달 call: none most of the time; urgent deliveries mostly at night,
 * group orders mostly during the lunch / dinner rush.
 */
export function rollSpecialOrder(
  isNight: boolean,
  isPeak: boolean,
  rand: () => number = Math.random,
  /** Rider reputation multiplier on the base chance */
  chanceMul = 1
): SpecialOrderKind | undefined {
  if (rand() >= SPECIAL_ORDER_CHANCE * chanceMul) return undefined;
  const urgentWeight = isNight ? 3 : 1;
  const groupWeight = isPeak ? 3 : 1;
  return rand() * (urgentWeight + groupWeight) < urgentWeight ? 'urgent' : 'group';
}

/** Random order number like "B-07" not already in use (adds it to `used`), or `fallback` after 25 tries */
export function pickOrderNumber(
  used: Set<string>,
  prefixes: readonly string[],
  fallback: string,
  rand: () => number = Math.random
): string {
  for (let tries = 0; tries < 25; tries++) {
    const p = prefixes[Math.floor(rand() * prefixes.length)];
    const code = `${p}${String(1 + Math.floor(rand() * 98)).padStart(2, '0')}`;
    if (!used.has(code)) {
      used.add(code);
      return code;
    }
  }
  return fallback;
}
