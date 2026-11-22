import { DeliveryLocation } from '../types';

export interface DeliveryOrder {
  id: string;
  shop: DeliveryLocation;
  customer: DeliveryLocation;
  menuName: string;
  baseFee: number;
  distanceMeters: number;
}

export type MissionPhase = 'idle' | 'pickup' | 'dropoff';

export interface ActiveMission {
  order: DeliveryOrder;
  phase: MissionPhase;
  foodIntegrity: number; // 0..100 (drops if rider crashes while carrying food!)
  startedAt: number;
}

export interface RoutePoint {
  x: number;
  z: number;
}

const ROAD_LINES = [-120, -40, 40, 120];
export const INTERACT_ZONE_RADIUS = 4.2;

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
      const baseFee = Math.round((3000 + distanceMeters * 11) / 100) * 100;

      orders.push({
        id: `ORD-${this.orderSeq++}`,
        shop,
        customer,
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
      phase: 'pickup',
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

  public getCurrentTarget(): DeliveryLocation | null {
    if (!this.activeMission) return null;
    return this.activeMission.phase === 'pickup'
      ? this.activeMission.order.shop
      : this.activeMission.order.customer;
  }

  public getDistanceToTarget(x: number, z: number): number | null {
    const target = this.getCurrentTarget();
    if (!target) return null;
    return Math.hypot(x - target.x, z - target.z);
  }

  public isInsideTargetZone(x: number, z: number): boolean {
    const d = this.getDistanceToTarget(x, z);
    return d !== null && d <= INTERACT_ZONE_RADIUS;
  }

  public applyCrashDamage(): number {
    if (!this.activeMission || this.activeMission.phase !== 'dropoff') {
      return 0;
    }
    const loss = 28;
    this.activeMission.foodIntegrity = Math.max(15, this.activeMission.foodIntegrity - loss);
    return loss;
  }

  /**
   * Attempts pickup or dropoff interaction when player is on foot at target.
   */
  public tryInteract(
    playerX: number,
    playerZ: number,
    isRiding: boolean
  ): { ok: boolean; event?: 'pickup' | 'complete'; message: string; earned?: number } {
    if (!this.activeMission) {
      return { ok: false, message: '진행 중인 배달이 없습니다 (스마트폰에서 콜을 수락하세요)' };
    }

    if (!this.isInsideTargetZone(playerX, playerZ)) {
      return { ok: false, message: '표시된 구역 안으로 더 가까이 이동하세요' };
    }

    if (isRiding) {
      return { ok: false, message: '먼저 [F]로 오토바이에서 내린 뒤 진행하세요!' };
    }

    if (this.activeMission.phase === 'pickup') {
      this.activeMission.phase = 'dropoff';
      const o = this.activeMission.order;
      return {
        ok: true,
        event: 'pickup',
        message: `${o.shop.emoji} ${o.menuName} 픽업 완료! → ${o.customer.name}으로 배달하세요`,
      };
    }

    // Complete delivery!
    const m = this.activeMission;
    const integrityFactor = m.foodIntegrity / 100;
    const tip = m.foodIntegrity >= 95 ? 500 : 0;
    const earned = Math.round((m.order.baseFee * integrityFactor + tip) / 100) * 100;

    this.totalEarnings += earned;
    this.completedCount += 1;
    this.activeMission = null;
    this.refreshAvailableOrders();

    const tipText = tip > 0 ? ' (안전배달 팁 +₩500!)' : m.foodIntegrity < 80 ? ' (음식 파손 감액)' : '';
    return {
      ok: true,
      event: 'complete',
      earned,
      message: `🎉 배달 완료! +₩${earned.toLocaleString()}${tipText}`,
    };
  }

  /**
   * Computes a clean street-snapped GPS route polyline from current position to target.
   */
  public computeRoute(fromX: number, fromZ: number): RoutePoint[] {
    const target = this.getCurrentTarget();
    if (!target) return [];

    const snapRoad = (v: number) => {
      let best = ROAD_LINES[0];
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

    const startRoadX = snapRoad(fromX);
    const startRoadZ = snapRoad(fromZ);
    const endRoadX = snapRoad(target.x);
    const endRoadZ = snapRoad(target.z);

    // Choose shorter road-snapped L-path
    const pts: RoutePoint[] = [{ x: fromX, z: fromZ }];
    const dx = Math.abs(fromX - target.x);
    const dz = Math.abs(fromZ - target.z);

    if (dx + dz < 28) {
      pts.push({ x: target.x, z: target.z });
      return pts;
    }

    // Snap onto nearest horizontal street, travel X, then travel Z along nearest vertical street
    pts.push({ x: fromX, z: startRoadZ });
    pts.push({ x: endRoadX, z: startRoadZ });
    if (endRoadZ !== startRoadZ) {
      pts.push({ x: endRoadX, z: endRoadZ });
    }
    if (Math.hypot(target.x - endRoadX, target.z - endRoadZ) > 3) {
      pts.push({ x: target.x, z: endRoadZ });
    }
    pts.push({ x: target.x, z: target.z });

    // Remove redundant close consecutive points
    const cleaned: RoutePoint[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const prev = cleaned[cleaned.length - 1];
      if (Math.hypot(pts[i].x - prev.x, pts[i].z - prev.z) > 2) {
        cleaned.push(pts[i]);
      }
    }
    if (startRoadX !== endRoadX && cleaned.length < 3) {
      cleaned.splice(1, 0, { x: startRoadX, z: endRoadZ });
    }
    return cleaned;
  }
}
