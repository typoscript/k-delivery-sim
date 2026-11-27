import { DeliveryLocation, FoodTempType, clamp } from '../types';
import { DemandPhase, SHIFT_START_MINUTE, demandPhaseAt } from '../game/GameClock';
import { RoadNavigator, RoutePoint, TurnGuidance } from '../world/RoadNavigator';
import { ScooterState } from '../vehicle/ScooterPhysics';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import { pickLocalCustomer, pickLocalShop } from './localPairing';
import {
  CustomerReview,
  MAX_STORED_REVIEWS,
  REGULAR_SHOP_THRESHOLD,
  RiderCareerSave,
  RiderTierSpec,
  UpgradeId,
  generateCustomerReview,
  getRiderTier,
  getUpgradeEffects,
  loadRiderCareer,
  localDateKey,
  saveRiderCareer,
} from './RiderCareer';

export const MAX_CONCURRENT_ORDERS = 3;
export const CARGO_SLOT_COUNT = 3;
export const INTERACT_ZONE_RADIUS = 3.6;
export const RAIN_SURCHARGE_BONUS = 1500;
export const NIGHT_SURCHARGE_BONUS = 1200; // 심야(야간) 배달 할증 +₩1,200
export const VILLA_STAIR_BONUS = 500; // 엘리베이터 없는 구축 빌라 계단 수고비 +₩500
export const OPTIMAL_TEMP_BONUS = 300; // 보온/보냉 최적 온도 유지 보너스 +₩300
export const PROMISED_CAREFUL_TIP = 1000; // 고객 채팅 조심배달 약속 팁 +₩1,000
export const BASE_FLAT_FEE = 3200;
export const SINGLE_FLAT_FEE = 4500; // 한집배달 기본 4,500원 + 거리할증
export const SINGLE_TIME_LIMIT_SEC = 300; // 한집배달 제한시간 300초
export const ALTTLE_FLAT_FEE = 2800; // 알뜰배달 기본 2,800원 x 2건
export const ALTTLE_TIME_LIMIT_SEC = 500; // 알뜰배달 제한시간 500초
export const FUEL_PRICE_PER_PERCENT = 40; // full 0->100% fill = ₩4,000
export const REPAIR_COST_PER_DAMAGE_STAGE = 2500; // stage 1..3 = ₩2,500..₩7,500
export const DAILY_MISSION_TARGET = 3; // 오늘 3건 배달 완료하기
export const DAILY_MISSION_BONUS = 5000; // +₩5,000 미션 달성 보너스
export const PEDESTRIAN_ACCIDENT_FINE = 50000; // 보행자 접촉 사고 과태료 및 합의금 -50,000원
export const PEDESTRIAN_RATING_PENALTY = 1.0; // 보행자 사고 신뢰 평점 -1.0점 감점
export const INITIAL_RIDER_RATING = 5.0; // 배달 기사 초기 신뢰 평점 (5.0 만점)

export interface DailyMissionStatus {
  title: string;
  current: number;
  target: number;
  bonus: number;
  completed: boolean;
  progressPct: number;
}

export type DispatchOrderType = 'SINGLE' | 'ALTTLE_BUNDLE';
export type DeliveryInstruction = 'PHOTO_DOOR' | 'KNOCK_DOOR' | 'MEET_FACE';

export interface InstructionMeta {
  type: DeliveryInstruction;
  badge: string;
  shortLabel: string;
  detailText: string;
}

export function getInstructionMeta(type: DeliveryInstruction): InstructionMeta {
  switch (type) {
    case 'KNOCK_DOOR':
      return {
        type,
        badge: '✊ 노크 후 문 앞',
        shortLabel: '노크 후 문 앞',
        detailText: '현관문 노크(똑똑똑) 후 문 앞에 두고 가주세요',
      };
    case 'MEET_FACE':
      return {
        type,
        badge: '🙋 직접 대면 수령',
        shortLabel: '직접 대면 수령',
        detailText: '인터폰 벨 누르고 직접 전달해주세요',
      };
    default:
      return {
        type: 'PHOTO_DOOR',
        badge: '📸 문 앞 (사진)',
        shortLabel: '문 앞 사진',
        detailText: '문 앞에 놓고 배달 완료 사진을 찍어주세요',
      };
  }
}

export function generateRandomInstruction(): DeliveryInstruction {
  const list: DeliveryInstruction[] = ['PHOTO_DOOR', 'KNOCK_DOOR', 'MEET_FACE'];
  return list[Math.floor(Math.random() * list.length)];
}

export interface FoodPhysicsMeta {
  tempType: FoodTempType;
  isSpillSensitive: boolean;
  categoryTag: string;
}

/** Classifies Korean delivery menu items into hot/cold & spill-sensitive physics categories */
export function classifyMenuFood(menuName: string, shopId: string): FoodPhysicsMeta {
  const isCold =
    menuName.includes('아이스') ||
    menuName.includes('스무디') ||
    menuName.includes('생크림 케이크') ||
    menuName.includes('콜라') && shopId === 'shop-coffee';

  const isSoupOrDrink =
    menuName.includes('마라탕') ||
    menuName.includes('국밥') ||
    menuName.includes('해장국') ||
    menuName.includes('부대찌개') ||
    menuName.includes('짬뽕') ||
    menuName.includes('쌀국수') ||
    menuName.includes('육개장') ||
    menuName.includes('오뎅탕') ||
    menuName.includes('우동') ||
    menuName.includes('라볶이') ||
    menuName.includes('아메리카노') ||
    menuName.includes('라떼') ||
    menuName.includes('스무디') ||
    shopId === 'shop-mara' ||
    shopId === 'shop-gukbap' ||
    shopId === 'shop-haejang' ||
    shopId === 'shop-jjamppong' ||
    shopId === 'shop-pho' ||
    shopId === 'shop-starbucks' ||
    shopId === 'shop-coffee';

  const isFragile = menuName.includes('케이크') || menuName.includes('피자') || menuName.includes('초밥');

  if (isCold && isSoupOrDrink) {
    return { tempType: 'cold', isSpillSensitive: true, categoryTag: '🧊 음료·쏟음/녹음 주의' };
  }
  if (isCold) {
    return { tempType: 'cold', isSpillSensitive: isFragile, categoryTag: isFragile ? '🍰 보냉·흔들림 주의' : '🧊 보냉 주의' };
  }
  if (isSoupOrDrink) {
    return { tempType: 'hot', isSpillSensitive: true, categoryTag: '🍲 국물·흔들림 주의' };
  }
  if (isFragile) {
    return { tempType: 'hot', isSpillSensitive: true, categoryTag: '🍕 수평·흔들림 주의' };
  }
  return { tempType: 'hot', isSpillSensitive: false, categoryTag: '🔥 따끈 보온' };
}

