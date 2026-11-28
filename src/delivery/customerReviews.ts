/** Customer reviews: stars, comment and tags from how the delivery went (food state, speed, weather, stairs) */

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
  /** Arrived after the time limit; `apologized` in the messenger first */
  late?: boolean;
  apologized?: boolean;
  isWalkupVilla: boolean;
  isRain: boolean;
  isNight: boolean;
  deliveryInstruction: 'PHOTO_DOOR' | 'KNOCK_DOOR' | 'MEET_FACE';
  createdAt: string;
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
  // late: much less so when the rider apologized in the messenger
  if (input.late) score -= input.apologized ? 0.3 : 0.9;

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
