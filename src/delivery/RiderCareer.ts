export type UpgradeId =
  | 'thermal_box'
  | 'suspension_tires'
  | 'fast_charger'
  | 'eco_tank'
  | 'ecu_tune';

export type RiderTierId = 'bronze' | 'silver' | 'gold' | 'master';

export interface UpgradeSpec {
  id: UpgradeId;
  icon: string;
  name: string;
  shortDesc: string;
  statBadge: string;
  price: number;
}

export interface RiderTierSpec {
  id: RiderTierId;
  icon: string;
  name: string;
  minDeliveries: number;
  bonusPerDelivery: number;
  color: string;
}

export interface UpgradeEffects {
  tempDecayMul: number; // 0.60 with thermal_box
  spillDamageMul: number; // 0.60 with suspension_tires
  gripMul: number; // 1.14 with suspension_tires
  chargeSpeedMul: number; // 2.0 with fast_charger
  fuelBurnMul: number; // 0.75 with eco_tank
  accelMul: number; // 1.14 with ecu_tune
  speedMul: number; // 1.08 with ecu_tune
}

export const REGULAR_SHOP_THRESHOLD = 2; // 같은 매장 2회 이상 픽업 시 단골 매장 등극!
export const MAX_STORED_REVIEWS = 25;

export interface CustomerReview {
  id: string;
  orderNumber: string;
  shopId: string;
  shopName: string;
  shopEmoji: string;
  menuName: string;
  customerName: string;
  unitNumber: string;
  stars: number; // 1..5
  comment: string;
  tags: string[];
  createdAt: string;
}

export interface ReviewGenerationInput {
  orderNumber: string;
  shopId: string;
  shopName: string;
  shopEmoji: string;
  menuName: string;
  customerName: string;
  unitNumber: string;
  foodIntegrity: number;
  foodTemp: number;
  foodTempType: 'hot' | 'cold';
  isSpillSensitive: boolean;
  spillDamageAccum: number;
  remainingRatio: number; // 0..1
  isWalkupVilla: boolean;
  isRain: boolean;
  isNight: boolean;
  deliveryInstruction: 'PHOTO_DOOR' | 'KNOCK_DOOR' | 'MEET_FACE';
  createdAt: string;
}

export interface RiderCareerSave {
  walletBalance: number;
  lifetimeCompleted: number;
  riderRating: number;
  upgrades: UpgradeId[];
  reviews: CustomerReview[];
  shopPickupCounts: Record<string, number>;
  shopNames: Record<string, string>;
  /** Daily 3-delivery mission progress, keyed by local date so a page reload can't re-claim the bonus */
  dailyMission?: { date: string; progress: number; claimed: boolean };
}

/** Local calendar date key (YYYY-MM-DD) for daily mission persistence */
export function localDateKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const RIDER_UPGRADES: Record<UpgradeId, UpgradeSpec> = {
  thermal_box: {
    id: 'thermal_box',
    icon: '🔥',
    name: '프리미엄 보온·보냉 배달통',
    shortDesc: '특수 단열 라이너로 뜨거운 음식·아이스 음료 온도 유지력 대폭 강화',
    statBadge: '온도 하락 -40%',
    price: 4000,
  },
  suspension_tires: {
    id: 'suspension_tires',
    icon: '🛞',
    name: '고성능 쇼바 & 빗길 타이어',
    shortDesc: '과속방지턱·국물 출렁임 파손 경감 + 빗길/코너링 타이어 접지력 상승',
    statBadge: '파손 -40% · 그립 +14%',
    price: 5000,
  },
  fast_charger: {
    id: 'fast_charger',
    icon: '⚡',
    name: '고속 무선충전 거치대',
    shortDesc: '오토바이 거치대 15W 급속 무선충전 모듈로 주행 중 배터리 초고속 완충',
    statBadge: '무선충전 2배',
    price: 3000,
  },
  eco_tank: {
    id: 'eco_tank',
    icon: '⛽',
    name: '대용량 탱크 · 에코 셀',
    shortDesc: '연료 탱크/EV 배터리 효율 최적화로 장거리 운행 연비 대폭 개선',
    statBadge: '연료·배터리 소모 -25%',
    price: 3500,
  },
  ecu_tune: {
    id: 'ecu_tune',
    icon: '🏍️',
    name: 'ECU 출력 튜닝',
    shortDesc: '엔진·인버터 출력 맵핑으로 출발 가속력과 최고속도 동시 향상',
    statBadge: '가속 +14% · 최고속 +8%',
    price: 6000,
  },
};