/** Generates realistic floor & unit numbers based on Korean building type (walk-up villa 2~4F vs apt 3~16F) */
export function generateUnitNumberForLocation(loc: DeliveryLocation): string {
  if (loc.residenceKind === 'walkup_villa') {
    const floor = 2 + Math.floor(Math.random() * 3); // 2F ~ 4F (no elevator!)
    const unit = 1 + Math.floor(Math.random() * 2); // 01 ~ 02
    return `${floor}0${unit}호`;
  }
  const floor = 3 + Math.floor(Math.random() * 14); // 3F ~ 16F
  const unit = 1 + Math.floor(Math.random() * 4); // 01 ~ 04
  return `${floor}0${unit}호`;
}

export type CustomerChatKind = 'change_to_photo' | 'fix_unit_number' | 'extra_tip_careful';

export interface CustomerChatEvent {
  missionId: string;
  orderNumber: string;
  customerName: string;
  kind: CustomerChatKind;
  title: string;
  message: string;
  effectBadge: string;
}

/** Generates realistic Korean apartment entrance keypad patterns */
export function generateKoreanLobbyPin(): { code: string; label: string } {
  let digits = '';
  for (let i = 0; i < 4; i++) {
    digits += String(Math.floor(Math.random() * 10));
  }
  const roll = Math.random();
  if (roll < 0.34) {
    return { code: `🔔${digits}`, label: `종모양(🔔) + ${digits}` };
  }
  if (roll < 0.68) {
    return { code: `🔑${digits}📞`, label: `열쇠(🔑) + ${digits} + 통화(📞)` };
  }
  if (roll < 0.85) {
    return { code: `#${digits}*`, label: `# + ${digits} + *` };
  }
  return { code: digits, label: `${digits} (번호 4자리)` };
}

export interface DailyFinanceLedger {
  completedCount: number;
  baseFeeTotal: number;
  distanceBonusTotal: number;
  rainBonusTotal: number;
  nightBonusTotal: number;
  peakBonusTotal: number;
  tierBonusTotal: number;
  tipTotal: number;
  missionBonusTotal: number;
  damageDeductionTotal: number;
  fuelExpense: number;
  repairExpense: number;
  upgradeExpense: number;
  convenienceExpense: number;
  fineExpense: number;
  grossIncome: number;
  totalExpenses: number;
  netProfit: number;
  walletBalance: number;
  lifetimeCompleted: number;
  riderTier: RiderTierSpec;
  riderRating: number;
  pedestrianAccidentCount: number;
}

export interface DeliveryOrder {
  id: string;
  orderNumber: string; // e.g., "A-12", "B-07", "C-45"
  dispatchType: DispatchOrderType; // 'SINGLE' (한집배달) | 'ALTTLE_BUNDLE' (알뜰배달)
  deliveryInstruction: DeliveryInstruction; // 'PHOTO_DOOR' | 'KNOCK_DOOR' | 'MEET_FACE'
  baseFlatFee: number; // 4500 (SINGLE) | 2800 (ALTTLE_BUNDLE)
  timeLimitSec: number; // 300 (SINGLE) | 500 (ALTTLE_BUNDLE)
  shop: DeliveryLocation;
  customer: DeliveryLocation;
  unitNumber: string; // e.g., "1402호"
  doorPin: string; // exact keypad sequence, e.g., "🔔1234", "🔑5678📞", "4829"
  doorPinLabel: string; // Korean pattern hint, e.g., "종모양(🔔) + 1234"
  menuName: string;
  foodTempType: FoodTempType;
  isSpillSensitive: boolean;
  foodCategoryTag: string;
  baseFee: number;
  rainBonus: number; // +1500 when generated in Rain mode!
  nightBonus: number; // +1200 when generated in Night mode!
  /** +₩1,000 when generated during a lunch / dinner rush (GameClock demand phase) */
  peakBonus?: number;
  distanceMeters: number;
}

export type MissionPhase =
  | 'to_pickup' // Go to outdoor store pickup counter & enter order number on POS
  | 'cooking_wait' // Peak-time cooking delay (5~10s countdown) -> player is FREE to move/ride/use phone!
  | 'pickup_ready' // Cooking finished! 3D food bag spawned on outdoor tray -> press [E] to pick up into hand
  | 'carrying_to_box' // Food bag in hand (CARRYING_FOOD, cannot drive!) -> load into scooter cargo slot
  | 'cargo_loaded' // Food inside scooter cargo box slot (0..2) -> ride to residence & unload from slot
  | 'carrying_to_lobby' // Food bag back in hand -> enter apartment lobby keypad pattern at 1st-floor glass door
  | 'lobby_unlocked' // 1st-floor glass door open -> step to elevator to ride up to corridor
  | 'in_corridor' // Inside underground corridor (y=-500) -> branch by deliveryInstruction!
  | 'photo_mode' // PHOTO_DOOR: food placed on mat -> smartphone camera viewfinder open
  | 'knock_waiting' // KNOCK_DOOR: knocked & placed on mat -> waiting 3s before completion
  | 'meet_waiting' // MEET_FACE: rang intercom -> door swinging 70° & NPC taking food
  | 'corridor_exit'; // Delivery settled! Walk back to corridor elevator to return to 1st floor

export interface ActiveMission {
  order: DeliveryOrder;
  phase: MissionPhase;
  foodIntegrity: number; // 0..100
  foodTemp: number; // 0..100 (hot retention or cold retention after pickup)
  spillDamageAccum: number; // cumulative damage caused by soup/drink slosh & speed bumps
  startedAt: number;
  remainingTimeSec: number; // counts down from order.timeLimitSec (300s / 500s)
  cookingDurationSec: number; // total cooking delay assigned (5..10s, 0 if instant)
  cookingRemainingSec: number; // live countdown while in 'cooking_wait'
  cargoSlot: number | null; // 0 | 1 | 2 when inside top-box
  pickedUp: boolean;
  chatEventTriggered: boolean;
  chatTriggerDelaySec: number; // >0 if scheduled to trigger mid-ride
  chatLoadedElapsedSec: number;
  chatNote: string | null;
  promisedExtraTip: number; // +₩1,000 if customer asked for careful delivery & integrity >= 85%
}

