import { DeliveryLocation } from '../types';
import { RoadNavigator, RoutePoint, TurnGuidance } from '../world/RoadNavigator';

export const MAX_CONCURRENT_ORDERS = 3;
export const CARGO_SLOT_COUNT = 3;
export const INTERACT_ZONE_RADIUS = 3.6;
export const RAIN_SURCHARGE_BONUS = 1500;
export const BASE_FLAT_FEE = 3200;
export const FUEL_PRICE_PER_PERCENT = 40; // full 0->100% fill = ₩4,000
export const REPAIR_COST_PER_DAMAGE_STAGE = 2500; // stage 1..3 = ₩2,500..₩7,500

export interface DailyFinanceLedger {
  completedCount: number;
  baseFeeTotal: number;
  distanceBonusTotal: number;
  rainBonusTotal: number;
  tipTotal: number;
  damageDeductionTotal: number;
  fuelExpense: number;
  repairExpense: number;
  fineExpense: number;
  grossIncome: number;
  totalExpenses: number;
  netProfit: number;
}

export interface DeliveryOrder {
  id: string;
  orderNumber: string; // e.g., "A-12", "B-07", "C-45"
  shop: DeliveryLocation;
  customer: DeliveryLocation;
  unitNumber: string; // e.g., "1402호"
  doorPin: string; // 4-digit apartment entrance PIN, e.g., "4829"
  menuName: string;
  baseFee: number;
  rainBonus: number; // +1500 when generated in Rain mode!
  distanceMeters: number;
}

export type MissionPhase =
  | 'to_pickup' // Go to outdoor store pickup counter & enter order number on POS
  | 'carrying_to_box' // Food bag in hand (CARRYING_FOOD, cannot drive!) -> load into scooter cargo slot
  | 'cargo_loaded' // Food inside scooter cargo box slot (0..2) -> ride to residence & unload from slot
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
  cargoSlot: number | null; // 0 | 1 | 2 when inside top-box
  pickedUp: boolean;
}

export interface CompletedMissionRecord {
  order: DeliveryOrder;
  earned: number;
  foodIntegrity: number;
  completedAt: string;
}

export interface SettlementResult {
  order: DeliveryOrder;
  baseFee: number;
  rainBonus: number;
  foodIntegrity: number;
  tip: number;
  tipPenalty: number;
  earned: number;
  totalEarnings: number;
  completedCount: number;
}

export interface RecommendedStop {
  missionId: string;
  orderNumber: string;
  kind: 'pickup' | 'load_box' | 'dropoff';
  location: DeliveryLocation | null; // null when kind === 'load_box' (scooter rear box)
  x: number;
  z: number;
  label: string;
  sublabel: string;
  emoji: string;
  cargoSlot: number | null;
  legDistance: number;
  cumulativeDistance: number;
  isCurrent: boolean;
}

export interface NavigationPlan {
  focusMission: ActiveMission | null;
  target: DeliveryLocation | null;
  targetPos: { x: number; z: number } | null;
  isPickupTarget: boolean;
  isCargoBoxTarget: boolean;
  route: RoutePoint[];
  guidance: TurnGuidance | null;
  recommendedStops: RecommendedStop[];
  totalBundleDistance: number;
}

export type { RoutePoint };

export class DeliveryManager {
  public availableOrders: DeliveryOrder[] = [];
  public activeMissions: ActiveMission[] = [];
  public cargoSlots: [string | null, string | null, string | null] = [null, null, null];
  public completedMissions: CompletedMissionRecord[] = [];
  public selectedMissionId: string | null = null; // null = Auto Recommended Route

  public totalEarnings = 0; // Net daily profit (income - fuel - repair - fines)
  public completedCount = 0;
  public isWeatherRaining = false;

  // Daily comprehensive finance ledger
  public baseFeeTotal = 0;
  public distanceBonusTotal = 0;
  public rainBonusTotal = 0;
  public tipTotal = 0;
  public damageDeductionTotal = 0;
  public fuelExpense = 0;
  public repairExpense = 0;
  public fineExpense = 0;

  private readonly shops: DeliveryLocation[];
  private readonly residences: DeliveryLocation[];
  private orderSeq = 1;