export const RIDER_UPGRADE_LIST: UpgradeSpec[] = [
  RIDER_UPGRADES.thermal_box,
  RIDER_UPGRADES.suspension_tires,
  RIDER_UPGRADES.fast_charger,
  RIDER_UPGRADES.eco_tank,
  RIDER_UPGRADES.ecu_tune,
];

export const RIDER_TIERS: RiderTierSpec[] = [
  {
    id: 'bronze',
    icon: '🥉',
    name: '브론즈 라이더',
    minDeliveries: 0,
    bonusPerDelivery: 0,
    color: '#d97706',
  },
  {
    id: 'silver',
    icon: '🥈',
    name: '실버 라이더',
    minDeliveries: 5,
    bonusPerDelivery: 300,
    color: '#94a3b8',
  },
  {
    id: 'gold',
    icon: '🥇',
    name: '골드 라이더',
    minDeliveries: 15,
    bonusPerDelivery: 600,
    color: '#facc15',
  },
  {
    id: 'master',
    icon: '👑',
    name: '마스터 라이더',
    minDeliveries: 30,
    bonusPerDelivery: 1000,
    color: '#38bdf8',
  },
];

const CAREER_STORAGE_KEY = 'k_delivery_rider_career_v1';
const VALID_UPGRADE_IDS = new Set<string>(Object.keys(RIDER_UPGRADES));

export function getRiderTier(lifetimeCompleted: number): RiderTierSpec {
  let current = RIDER_TIERS[0];
  for (const tier of RIDER_TIERS) {
    if (lifetimeCompleted >= tier.minDeliveries) {
      current = tier;
    }
  }
  return current;
}

export function getNextRiderTier(lifetimeCompleted: number): RiderTierSpec | null {
  for (const tier of RIDER_TIERS) {
    if (lifetimeCompleted < tier.minDeliveries) {
      return tier;
    }
  }
  return null;
}

export function getUpgradeEffects(upgrades: readonly UpgradeId[]): UpgradeEffects {
  const has = (id: UpgradeId) => upgrades.includes(id);
  return {
    tempDecayMul: has('thermal_box') ? 0.6 : 1.0,
    spillDamageMul: has('suspension_tires') ? 0.6 : 1.0,
    gripMul: has('suspension_tires') ? 1.14 : 1.0,
    chargeSpeedMul: has('fast_charger') ? 2.0 : 1.0,
    fuelBurnMul: has('eco_tank') ? 0.75 : 1.0,
    accelMul: has('ecu_tune') ? 1.14 : 1.0,
    speedMul: has('ecu_tune') ? 1.08 : 1.0,
  };
}