export interface PosPickupResult {
  mission: ActiveMission;
  status: 'cooking' | 'picked_up';
  waitSec: number;
  isRegularPerk: boolean;
  savedWaitSec: number;
  shopPickupCount: number;
  justBecameRegular: boolean;
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
  nightBonus: number;
  peakBonus: number;
  tierBonus: number;
  tierPromotedTo: RiderTierSpec | null;
  foodIntegrity: number;
  foodTemp: number;
  spillDamageAccum: number;
  tempBonus: number;
  villaStairBonus: number;
  promisedTipBonus: number;
  tip: number;
  tipPenalty: number;
  earned: number;
  totalEarnings: number;
  completedCount: number;
  missionJustCompleted: boolean;
  missionBonusAwarded: number;
  review: CustomerReview;
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

  /** Rider position used to offer nearby shops on the city-sized open-world map */
  public refX = ACTIVE_MAP_DATA.meta.playerSpawn.x;
  public refZ = ACTIVE_MAP_DATA.meta.playerSpawn.z;

  public totalEarnings = 0; // Persistent wallet balance across sessions & Suwon districts!
  public completedCount = 0; // Today's session completed count
  public lifetimeCompleted = 0; // Lifetime completed deliveries (determines Rider Tier!)
  public career: RiderCareerSave;
  public isWeatherRaining = false;
  public isNightMode = false;
  /** Current demand phase from the game clock (call frequency, peak surcharge, kitchen wait) */
  public demandPhase: DemandPhase = demandPhaseAt(SHIFT_START_MINUTE);

