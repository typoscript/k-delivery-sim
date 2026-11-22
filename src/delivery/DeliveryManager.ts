import { CITY_ROAD_LINES, DeliveryLocation } from '../types';

export interface DeliveryOrder {
  id: string;
  orderNumber: string; // e.g., "A-12", "B-45", "77"
  shop: DeliveryLocation;
  customer: DeliveryLocation;
  unitNumber: string; // e.g., "1402호"
  doorPin: string; // 4-digit apartment entrance PIN, e.g., "4829"
  menuName: string;
  baseFee: number;
  distanceMeters: number;
}

export type MissionPhase =
  | 'to_pickup' // Go to outdoor store pickup counter & enter order number on POS
  | 'carrying_to_box' // Food bag in hand (CARRYING_FOOD, cannot drive!) -> load into scooter rear cargo box
  | 'cargo_loaded' // Food inside scooter cargo box (CARGO_LOADED) -> ride to residence & unload from box
  | 'carrying_to_lobby' // Food bag back in hand -> enter 4-digit PIN at 1st-floor glass door
  | 'lobby_unlocked' // 1st-floor glass door open -> step to elevator to ride up to corridor
  | 'in_corridor' // Inside underground corridor (y=-500) -> place food on target unit doormat
  | 'photo_mode' // Food placed on mat -> smartphone camera viewfinder open -> capture delivery proof photo
  | 'corridor_exit'; // Delivery settled! Walk back to corridor elevator to return to 1st floor

export interface ActiveMission {
  order: DeliveryOrder;
  phase: MissionPhase;
  foodIntegrity: number; // 0..100
  startedAt: number;
}

export interface SettlementResult {
  order: DeliveryOrder;
  baseFee: number;
  foodIntegrity: number;
  tip: number;
  earned: number;
  totalEarnings: number;
  completedCount: number;
}

export interface RoutePoint {
  x: number;
  z: number;
}

const ROAD_LINES = CITY_ROAD_LINES;
export const INTERACT_ZONE_RADIUS = 3.6;

export class DeliveryManager {
  public availableOrders: DeliveryOrder[] = [];
  public activeMission: ActiveMission | null = null;
  public totalEarnings = 0;
  public completedCount = 0;

  private readonly shops: DeliveryLocation[];
  private readonly residences: DeliveryLocation[];
  private orderSeq = 1;

  constructor(locations: DeliveryLocation[]) {
    this.shops = locations.filter((l) => l.type === 'shop');
    this.residences = locations.filter((l) => l.type === 'residential');
    this.refreshAvailableOrders();
  }

  private generateOrderNumber(): string {
    const prefixes = ['A-', 'B-', 'C-', ''];
    const p = prefixes[Math.floor(Math.random() * prefixes.length)];
    const num = 10 + Math.floor(Math.random() * 89);
    return `${p}${num}`;
  }

  private generateUnitNumber(): string {
    const floor = 3 + Math.floor(Math.random() * 14); // 3F ~ 16F
    const unit = 1 + Math.floor(Math.random() * 4); // 01 ~ 04
    return `${floor}0${unit}호`;
  }

  private generateDoorPin(): string {
    let pin = '';
    for (let i = 0; i < 4; i++) {
      pin += String(Math.floor(Math.random() * 10));
    }
    return pin;
  }

  public refreshAvailableOrders(): void {
    const orders: DeliveryOrder[] = [];
    const usedPairs = new Set<string>();

    let attempts = 0;
    while (orders.length < 3 && attempts < 30) {
      attempts++;
      const shop = this.shops[Math.floor(Math.random() * this.shops.length)];
      const customer = this.residences[Math.floor(Math.random() * this.residences.length)];
      const key = `${shop.id}-${customer.id}`;
      if (usedPairs.has(key)) continue;
      usedPairs.add(key);

      const menus = shop.menus ?? ['배달 음식 세트'];
      const menuName = menus[Math.floor(Math.random() * menus.length)];
      const manhattan = Math.abs(shop.x - customer.x) + Math.abs(shop.z - customer.z);
      const distanceMeters = Math.round(manhattan);
      const baseFee = Math.round((3200 + distanceMeters * 12) / 100) * 100;

      orders.push({
        id: `ORD-${this.orderSeq++}`,
        orderNumber: this.generateOrderNumber(),
        shop,
        customer,
        unitNumber: this.generateUnitNumber(),
        doorPin: this.generateDoorPin(),
        menuName,
        baseFee,
        distanceMeters,
      });
    }

    this.availableOrders = orders;
  }

  public acceptOrder(orderId: string): DeliveryOrder | null {
    if (this.activeMission) return null;
    const found = this.availableOrders.find((o) => o.id === orderId);
    if (!found) return null;

    this.activeMission = {
      order: found,
      phase: 'to_pickup',
      foodIntegrity: 100,
      startedAt: performance.now(),
    };
    this.availableOrders = this.availableOrders.filter((o) => o.id !== orderId);
    return found;
  }

  public cancelActiveMission(): void {
    this.activeMission = null;
    if (this.availableOrders.length < 3) {
      this.refreshAvailableOrders();
    }
  }

  public isCarryingFood(): boolean {
    if (!this.activeMission) return false;
    const p = this.activeMission.phase;
    return (
      p === 'carrying_to_box' ||
      p === 'carrying_to_lobby' ||
      p === 'lobby_unlocked' ||
      p === 'in_corridor'
    );
  }

  public isCargoLoaded(): boolean {
    return this.activeMission?.phase === 'cargo_loaded';
  }

