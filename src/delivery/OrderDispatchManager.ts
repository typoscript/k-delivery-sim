import { pickLocalCustomer, pickLocalShop } from './localPairing';
import { DeliveryLocation } from '../types';
import {
  ALTTLE_FLAT_FEE,
  ALTTLE_TIME_LIMIT_SEC,
  DeliveryManager,
  DeliveryOrder,
  DispatchOrderType,
  MAX_CONCURRENT_ORDERS,
  NIGHT_SURCHARGE_BONUS,
  RAIN_SURCHARGE_BONUS,
  SINGLE_FLAT_FEE,
  SINGLE_TIME_LIMIT_SEC,
  classifyMenuFood,
  generateKoreanLobbyPin,
  generateRandomInstruction,
  generateUnitNumberForLocation,
} from './DeliveryManager';

export type DispatchOfferState = 'IDLE' | 'OFFERING' | 'COOLDOWN';

export interface DispatchOffer {
  id: string;
  type: DispatchOrderType; // 'SINGLE' (한집배달) | 'ALTTLE_BUNDLE' (알뜰배달)
  orders: DeliveryOrder[]; // 1 order for SINGLE, 2 orders for ALTTLE_BUNDLE
  totalFee: number;
  totalRainBonus: number;
  totalNightBonus: number;
  /** Lunch / dinner rush surcharge over all orders of the offer */
  totalPeakBonus: number;
  totalDistanceMeters: number;
  timeLimitSec: number; // 300s (SINGLE) | 500s (ALTTLE_BUNDLE)
  remainingOfferSec: number; // 20s countdown
  durationOfferSec: number;
  pulseTick: number; // increments when visual/audio vibrate should pulse
}

export interface DispatchCallbacks {
  onOfferArrived: (offer: DispatchOffer) => void;
  onOfferExpired: (offer: DispatchOffer) => void;
  onOfferUrgentTick?: (offer: DispatchOffer) => void;
}

export const OFFER_DURATION_SEC = 20;
export const REJECT_COOLDOWN_SEC = 10;
const INITIAL_DISPATCH_DELAY_SEC = 3.2;

/**
 * Call Dispatch State Machine (OrderDispatchManager):
 * - Generates 'SINGLE' (한집배달: ₩4,500 + distance, 300s strict) and
 *   'ALTTLE_BUNDLE' (알뜰배달: ₩2,800 × 2, 500s relaxed, 2 cargo slots) call offers.
 * - Runs a 20-second countdown timer; auto-declines on timeout & enters a 10-second cooldown.
 */
export class OrderDispatchManager {
  public state: DispatchOfferState = 'COOLDOWN';
  public activeOffer: DispatchOffer | null = null;
  public cooldownRemainingSec = INITIAL_DISPATCH_DELAY_SEC;

  private readonly shops: DeliveryLocation[];
  private readonly residences: DeliveryLocation[];
  private readonly callbacks: DispatchCallbacks;
  private offerSeq = 1;
  /** Demand multiplier on the wait between calls (game clock: rush hours < 1, dawn > 1) */
  private offerIntervalMul = 1;
  private orderSeq = 100;
  private urgentNotified = false;

  constructor(locations: DeliveryLocation[], callbacks: DispatchCallbacks) {
    this.shops = locations.filter((l) => l.type === 'shop');
    this.residences = locations.filter((l) => l.type === 'residential');
    this.callbacks = callbacks;
  }

  /** Checks if player currently has capacity to receive a new call offer */
  private getAllowedOfferTypes(delivery: DeliveryManager): DispatchOrderType[] {
    const active = delivery.activeMissions;
    // If already carrying a SINGLE (한집배달 direct) mission, do not dispatch overlapping calls!
    if (active.some((m) => m.order.dispatchType === 'SINGLE')) {
      return [];
    }
    const freeSlots = MAX_CONCURRENT_ORDERS - active.length;
    if (freeSlots >= 2) {
      return ['SINGLE', 'ALTTLE_BUNDLE'];
    }
    if (freeSlots === 1) {
      return ['SINGLE'];
    }
    return [];
  }

