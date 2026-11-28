import { isBenchHandoff } from '../../delivery/riversideHandoff';
/** Contextual [E] / [F] interaction prompt: corridor, on foot outdoors, riding hints and mount / dismount */
import { NO_GROUND_PARK_LIMIT_M, NO_GROUND_WALK_BONUS, isNoGroundVehicleComplex, scooterInsideComplex } from '../../delivery/apartmentRules';
import type { InteractionContext } from '../Hud';
import { PlayerState } from '../../player/PlayerController';
import { ScooterState } from '../../vehicle/ScooterPhysics';
import { CARGO_SLOT_COUNT, DeliveryManager, NavigationPlan } from '../../delivery/DeliveryManager';

export function computePrompt(
  player: PlayerState,
  scooter: ScooterState,
  delivery: DeliveryManager,
  navPlan: NavigationPlan,
  ctx: InteractionContext,
): string | null {
  if (player.mode === 'knockdown') return null;

  const isRiding = player.mode === 'riding';

  // --- Inside Underground Corridor (Apartment Real 3D Elevator OR 원룸·빌라 Stairwell) ---
  const corridorM = delivery.getCorridorMission();
  if (player.inCorridor && corridorM) {
    // Real 3D Apartment Elevator Cabin Prompts!
    if (!ctx.isVillaCorridor) {
      if (ctx.elevatorPhase === 'moving_up') {
        return `🛗 엘리베이터 상승 중... ▲ ${ctx.elevatorCurrentFloor}F / 목표 ${ctx.elevatorTargetFloor}F`;
      }
      if (ctx.elevatorPhase === 'moving_down') {
        return `🛗 엘리베이터 하강 중... ▼ ${ctx.elevatorCurrentFloor}F → 1F 로비`;
      }
      if (ctx.insideElevatorCabin && ctx.elevatorPhase === 'idle_1f') {
        return `<kbd>E</kbd> 🛗 엘리베이터 [${ctx.elevatorTargetFloor}층] 버튼 누르기 (${corridorM.order.unitNumber})`;
      }
      if (ctx.insideElevatorCabin && corridorM.phase === 'in_corridor' && ctx.elevatorDoorsOpen) {
        return `🚶 ${ctx.elevatorCurrentFloor}층 도착! 앞으로 걸어 나가 ${corridorM.order.unitNumber}로 이동하세요`;
      }
      if (corridorM.phase === 'corridor_exit') {
        if (ctx.insideElevatorCabin) {
          return `<kbd>E</kbd> 🛗 엘리베이터 [1층] 버튼 누르기 (1층 로비로 하강)`;
        }
        if (ctx.nearCorridorElevator) {
          return ctx.elevatorDoorsOpen
            ? '🚶 엘리베이터 안으로 걸어 들어가 [1층] 버튼을 누르세요'
            : '<kbd>E</kbd> 🛗 엘리베이터 호출 버튼 누르기 (문 열기)';
        }
      }
    }

    if (corridorM.phase === 'in_corridor' && ctx.nearCorridorTargetDoor) {
      const inst = corridorM.order.deliveryInstruction;
      if (inst === 'KNOCK_DOOR') {
        return `<kbd>E</kbd> ✊ ${corridorM.order.unitNumber} 문 노크(똑똑똑) 후 음식 내려놓기`;
      }
      if (inst === 'MEET_FACE') {
        return `<kbd>E</kbd> 🔔 ${corridorM.order.unitNumber} 인터폰 벨 누르기 (직접 대면 수령)`;
      }
      return `<kbd>E</kbd> 📸 ${corridorM.order.unitNumber} 문 앞 발매트에 [#${corridorM.order.orderNumber}] 내려놓기`;
    }
    if (corridorM.phase === 'knock_waiting') {
      return '✊ 똑똑똑! 문 앞에 내려놓았습니다 — 배달 완료 처리 중...';
    }
    if (corridorM.phase === 'meet_waiting') {
      return '🔔 "누구세요? 배달이요!" — 고객이 문을 열고 수령 중...';
    }
    if (corridorM.phase === 'corridor_exit' && ctx.nearCorridorElevator && ctx.isVillaCorridor) {
      return '<kbd>E</kbd> 🚪 원룸·빌라 1층 현관 출구로 나가기';
    }
    return null;
  }

  const carrying = delivery.getCarryingMission();
  const loadedCount = delivery.getLoadedCargoCount();

  // --- Outdoor On-Foot Interactions ---
  if (!isRiding) {
    // 0. Service Stations (Gas Station & Motorcycle Repair Center — encapsulated away from delivery E zones)
    if (ctx.nearGasPump) {
      return ctx.scooterOnGasPad
        ? `<kbd>E</kbd> ⛽ 셀프 주유기 열기 (현재 연료 ${Math.round(scooter.fuel)}%)`
        : '⛽ 오토바이를 주유소 노란 주유 패드 위에 세운 뒤 주유하세요';
    }
    if (ctx.nearRepairShop) {
      return scooter.damageLevel > 0
        ? `<kbd>E</kbd> 🔧 번개 오토바이 센터 (${scooter.damageLevel}단계 수리 · 기종 · 도색 · 장비 업그레이드)`
        : `<kbd>E</kbd> 🔧 번개 오토바이 센터 (기종 변경 · 커스텀 도색 · 성능 업그레이드)`;
    }
    if (ctx.nearConvenienceStore) {
      return `<kbd>E</kbd> 🏪 K-24 편의점 이용 (에너지드링크 · 아메리카노 · 보조배터리)`;
    }

    // 1. Outdoor Shop Pickup POS / Cooking Wait / Ready Tray Pickup
    const shopM = delivery.getMissionNearShopPickup(player.x, player.z);
    if (shopM) {
      if (shopM.phase === 'cooking_wait') {
        const sec = Math.max(1, Math.ceil(shopM.cookingRemainingSec));
        return `🍳 ${shopM.order.shop.name} [#${shopM.order.orderNumber}] 조리 중 (남은 시간: ${sec}초) — 대기 중 자유 이동·탑승 가능`;
      }
      if (carrying) {
        return `🛍️ [#${carrying.order.orderNumber}] 휴대 중 — 먼저 오토바이 배달통에 <kbd>E</kbd> 적재`;
      }
      if (shopM.phase === 'pickup_ready') {
        return `<kbd>E</kbd> 🛍️ 픽업대 트레이에서 [#${shopM.order.orderNumber}] 음식 수령하기`;
      }
      return `<kbd>E</kbd> ${shopM.order.shop.emoji} 야외 픽업 POS 열기 (주문번호: ${shopM.order.orderNumber})`;
    }

    // 2. Rear Scooter 3-Slot Cargo Box
    if (ctx.nearCargoBox && (carrying !== null || loadedCount > 0)) {
      if (carrying && (carrying.phase === 'carrying_to_box' || carrying.phase === 'carrying_to_lobby')) {
        return `<kbd>E</kbd> 📦 배달통 슬롯 열기 ([#${carrying.order.orderNumber}] 적재 · ${loadedCount}/${CARGO_SLOT_COUNT})`;
      }
      return `<kbd>E</kbd> 📦 배달통 슬롯 열기 (적재 ${loadedCount}/${CARGO_SLOT_COUNT}칸 · 꺼내기)`;
    }

    // 3. Customer Lobby Entrance PIN / Elevator
    const lobbyM = delivery.getMissionNearCustomerLobby(player.x, player.z);
    if (lobbyM) {
      if (isBenchHandoff(lobbyM)) {
        return `<kbd>E</kbd> 🌿 ${lobbyM.order.customer.name} 벤치의 손님에게 음식 전달 ([#${lobbyM.order.orderNumber}])`;
      }
      if (lobbyM.phase === 'carrying_to_lobby') {
        return `<kbd>E</kbd> 🔑 ${lobbyM.order.customer.name} 공동현관 PIN 입력 ([#${lobbyM.order.orderNumber}])`;
      }
      if (lobbyM.phase === 'lobby_unlocked') {
        if (lobbyM.order.customer.residenceKind === 'walkup_villa') {
          return `<kbd>E</kbd> 🪜 원룸·빌라 1층 진입 → 계단 오르기 (${lobbyM.order.unitNumber} · 수고비 +₩500)`;
        }
        return `<kbd>E</kbd> 🛗 아파트 1층 엘리베이터 탑승 (${lobbyM.order.unitNumber})`;
      }
    }
  }

  // --- Outdoor Riding Contextual Hints ---
  if (isRiding && Math.abs(scooter.speed) <= 4.2) {
    const shopM = delivery.getMissionNearShopPickup(player.x, player.z);
    if (shopM) {
      if (shopM.phase === 'pickup_ready') {
        return `<kbd>F</kbd> 하차 후 트레이에서 [#${shopM.order.orderNumber}] 음식 수령`;
      }
      if (shopM.phase === 'cooking_wait') {
        return `🍳 ${shopM.order.shop.name} 조리 중 (${Math.ceil(shopM.cookingRemainingSec)}초) · <kbd>F</kbd> 하차`;
      }
      return `<kbd>F</kbd> 하차 후 ${shopM.order.shop.name} 픽업 ([#${shopM.order.orderNumber}])`;
    }
    if (
      loadedCount > 0 &&
      navPlan.focusMission?.phase === 'cargo_loaded' &&
      (navPlan.guidance?.totalDistance ?? 999) < 16
    ) {
      const c = navPlan.focusMission.order.customer;
      if (isNoGroundVehicleComplex(c) && scooterInsideComplex(c.x, c.z, scooter.x, scooter.z)) {
        return `🚫 지상 차량 출입 금지 단지 — 정문 밖(${NO_GROUND_PARK_LIMIT_M}m 이상)에 세우고 걸어가면 도보 수당 +₩${NO_GROUND_WALK_BONUS}`;
      }
      return `<kbd>F</kbd> 하차 후 배달통에서 [#${navPlan.focusMission.order.orderNumber}] 꺼내기`;
    }
  }

  // --- Scooter Mount / Dismount Prompts ---
  if (!isRiding && player.canMountScooter) {
    if (delivery.isCarryingFood()) {
      return '🚫 음식 든 채 운전 불가 — 뒤편 배달통에서 <kbd>E</kbd> 적재';
    }
    return scooter.crashed ? '<kbd>F</kbd> 넘어진 오토바이 일으켜 탑승' : '<kbd>F</kbd> 배달 오토바이 탑승';
  }

  if (isRiding && Math.abs(scooter.speed) <= 4.2) {
    return '<kbd>F</kbd> 오토바이 하차';
  }

  return null;
}
