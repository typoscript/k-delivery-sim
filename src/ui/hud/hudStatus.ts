/** Per-frame HUD sync: status pills, mission gauges, riding warnings and the speedometer cluster */
import type { Hud, InteractionContext } from '../Hud';
import { PlayerState } from '../../player/PlayerController';
import { ScooterState } from '../../vehicle/ScooterPhysics';
import { SCOOTER_MODELS } from '../../vehicle/ScooterModels';
import { CARGO_SLOT_COUNT, DeliveryManager, MAX_CONCURRENT_ORDERS } from '../../delivery/DeliveryManager';
import { WeatherMode } from '../../types';

/** Top-left pills: career tier & wallet, trust rating, drink buff and the mode badge (weather: phone weather app) */
export function syncStatusPills(
  host: Hud,
  player: PlayerState,
  scooter: ScooterState,
  delivery: DeliveryManager,
  _weatherMode: WeatherMode,
  ctx: InteractionContext,
): void {
  const isRiding = player.mode === 'riding';
  // Update Rider Career Tier & Persistent Wallet Pill
  const tier = delivery.getCurrentTier();
  const shortTier = tier.name.replace(' 라이더', '');
  host.tierBadge.textContent = `${tier.icon} ${shortTier} · ₩${delivery.totalEarnings.toLocaleString()}`;
  host.tierBadge.style.borderColor = tier.color;
  host.tierBadge.title = `${tier.icon} ${tier.name} (누적 ${delivery.lifetimeCompleted}건 · 건당 보너스 +₩${tier.bonusPerDelivery.toLocaleString()})`;

  // Update Rider Trust Rating badge (★ 5.0 -> drops -1.0 per pedestrian accident)
  const rating = delivery.riderRating;
  const rep = delivery.getReputation();
  host.ratingBadge.textContent = `★ ${rating.toFixed(1)} · ${rep.icon}`;
  host.ratingBadge.title = `신뢰 평점 ${rating.toFixed(1)} · 최근 별점 ${rep.recentStars ?? '-'} → ${rep.label}: ${rep.description}`;
  host.ratingBadge.className = rating <= 2.5 ? 'rating-pill danger' : rating < 4.5 ? 'rating-pill warn' : 'rating-pill';

  // Update convenience store beverage buff pill (Energy Drink / Iced Coffee)
  if (player.energyBuffTimer > 0) {
    host.buffBadge.textContent = `⚡ 에너지 ${Math.ceil(player.energyBuffTimer)}s`;
    host.buffBadge.classList.remove('hidden');
  } else if (player.coffeeBuffTimer > 0) {
    host.buffBadge.textContent = `☕ 카페인 ${Math.ceil(player.coffeeBuffTimer)}s`;
    host.buffBadge.classList.remove('hidden');
  } else {
    host.buffBadge.classList.add('hidden');
  }

  // (the weather is only shown in the phone's weather app)
  const carrying = delivery.getCarryingMission();
  const corridorM = delivery.getCorridorMission();
  const loadedCount = delivery.getLoadedCargoCount();
  const activeCount = delivery.activeMissions.length;

  if (player.inCorridor) {
    const unit = corridorM?.order.unitNumber ?? '';
    const ordNo = corridorM ? `#${corridorM.order.orderNumber} ` : '';
    if (ctx.isVillaCorridor) {
      host.modeBadge.textContent = `🏠 원룸·빌라 계단 ${ctx.villaCurrentFloor}F (${ordNo}${unit})`;
    } else if (ctx.insideElevatorCabin) {
      const dir = ctx.elevatorPhase === 'moving_up' ? '▲ ' : ctx.elevatorPhase === 'moving_down' ? '▼ ' : '';
      host.modeBadge.textContent = `🛗 엘리베이터 ${dir}${ctx.elevatorCurrentFloor}F (목표 ${ctx.elevatorTargetFloor}F)`;
    } else {
      host.modeBadge.textContent = `🏢 아파트 ${ctx.elevatorCurrentFloor}F 복도 (${ordNo}${unit})`;
    }
    host.modeBadge.className = 'mode-pill foot';
  } else if (player.mode === 'knockdown') {
    host.modeBadge.textContent = '💥 전도! 일어나는 중';
    host.modeBadge.className = 'mode-pill danger';
  } else if (isRiding) {
    const bikeSpec = SCOOTER_MODELS[scooter.modelId];
    host.modeBadge.textContent =
      loadedCount > 0
        ? `${bikeSpec.icon} ${bikeSpec.shortBadge} · 📦 배달통 ${loadedCount}/${CARGO_SLOT_COUNT}칸`
        : activeCount > 0
          ? `${bikeSpec.icon} ${bikeSpec.shortBadge} · 묶음 ${activeCount}/${MAX_CONCURRENT_ORDERS}건`
          : `${bikeSpec.icon} ${bikeSpec.shortBadge} 라이딩`;
    host.modeBadge.className = 'mode-pill riding';
  } else if (carrying) {
    host.modeBadge.textContent = `🛍️ 도보 · [#${carrying.order.orderNumber}] 음식 휴대 중`;
    host.modeBadge.className = 'mode-pill riding';
  } else if (activeCount > 0) {
    host.modeBadge.textContent = `🚶 도보 · 묶음 ${activeCount}/${MAX_CONCURRENT_ORDERS} (적재 ${loadedCount})`;
    host.modeBadge.className = 'mode-pill foot';
  } else {
    host.modeBadge.textContent = '🚶 1인칭 도보';
    host.modeBadge.className = 'mode-pill foot';
  }
}

