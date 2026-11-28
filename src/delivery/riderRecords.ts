/**
 * What the rider's history says about them: regular shops (pickup counts), regular customers (delivery counts),
 * customer reviews and the reputation computed from them. Reads and writes the saved career; the caller persists.
 */
import { DeliveryLocation } from '../types';
import {
  CustomerReview,
  MAX_STORED_REVIEWS,
  REGULAR_SHOP_THRESHOLD,
  ReviewGenerationInput,
  RiderCareerSave,
} from './RiderCareer';
import { ActiveMission, REGULAR_CUSTOMER_THRESHOLD } from './deliveryTypes';
import { Reputation, computeReputation } from './reputation';

export interface ShopPickupRecord {
  /** Pickups at this shop including this one */
  count: number;
  /** Already a regular before this pickup (fast-track cooking perk) */
  isRegularPerk: boolean;
  justBecameRegular: boolean;
}

/** Review input for a delivered mission */
export function reviewInputFor(m: ActiveMission, isRain: boolean, isNight: boolean, createdAt: string): ReviewGenerationInput {
  return {
    orderNumber: m.order.orderNumber,
    shopId: m.order.shop.id,
    shopName: m.order.shop.name,
    shopEmoji: m.order.shop.emoji,
    menuName: m.order.menuName,
    customerName: m.order.customer.name,
    unitNumber: m.order.unitNumber,
    foodIntegrity: Math.round(m.foodIntegrity),
    foodTemp: Math.round(m.foodTemp),
    foodTempType: m.order.foodTempType,
    isSpillSensitive: m.order.isSpillSensitive,
    spillDamageAccum: Math.round(m.spillDamageAccum),
    remainingRatio: m.order.timeLimitSec > 0 ? m.remainingTimeSec / m.order.timeLimitSec : 0.5,
    late: m.remainingTimeSec <= 0,
    apologized: !!m.lateApologized,
    isWalkupVilla: m.order.customer.residenceKind === 'walkup_villa',
    isRain,
    isNight,
    deliveryInstruction: m.order.deliveryInstruction,
    createdAt,
  };
}

/** Trust rating after a review: +0.1 for clean food or 5 stars (max 5), -0.1 for 1~2 stars (min 1) */
export function ratingAfterReview(rating: number, foodIntegrity: number, stars: number): number {
  if ((foodIntegrity >= 90 || stars === 5) && rating < 5.0) return Math.min(5.0, Math.round((rating + 0.1) * 10) / 10);
  if (stars <= 2 && rating > 1.0) return Math.max(1.0, Math.round((rating - 0.1) * 10) / 10);
  return rating;
}

export class RiderRecords {
  private reputationCache: { key: string; rep: Reputation } | null = null;

  constructor(
    private readonly career: RiderCareerSave,
    private readonly shops: readonly DeliveryLocation[]
  ) {}

  public shopPickupCount(shopId: string): number {
    return this.career.shopPickupCounts[shopId] ?? 0;
  }

  public isRegularShop(shopId: string): boolean {
    return this.shopPickupCount(shopId) >= REGULAR_SHOP_THRESHOLD;
  }

  /** 단골 고객: this customer location already received REGULAR_CUSTOMER_THRESHOLD+ of your deliveries */
  public isRegularCustomer(customerId: string): boolean {
    return (this.career.customerDeliveryCounts[customerId] ?? 0) >= REGULAR_CUSTOMER_THRESHOLD;
  }

  public regularShops(): Array<{ shopId: string; name: string; count: number }> {
    const out: Array<{ shopId: string; name: string; count: number }> = [];
    for (const [shopId, count] of Object.entries(this.career.shopPickupCounts)) {
      if (count >= REGULAR_SHOP_THRESHOLD) {
        const localShop = this.shops.find((s) => s.id === shopId);
        const name = this.career.shopNames[shopId] ?? (localShop ? `${localShop.emoji} ${localShop.name}` : shopId);
        out.push({ shopId, name, count });
      }
    }
    out.sort((a, b) => b.count - a.count);
    return out;
  }

  /** Counts a pickup at `shop` (단골 매장 after REGULAR_SHOP_THRESHOLD) */
  public recordShopPickup(shop: DeliveryLocation): ShopPickupRecord {
    const prev = this.shopPickupCount(shop.id);
    const count = prev + 1;
    this.career.shopPickupCounts[shop.id] = count;
    this.career.shopNames[shop.id] = `${shop.emoji} ${shop.name}`;
    return {
      count,
      isRegularPerk: prev >= REGULAR_SHOP_THRESHOLD,
      justBecameRegular: prev < REGULAR_SHOP_THRESHOLD && count >= REGULAR_SHOP_THRESHOLD,
    };
  }

  /** Counts a completed delivery to this customer location */
  public recordCustomerDelivery(customerId: string): void {
    this.career.customerDeliveryCounts[customerId] = (this.career.customerDeliveryCounts[customerId] ?? 0) + 1;
  }

  public reviews(): CustomerReview[] {
    return this.career.reviews;
  }

  /** Newest first, keeping MAX_STORED_REVIEWS */
  public addReview(review: CustomerReview): void {
    this.career.reviews.unshift(review);
    if (this.career.reviews.length > MAX_STORED_REVIEWS) this.career.reviews.length = MAX_STORED_REVIEWS;
  }

  public averageStars(): number | null {
    const list = this.career.reviews;
    if (list.length === 0) return null;
    const sum = list.reduce((acc, r) => acc + r.stars, 0);
    return Math.round((sum / list.length) * 10) / 10;
  }

  /** Reputation from the newest review stars and the trust rating; cached (the dispatcher asks every frame) */
  public reputation(riderRating: number): Reputation {
    const newest = this.career.reviews[0];
    const key = `${this.career.reviews.length}:${newest?.orderNumber ?? ''}:${newest?.createdAt ?? ''}:${riderRating}`;
    if (this.reputationCache?.key !== key) {
      this.reputationCache = { key, rep: computeReputation(this.career.reviews.map((r) => r.stars), riderRating) };
    }
    return this.reputationCache.rep;
  }
}