  // Cached navigation plan to avoid recomputing A* every frame when stationary
  private cachedPlan: NavigationPlan | null = null;
  private lastNavX = Infinity;
  private lastNavZ = Infinity;
  private lastNavHeading = Infinity;
  private lastNavFingerprint = '';
  private lastNavTime = -1;

  constructor(locations: DeliveryLocation[]) {
    this.shops = locations.filter((l) => l.type === 'shop');
    this.residences = locations.filter((l) => l.type === 'residential');
    this.refreshAvailableOrders();
  }

  /** Backward-compatible primary mission accessor (carried / corridor / pinned / first active) */
  public get activeMission(): ActiveMission | null {
    return (
      this.getCorridorMission() ??
      this.getCarryingMission() ??
      (this.selectedMissionId
        ? this.activeMissions.find((m) => m.order.id === this.selectedMissionId) ?? null
        : null) ??
      this.activeMissions[0] ??
      null
    );
  }

  public getMissionById(id: string | null): ActiveMission | null {
    if (!id) return null;
    return this.activeMissions.find((m) => m.order.id === id) ?? null;
  }

  public getCorridorMission(): ActiveMission | null {
    return (
      this.activeMissions.find(
        (m) => m.phase === 'in_corridor' || m.phase === 'photo_mode' || m.phase === 'corridor_exit'
      ) ?? null
    );
  }

  public getCarryingMission(): ActiveMission | null {
    return (
      this.activeMissions.find(
        (m) =>
          m.phase === 'carrying_to_box' ||
          m.phase === 'carrying_to_lobby' ||
          m.phase === 'lobby_unlocked' ||
          m.phase === 'in_corridor'
      ) ?? null
    );
  }

  public isCarryingFood(): boolean {
    return this.getCarryingMission() !== null;
  }

  public isCargoLoaded(): boolean {
    return this.cargoSlots.some((id) => id !== null);
  }

  public getLoadedCargoCount(): number {
    let count = 0;
    for (const id of this.cargoSlots) {
      if (id !== null) count++;
    }
    return count;
  }

  public getCargoSlotOccupiedFlags(): [boolean, boolean, boolean] {
    return [this.cargoSlots[0] !== null, this.cargoSlots[1] !== null, this.cargoSlots[2] !== null];
  }

  public getCargoSlotMission(slotIndex: number): ActiveMission | null {
    if (slotIndex < 0 || slotIndex >= CARGO_SLOT_COUNT) return null;
    const id = this.cargoSlots[slotIndex];
    return id ? this.getMissionById(id) : null;
  }

  public getFirstEmptyCargoSlot(): number {
    for (let i = 0; i < CARGO_SLOT_COUNT; i++) {
      if (this.cargoSlots[i] === null) return i;
    }
    return -1;
  }

  public canAcceptMoreOrders(): boolean {
    return this.activeMissions.length < MAX_CONCURRENT_ORDERS;
  }

  public setSelectedMission(missionId: string | null): void {
    if (missionId === null) {
      this.selectedMissionId = null;
    } else if (this.activeMissions.some((m) => m.order.id === missionId)) {
      this.selectedMissionId = missionId;
    }
    this.invalidateNavCache();
  }

  public invalidateNavCache(): void {
    this.lastNavFingerprint = '';
  }

  private generateOrderNumber(usedNumbers: Set<string>): string {
    const prefixes = ['A-', 'B-', 'C-'];
    for (let tries = 0; tries < 25; tries++) {
      const p = prefixes[Math.floor(Math.random() * prefixes.length)];
      const num = String(1 + Math.floor(Math.random() * 98)).padStart(2, '0');
      const code = `${p}${num}`;
      if (!usedNumbers.has(code)) {
        usedNumbers.add(code);
        return code;
      }
    }
    return `D-${10 + (this.orderSeq % 89)}`;
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

  public setWeatherRaining(raining: boolean): void {
    if (this.isWeatherRaining === raining) return;
    this.isWeatherRaining = raining;
    // Immediately refresh unaccepted calls so players see "+₩1,500 우천 할증" calls right away!
    this.refreshAvailableOrders();
  }

  public refreshAvailableOrders(): void {
    const orders: DeliveryOrder[] = [];
    const usedPairs = new Set<string>(
      this.activeMissions.map((m) => `${m.order.shop.id}-${m.order.customer.id}`)
    );
    const usedNumbers = new Set<string>(this.activeMissions.map((m) => m.order.orderNumber));

    let attempts = 0;
    while (orders.length < 4 && attempts < 45) {
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
        orderNumber: this.generateOrderNumber(usedNumbers),
        shop,
        customer,
        unitNumber: this.generateUnitNumber(),
        doorPin: this.generateDoorPin(),
        menuName,
        baseFee,
        rainBonus: this.isWeatherRaining ? RAIN_SURCHARGE_BONUS : 0,
        distanceMeters,
      });
    }

