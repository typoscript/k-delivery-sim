// Delivery domain model shared by the delivery systems and the UI: fees and limits, order / mission /
// settlement / ledger types, and the pure order-content helpers (delivery instructions, food physics class,
// unit numbers, lobby PINs).
import { DeliveryLocation, FoodTempType } from '../types';
import { RoutePoint, TurnGuidance } from '../world/RoadNavigator';
import { CustomerReview, RiderTierSpec } from './RiderCareer';
import type { AchievementSpec, AchievementStatus, DayRecord, WeekSummary } from './careerHistory';
import type { WeekGoalStatus } from './weeklyGoals';
import { ShiftGoalSpec, ShiftGoalStatus } from './ShiftDay';
import type { DemandEventId } from './demandEvents';

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
export const PEDESTRIAN_ACCIDENT_FINE = 50000; // 보행자 접촉 사고 과태료 및 합의금 -50,000원
export const PEDESTRIAN_RATING_PENALTY = 1.0; // 보행자 사고 신뢰 평점 -1.0점 감점
export const INITIAL_RIDER_RATING = 5.0; // 배달 기사 초기 신뢰 평점 (5.0 만점)

/** Result of clocking out: the finished day's ledger and goals, after which the next day starts */
export interface ClockOutResult {
  day: number;
  ledger: DailyFinanceLedger;
  goals: ShiftGoalStatus[];
  /** Goals paid at clock-out (e.g. accident-free shift) */
  awardedAtClockOut: ShiftGoalSpec[];
  nextDay: number;
  /** The finished day next to the rider's career: last working day, streak, achievements */
  recap: ShiftRecap;
}

export interface ShiftRecap {
  /** Previous finished day (to compare the net profit), null on the first day */
  previous: DayRecord | null;
  /** Accident-free days in a row including today (3+ deliveries, no pedestrian accident) */
  safeStreak: number;
  /** Achievements unlocked during this working day (deliveries and clock-out) */
  achievementsToday: AchievementStatus[];
  /** Unlocked just now at clock-out (announced with a toast) */
  newAtClockOut: AchievementSpec[];
  /** Locked achievement closest to done */
  next: AchievementStatus | null;
  /** Weekly statement when this day closes a week (every 7th day) */
  week: WeekSummary | null;
  /** The week's goals checked at this clock-out (week end only) */
  weekGoals: WeekGoalStatus[] | null;
  /** Weekly goal bonus paid at this clock-out */
  weeklyBonus: number;
}

export type DispatchOrderType = 'SINGLE' | 'ALTTLE_BUNDLE';

/** Special orders (한집배달 only): urgent deliveries with a tight time limit and big group orders */
export type SpecialOrderKind = 'urgent' | 'group';

export interface SpecialOrderSpec {
  kind: SpecialOrderKind;
  icon: string;
  label: string;
  /** Extra fee; for an urgent delivery it is only paid when delivered within the (short) time limit */
  bonus: number;
  timeLimitSec: number;
  /** Extra kitchen / counter wait at pickup */
  extraWaitSec: number;
  /** Turns the shop's own menu into the special order (e.g. "와퍼 세트" -> "와퍼 세트 · 10인분 단체") */
  menuFormat: (shopMenu: string) => string;
}

export const SPECIAL_ORDERS: Record<SpecialOrderKind, SpecialOrderSpec> = {
  urgent: {
    kind: 'urgent',
    icon: '⏱️',
    label: '급한 배달',
    bonus: 3000,
    timeLimitSec: 150,
    extraWaitSec: 0,
    menuFormat: (m) => `${m} (급해요!)`,
  },
  group: {
    kind: 'group',
    icon: '🍱',
    label: '단체 주문',
    bonus: 2500,
    timeLimitSec: 420,
    extraWaitSec: 8,
    menuFormat: (m) => `${m} · 10인분 단체`,
  },
};

/** A customer becomes a regular (단골 고객) after this many completed deliveries */
export const REGULAR_CUSTOMER_THRESHOLD = 2;
/** Regular customers tip this much when the food arrives in good shape (integrity >= 80%) */
export const REGULAR_CUSTOMER_TIP = 800;
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

/** What a fine was for (the daily ledger breaks fines down by kind) */
export type FineKind = 'speeding' | 'signal' | 'sidewalk' | 'pedestrian';
export const FINE_KINDS: readonly FineKind[] = ['speeding', 'signal', 'sidewalk', 'pedestrian'];
/** Shift counter key that keeps today's fines of a kind (`_` keys are bookkeeping, not goal counters) */
export const fineCounterKey = (kind: FineKind) => `_fine:${kind}`;

export interface DailyFinanceLedger {
  /** Working day (N일차) this ledger belongs to */
  shiftDay: number;
  completedCount: number;
  baseFeeTotal: number;
  distanceBonusTotal: number;
  rainBonusTotal: number;
  nightBonusTotal: number;
  peakBonusTotal: number;
  /** Special order surcharges and regular customer tips */
  specialBonusTotal: number;
  tierBonusTotal: number;
  tipTotal: number;
  missionBonusTotal: number;
  /** Weekly goal bonuses (paid on the 7th day's clock-out) */
  weeklyBonusTotal: number;
  /** Demand event surcharges (비 오는 날 국물 · 야식 타임) */
  eventBonusTotal: number;
  damageDeductionTotal: number;
  fuelExpense: number;
  repairExpense: number;
  upgradeExpense: number;
  convenienceExpense: number;
  fineExpense: number;
  /** fineExpense by kind; fines saved before kinds were tracked are not in here */
  fines: Record<FineKind, number>;
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
  /** Special order (urgent delivery / group order) and its surcharge */
  special?: SpecialOrderKind;
  specialBonus?: number;
  /** Demand event the menu belongs to (비 오는 날 국물 / 야식 타임) and its surcharge, paid if the condition holds */
  demandEvent?: DemandEventId;
  eventBonus?: number;
  /** Customer already received 2+ of your deliveries (단골 고객): tips when the food arrives in good shape */
  regularCustomer?: boolean;
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
  /** Special order surcharge actually paid (urgent: only if on time) + regular customer tip */
  specialBonus: number;
  regularCustomerTip: number;
  /** Demand event surcharge actually paid (0 when the food missed its condition) */
  eventBonus: number;
  /** Deducted from the base fee for damaged food */
  damageDeduction: number;
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
  /** Daily goals completed by this delivery (their bonuses are in missionBonusAwarded) */
  goalsCompleted: ShiftGoalSpec[];
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
  /** Construction on the route: segments passed through (with their positions) and segments detoured around */
  roadworks: RouteRoadworks;
}

export interface RouteRoadworks {
  through: number;
  points: RoutePoint[];
  avoided: number;
}

export const NO_ROADWORKS: RouteRoadworks = { through: 0, points: [], avoided: 0 };

export type { RoutePoint };

