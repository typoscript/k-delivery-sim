import { clamp } from '../types';
import { ScooterState } from '../vehicle/ScooterPhysics';
import { UpgradeEffects } from './RiderCareer';
import { ActiveMission, CustomerChatEvent, PROMISED_CAREFUL_TIP } from './deliveryTypes';

/**
 * Food condition on the road: temperature retention, soup / drink spills from harsh lean or braking,
 * speed bump and crash damage to food loaded in the top box, and live customer chat events.
 * Pure functions over active missions (DeliveryManager owns the missions and calls these).
 */

export type CrashSeverity = boolean | 'normal' | 'rain_slip' | 'pedestrian_hit';

/**
 * Steps temperature decay for picked-up food and spill damage inside the top box while riding.
 * Cold drinks / desserts lose temperature ~1.45x faster than hot food; harsh corner lean (> ~25°) or hard
 * braking / acceleration (> 9.4 m/s²) spills soup and coffee. Returns one spilling mission (for the warning) or null.
 */
export function stepFoodCondition(
  missions: readonly ActiveMission[],
  scooter: ScooterState,
  isRiding: boolean,
  upgFx: UpgradeEffects,
  dt: number
): ActiveMission | null {
  const absLean = Math.abs(scooter.leanAngle);
  const absLongAcc = Math.abs(scooter.lastLongAccel);
  const speedKmh = Math.abs(scooter.speed) * 3.6;
  const harshLean = isRiding && !scooter.crashed && speedKmh > 20 && absLean > 0.44;
  const harshLong = isRiding && !scooter.crashed && speedKmh > 14 && absLongAcc > 9.4;
  let spillSample: ActiveMission | null = null;

  for (const m of missions) {
    if (!m.pickedUp || m.phase === 'corridor_exit') continue;

    // 1. Temperature retention (insulated top box slows decay; the thermal_box upgrade cuts it another -40%)
    const inInsulatedBox = m.phase === 'cargo_loaded';
    const baseRate = m.order.foodTempType === 'cold' ? 0.62 : 0.42; // % per second in box
    const tempRate = inInsulatedBox ? baseRate * upgFx.tempDecayMul : baseRate * 1.55;
    m.foodTemp = clamp(m.foodTemp - tempRate * dt, 0, 100);

    // 2. Liquid / fragile spill damage inside the top box from harsh lean or sudden braking
    if (inInsulatedBox && m.order.isSpillSensitive && (harshLean || harshLong)) {
      const leanFactor = harshLean ? (absLean - 0.44) * 10.5 : 0;
      const brakeFactor = harshLong ? (absLongAcc - 9.4) * 1.45 : 0;
      const dmg = (leanFactor + brakeFactor) * upgFx.spillDamageMul * dt;
      if (dmg > 0) {
        m.foodIntegrity = clamp(m.foodIntegrity - dmg, 20, 100);
        m.spillDamageAccum += dmg;
        if (!spillSample) spillSample = m;
      }
    }
  }
  return spillSample;
}

/** Suspension shock to food in the top box when crossing a speed bump above 22 km/h */
export function applySpeedBumpToCargo(
  loaded: readonly ActiveMission[],
  speedKmh: number,
  upgFx: UpgradeEffects
): { damagedCount: number; maxLoss: number; spillHit: boolean } {
  if (speedKmh <= 22) return { damagedCount: 0, maxLoss: 0, spillHit: false };
  const excess = clamp((speedKmh - 22) / 36, 0.25, 1.0);
  let damagedCount = 0;
  let maxLoss = 0;
  let spillHit = false;
  for (const m of loaded) {
    const loss = Math.round((m.order.isSpillSensitive ? 6 + excess * 10 : 3 + excess * 5) * upgFx.spillDamageMul);
    m.foodIntegrity = clamp(m.foodIntegrity - loss, 15, 100);
    m.spillDamageAccum += loss;
    damagedCount++;
    if (loss > maxLoss) maxLoss = loss;
    if (m.order.isSpillSensitive) spillHit = true;
  }
  return { damagedCount, maxLoss, spillHit };
}

/** Crash impact on all food in the top box: -25% (normal), -32% (rain slip / hard), -55% (pedestrian hit) */
export function applyCrashToCargo(loaded: readonly ActiveMission[], severity: CrashSeverity): { damagedCount: number; loss: number } {
  const loss = severity === 'pedestrian_hit' ? 55 : severity === true || severity === 'rain_slip' ? 32 : 25;
  const minIntegrity = severity === 'pedestrian_hit' ? 5 : 15;
  for (const m of loaded) m.foodIntegrity = Math.max(minIntegrity, m.foodIntegrity - loss);
  return { damagedCount: loaded.length, loss: loaded.length > 0 ? loss : 0 };
}

/**
 * Live Korean mid-delivery customer chat for a loaded order (mutates the order / mission):
 *  1. baby sleeping -> instruction changes to PHOTO_DOOR
 *  2. wrong unit number -> unit number corrected on the same floor
 *  3. careful delivery request -> +₩1,000 tip promised if food integrity stays >= 85%
 */
export function createCustomerChatEvent(m: ActiveMission, isRaining: boolean, rand: () => number = Math.random): CustomerChatEvent {
  const o = m.order;
  const candidates: Array<'change_to_photo' | 'fix_unit_number' | 'extra_tip_careful'> = [];

  if (o.deliveryInstruction !== 'PHOTO_DOOR') {
    candidates.push('change_to_photo');
  }
  candidates.push('fix_unit_number');
  candidates.push('extra_tip_careful');
  if (o.isSpillSensitive || isRaining) {
    // Slightly weight careful-delivery tip chat for soup/drinks & rain
    candidates.push('extra_tip_careful');
  }

  const kind = candidates[Math.floor(rand() * candidates.length)];

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