  public completePosPickup(): boolean {
    if (!this.activeMission || this.activeMission.phase !== 'to_pickup') return false;
    this.activeMission.phase = 'carrying_to_box';
    return true;
  }

  public loadFoodIntoCargoBox(): boolean {
    if (!this.activeMission || this.activeMission.phase !== 'carrying_to_box') return false;
    this.activeMission.phase = 'cargo_loaded';
    return true;
  }

  public unloadFoodFromCargoBox(): boolean {
    if (!this.activeMission || this.activeMission.phase !== 'cargo_loaded') return false;
    this.activeMission.phase = 'carrying_to_lobby';
    return true;
  }

  public unlockLobbyDoor(): boolean {
    if (!this.activeMission || this.activeMission.phase !== 'carrying_to_lobby') return false;
    this.activeMission.phase = 'lobby_unlocked';
    return true;
  }

  public enterCorridor(): boolean {
    if (!this.activeMission || this.activeMission.phase !== 'lobby_unlocked') return false;
    this.activeMission.phase = 'in_corridor';
    return true;
  }

  public placeFoodAtDoor(): boolean {
    if (!this.activeMission || this.activeMission.phase !== 'in_corridor') return false;
    this.activeMission.phase = 'photo_mode';
    return true;
  }

  /** Called when the player presses shutter in smartphone camera viewfinder! */
  public completePhotoSettlement(): SettlementResult | null {
    if (!this.activeMission || this.activeMission.phase !== 'photo_mode') return null;

    const m = this.activeMission;
    const integrityFactor = m.foodIntegrity / 100;
    const tip = m.foodIntegrity >= 95 ? 500 : 0;
    const earned = Math.round((m.order.baseFee * integrityFactor + tip) / 100) * 100;

    this.totalEarnings += earned;
    this.completedCount += 1;

    const result: SettlementResult = {
      order: m.order,
      baseFee: m.order.baseFee,
      foodIntegrity: m.foodIntegrity,
      tip,
      earned,
      totalEarnings: this.totalEarnings,
      completedCount: this.completedCount,
    };

    // Stay in corridor until player takes the elevator back down!
    this.activeMission.phase = 'corridor_exit';
    return result;
  }

  public finishAfterCorridorExit(): void {
    this.activeMission = null;
    this.refreshAvailableOrders();
  }

  public getCurrentOutdoorTarget(): DeliveryLocation | null {
    if (!this.activeMission) return null;
    const p = this.activeMission.phase;
    if (p === 'to_pickup') return this.activeMission.order.shop;
    if (p === 'cargo_loaded' || p === 'carrying_to_lobby' || p === 'lobby_unlocked') {
      return this.activeMission.order.customer;
    }
    return null;
  }

  public getDistanceToOutdoorTarget(x: number, z: number): number | null {
    const target = this.getCurrentOutdoorTarget();
    if (!target) return null;
    return Math.hypot(x - target.x, z - target.z);
  }

  public isNearShopPickup(x: number, z: number): boolean {
    if (!this.activeMission || this.activeMission.phase !== 'to_pickup') return false;
    const s = this.activeMission.order.shop;
    return Math.hypot(x - s.x, z - s.z) <= INTERACT_ZONE_RADIUS;
  }

  public isNearCustomerLobby(x: number, z: number): boolean {
    if (!this.activeMission) return false;
    const p = this.activeMission.phase;
    if (p !== 'carrying_to_lobby' && p !== 'lobby_unlocked') return false;
    const c = this.activeMission.order.customer;
    return Math.hypot(x - c.x, z - c.z) <= INTERACT_ZONE_RADIUS;
  }

  public applyCrashDamage(): number {
    if (!this.activeMission || this.activeMission.phase !== 'cargo_loaded') {
      return 0;
    }
    const loss = 28;
    this.activeMission.foodIntegrity = Math.max(15, this.activeMission.foodIntegrity - loss);
    return loss;
  }

  public applyFine(amount: number): number {
    const deducted = Math.min(this.totalEarnings, amount);
    this.totalEarnings -= deducted;
    return deducted;
  }

  public computeRoute(fromX: number, fromZ: number): RoutePoint[] {
    const target = this.getCurrentOutdoorTarget();
    if (!target) return [];

    const snapRoad = (v: number) => {
      let best: number = ROAD_LINES[0];
      let bestDist = Infinity;
      for (const r of ROAD_LINES) {
        const d = Math.abs(v - r);
        if (d < bestDist) {
          bestDist = d;
          best = r;
        }
      }
      return best;
    };

    const startRoadZ = snapRoad(fromZ);
    const endRoadX = snapRoad(target.x);
    const endRoadZ = snapRoad(target.z);

    const pts: RoutePoint[] = [{ x: fromX, z: fromZ }];
    if (Math.abs(fromX - target.x) + Math.abs(fromZ - target.z) < 28) {
      pts.push({ x: target.x, z: target.z });
      return pts;
    }

    pts.push({ x: fromX, z: startRoadZ });
    pts.push({ x: endRoadX, z: startRoadZ });
    if (endRoadZ !== startRoadZ) {
      pts.push({ x: endRoadX, z: endRoadZ });
    }
    if (Math.hypot(target.x - endRoadX, target.z - endRoadZ) > 3) {
      pts.push({ x: target.x, z: endRoadZ });
    }
    pts.push({ x: target.x, z: target.z });

    const cleaned: RoutePoint[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const prev = cleaned[cleaned.length - 1];
      if (Math.hypot(pts[i].x - prev.x, pts[i].z - prev.z) > 2) {
        cleaned.push(pts[i]);
      }
    }
    return cleaned;
  }
}