/** Cooking countdown bar, walk-up villa floor / stamina and the visor wipe hint */
export function syncMissionHud(
  host: Hud,
  player: PlayerState,
  delivery: DeliveryManager,
  ctx: InteractionContext,
): void {
  const corridorM = delivery.getCorridorMission();
  // Top HUD Yellow Cooking Delay Countdown Gauge (visible outdoors & non-blocking!)
  const cookM = !player.inCorridor ? delivery.getPrimaryCookingMission() : null;
  if (cookM) {
    host.cookingHudBar.classList.remove('hidden');
    if (cookM.phase === 'cooking_wait') {
      const rem = Math.max(1, Math.ceil(cookM.cookingRemainingSec));
      const pct =
        cookM.cookingDurationSec > 0
          ? Math.max(0, Math.min(100, (cookM.cookingRemainingSec / cookM.cookingDurationSec) * 100))
          : 0;
      host.cookingHudBar.classList.remove('ready');
      host.cookingHudTitle.textContent = `🍳 ${cookM.order.shop.name} [#${cookM.order.orderNumber}] 조리 중 (남은 시간: ${rem}초)`;
      host.cookingHudSub.textContent = '이동·탑승(F)·폰(Tab/V) 자유 조작';
      host.cookingHudFill.style.width = `${pct.toFixed(1)}%`;
    } else {
      host.cookingHudBar.classList.add('ready');
      host.cookingHudTitle.textContent = `🔔 ${cookM.order.shop.name} [#${cookM.order.orderNumber}] 음식이 준비되었습니다!`;
      host.cookingHudSub.textContent = '픽업대 트레이 [E] 수령';
      host.cookingHudFill.style.width = '100%';
    }
  } else {
    host.cookingHudBar.classList.add('hidden');
  }

  // Walk-up Villa Stairwell Floor & Stamina HUD
  if (player.inCorridor && ctx.isVillaCorridor && corridorM) {
    host.villaStairHud.classList.remove('hidden');
    const stPct = Math.round(player.stamina);
    host.vsFloorText.textContent =
      corridorM.phase === 'corridor_exit'
        ? `🏠 원룸·빌라 ${ctx.villaCurrentFloor}F · 1F 출구로 하강`
        : `🏠 원룸·빌라 ${ctx.villaCurrentFloor}F · 목표 ${corridorM.order.unitNumber}`;
    host.vsStaminaVal.textContent = stPct < 20 ? `😮‍💨 숨참 (${stPct}%)` : `체력 ${stPct}%`;
    host.vsStaminaFill.style.width = `${stPct}%`;
    host.vsStaminaFill.className = stPct < 25 ? 'vs-fill danger' : stPct < 55 ? 'vs-fill warn' : 'vs-fill';
  } else {
    host.villaStairHud.classList.add('hidden');
  }

  // Rainy Helmet Visor Wipe Hint Chip ([G] to wipe visor)
  host.visorWipeHint.classList.toggle('hidden', !ctx.visorWetHint || ctx.modalOpen || player.inCorridor);
}