    this.availableOrders = orders;
  }

  public acceptOrder(orderId: string): DeliveryOrder | null {
    if (!this.canAcceptMoreOrders()) return null;
    const found = this.availableOrders.find((o) => o.id === orderId);
    if (!found) return null;

    this.activeMissions.push({
      order: found,
      phase: 'to_pickup',
      foodIntegrity: 100,
      startedAt: performance.now(),
      cargoSlot: null,
      pickedUp: false,
    });
    this.availableOrders = this.availableOrders.filter((o) => o.id !== orderId);

    // Keep at least 3 fresh calls ready so bundled pickups feel lively
    if (this.availableOrders.length < 2) {
      this.replenishAvailableOrders();
    }
    this.invalidateNavCache();
    return found;
  }

  private replenishAvailableOrders(): void {
    const usedPairs = new Set<string>([
      ...this.activeMissions.map((m) => `${m.order.shop.id}-${m.order.customer.id}`),
      ...this.availableOrders.map((o) => `${o.shop.id}-${o.customer.id}`),
    ]);
    const usedNumbers = new Set<string>([
      ...this.activeMissions.map((m) => m.order.orderNumber),
      ...this.availableOrders.map((o) => o.orderNumber),
    ]);

    let attempts = 0;
    while (this.availableOrders.length < 4 && attempts < 35) {
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

      this.availableOrders.push({
        id: `ORD-${this.orderSeq++}`,
        orderNumber: this.generateOrderNumber(usedNumbers),
        shop,
        customer,
        unitNumber: this.generateUnitNumber(),
        doorPin: this.generateDoorPin(),
        menuName,
        baseFee,
        rainBonus: this.isWeatherRaining ? RAIN_SURCHARGE_BONUS : 0,
        distanceMeters,
      });
    }
  }

  public cancelMission(orderId: string): ActiveMission | null {
    const idx = this.activeMissions.findIndex((m) => m.order.id === orderId);
    if (idx === -1) return null;
    const m = this.activeMissions[idx];
    if (m.phase === 'in_corridor' || m.phase === 'photo_mode' || m.phase === 'corridor_exit') {
      return null;
    }

    if (m.cargoSlot !== null && this.cargoSlots[m.cargoSlot] === orderId) {
      this.cargoSlots[m.cargoSlot] = null;
    }
    this.activeMissions.splice(idx, 1);
    if (this.selectedMissionId === orderId) {
      this.selectedMissionId = null;
    }
    if (this.availableOrders.length < 3) {
      this.replenishAvailableOrders();
    }
    this.invalidateNavCache();
    return m;
  }

  /** Complete POS pickup for a specific `to_pickup` mission (only when hands are free) */
  public completePosPickup(missionId: string): ActiveMission | null {
    if (this.isCarryingFood()) return null;
    const m = this.getMissionById(missionId);
    if (!m || m.phase !== 'to_pickup') return null;
    m.phase = 'carrying_to_box';
    m.pickedUp = true;
    this.invalidateNavCache();
    return m;
  }

  /** Load currently held food bag (`carrying_to_box` or `carrying_to_lobby`) into a specific cargo slot (0..2) */
  public loadFoodIntoCargoSlot(slotIndex: number): ActiveMission | null {
    if (slotIndex < 0 || slotIndex >= CARGO_SLOT_COUNT) return null;
    if (this.cargoSlots[slotIndex] !== null) return null;
    const carrying = this.getCarryingMission();
    if (!carrying) return null;
    if (carrying.phase !== 'carrying_to_box' && carrying.phase !== 'carrying_to_lobby') {
      return null;
    }

    this.cargoSlots[slotIndex] = carrying.order.id;
    carrying.cargoSlot = slotIndex;
    carrying.phase = 'cargo_loaded';
    this.invalidateNavCache();
    return carrying;
  }

  /** Unload a specific cargo slot (0..2) into the rider's left hand (`carrying_to_lobby`) */
  public unloadFoodFromCargoSlot(slotIndex: number): ActiveMission | null {
    if (slotIndex < 0 || slotIndex >= CARGO_SLOT_COUNT) return null;
    if (this.isCarryingFood()) return null;
    const id = this.cargoSlots[slotIndex];
    if (!id) return null;
    const m = this.getMissionById(id);
    if (!m || m.phase !== 'cargo_loaded') return null;

    this.cargoSlots[slotIndex] = null;
    m.cargoSlot = null;
    m.phase = 'carrying_to_lobby';
    this.invalidateNavCache();
    return m;
  }

  public unlockLobbyDoor(missionId: string): ActiveMission | null {
    const m = this.getMissionById(missionId);
    if (!m || m.phase !== 'carrying_to_lobby') return null;
    m.phase = 'lobby_unlocked';
    this.invalidateNavCache();
    return m;
  }

  public enterCorridor(missionId: string): ActiveMission | null {
    const m = this.getMissionById(missionId);
    if (!m || m.phase !== 'lobby_unlocked') return null;
    m.phase = 'in_corridor';
    this.invalidateNavCache();
    return m;
  }

  public placeFoodAtDoor(): ActiveMission | null {
    const m = this.getCorridorMission();
    if (!m || m.phase !== 'in_corridor') return null;
    m.phase = 'photo_mode';
    return m;
  }

  /** Called when the player presses shutter in smartphone camera viewfinder! */
  public completePhotoSettlement(): SettlementResult | null {
    const m = this.getCorridorMission();
    if (!m || m.phase !== 'photo_mode') return null;

    const integrityFactor = m.foodIntegrity / 100;
    const maxTip = 500;
    const tip = m.foodIntegrity >= 95 ? maxTip : m.foodIntegrity >= 70 ? 200 : 0;
    const tipPenalty = maxTip - tip;
    const rainBonus = m.order.rainBonus;
    const earned = Math.round((m.order.baseFee * integrityFactor + tip + rainBonus) / 100) * 100;

    // Record itemized income breakdown into daily ledger
    const basePart = Math.min(m.order.baseFee, BASE_FLAT_FEE);
    const distPart = Math.max(0, m.order.baseFee - basePart);
    const damageDed = Math.max(0, Math.round(m.order.baseFee * (1 - integrityFactor) / 100) * 100);
    this.baseFeeTotal += basePart;
    this.distanceBonusTotal += distPart;
    this.rainBonusTotal += rainBonus;
    this.tipTotal += tip;
    this.damageDeductionTotal += damageDed;

    this.totalEarnings += earned;
    this.completedCount += 1;

    const now = new Date();
    const completedAt = `${String(now.getHours()).padStart(2, '0')}:${String(
      now.getMinutes()
    ).padStart(2, '0')}`;

    this.completedMissions.unshift({
      order: m.order,
      earned,
      foodIntegrity: m.foodIntegrity,
      completedAt,
    });
    if (this.completedMissions.length > 12) {
      this.completedMissions.length = 12;
    }

    const result: SettlementResult = {
      order: m.order,
      baseFee: m.order.baseFee,
      rainBonus,
      foodIntegrity: m.foodIntegrity,
      tip,
      tipPenalty,
      earned,
      totalEarnings: this.totalEarnings,
      completedCount: this.completedCount,
    };

    m.phase = 'corridor_exit';
    return result;
  }

  public finishAfterCorridorExit(): void {
    const finished = this.activeMissions.find((m) => m.phase === 'corridor_exit');
    if (finished) {
      if (this.selectedMissionId === finished.order.id) {
        this.selectedMissionId = null;
      }
      this.activeMissions = this.activeMissions.filter((m) => m.order.id !== finished.order.id);
    }
    this.replenishAvailableOrders();
    this.invalidateNavCache();
  }

  /** Returns the nearest `to_pickup` mission whose outdoor shop counter is within interact radius */
  public getMissionNearShopPickup(x: number, z: number): ActiveMission | null {
    let best: ActiveMission | null = null;
    let bestDist = INTERACT_ZONE_RADIUS;
    for (const m of this.activeMissions) {
      if (m.phase !== 'to_pickup') continue;
      const d = Math.hypot(x - m.order.shop.x, z - m.order.shop.z);
      if (d <= bestDist) {
        // Prefer pinned mission if tied at the same shop
        if (best && d === bestDist && best.order.id === this.selectedMissionId) continue;
        best = m;
        bestDist = d;
      }
    }
    return best;
  }

  /** Returns the carried mission if player is near its target customer lobby */
  public getMissionNearCustomerLobby(x: number, z: number): ActiveMission | null {
    const carrying = this.getCarryingMission();
    if (!carrying) return null;
    if (carrying.phase !== 'carrying_to_lobby' && carrying.phase !== 'lobby_unlocked') return null;
    const c = carrying.order.customer;
    return Math.hypot(x - c.x, z - c.z) <= INTERACT_ZONE_RADIUS ? carrying : null;
  }

  /** Helper: checks if player is standing right in front of any residential lobby (to warn about wrong bag) */
  public getNearestResidenceWithin(x: number, z: number, radius = INTERACT_ZONE_RADIUS): DeliveryLocation | null {
    let best: DeliveryLocation | null = null;
    let bestD = radius;
    for (const r of this.residences) {
      const d = Math.hypot(x - r.x, z - r.z);
      if (d <= bestD) {
        best = r;
        bestD = d;
      }
    }
    return best;
  }

  /** Applies crash impact damage to ALL food bags currently loaded in the 3 cargo box slots */
  public applyCrashDamage(isRainSlip = false): { damagedCount: number; loss: number } {
    const loss = isRainSlip ? 32 : 25;
    let damagedCount = 0;
    for (const id of this.cargoSlots) {
      if (!id) continue;
      const m = this.getMissionById(id);
      if (m && m.phase === 'cargo_loaded') {
        m.foodIntegrity = Math.max(15, m.foodIntegrity - loss);
        damagedCount++;
      }
    }
    return { damagedCount, loss: damagedCount > 0 ? loss : 0 };
  }

  public applyFine(amount: number): number {
    this.fineExpense += amount;
    this.totalEarnings -= amount;
    return amount;
  }

  public recordFuelExpense(amount: number): void {
    const rounded = Math.max(0, Math.round(amount / 100) * 100);
    this.fuelExpense += rounded;
    this.totalEarnings -= rounded;
  }

  public recordRepairExpense(amount: number): void {
    const rounded = Math.max(0, Math.round(amount / 100) * 100);
    this.repairExpense += rounded;
    this.totalEarnings -= rounded;
  }

  public getDailyLedger(): DailyFinanceLedger {
    const grossIncome =
      this.baseFeeTotal +
      this.distanceBonusTotal +
      this.rainBonusTotal +
      this.tipTotal -
      this.damageDeductionTotal;
    const totalExpenses = this.fuelExpense + this.repairExpense + this.fineExpense;
    return {
      completedCount: this.completedCount,
      baseFeeTotal: this.baseFeeTotal,
      distanceBonusTotal: this.distanceBonusTotal,
      rainBonusTotal: this.rainBonusTotal,
      tipTotal: this.tipTotal,
      damageDeductionTotal: this.damageDeductionTotal,
      fuelExpense: this.fuelExpense,
      repairExpense: this.repairExpense,
      fineExpense: this.fineExpense,
      grossIncome,
      totalExpenses,
      netProfit: grossIncome - totalExpenses,
    };
  }

  /**
   * Computes the optimal valid multi-stop sequence (Recommended Route Guide) for up to 3 bundled orders,
   * then computes the live A* shortest path & turn-by-turn guidance to the active stop.
   * Cached and throttled cleanly so per-frame CPU overhead is near zero.
   */
  public getNavigationPlan(
    playerX: number,
    playerZ: number,
    playerHeading: number,
    scooterX: number,
    scooterZ: number,
    inCorridor: boolean,
    elapsedTime: number,
    navigator: RoadNavigator
  ): NavigationPlan {
    if (inCorridor || this.activeMissions.length === 0) {
      return {
        focusMission: this.activeMission,
        target: null,
        targetPos: null,
        isPickupTarget: false,
        isCargoBoxTarget: false,
        route: [],
        guidance: null,
        recommendedStops: [],
        totalBundleDistance: 0,
      };
    }

    const fp =
      `${this.selectedMissionId ?? 'auto'}|` +
      this.activeMissions.map((m) => `${m.order.id}:${m.phase}:${m.cargoSlot}`).join(',');

    const moved = Math.hypot(playerX - this.lastNavX, playerZ - this.lastNavZ);
    const turned = Math.abs(playerHeading - this.lastNavHeading);
    const dtSince = elapsedTime - this.lastNavTime;

    if (
      this.cachedPlan &&
      fp === this.lastNavFingerprint &&
      moved < 1.8 &&
      turned < 0.22 &&
      dtSince < 0.25
    ) {
      return this.cachedPlan;
    }

    const stops = this.computeRecommendedStops(playerX, playerZ, scooterX, scooterZ);

    // Determine active stop:
    //  1) If carrying food, immediate priority is ALWAYS that carried mission (load to box or drop off)
    //  2) Else if user manually pinned a mission (`selectedMissionId`), focus its next stop
    //  3) Else follow recommendedStops[0]
    let currentStop: RecommendedStop | null = stops[0] ?? null;
    const carrying = this.getCarryingMission();
    if (!carrying && this.selectedMissionId) {
      const pinnedStop = stops.find((s) => s.missionId === this.selectedMissionId);
      if (pinnedStop) {
        currentStop = pinnedStop;
      }
    }

    for (const s of stops) {
      s.isCurrent = currentStop !== null && s.missionId === currentStop.missionId && s.kind === currentStop.kind;
    }

    const focusMission = currentStop ? this.getMissionById(currentStop.missionId) : null;
    const targetPos = currentStop ? { x: currentStop.x, z: currentStop.z } : null;
    const target = currentStop?.location ?? null;
    const isPickupTarget = currentStop?.kind === 'pickup';
    const isCargoBoxTarget = currentStop?.kind === 'load_box';

    let route: RoutePoint[] = [];
    let guidance: TurnGuidance | null = null;

    if (targetPos) {
      if (isCargoBoxTarget) {
        const directDist = Math.hypot(targetPos.x - playerX, targetPos.z - playerZ);
        route = [
          { x: playerX, z: playerZ },
          { x: targetPos.x, z: targetPos.z },
        ];
        guidance = {
          direction: 'arrive',
          distanceToTurn: Math.round(directDist),
          totalDistance: Math.round(directDist),
          instructionText: `배달통 적재 (${Math.round(directDist)}m)`,
        };
      } else {
        const pathRes = navigator.findShortestPath(playerX, playerZ, targetPos.x, targetPos.z);
        route = pathRes.points;
        guidance = navigator.computeTurnGuidance(route, pathRes.distance, playerHeading);
      }
    }

    const totalBundleDistance =
      stops.length > 0 ? Math.round(stops[stops.length - 1].cumulativeDistance) : 0;

    const plan: NavigationPlan = {
      focusMission,
      target,
      targetPos,
      isPickupTarget,
      isCargoBoxTarget,
      route,
      guidance,
      recommendedStops: stops,
      totalBundleDistance,
    };

    this.cachedPlan = plan;
    this.lastNavX = playerX;
    this.lastNavZ = playerZ;
    this.lastNavHeading = playerHeading;
    this.lastNavFingerprint = fp;
    this.lastNavTime = elapsedTime;
    return plan;
  }

  /**
   * Exact optimal valid stop ordering (TSP with pickup->dropoff precedence) over <= 3 active orders.
   * Uses Manhattan road-grid metric for ultra-fast (<0.05ms) evaluation of all valid sequences (<= 90).
   */
  private computeRecommendedStops(
    playerX: number,
    playerZ: number,
    scooterX: number,
    scooterZ: number
  ): RecommendedStop[] {
    if (this.activeMissions.length === 0) return [];

    interface StepCandidate {
      mission: ActiveMission;
      kind: 'pickup' | 'load_box' | 'dropoff';
      x: number;
      z: number;
      location: DeliveryLocation | null;
    }

    const forcedFirst: StepCandidate[] = [];
    const missions = this.activeMissions;

    // 0 = needs pickup then dropoff, 1 = needs dropoff only, 2 = already handled/done
    const initialStage: number[] = missions.map((m) => {
      if (m.phase === 'to_pickup') return 0;
      if (m.phase === 'carrying_to_box') {
        forcedFirst.push({
          mission: m,
          kind: 'load_box',
          x: scooterX,
          z: scooterZ,
          location: null,
        });
        return 1; // after loading into box, still needs dropoff
      }
      if (m.phase === 'carrying_to_lobby' || m.phase === 'lobby_unlocked') {
        forcedFirst.push({
          mission: m,
          kind: 'dropoff',
          x: m.order.customer.x,
          z: m.order.customer.z,
          location: m.order.customer,
        });
        return 2; // already forced as immediate first stop
      }
      if (m.phase === 'cargo_loaded') return 1;
      return 2;
    });

    const startX = forcedFirst.length > 0 ? forcedFirst[forcedFirst.length - 1].x : playerX;
    const startZ = forcedFirst.length > 0 ? forcedFirst[forcedFirst.length - 1].z : playerZ;

    let bestCost = Infinity;
    let bestTail: StepCandidate[] = [];

    const manhattan = (ax: number, az: number, bx: number, bz: number) =>
      Math.abs(ax - bx) + Math.abs(az - bz);

    const search = (
      cx: number,
      cz: number,
      stages: number[],
      costSoFar: number,
      seq: StepCandidate[]
    ) => {
      if (costSoFar >= bestCost) return;

      let remaining = false;
      for (let i = 0; i < missions.length; i++) {
        if (stages[i] < 2) {
          remaining = true;
          const m = missions[i];
          const isPickup = stages[i] === 0;
          const loc = isPickup ? m.order.shop : m.order.customer;
          const nextCost = costSoFar + manhattan(cx, cz, loc.x, loc.z);

          stages[i]++;
          seq.push({
            mission: m,
            kind: isPickup ? 'pickup' : 'dropoff',
            x: loc.x,
            z: loc.z,
            location: loc,
          });
          search(loc.x, loc.z, stages, nextCost, seq);
          seq.pop();
          stages[i]--;
        }
      }

      if (!remaining && costSoFar < bestCost) {
        bestCost = costSoFar;
        bestTail = [...seq];
      }
    };

    search(startX, startZ, [...initialStage], 0, []);

    const fullSeq = [...forcedFirst, ...bestTail];
    const result: RecommendedStop[] = [];
    let prevX = playerX;
    let prevZ = playerZ;
    let cumDist = 0;

    for (let i = 0; i < fullSeq.length; i++) {
      const st = fullSeq[i];
      const leg = Math.round(manhattan(prevX, prevZ, st.x, st.z));
      cumDist += leg;
      prevX = st.x;
      prevZ = st.z;

      const m = st.mission;
      const slotTag = m.cargoSlot !== null ? ` · 슬롯 ${m.cargoSlot + 1}` : '';
      result.push({
        missionId: m.order.id,
        orderNumber: m.order.orderNumber,
        kind: st.kind,
        location: st.location,
        x: st.x,
        z: st.z,
        label:
          st.kind === 'pickup'
            ? m.order.shop.name
            : st.kind === 'load_box'
              ? '오토바이 배달통 적재'
              : `${m.order.customer.name} ${m.order.unitNumber}`,
        sublabel:
          st.kind === 'pickup'
            ? `픽업 #${m.order.orderNumber} · ${m.order.menuName}`
            : st.kind === 'load_box'
              ? `손에 든 #${m.order.orderNumber} 적재 후 이동`
              : `배달 #${m.order.orderNumber}${slotTag} · PIN ${m.order.doorPin}`,
        emoji:
          st.kind === 'pickup' ? m.order.shop.emoji : st.kind === 'load_box' ? '📦' : m.order.customer.emoji,
        cargoSlot: m.cargoSlot,
        legDistance: leg,
        cumulativeDistance: cumDist,
        isCurrent: i === 0,
      });
    }

    return result;
  }
}