  // Daily comprehensive finance ledger & mission state
  public baseFeeTotal = 0;
  public distanceBonusTotal = 0;
  public rainBonusTotal = 0;
  public nightBonusTotal = 0;
  public peakBonusTotal = 0;
  public tierBonusTotal = 0;
  public tipTotal = 0;
  public missionBonusTotal = 0;
  public dailyMissionClaimed = false;
  /** Deliveries counted toward today's mission (persisted per local date, survives reloads & district switches) */
  private dailyMissionProgress = 0;
  private dailyMissionDate = localDateKey();
  public damageDeductionTotal = 0;
  public fuelExpense = 0;
  public repairExpense = 0;
  public upgradeExpense = 0;
  public convenienceExpense = 0;
  public fineExpense = 0;
  public riderRating = INITIAL_RIDER_RATING; // 0.0 ~ 5.0 신뢰 평점 (persisted!)
  public pedestrianAccidentCount = 0;

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
    this.career = loadRiderCareer();
    this.totalEarnings = this.career.walletBalance;
    this.lifetimeCompleted = this.career.lifetimeCompleted;
    this.riderRating = this.career.riderRating;
    const dm = this.career.dailyMission;
    if (dm && dm.date === this.dailyMissionDate) {
      this.dailyMissionProgress = dm.progress;
      this.dailyMissionClaimed = dm.claimed;
    }
    this.refreshAvailableOrders();
  }

  /** Called every frame with the rider position (outdoors) so new orders stay local */
  public setReferencePosition(x: number, z: number): void {
    this.refX = x;
    this.refZ = z;
  }

  public persistCareer(): void {
    this.career.walletBalance = Math.round(this.totalEarnings);
    this.career.lifetimeCompleted = this.lifetimeCompleted;
    this.career.riderRating = Math.round(this.riderRating * 10) / 10;
    this.career.dailyMission = {
      date: this.dailyMissionDate,
      progress: this.dailyMissionProgress,
      claimed: this.dailyMissionClaimed,
    };
    saveRiderCareer(this.career);
  }

  public getCurrentTier(): RiderTierSpec {
    return getRiderTier(this.lifetimeCompleted);
  }

  public hasUpgrade(id: UpgradeId): boolean {
    return this.career.upgrades.includes(id);
  }

  public buyUpgrade(id: UpgradeId, cost: number): boolean {
    if (this.hasUpgrade(id)) return false;
    const rounded = Math.max(0, Math.round(cost / 100) * 100);
    this.career.upgrades.push(id);
    this.upgradeExpense += rounded;
    this.totalEarnings -= rounded;
    this.persistCareer();
    return true;
  }

  public getShopPickupCount(shopId: string): number {
    return this.career.shopPickupCounts[shopId] ?? 0;
  }

  public isRegularShop(shopId: string): boolean {
    return this.getShopPickupCount(shopId) >= REGULAR_SHOP_THRESHOLD;
  }

  public getRegularShops(): Array<{ shopId: string; name: string; count: number }> {
    const out: Array<{ shopId: string; name: string; count: number }> = [];
    for (const [shopId, count] of Object.entries(this.career.shopPickupCounts)) {
      if (count >= REGULAR_SHOP_THRESHOLD) {
        const localShop = this.shops.find((s) => s.id === shopId);
        const name =
          this.career.shopNames[shopId] ??
          (localShop ? `${localShop.emoji} ${localShop.name}` : shopId);
        out.push({ shopId, name, count });
      }
    }
    out.sort((a, b) => b.count - a.count);
    return out;
  }

  public getRecentReviews(): CustomerReview[] {
    return this.career.reviews;
  }

  public getAverageReviewStars(): number | null {
    const list = this.career.reviews;
    if (list.length === 0) return null;
    const sum = list.reduce((acc, r) => acc + r.stars, 0);
    return Math.round((sum / list.length) * 10) / 10;
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
        (m) =>
          m.phase === 'in_corridor' ||
          m.phase === 'photo_mode' ||
          m.phase === 'knock_waiting' ||
          m.phase === 'meet_waiting' ||
          m.phase === 'corridor_exit'
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

  private createActiveMission(order: DeliveryOrder, startedAt: number): ActiveMission {
    // ~62% of orders get a live Korean mid-delivery customer chat event once loaded on scooter!
    const willChat = Math.random() < 0.62;
    return {
      order,
      phase: 'to_pickup',
      foodIntegrity: 100,
      foodTemp: 100,
      spillDamageAccum: 0,
      startedAt,
      remainingTimeSec: order.timeLimitSec,
      cookingDurationSec: 0,
      cookingRemainingSec: 0,
      cargoSlot: null,
      pickedUp: false,
      chatEventTriggered: false,
      chatTriggerDelaySec: willChat ? 4.5 + Math.random() * 6.5 : 0,
      chatLoadedElapsedSec: 0,
      chatNote: null,
      promisedExtraTip: 0,
    };
  }

  public setWeatherRaining(raining: boolean): void {
    if (this.isWeatherRaining === raining) return;
    this.isWeatherRaining = raining;
    // Immediately refresh unaccepted calls so players see "+₩1,500 우천 할증" calls right away!
    this.refreshAvailableOrders();
  }

  public setNightMode(night: boolean): void {
    if (this.isNightMode === night) return;
    this.isNightMode = night;
    // Immediately refresh unaccepted calls so players see "+₩1,200 심야 할증" calls right away!
    this.refreshAvailableOrders();
  }

  /** Game clock moved into a new demand phase: refresh unaccepted calls so rush-hour surcharges show at once */
  public setDemandPhase(phase: DemandPhase): void {
    if (this.demandPhase.id === phase.id) return;
    this.demandPhase = phase;
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
      const shop = pickLocalShop(this.shops, this.refX, this.refZ);
      const customer = pickLocalCustomer(this.residences, shop);
      const key = `${shop.id}-${customer.id}`;
      if (usedPairs.has(key)) continue;
      usedPairs.add(key);

      const menus = shop.menus ?? ['배달 음식 세트'];
      const menuName = menus[Math.floor(Math.random() * menus.length)];
      const manhattan = Math.abs(shop.x - customer.x) + Math.abs(shop.z - customer.z);
      const distanceMeters = Math.round(manhattan);
      const isSingle = orders.length % 2 === 0;
      const dispatchType: DispatchOrderType = isSingle ? 'SINGLE' : 'ALTTLE_BUNDLE';
      const baseFlatFee = isSingle ? SINGLE_FLAT_FEE : ALTTLE_FLAT_FEE;
      const distBonus = isSingle ? Math.round((distanceMeters * 12) / 100) * 100 : 0;
      const baseFee = baseFlatFee + distBonus;

      const pinObj = generateKoreanLobbyPin();
      const foodMeta = classifyMenuFood(menuName, shop.id);
      orders.push({
        id: `ORD-${this.orderSeq++}`,
        orderNumber: this.generateOrderNumber(usedNumbers),
        dispatchType,
        deliveryInstruction: generateRandomInstruction(),
        baseFlatFee,
        timeLimitSec: isSingle ? SINGLE_TIME_LIMIT_SEC : ALTTLE_TIME_LIMIT_SEC,
        shop,
        customer,
        unitNumber: generateUnitNumberForLocation(customer),
        doorPin: pinObj.code,
        doorPinLabel: pinObj.label,
        menuName,
        foodTempType: foodMeta.tempType,
        isSpillSensitive: foodMeta.isSpillSensitive,
        foodCategoryTag: foodMeta.categoryTag,
        baseFee,
        rainBonus: this.isWeatherRaining ? RAIN_SURCHARGE_BONUS : 0,
        nightBonus: this.isNightMode ? NIGHT_SURCHARGE_BONUS : 0,
        peakBonus: this.demandPhase.peakBonus,
        distanceMeters,
      });
    }

    this.availableOrders = orders;
  }

  public acceptOrder(orderId: string): DeliveryOrder | null {
    if (!this.canAcceptMoreOrders()) return null;
    const found = this.availableOrders.find((o) => o.id === orderId);
    if (!found) return null;

    this.activeMissions.push(this.createActiveMission(found, performance.now()));
    this.availableOrders = this.availableOrders.filter((o) => o.id !== orderId);

    // Keep at least 3 fresh calls ready so bundled pickups feel lively
    if (this.availableOrders.length < 2) {
      this.replenishAvailableOrders();
    }
    this.invalidateNavCache();
    return found;
  }

  /** Accepts 1 (SINGLE) or 2 (ALTTLE_BUNDLE) orders simultaneously from OrderDispatchManager */
  public acceptDispatchedOffer(orders: DeliveryOrder[]): boolean {
    if (orders.length === 0) return false;
    if (this.activeMissions.length + orders.length > MAX_CONCURRENT_ORDERS) {
      return false;
    }
    const now = performance.now();
    for (const o of orders) {
      this.activeMissions.push(this.createActiveMission(o, now));
    }
    this.invalidateNavCache();
    return true;
  }

  /** Steps active mission delivery countdowns & peak-time cooking delay timers */
  public stepTimers(dt: number, onCookingReady?: (mission: ActiveMission) => void): void {
    for (const m of this.activeMissions) {
      if (m.phase === 'corridor_exit') continue;
      m.remainingTimeSec = Math.max(0, m.remainingTimeSec - dt);

      if (m.phase === 'cooking_wait') {
        m.cookingRemainingSec = Math.max(0, m.cookingRemainingSec - dt);
        if (m.cookingRemainingSec <= 0) {
          m.phase = 'pickup_ready';
          m.cookingRemainingSec = 0;
          this.invalidateNavCache();
          if (onCookingReady) {
            onCookingReady(m);
          }
        }
      }
    }
  }

  public getCookingMissions(): ActiveMission[] {
    return this.activeMissions.filter(
      (m) => m.phase === 'cooking_wait' || m.phase === 'pickup_ready'
    );
  }

  public getPrimaryCookingMission(): ActiveMission | null {
    return (
      this.activeMissions.find((m) => m.phase === 'cooking_wait') ??
      this.activeMissions.find((m) => m.phase === 'pickup_ready') ??
      null
    );
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
      const shop = pickLocalShop(this.shops, this.refX, this.refZ);
      const customer = pickLocalCustomer(this.residences, shop);
      const key = `${shop.id}-${customer.id}`;
      if (usedPairs.has(key)) continue;
      usedPairs.add(key);

      const menus = shop.menus ?? ['배달 음식 세트'];
      const menuName = menus[Math.floor(Math.random() * menus.length)];
      const manhattan = Math.abs(shop.x - customer.x) + Math.abs(shop.z - customer.z);
      const distanceMeters = Math.round(manhattan);
      const isSingle = this.availableOrders.length % 2 === 0;
      const dispatchType: DispatchOrderType = isSingle ? 'SINGLE' : 'ALTTLE_BUNDLE';
      const baseFlatFee = isSingle ? SINGLE_FLAT_FEE : ALTTLE_FLAT_FEE;
      const distBonus = isSingle ? Math.round((distanceMeters * 12) / 100) * 100 : 0;
      const baseFee = baseFlatFee + distBonus;

      const pinObj = generateKoreanLobbyPin();
      const foodMeta = classifyMenuFood(menuName, shop.id);
      this.availableOrders.push({
        id: `ORD-${this.orderSeq++}`,
        orderNumber: this.generateOrderNumber(usedNumbers),
        dispatchType,
        deliveryInstruction: generateRandomInstruction(),
        baseFlatFee,
        timeLimitSec: isSingle ? SINGLE_TIME_LIMIT_SEC : ALTTLE_TIME_LIMIT_SEC,
        shop,
        customer,
        unitNumber: generateUnitNumberForLocation(customer),
        doorPin: pinObj.code,
        doorPinLabel: pinObj.label,
        menuName,
        foodTempType: foodMeta.tempType,
        isSpillSensitive: foodMeta.isSpillSensitive,
        foodCategoryTag: foodMeta.categoryTag,
        baseFee,
        rainBonus: this.isWeatherRaining ? RAIN_SURCHARGE_BONUS : 0,
        nightBonus: this.isNightMode ? NIGHT_SURCHARGE_BONUS : 0,
        peakBonus: this.demandPhase.peakBonus,
        distanceMeters,
      });
    }
  }

  public cancelMission(orderId: string): ActiveMission | null {
    const idx = this.activeMissions.findIndex((m) => m.order.id === orderId);
    if (idx === -1) return null;
    const m = this.activeMissions[idx];
    if (
      m.phase === 'in_corridor' ||
      m.phase === 'photo_mode' ||
      m.phase === 'knock_waiting' ||
      m.phase === 'meet_waiting' ||
      m.phase === 'corridor_exit'
    ) {
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

  /**
   * Complete POS order-number check at an outdoor store counter.
   * Peak-time / busy cooked-food restaurants enter a 5~10s 'cooking_wait' state
   * (leaving rider completely free to move, ride, or use smartphone until ready!).
   */
  public completePosPickup(missionId: string, forceCookingDelay?: boolean): PosPickupResult | null {
    if (this.isCarryingFood()) return null;
    const m = this.getMissionById(missionId);
    if (!m || m.phase !== 'to_pickup') return null;

    // Peak-time cooked food shops (chicken, pizza, burger, bunsik, katsu, mara, gukbap) have high delay chance
    const busyCookShops = new Set([
      'shop-chicken',
      'shop-bunsik',
      'shop-burger',
      'shop-pizza',
      'shop-katsu',
      'shop-mara',
      'shop-gukbap',
      'shop-haejang',
      'shop-jjamppong',
      'shop-sundae',
      'shop-burgerking',
      'shop-lotteria',
      'shop-pho',
      'shop-sushi',
      'shop-mcd',
    ]);
    const sameShopCount = this.activeMissions.filter((x) => x.order.shop.id === m.order.shop.id).length;
    const delayProb = busyCookShops.has(m.order.shop.id) || sameShopCount > 1 ? 0.8 : 0.45;
    const hasDelay = forceCookingDelay !== undefined ? forceCookingDelay : Math.random() < delayProb;

    // Regular Store Perk: >= 2 previous pickups at this shop grants priority fast-track cooking!
    const prevCount = this.getShopPickupCount(m.order.shop.id);
    const isRegularPerk = prevCount >= REGULAR_SHOP_THRESHOLD;
    const nextCount = prevCount + 1;
    this.career.shopPickupCounts[m.order.shop.id] = nextCount;
    this.career.shopNames[m.order.shop.id] = `${m.order.shop.emoji} ${m.order.shop.name}`;
    const justBecameRegular = prevCount < REGULAR_SHOP_THRESHOLD && nextCount >= REGULAR_SHOP_THRESHOLD;
    this.persistCareer();

    if (hasDelay) {
      // 5 ~ 10 seconds random, longer while kitchens are slammed in a lunch / dinner rush
      const rawWaitSec = Math.round((5 + Math.floor(Math.random() * 6)) * this.demandPhase.cookingMul);
      if (isRegularPerk && rawWaitSec <= 6) {
        // Regular store owner prioritized your order -> instant handoff!
        m.phase = 'carrying_to_box';
        m.pickedUp = true;
        this.invalidateNavCache();
        return {
          mission: m,
          status: 'picked_up',
          waitSec: 0,
          isRegularPerk: true,
          savedWaitSec: rawWaitSec,
          shopPickupCount: nextCount,
          justBecameRegular,
        };
      }
      const waitSec = isRegularPerk ? Math.max(2, Math.round(rawWaitSec * 0.45)) : rawWaitSec;
      const savedWaitSec = rawWaitSec - waitSec;
      m.phase = 'cooking_wait';
      m.cookingDurationSec = waitSec;
      m.cookingRemainingSec = waitSec;
      this.invalidateNavCache();
      return {
        mission: m,
        status: 'cooking',
        waitSec,
        isRegularPerk,
        savedWaitSec,
        shopPickupCount: nextCount,
        justBecameRegular,
      };
    }

    m.phase = 'carrying_to_box';
    m.pickedUp = true;
    this.invalidateNavCache();
    return {
      mission: m,
      status: 'picked_up',
      waitSec: 0,
      isRegularPerk,
      savedWaitSec: 0,
      shopPickupCount: nextCount,
      justBecameRegular,
    };
  }

  /** Collects the spawned 3D takeout food bag from the shop pickup tray into the rider's left hand */
  public collectReadyPickup(missionId: string): ActiveMission | null {
    if (this.isCarryingFood()) return null;
    const m = this.getMissionById(missionId);
    if (!m || m.phase !== 'pickup_ready') return null;
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

  public startKnockDelivery(): ActiveMission | null {
    const m = this.getCorridorMission();
    if (!m || m.phase !== 'in_corridor') return null;
    m.phase = 'knock_waiting';
    return m;
  }

  public startMeetFaceDelivery(): ActiveMission | null {
    const m = this.getCorridorMission();
    if (!m || m.phase !== 'in_corridor') return null;
    m.phase = 'meet_waiting';
    return m;
  }

  /** Called when photo shutter is pressed (PHOTO_DOOR) or after knock/face-to-face completion! */
  public completePhotoSettlement(): SettlementResult | null {
    const m = this.getCorridorMission();
    if (
      !m ||
      (m.phase !== 'photo_mode' && m.phase !== 'knock_waiting' && m.phase !== 'meet_waiting')
    ) {
      return null;
    }

    const integrityFactor = m.foodIntegrity / 100;
    const maxTip = 500;
    const baseTip = m.foodIntegrity >= 95 ? maxTip : m.foodIntegrity >= 70 ? 200 : 0;
    // Cold/melted or lukewarm food (<50%) forfeits half of the safety tip
    const tip = m.foodTemp < 50 ? Math.round((baseTip * 0.5) / 100) * 100 : baseTip;
    const tipPenalty = maxTip - tip;

    const tempBonus = m.foodTemp >= 80 ? OPTIMAL_TEMP_BONUS : 0;
    const villaStairBonus = m.order.customer.residenceKind === 'walkup_villa' ? VILLA_STAIR_BONUS : 0;
    const promisedTipBonus =
      m.promisedExtraTip > 0 && m.foodIntegrity >= 85 ? m.promisedExtraTip : 0;

    const rainBonus = m.order.rainBonus;
    const nightBonus = m.order.nightBonus;
    const peakBonus = m.order.peakBonus ?? 0;
    const prevTier = this.getCurrentTier();
    const tierBonus = prevTier.bonusPerDelivery;
    const extraBonuses = tempBonus + villaStairBonus + promisedTipBonus;
    // Payout is the exact sum of the itemized (already rounded) ledger parts, so the daily ledger's
    // net profit always matches the real wallet change (no independent ±₩100 rounding drift).
    const damageDed = Math.max(0, Math.round((m.order.baseFee * (1 - integrityFactor)) / 100) * 100);
    const earned =
      m.order.baseFee - damageDed + tip + rainBonus + nightBonus + peakBonus + tierBonus + extraBonuses;

    // Record itemized income breakdown into daily ledger (respects SINGLE ₩4,500 vs ALTTLE ₩2,800 base flat fee)
    const flatRef = m.order.baseFlatFee || BASE_FLAT_FEE;
    const basePart = Math.min(m.order.baseFee, flatRef);
    const distPart = Math.max(0, m.order.baseFee - basePart);
    this.baseFeeTotal += basePart;
    this.distanceBonusTotal += distPart;
    this.rainBonusTotal += rainBonus;
    this.nightBonusTotal += nightBonus;
    this.peakBonusTotal += peakBonus;
    this.tierBonusTotal += tierBonus;
    this.tipTotal += tip + extraBonuses;
    this.damageDeductionTotal += damageDed;

    this.totalEarnings += earned;
    this.completedCount += 1;
    this.lifetimeCompleted += 1;
    const today = localDateKey();
    if (today !== this.dailyMissionDate) {
      // Crossed midnight mid-shift -> start a fresh daily mission
      this.dailyMissionDate = today;
      this.dailyMissionProgress = 0;
      this.dailyMissionClaimed = false;
    }
    this.dailyMissionProgress += 1;
    const nextTier = this.getCurrentTier();
    const tierPromotedTo = nextTier.id !== prevTier.id ? nextTier : null;

    // Check daily 3-delivery mission completion (+₩5,000 instant wallet bonus!)
    let missionJustCompleted = false;
    let missionBonusAwarded = 0;
    if (!this.dailyMissionClaimed && this.dailyMissionProgress >= DAILY_MISSION_TARGET) {
      this.dailyMissionClaimed = true;
      this.missionBonusTotal += DAILY_MISSION_BONUS;
      this.totalEarnings += DAILY_MISSION_BONUS;
      missionJustCompleted = true;
      missionBonusAwarded = DAILY_MISSION_BONUS;
    }

    const now = new Date();
    const completedAt = `${String(now.getHours()).padStart(2, '0')}:${String(
      now.getMinutes()
    ).padStart(2, '0')}`;

    const review = generateCustomerReview({
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
      isWalkupVilla: m.order.customer.residenceKind === 'walkup_villa',
      isRain: rainBonus > 0,
      isNight: nightBonus > 0,
      deliveryInstruction: m.order.deliveryInstruction,
      createdAt: completedAt,
    });
    this.career.reviews.unshift(review);
    if (this.career.reviews.length > MAX_STORED_REVIEWS) {
      this.career.reviews.length = MAX_STORED_REVIEWS;
    }

    // Smoothly adjust trust rating from clean 5-star or damaged 1~2-star customer reviews
    if ((m.foodIntegrity >= 90 || review.stars === 5) && this.riderRating < 5.0) {
      this.riderRating = Math.min(5.0, Math.round((this.riderRating + 0.1) * 10) / 10);
    } else if (review.stars <= 2 && this.riderRating > 1.0) {
      this.riderRating = Math.max(1.0, Math.round((this.riderRating - 0.1) * 10) / 10);
    }
    this.persistCareer();

    this.completedMissions.unshift({
      order: m.order,
      earned,
      foodIntegrity: Math.round(m.foodIntegrity),
      completedAt,
    });
    if (this.completedMissions.length > 12) {
      this.completedMissions.length = 12;
    }

    const result: SettlementResult = {
      order: m.order,
      baseFee: m.order.baseFee,
      rainBonus,
      nightBonus,
      peakBonus,
      tierBonus,
      tierPromotedTo,
      foodIntegrity: Math.round(m.foodIntegrity),
      foodTemp: Math.round(m.foodTemp),
      spillDamageAccum: Math.round(m.spillDamageAccum),
      tempBonus,
      villaStairBonus,
      promisedTipBonus,
      tip,
      tipPenalty,
      earned,
      totalEarnings: this.totalEarnings,
      completedCount: this.completedCount,
      missionJustCompleted,
      missionBonusAwarded,
      review,
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

  /** Returns the highest-priority shop mission near the player's outdoor pickup counter (pickup_ready > to_pickup > cooking_wait) */
  public getMissionNearShopPickup(x: number, z: number): ActiveMission | null {
    const priority = (phase: MissionPhase) =>
      phase === 'pickup_ready' ? 3 : phase === 'to_pickup' ? 2 : phase === 'cooking_wait' ? 1 : 0;

    let best: ActiveMission | null = null;
    let bestPri = 0;
    let bestDist = INTERACT_ZONE_RADIUS;
    for (const m of this.activeMissions) {
      const pri = priority(m.phase);
      if (pri === 0) continue;
      const d = Math.hypot(x - m.order.shop.x, z - m.order.shop.z);
      if (d <= INTERACT_ZONE_RADIUS) {
        if (pri > bestPri || (pri === bestPri && d < bestDist)) {
          best = m;
          bestPri = pri;
          bestDist = d;
        }
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

  private spillWarnCooldown = 0;
  public activeSpillWarning = false;

  /**
   * Steps real-time food temperature (hot cooling / cold melting) and liquid/fragile slosh physics!
   * - Cold drinks/desserts lose temperature ~1.45x faster than hot food -> strategic bundle ordering!
   * - Harsh corner lean (>25°) or hard braking/accel (>9.2 m/s²) spills soup/coffee inside top box!
   */
  public stepCargoPhysics(
    dt: number,
    scooter: ScooterState,
    isRiding: boolean,
    onSpillPulse?: (orderNumber: string, menuName: string) => void
  ): void {
    const clampedDt = Math.min(dt, 0.05);
    this.spillWarnCooldown = Math.max(0, this.spillWarnCooldown - clampedDt);

    let spillingNow = false;
    let spillSample: ActiveMission | null = null;

    const absLean = Math.abs(scooter.leanAngle);
    const absLongAcc = Math.abs(scooter.lastLongAccel);
    const speedKmh = Math.abs(scooter.speed) * 3.6;

    // Harsh maneuver check while riding with cargo
    const harshLean = isRiding && !scooter.crashed && speedKmh > 20 && absLean > 0.44; // > ~25°
    const harshLong = isRiding && !scooter.crashed && speedKmh > 14 && absLongAcc > 9.4;

    const upgFx = getUpgradeEffects(this.career.upgrades);

    for (const m of this.activeMissions) {
      if (!m.pickedUp || m.phase === 'corridor_exit') continue;

      // 1. Temperature retention decay (insulated cargo box slows decay; thermal_box upgrade cuts decay another -40%!)
      const inInsulatedBox = m.phase === 'cargo_loaded';
      const baseRate = m.order.foodTempType === 'cold' ? 0.62 : 0.42; // % per second in box
      const tempRate = (inInsulatedBox ? baseRate * upgFx.tempDecayMul : baseRate * 1.55);
      m.foodTemp = clamp(m.foodTemp - tempRate * clampedDt, 0, 100);

      // 2. Real-time liquid/fragile spill damage inside top box from harsh lean or sudden braking
      if (inInsulatedBox && m.order.isSpillSensitive && (harshLean || harshLong)) {
        const leanFactor = harshLean ? (absLean - 0.44) * 10.5 : 0;
        const brakeFactor = harshLong ? (absLongAcc - 9.4) * 1.45 : 0;
        const dmg = (leanFactor + brakeFactor) * upgFx.spillDamageMul * clampedDt;
        if (dmg > 0) {
          m.foodIntegrity = clamp(m.foodIntegrity - dmg, 20, 100);
          m.spillDamageAccum += dmg;
          spillingNow = true;
          if (!spillSample) spillSample = m;
        }
      }
    }

    this.activeSpillWarning = spillingNow;
    if (spillingNow && spillSample && this.spillWarnCooldown <= 0) {
      this.spillWarnCooldown = 2.6;
      if (onSpillPulse) {
        onSpillPulse(spillSample.order.orderNumber, spillSample.order.menuName);
      }
    }
  }

  /** Applies suspension shock damage to loaded cargo when crossing a speed bump above 22 km/h */
  public applySpeedBumpImpact(speedKmh: number): {
    damagedCount: number;
    maxLoss: number;
    spillHit: boolean;
  } {
    if (speedKmh <= 22) {
      return { damagedCount: 0, maxLoss: 0, spillHit: false };
    }
    const excess = clamp((speedKmh - 22) / 36, 0.25, 1.0);
    let damagedCount = 0;
    let maxLoss = 0;
    let spillHit = false;

    const upgFx = getUpgradeEffects(this.career.upgrades);
    for (const id of this.cargoSlots) {
      if (!id) continue;
      const m = this.getMissionById(id);
      if (!m || m.phase !== 'cargo_loaded') continue;
      const loss = Math.round(
        (m.order.isSpillSensitive ? 6 + excess * 10 : 3 + excess * 5) * upgFx.spillDamageMul
      );
      m.foodIntegrity = clamp(m.foodIntegrity - loss, 15, 100);
      m.spillDamageAccum += loss;
      damagedCount++;
      if (loss > maxLoss) maxLoss = loss;
      if (m.order.isSpillSensitive) spillHit = true;
    }

    return { damagedCount, maxLoss, spillHit };
  }

  /**
   * Fires live Korean mid-delivery customer chat events while riding with loaded cargo:
   *  1. Baby sleeping -> changes deliveryInstruction live to PHOTO_DOOR!
   *  2. Wrong unit number typo -> updates unitNumber live on the same floor!
   *  3. Careful soup/rain request -> promises +₩1,000 extra tip if integrity >= 85%!
   */
  public stepCustomerChatEvents(
    dt: number,
    inCorridor: boolean,
    isRiding: boolean,
    onChatEvent: (ev: CustomerChatEvent) => void
  ): void {
    if (inCorridor || !isRiding) return;
    const clampedDt = Math.min(dt, 0.05);

    for (const m of this.activeMissions) {
      if (m.phase !== 'cargo_loaded' || m.chatEventTriggered || m.chatTriggerDelaySec <= 0) {
        continue;
      }
      m.chatLoadedElapsedSec += clampedDt;
      if (m.chatLoadedElapsedSec < m.chatTriggerDelaySec) continue;

      m.chatEventTriggered = true;
      const ev = this.triggerChatEventForMission(m);
      if (ev) {
        this.invalidateNavCache();
        onChatEvent(ev);
        break; // At most one popup per frame
      }
    }
  }

  private triggerChatEventForMission(m: ActiveMission): CustomerChatEvent | null {
    const o = m.order;
    const candidates: Array<'change_to_photo' | 'fix_unit_number' | 'extra_tip_careful'> = [];

    if (o.deliveryInstruction !== 'PHOTO_DOOR') {
      candidates.push('change_to_photo');
    }
    candidates.push('fix_unit_number');
    candidates.push('extra_tip_careful');
    if (o.isSpillSensitive || this.isWeatherRaining) {
      // Slightly weight careful-delivery tip chat for soup/drinks & rain
      candidates.push('extra_tip_careful');
    }

    const kind = candidates[Math.floor(Math.random() * candidates.length)];

    if (kind === 'change_to_photo') {
      o.deliveryInstruction = 'PHOTO_DOOR';
      m.chatNote = '👶 아기 수면 → 문 앞 사진으로 변경됨';
      return {
        missionId: o.id,
        orderNumber: o.orderNumber,
        customerName: `${o.customer.name} ${o.unitNumber}`,
        kind,
        title: '요청사항 실시간 변경!',
        message: '아기가 방금 잠들었어요ㅠㅠ 노크/벨 누르지 마시고 문 앞에 놓고 사진만 찍어주세요!',
        effectBadge: '📸 문 앞 사진으로 자동 변경',
      };
    }

    if (kind === 'fix_unit_number') {
      const oldUnit = o.unitNumber;
      const match = oldUnit.match(/(\d+)/);
      const num = match ? parseInt(match[1], 10) : 301;
      const floor = Math.floor(num / 100);
      const curU = num % 100;
      const maxU = o.customer.residenceKind === 'walkup_villa' ? 2 : 4;
      const nextU = (curU % maxU) + 1;
      const newUnit = `${floor}0${nextU}호`;
      o.unitNumber = newUnit;
      m.chatNote = `🏠 호수 정정: ${oldUnit} → ${newUnit}`;
      return {
        missionId: o.id,
        orderNumber: o.orderNumber,
        customerName: `${o.customer.name} 고객님`,
        kind,
        title: '배달 호수 오기재 정정!',
        message: `죄송해요 호수를 잘못 적었어요! ${oldUnit} 말고 ${newUnit}로 가져다주세요 🙇`,
        effectBadge: `🏠 목적지 ${oldUnit} → ${newUnit} 변경`,
      };
    }

    m.promisedExtraTip = PROMISED_CAREFUL_TIP;
    m.chatNote = '🙏 조심 배달 약속 팁 +₩1,000 (상태 85%↑)';
    const customMsg = o.isSpillSensitive
      ? `${o.menuName} 국물/음료 안 쏟아지게 천천히 와주세요! 안전하게 오시면 팁 +₩1,000 더 드릴게요 🙏`
      : `천천히 안전운전해서 와주세요! 음식 깔끔하게 오시면 팁 +₩1,000 챙겨드릴게요 🙏`;
    return {
      missionId: o.id,
      orderNumber: o.orderNumber,
      customerName: `${o.customer.name} ${o.unitNumber}`,
      kind,
      title: '고객 응원 & 추가 팁 약속!',
      message: customMsg,
      effectBadge: '💰 음식 85%↑ 유지 시 +₩1,000 팁',
    };
  }

  /** Applies crash impact damage to ALL food bags currently loaded in the 3 cargo box slots */
  public applyCrashDamage(
    severity: boolean | 'normal' | 'rain_slip' | 'pedestrian_hit' = false
  ): { damagedCount: number; loss: number } {
    const loss =
      severity === 'pedestrian_hit'
        ? 55
        : severity === true || severity === 'rain_slip'
          ? 32
          : 25;
    const minIntegrity = severity === 'pedestrian_hit' ? 5 : 15;
    let damagedCount = 0;
    for (const id of this.cargoSlots) {
      if (!id) continue;
      const m = this.getMissionById(id);
      if (m && m.phase === 'cargo_loaded') {
        m.foodIntegrity = Math.max(minIntegrity, m.foodIntegrity - loss);
        damagedCount++;
      }
    }
    return { damagedCount, loss: damagedCount > 0 ? loss : 0 };
  }

  public applyFine(amount: number): number {
    this.fineExpense += amount;
    this.totalEarnings -= amount;
    this.persistCareer();
    return amount;
  }

  /**
   * Applies pedestrian collision accident penalties:
   * - Immediately deducts -₩50,000 fine & settlement from player wallet balance (and daily ledger)
   * - Deducts 1.0 point from Rider Trust Rating (min 0.0)
   */
  public applyPedestrianAccidentPenalty(): {
    fine: number;
    ratingLoss: number;
    newRating: number;
    newBalance: number;
  } {
    const fine = this.applyFine(PEDESTRIAN_ACCIDENT_FINE);
    this.pedestrianAccidentCount += 1;
    const prevRating = this.riderRating;
    this.riderRating = Math.max(0, Math.round((this.riderRating - PEDESTRIAN_RATING_PENALTY) * 10) / 10);
    this.persistCareer();
    return {
      fine,
      ratingLoss: Math.round((prevRating - this.riderRating) * 10) / 10,
      newRating: this.riderRating,
      newBalance: this.totalEarnings,
    };
  }

  public recordFuelExpense(amount: number): void {
    const rounded = Math.max(0, Math.round(amount / 100) * 100);
    this.fuelExpense += rounded;
    this.totalEarnings -= rounded;
    this.persistCareer();
  }

  public recordRepairExpense(amount: number): void {
    const rounded = Math.max(0, Math.round(amount / 100) * 100);
    this.repairExpense += rounded;
    this.totalEarnings -= rounded;
    this.persistCareer();
  }

  public recordConvenienceExpense(amount: number): void {
    const rounded = Math.max(0, Math.round(amount / 100) * 100);
    this.convenienceExpense += rounded;
    this.totalEarnings -= rounded;
    this.persistCareer();
  }

  public getDailyMissionStatus(): DailyMissionStatus {
    const current = Math.min(this.dailyMissionProgress, DAILY_MISSION_TARGET);
    return {
      title: `오늘 ${DAILY_MISSION_TARGET}건 배달 완료하기`,
      current,
      target: DAILY_MISSION_TARGET,
      bonus: DAILY_MISSION_BONUS,
      completed: this.dailyMissionClaimed,
      progressPct: Math.min(100, Math.round((current / DAILY_MISSION_TARGET) * 100)),
    };
  }

  public getDailyLedger(): DailyFinanceLedger {
    const grossIncome =
      this.baseFeeTotal +
      this.distanceBonusTotal +
      this.rainBonusTotal +
      this.nightBonusTotal +
      this.peakBonusTotal +
      this.tierBonusTotal +
      this.tipTotal +
      this.missionBonusTotal;
    const totalExpenses =
      this.damageDeductionTotal +
      this.fuelExpense +
      this.repairExpense +
      this.upgradeExpense +
      this.convenienceExpense +
      this.fineExpense;
    return {
      completedCount: this.completedCount,
      baseFeeTotal: this.baseFeeTotal,
      distanceBonusTotal: this.distanceBonusTotal,
      rainBonusTotal: this.rainBonusTotal,
      nightBonusTotal: this.nightBonusTotal,
      peakBonusTotal: this.peakBonusTotal,
      tierBonusTotal: this.tierBonusTotal,
      tipTotal: this.tipTotal,
      missionBonusTotal: this.missionBonusTotal,
      damageDeductionTotal: this.damageDeductionTotal,
      fuelExpense: this.fuelExpense,
      repairExpense: this.repairExpense,
      upgradeExpense: this.upgradeExpense,
      convenienceExpense: this.convenienceExpense,
      fineExpense: this.fineExpense,
      grossIncome,
      totalExpenses,
      netProfit: grossIncome - totalExpenses,
      walletBalance: this.totalEarnings,
      lifetimeCompleted: this.lifetimeCompleted,
      riderTier: this.getCurrentTier(),
      riderRating: this.riderRating,
      pedestrianAccidentCount: this.pedestrianAccidentCount,
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
      if (m.phase === 'to_pickup' || m.phase === 'cooking_wait' || m.phase === 'pickup_ready') return 0;
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