/** Red warning strip while riding: out of fuel, wet manhole / paint, over-lean, soup spill */
export function syncRidingWarning(
  host: Hud,
  player: PlayerState,
  scooter: ScooterState,
  delivery: DeliveryManager,
  ctx: InteractionContext,
): void {
  const isRiding = player.mode === 'riding';
  const showSlip =
    isRiding &&
    (scooter.outOfFuel || scooter.slipWarning || scooter.wetSlipWarning !== 'none' || delivery.activeSpillWarning);
  if (showSlip) {
    if (scooter.outOfFuel) {
      const where = ctx.nearestGas ? ` (가장 가까운 ${ctx.nearestGas.name} ${Math.round(ctx.nearestGas.dist)}m)` : '';
      host.slipWarningEl.textContent = SCOOTER_MODELS[scooter.modelId].isElectric
        ? `⚡ EV 배터리 방전! 하차(F) 후 주유소 충전기에서 급속 충전하세요${where}`
        : `⛽ 연료 고갈! 가속 불가 — 오토바이를 밀고 주유소로 가세요${where}`;
    } else if (scooter.wetSlipWarning === 'manhole') {
      host.slipWarningEl.textContent = '⚠ 빗길 금속 맨홀 뚜껑! 브레이크·급회전 시 접지력 상실로 전도됩니다!';
    } else if (scooter.wetSlipWarning === 'crosswalk_paint') {
      host.slipWarningEl.textContent = '⚠ 빗길 횡단보도 페인트선! 감속·직진 통과하지 않으면 미끄러집니다!';
    } else if (scooter.slipWarning) {
      host.slipWarningEl.textContent = '⚠ 코너 기울기 과다! 감속하지 않으면 넘어집니다!';
    } else {
      host.slipWarningEl.textContent = '🍲 국물·음료 출렁임 주의! 코너 감속·급제동을 줄여 음식 파손을 막으세요!';
    }
  }
  host.slipWarningEl.classList.toggle('hidden', !showSlip);
}

/** Speedometer cluster: speed, lean risk, fuel, damage and the indicator lamps */
export function syncRidingCluster(
  host: Hud,
  scooter: ScooterState,
  ctx: InteractionContext,
  elapsedTime: number,
  isNight: boolean,
  isMuted: boolean,
): void {
  host.speedVal.textContent = String(Math.round(Math.abs(scooter.speed) * 3.6));

  const leanDeg = Math.round((Math.abs(scooter.leanAngle) * 180) / Math.PI);
  const leanDir = scooter.leanAngle < -0.05 ? '좌 ' : scooter.leanAngle > 0.05 ? '우 ' : '';
  host.leanVal.textContent = `${leanDir}${leanDeg}°`;
  const riskPct = Math.min(100, Math.round(scooter.leanRisk * 100));
  host.leanBar.style.width = `${riskPct}%`;
  host.leanBar.className = riskPct >= 75 ? 'lean-fill danger' : riskPct >= 45 ? 'lean-fill warn' : 'lean-fill safe';

  const fuelPct = Math.round(scooter.fuel);
  const gasHint = ctx.nearestGas && fuelPct <= 30 ? ` · ⛽${Math.round(ctx.nearestGas.dist)}m` : '';
  host.fuelVal.textContent = scooter.outOfFuel ? `고갈 (0%)${gasHint}` : `${fuelPct}%${gasHint}`;
  host.fuelBar.style.width = `${fuelPct}%`;
  host.fuelBar.className = scooter.lowFuelWarning
    ? 'lean-fill danger'
    : fuelPct <= 30
      ? 'lean-fill warn'
      : 'lean-fill safe';

  if (scooter.damageLevel > 0) {
    host.damageBadge.textContent = `🔧 파손 -${scooter.damageLevel * 10}%`;
    host.damageBadge.classList.remove('hidden');
  } else {
    host.damageBadge.classList.add('hidden');
  }

  const blinkOn = Math.floor(elapsedTime * 2.5) % 2 === 0;
  host.indLeft.className =
    (scooter.leftBlinker || scooter.hazard) && blinkOn ? 'ind ind-blink active-amber' : 'ind ind-blink';
  host.indRight.className =
    (scooter.rightBlinker || scooter.hazard) && blinkOn ? 'ind ind-blink active-amber' : 'ind ind-blink';
  host.indLight.className = scooter.headlights ? 'ind active-amber' : 'ind';
  host.indTime.className = isNight ? 'ind active-blue' : 'ind';
  host.indTime.textContent = isNight ? '밤' : '낮';
  host.indAudio.className = isMuted ? 'ind active-red' : 'ind';
  host.indAudio.textContent = isMuted ? '음소거' : '사운드';
}