export function generateCustomerReview(input: ReviewGenerationInput): CustomerReview {
  let score = 5.0;

  if (input.foodIntegrity < 35) score -= 3.2;
  else if (input.foodIntegrity < 60) score -= 2.2;
  else if (input.foodIntegrity < 80) score -= 1.2;
  else if (input.foodIntegrity < 95) score -= 0.45;

  if (input.foodTemp < 50) score -= 1.0;
  else if (input.foodTemp < 75) score -= 0.35;

  if (input.spillDamageAccum >= 12) score -= 0.7;
  else if (input.spillDamageAccum >= 5) score -= 0.3;

  // Gratitude cushion for fast delivery, tough weather, night shift, or walk-up stairs
  if (input.remainingRatio >= 0.55 && input.foodIntegrity >= 90) score += 0.35;
  if (input.isWalkupVilla || input.isRain || input.isNight) score += 0.25;

  const stars = Math.max(1, Math.min(5, Math.round(score)));
  const tags: string[] = [];
  let comment = '';

  if (stars === 5) {
    if (input.foodTempType === 'cold' && input.foodTemp >= 80) {
      comment = '얼음 하나도 안 녹고 완전 시원하게 왔어요! 기사님 최고 👍';
      tags.push('#보냉완벽', '#초고속배달');
    } else if (input.isSpillSensitive && input.spillDamageAccum === 0 && input.foodTemp >= 80) {
      comment = '국물 한 방울도 안 새고 뜨끈뜨끈하게 도착했어요! 감사합니다 ㅎㅎ';
      tags.push('#국물안샘', '#뜨끈뜨끈');
    } else if (input.isWalkupVilla) {
      comment = '엘리베이터 없는 빌라인데 계단 올라와주셔서 너무 감사해요 🙏 안전운전하세요!';
      tags.push('#계단감사', '#친절배달');
    } else if (input.isRain) {
      comment = '비 오는데 엄청 빠르고 안전하게 갖다주셨네요 🌧️ 감기 조심하세요!';
      tags.push('#우천감사', '#안전운전');
    } else if (input.isNight) {
      comment = '야식 시켰는데 심야에 번개처럼 왔어요! 덕분에 잘 먹겠습니다 🌙';
      tags.push('#심야번개배달', '#친절해요');
    } else if (input.deliveryInstruction === 'MEET_FACE') {
      comment = '직접 받아보니 기사님이 너무 친절하셔서 기분 좋았어요! 별 다섯 개 드립니다 ⭐';
      tags.push('#친절응대', '#안전배달');
    } else if (input.deliveryInstruction === 'KNOCK_DOOR') {
      comment = '요청대로 똑똑 노크해주시고 깔끔하게 두고 가셨어요! 감사합니다 😊';
      tags.push('#요청사항준수', '#깔끔배달');
    } else {
      comment = '포장 찌그러짐 없이 깔끔하고 빠르게 왔어요! 오늘도 안전운전 하세요 🛵';
      tags.push('#포장완벽', '#빠른배달');
    }
    if (input.remainingRatio >= 0.6 && !tags.includes('#빠른배달') && !tags.includes('#초고속배달')) {
      tags.push('#총알배송');
    }
  } else if (stars === 4) {
    if (input.foodTemp < 75) {
      comment =
        input.foodTempType === 'cold'
          ? '살짝 녹긴 했지만 시원하게 잘 먹었어요! 수고하셨습니다.'
          : '조금 식긴 했지만 안전하게 잘 도착했어요! 수고하셨습니다.';
      tags.push('#무사도착', input.foodTempType === 'cold' ? '#살짝녹음' : '#조금식음');
    } else if (input.foodIntegrity < 92) {
      comment = '포장이 살짝 흔들렸지만 먹는 데 문제없어요. 수고 많으셨어요!';
      tags.push('#양호도착', '#수고하셨어요');
    } else {
      comment = '시간 맞춰 잘 도착했습니다~ 요청사항도 잘 지켜주셨어요!';
      tags.push('#정시도착', '#친절해요');
    }
  } else if (stars === 3) {
    if (input.spillDamageAccum > 0) {
      comment = '국물이 봉투에 조금 샜네요 ㅠㅠ 다음엔 과속방지턱 천천히 넘어주세요!';
      tags.push('#국물살짝샘', '#방지턱주의');
    } else if (input.foodTemp < 55) {
      comment =
        input.foodTempType === 'cold'
          ? '음료가 꽤 녹아서 조금 아쉬웠어요. 그래도 배달 감사합니다.'
          : '음식이 많이 식어서 조금 아쉬웠어요. 그래도 배달 감사합니다.';
      tags.push('#온도아쉬움', '#무사도착');
    } else {
      comment = '배달은 잘 왔는데 포장이 살짝 찌그러졌어요. 안전운전 부탁드려요!';
      tags.push('#포장살짝파손', '#안전운전요망');
    }
  } else {
    if (input.spillDamageAccum >= 12) {
      comment = '국물/음료가 너무 많이 쏟아져서 봉투가 다 젖었어요 ㅠㅠ 주의해주세요...';
      tags.push('#국물쏟아짐', '#개선필요');
    } else if (input.foodIntegrity < 60) {
      comment = '음식이 다 쏠리고 엎어져서 왔어요 😭 라이딩하실 때 제발 조심해주세요...';
      tags.push('#음식파손', '#주의필요');
    } else {
      comment = '음식 상태가 안 좋고 많이 식어서 아쉬웠습니다. 다음엔 더 신경 써주세요.';
      tags.push('#상태미흡', '#온도저하');
    }
  }

  return {
    id: `REV-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    orderNumber: input.orderNumber,
    shopId: input.shopId,
    shopName: input.shopName,
    shopEmoji: input.shopEmoji,
    menuName: input.menuName,
    customerName: input.customerName,
    unitNumber: input.unitNumber,
    stars,
    comment,
    tags,
    createdAt: input.createdAt,
  };
}

export function loadRiderCareer(): RiderCareerSave {
  const fallback: RiderCareerSave = {
    walletBalance: 0,
    lifetimeCompleted: 0,
    riderRating: 5.0,
    upgrades: [],
    reviews: [],
    shopPickupCounts: {},
    shopNames: {},
  };
  try {
    const raw = window.localStorage.getItem(CAREER_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<RiderCareerSave>;
    const walletBalance =
      typeof parsed.walletBalance === 'number' && Number.isFinite(parsed.walletBalance)
        ? Math.round(parsed.walletBalance)
        : 0;
    const lifetimeCompleted =
      typeof parsed.lifetimeCompleted === 'number' && Number.isFinite(parsed.lifetimeCompleted)
        ? Math.max(0, Math.floor(parsed.lifetimeCompleted))
        : 0;
    const riderRating =
      typeof parsed.riderRating === 'number' && Number.isFinite(parsed.riderRating)
        ? Math.max(0, Math.min(5.0, Math.round(parsed.riderRating * 10) / 10))
        : 5.0;
    const upgrades: UpgradeId[] = Array.isArray(parsed.upgrades)
      ? Array.from(
          new Set(parsed.upgrades.filter((u): u is UpgradeId => typeof u === 'string' && VALID_UPGRADE_IDS.has(u)))
        )
      : [];
    const reviews: CustomerReview[] = Array.isArray(parsed.reviews)
      ? parsed.reviews
          .filter(
            (r): r is CustomerReview =>
              !!r &&
              typeof r === 'object' &&
              typeof r.comment === 'string' &&
              typeof r.stars === 'number' &&
              Number.isFinite(r.stars) &&
              typeof r.shopName === 'string'
          )
          .slice(0, MAX_STORED_REVIEWS)
          .map((r) => ({
            ...r,
            stars: Math.max(1, Math.min(5, Math.round(r.stars))),
            tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string') : [],
          }))
      : [];
    const shopPickupCounts: Record<string, number> = {};
    if (parsed.shopPickupCounts && typeof parsed.shopPickupCounts === 'object') {
      for (const [k, v] of Object.entries(parsed.shopPickupCounts)) {
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
          shopPickupCounts[k] = Math.floor(v);
        }
      }
    }
    const shopNames: Record<string, string> = {};
    if (parsed.shopNames && typeof parsed.shopNames === 'object') {
      for (const [k, v] of Object.entries(parsed.shopNames)) {
        if (typeof v === 'string' && v.length > 0) {
          shopNames[k] = v;
        }
      }
    }
    let dailyMission: RiderCareerSave['dailyMission'];
    const dm = parsed.dailyMission;
    if (
      dm &&
      typeof dm === 'object' &&
      typeof dm.date === 'string' &&
      typeof dm.progress === 'number' &&
      Number.isFinite(dm.progress)
    ) {
      dailyMission = { date: dm.date, progress: Math.max(0, Math.floor(dm.progress)), claimed: dm.claimed === true };
    }
    return {
      walletBalance,
      lifetimeCompleted,
      riderRating,
      upgrades,
      reviews,
      shopPickupCounts,
      shopNames,
      dailyMission,
    };
  } catch {
    return fallback;
  }
}

export function saveRiderCareer(career: RiderCareerSave): void {
  try {
    window.localStorage.setItem(CAREER_STORAGE_KEY, JSON.stringify(career));
  } catch {
    // ignore storage quota errors
  }
}
