import { isBenchHandoff } from '../../delivery/riversideHandoff';
import type { InteractEnv } from './interactEnv';
import { NO_GROUND_WALK_BONUS, isNoGroundVehicleComplex, scooterInsideComplex } from '../../delivery/apartmentRules';

/** Outdoors on foot: shop pickup counter / tray, the scooter's cargo box, the customer's lobby door */
export function interactOutdoors(env: InteractEnv): void {
  const { delivery, scooterMesh, scooterPhysics, playerCtrl, audio, hud, modalUi } = env.ctx;
  const { isPlayerNearCargoBox, playerHasPhonePhysically, enterElevatorToCorridor } = env;
  // Outdoors (must be on foot)
  if (playerCtrl.state.mode !== 'on_foot') return;

  const carrying = delivery.getCarryingMission();
  const hasPhone = playerHasPhonePhysically();

  // 1. Outdoor Shop Pickup POS / Cooking Wait / Ready Tray Collection
  const shopMission = delivery.getMissionNearShopPickup(playerCtrl.state.x, playerCtrl.state.z);
  if (shopMission) {
    if (shopMission.phase === 'cooking_wait') {
      const rem = Math.max(1, Math.ceil(shopMission.cookingRemainingSec));
      hud.showToast(
        `🍳 ${shopMission.order.shop.name} [#${shopMission.order.orderNumber}] 조리 중입니다 (남은 시간: ${rem}초)`,
        2600,
      );
      return;
    }

    if (carrying) {
      hud.showToast(
        `🛍️ 이미 [#${carrying.order.orderNumber}] 음식을 손에 들고 있습니다! 먼저 오토바이 배달통에 [E]로 적재하세요`,
        3600,
      );
      return;
    }

    if (shopMission.phase === 'pickup_ready') {
      const collected = delivery.collectReadyPickup(shopMission.order.id);
      if (collected) {
        audio.playChime('pickup');
        hud.showToast(
          `🛍️ [#${collected.order.orderNumber}] 픽업대 트레이에서 음식 수령 완료! 오토바이 뒤편 배달통 [E]로 적재하세요`,
          3800,
        );
      }
      return;
    }

    if (hud.phoneMap.placement === 'in_hand') hud.stowPhoneToPocket();
    else hud.phoneMap.setZoomed(false);
    modalUi.openPosKeypad(shopMission.order, hasPhone, delivery.isRegularShop(shopMission.order.shop.id));
    return;
  }

  // 2. Scooter Rear 3-Slot Cargo Box
  if (isPlayerNearCargoBox()) {
    if (carrying || delivery.isCargoLoaded()) {
      if (hud.phoneMap.placement === 'in_hand') hud.stowPhoneToPocket();
      else hud.phoneMap.setZoomed(false);
      scooterMesh.triggerCargoBoxOpen();
      audio.playCargoBoxSound();
      modalUi.openCargoBoxModal(delivery, playerCtrl.state.x, playerCtrl.state.z);
    } else {
      hud.showToast('배달통이 비어 있습니다. 매장에서 음식을 픽업해 오세요!');
    }
    return;
  }

  // 3. Customer 1st-Floor Lobby Glass Door PIN / Elevator
  const lobbyMission = delivery.getMissionNearCustomerLobby(playerCtrl.state.x, playerCtrl.state.z);
  if (lobbyMission) {
    if (isBenchHandoff(lobbyMission)) {
      env.handleRiversideHandoff(lobbyMission.order.id);
      return;
    }
    if (lobbyMission.phase === 'carrying_to_lobby') {
      // 지상 차량 출입 금지 단지: the guard notices a scooter parked inside the complex (allowance forfeited)
      const c = lobbyMission.order.customer;
      if (
        isNoGroundVehicleComplex(c) &&
        !lobbyMission.groundRuleBroken &&
        scooterInsideComplex(c.x, c.z, scooterPhysics.state.x, scooterPhysics.state.z)
      ) {
        lobbyMission.groundRuleBroken = true;
        audio.playKeypadBeep(false);
        hud.showToast(
          `👮 경비원: "여긴 지상 차량 출입 금지 단지예요! 오토바이는 정문 밖에 세워 주세요" (도보 수당 ₩${NO_GROUND_WALK_BONUS.toLocaleString()} 없음)`,
          4200,
        );
      }
      if (hud.phoneMap.placement === 'in_hand') hud.stowPhoneToPocket();
      else hud.phoneMap.setZoomed(false);
      modalUi.openPinKeypad(lobbyMission.order, hasPhone);
      return;
    }
    if (lobbyMission.phase === 'lobby_unlocked') {
      enterElevatorToCorridor(lobbyMission.order.id);
      return;
    }
  }

  // Helpful feedback if holding wrong food bag at a different residential building
  const nearRes = delivery.getNearestResidenceWithin(playerCtrl.state.x, playerCtrl.state.z);
  if (nearRes) {
    if (carrying) {
      hud.showToast(
        `🚫 현재 들고 있는 [#${carrying.order.orderNumber}]의 목적지는 ${carrying.order.customer.name}입니다!`,
        3600,
      );
    } else if (delivery.isCargoLoaded()) {
      hud.showToast('🛍️ 먼저 오토바이 뒤편 배달통에서 [E]로 해당 호수 음식을 꺼내오세요!', 3200);
    }
  }
}