  public step(
    dt: number,
    delivery: DeliveryManager,
    inCorridor: boolean,
    modalBlocking: boolean
  ): void {
    const clampedDt = Math.min(dt, 0.05);
    this.offerIntervalMul = delivery.demandPhase.offerIntervalMul;

    // Pause dispatch generation indoors (underground corridor)
    if (inCorridor) {
      return;
    }

    const allowed = this.getAllowedOfferTypes(delivery);

    if (this.state === 'OFFERING' && this.activeOffer) {
      // If player filled capacity manually via phone list while offer was showing, cancel cleanly
      if (
        allowed.length === 0 ||
        (this.activeOffer.type === 'ALTTLE_BUNDLE' && !allowed.includes('ALTTLE_BUNDLE'))
      ) {
        this.activeOffer = null;
        this.state = 'IDLE';
        return;
      }

      this.activeOffer.remainingOfferSec -= clampedDt;

      // Subtle urgent reminder pulse at 5 seconds left
      if (!this.urgentNotified && this.activeOffer.remainingOfferSec <= 5.0 && this.activeOffer.remainingOfferSec > 0) {
        this.urgentNotified = true;
        this.activeOffer.pulseTick++;
        if (this.callbacks.onOfferUrgentTick) {
          this.callbacks.onOfferUrgentTick(this.activeOffer);
        }
      }

      if (this.activeOffer.remainingOfferSec <= 0) {
        const expired = this.activeOffer;
        this.activeOffer = null;
        this.state = 'COOLDOWN';
        this.cooldownRemainingSec = this.nextOfferDelaySec();
        this.callbacks.onOfferExpired(expired);
      }
      return;
    }

    if (this.state === 'COOLDOWN') {
      this.cooldownRemainingSec -= clampedDt;
      if (this.cooldownRemainingSec <= 0) {
        this.cooldownRemainingSec = 0;
        this.state = 'IDLE';
      }
      return;
    }

    // state === 'IDLE': dispatch a new call when allowed and no blocking modal is open
    if (allowed.length > 0 && !modalBlocking) {
      const chosenType = this.chooseOfferType(allowed, delivery);
      const offer = this.createOffer(chosenType, delivery);
      if (offer) {
        this.activeOffer = offer;
        this.state = 'OFFERING';
        this.urgentNotified = false;
        this.callbacks.onOfferArrived(offer);
      }
    }
  }

  /** Accepts the active 20s call offer and commits its order(s) to DeliveryManager */
  public acceptCurrentOffer(delivery: DeliveryManager): DispatchOffer | null {
    if (this.state !== 'OFFERING' || !this.activeOffer) return null;
    const offer = this.activeOffer;
    const ok = delivery.acceptDispatchedOffer(offer.orders);
    if (!ok) return null;

    this.activeOffer = null;
    this.state = 'COOLDOWN';
    this.cooldownRemainingSec = this.nextOfferDelaySec();
    return offer;
  }

  /** Seconds until the next call: 10s normally, ~4.5s in a lunch / dinner rush, 20s at dawn */
  public nextOfferDelaySec(): number {
    return REJECT_COOLDOWN_SEC * this.offerIntervalMul;
  }

  /** Declines the active 20s call offer and starts the cooldown until the next call */
  public rejectCurrentOffer(): DispatchOffer | null {
    if (this.state !== 'OFFERING' || !this.activeOffer) return null;
    const declined = this.activeOffer;
    this.activeOffer = null;
    this.state = 'COOLDOWN';
    this.cooldownRemainingSec = this.nextOfferDelaySec();
    return declined;
  }

  private chooseOfferType(allowed: DispatchOrderType[], delivery: DeliveryManager): DispatchOrderType {
    if (allowed.length === 1) return allowed[0];
    // When raining or when player already completed an order, slightly favor varied offers (~50/50)
    if (delivery.activeMissions.length === 1) {
      // With 1 order already active, 65% chance to offer ALTTLE_BUNDLE to fill all 3 top-box slots!
      return Math.random() < 0.65 ? 'ALTTLE_BUNDLE' : 'SINGLE';
    }
    return Math.random() < 0.5 ? 'SINGLE' : 'ALTTLE_BUNDLE';
  }

  private generateOrderNumber(usedNumbers: Set<string>, type: DispatchOrderType): string {
    const prefixes = type === 'SINGLE' ? ['S-', 'A-'] : ['B-', 'C-'];
    for (let tries = 0; tries < 25; tries++) {
      const p = prefixes[Math.floor(Math.random() * prefixes.length)];
      const num = String(10 + Math.floor(Math.random() * 89));
      const code = `${p}${num}`;
      if (!usedNumbers.has(code)) {
        usedNumbers.add(code);
        return code;
      }
    }
    return `K-${this.orderSeq++}`;
  }

