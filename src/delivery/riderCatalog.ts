/** Rider upgrades (garage) and rider tiers: prices, effects and delivery thresholds */

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

export const RIDER_UPGRADES: Record<UpgradeId, UpgradeSpec> = {
  thermal_box: {
    id: 'thermal_box',
    icon: '🔥',
    name: '프리미엄 보온·보냉 배달통',
    shortDesc: '특수 단열 라이너로 뜨거운 음식·아이스 음료 온도 유지력 대폭 강화',
    statBadge: '온도 하락 -40%',
    price: 40000,
  },
  suspension_tires: {
    id: 'suspension_tires',
    icon: '🛞',
    name: '고성능 쇼바 & 빗길 타이어',
    shortDesc: '과속방지턱·국물 출렁임 파손 경감 + 빗길/코너링 타이어 접지력 상승',
    statBadge: '파손 -40% · 그립 +14%',
    price: 50000,
  },
  fast_charger: {
    id: 'fast_charger',
    icon: '⚡',
    name: '고속 무선충전 거치대',
    shortDesc: '오토바이 거치대 15W 급속 무선충전 모듈로 주행 중 배터리 초고속 완충',
    statBadge: '무선충전 2배',
    price: 30000,
  },
  eco_tank: {
    id: 'eco_tank',
    icon: '⛽',
    name: '대용량 탱크 · 에코 셀',
    shortDesc: '연료 탱크/EV 배터리 효율 최적화로 장거리 운행 연비 대폭 개선',
    statBadge: '연료·배터리 소모 -25%',
    price: 35000,
  },
  ecu_tune: {
    id: 'ecu_tune',
    icon: '🏍️',
    name: 'ECU 출력 튜닝',
    shortDesc: '엔진·인버터 출력 맵핑으로 출발 가속력과 최고속도 동시 향상',
    statBadge: '가속 +14% · 최고속 +8%',
    price: 60000,
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