  private createOffer(type: DispatchOrderType, delivery: DeliveryManager): DispatchOffer | null {
    const usedNumbers = new Set<string>([
      ...delivery.activeMissions.map((m) => m.order.orderNumber),
      ...delivery.availableOrders.map((o) => o.orderNumber),
    ]);
    const usedPairs = new Set<string>(
      delivery.activeMissions.map((m) => `${m.order.shop.id}-${m.order.customer.id}`)
    );

    const count = type === 'ALTTLE_BUNDLE' ? 2 : 1;
    const rainBonus = delivery.isWeatherRaining ? RAIN_SURCHARGE_BONUS : 0;
    const nightBonus = delivery.isNightMode ? NIGHT_SURCHARGE_BONUS : 0;
    const peakBonus = delivery.demandPhase.peakBonus;
    const orders: DeliveryOrder[] = [];

    // For ALTTLE_BUNDLE, prefer geographically reasonable pairs (different customers)
    let firstShop: DeliveryLocation | null = null;
    let attempts = 0;
    while (orders.length < count && attempts < 40) {
      attempts++;
      let shop: DeliveryLocation;
      if (count === 2 && firstShop && Math.random() < 0.45) {
        // 45% chance nearby shop along same commercial corridor for realistic Korean 알뜰배달
        const nearbyShops = this.shops.filter(
          (s) => Math.hypot(s.x - firstShop!.x, s.z - firstShop!.z) <= 75
        );
        shop = nearbyShops[Math.floor(Math.random() * nearbyShops.length)] ?? this.shops[0];
      } else {
        shop = pickLocalShop(this.shops, delivery.refX, delivery.refZ);
      }
      const customer = pickLocalCustomer(this.residences, shop);
      const pairKey = `${shop.id}-${customer.id}`;
      if (usedPairs.has(pairKey)) continue;
      if (orders.some((o) => o.customer.id === customer.id)) continue;

      usedPairs.add(pairKey);
      if (!firstShop) firstShop = shop;

      const menus = shop.menus ?? ['배달 음식 세트'];
      const menuName = menus[Math.floor(Math.random() * menus.length)];
      const distanceMeters = Math.round(
        Math.abs(shop.x - customer.x) + Math.abs(shop.z - customer.z)
      );

      const pinObj = generateKoreanLobbyPin();
      const deliveryInstruction = generateRandomInstruction();
      const foodMeta = classifyMenuFood(menuName, shop.id);
      const unitNumber = generateUnitNumberForLocation(customer);

      if (type === 'SINGLE') {
        // 한집배달: 기본 ₩4,500 + 거리 할증, 제한시간 300초
        const distBonus = Math.round((distanceMeters * 12) / 100) * 100;
        orders.push({
          id: `DSP-${this.orderSeq++}`,
          orderNumber: this.generateOrderNumber(usedNumbers, type),
          dispatchType: 'SINGLE',
          deliveryInstruction,
          baseFlatFee: SINGLE_FLAT_FEE,
          timeLimitSec: SINGLE_TIME_LIMIT_SEC,
          shop,
          customer,
          unitNumber,
          doorPin: pinObj.code,
          doorPinLabel: pinObj.label,
          menuName,
          foodTempType: foodMeta.tempType,
          isSpillSensitive: foodMeta.isSpillSensitive,
          foodCategoryTag: foodMeta.categoryTag,
          baseFee: SINGLE_FLAT_FEE + distBonus,
          rainBonus,
          nightBonus,
          peakBonus,
          distanceMeters,
        });
      } else {
        // 알뜰배달: 기본 ₩2,800 × 2건, 제한시간 500초
        orders.push({
          id: `DSP-${this.orderSeq++}`,
          orderNumber: this.generateOrderNumber(usedNumbers, type),
          dispatchType: 'ALTTLE_BUNDLE',
          deliveryInstruction,
          baseFlatFee: ALTTLE_FLAT_FEE,
          timeLimitSec: ALTTLE_TIME_LIMIT_SEC,
          shop,
          customer,
          unitNumber,
          doorPin: pinObj.code,
          doorPinLabel: pinObj.label,
          menuName,
          foodTempType: foodMeta.tempType,
          isSpillSensitive: foodMeta.isSpillSensitive,
          foodCategoryTag: foodMeta.categoryTag,
          baseFee: ALTTLE_FLAT_FEE,
          rainBonus,
          nightBonus,
          peakBonus,
          distanceMeters,
        });
      }
    }

    if (orders.length < count) return null;

    const totalFee = orders.reduce((acc, o) => acc + o.baseFee + o.rainBonus + o.nightBonus + (o.peakBonus ?? 0), 0);
    const totalRainBonus = orders.reduce((acc, o) => acc + o.rainBonus, 0);
    const totalNightBonus = orders.reduce((acc, o) => acc + o.nightBonus, 0);
    const totalPeakBonus = orders.reduce((acc, o) => acc + (o.peakBonus ?? 0), 0);
    const totalDistanceMeters =
      orders.length === 1
        ? orders[0].distanceMeters
        : Math.round(
            Math.abs(orders[0].shop.x - orders[1].shop.x) +
              Math.abs(orders[0].shop.z - orders[1].shop.z) +
              Math.abs(orders[1].shop.x - orders[0].customer.x) +
              Math.abs(orders[1].shop.z - orders[0].customer.z) +
              Math.abs(orders[0].customer.x - orders[1].customer.x) +
              Math.abs(orders[0].customer.z - orders[1].customer.z)
          );

    return {
      id: `OFFER-${this.offerSeq++}`,
      type,
      orders,
      totalFee,
      totalRainBonus,
      totalNightBonus,
      totalPeakBonus,
      totalDistanceMeters,
      timeLimitSec: type === 'SINGLE' ? SINGLE_TIME_LIMIT_SEC : ALTTLE_TIME_LIMIT_SEC,
      remainingOfferSec: OFFER_DURATION_SEC,
      durationOfferSec: OFFER_DURATION_SEC,
      pulseTick: 1,
    };
  }
}
