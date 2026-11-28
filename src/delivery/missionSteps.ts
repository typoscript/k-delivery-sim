/**
 * The delivery steps of one order: counter pickup (kitchen wait, regular-shop perk) -> top box load / unload ->
 * lobby door -> corridor -> door drop / knock / face-to-face -> back outside, plus cancelling. Payment happens in
 * DeliveryManager.completePhotoSettlement.
 */
import type { DeliveryManager } from './DeliveryManager';
import { ActiveMission, CARGO_SLOT_COUNT, PosPickupResult, SPECIAL_ORDERS } from './deliveryTypes';
import { kitchenDelayChance } from './orderFactory';

export function cancelMission(host: DeliveryManager, orderId: string): ActiveMission | null {
  const idx = host.activeMissions.findIndex((m) => m.order.id === orderId);
  if (idx === -1) return null;
  const m = host.activeMissions[idx];
  if (
    m.phase === 'in_corridor' ||
    m.phase === 'photo_mode' ||
    m.phase === 'knock_waiting' ||
    m.phase === 'meet_waiting' ||
    m.phase === 'corridor_exit'
  ) {
    return null;
  }

  if (m.cargoSlot !== null && host.cargoSlots[m.cargoSlot] === orderId) {
    host.cargoSlots[m.cargoSlot] = null;
  }
  host.activeMissions.splice(idx, 1);
  if (host.selectedMissionId === orderId) {
    host.selectedMissionId = null;
  }
  if (host.availableOrders.length < 3) {
    host.replenishAvailableOrders();
  }
  host.invalidateNavCache();
  return m;
}

/**
 * Complete POS order-number check at an outdoor store counter.
 * Peak-time / busy cooked-food restaurants enter a 5~10s 'cooking_wait' state
 * (leaving rider completely free to move, ride, or use smartphone until ready!).
 */
export function completePosPickup(
  host: DeliveryManager,
  missionId: string,
  forceCookingDelay?: boolean,
): PosPickupResult | null {
  if (host.isCarryingFood()) return null;
  const m = host.getMissionById(missionId);
  if (!m || m.phase !== 'to_pickup') return null;

  const sameShopCount = host.activeMissions.filter((x) => x.order.shop.id === m.order.shop.id).length;
  const delayProb = kitchenDelayChance(m.order.shop.id, sameShopCount);
  const special = m.order.special ? SPECIAL_ORDERS[m.order.special] : null;
  // Group orders always take a while at the counter (a big batch is still being packed)
  const hasDelay =
    forceCookingDelay !== undefined ? forceCookingDelay : (special?.extraWaitSec ?? 0) > 0 || Math.random() < delayProb;

  // Regular Store Perk: >= 2 previous pickups at this shop grants priority fast-track cooking!
  const { count: nextCount, isRegularPerk, justBecameRegular } = host.records.recordShopPickup(m.order.shop);
  host.persistCareer();

  if (hasDelay) {
    // 5 ~ 10 seconds random, longer while kitchens are slammed in a lunch / dinner rush
    const rawWaitSec =
      Math.round((5 + Math.floor(Math.random() * 6)) * host.demandPhase.cookingMul) + (special?.extraWaitSec ?? 0);
    if (isRegularPerk && rawWaitSec <= 6) {
      // Regular store owner prioritized your order -> instant handoff!
      m.phase = 'carrying_to_box';
      m.pickedUp = true;
      host.invalidateNavCache();
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
    host.invalidateNavCache();
    host.postShopMessage(
      m,
      host.demandPhase.isPeak
        ? `[#${m.order.orderNumber}] 주문이 몰려서 조리가 조금 늦어요 🙇 약 ${waitSec}초만 기다려 주세요!`
        : `[#${m.order.orderNumber}] 지금 조리 중이에요 🍳 약 ${waitSec}초 뒤 픽업대에 올려드릴게요`,
    );
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
  host.invalidateNavCache();
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
export function collectReadyPickup(host: DeliveryManager, missionId: string): ActiveMission | null {
  if (host.isCarryingFood()) return null;
  const m = host.getMissionById(missionId);
  if (!m || m.phase !== 'pickup_ready') return null;
  m.phase = 'carrying_to_box';
  m.pickedUp = true;
  host.invalidateNavCache();
  return m;
}

/** Load currently held food bag (`carrying_to_box` or `carrying_to_lobby`) into a specific cargo slot (0..2) */
export function loadFoodIntoCargoSlot(host: DeliveryManager, slotIndex: number): ActiveMission | null {
  if (slotIndex < 0 || slotIndex >= CARGO_SLOT_COUNT) return null;
  if (host.cargoSlots[slotIndex] !== null) return null;
  const carrying = host.getCarryingMission();
  if (!carrying) return null;
  if (carrying.phase !== 'carrying_to_box' && carrying.phase !== 'carrying_to_lobby') {
    return null;
  }

  host.cargoSlots[slotIndex] = carrying.order.id;
  carrying.cargoSlot = slotIndex;
  carrying.phase = 'cargo_loaded';
  host.invalidateNavCache();
  return carrying;
}

/** Unload a specific cargo slot (0..2) into the rider's left hand (`carrying_to_lobby`) */
export function unloadFoodFromCargoSlot(host: DeliveryManager, slotIndex: number): ActiveMission | null {
  if (slotIndex < 0 || slotIndex >= CARGO_SLOT_COUNT) return null;
  if (host.isCarryingFood()) return null;
  const id = host.cargoSlots[slotIndex];
  if (!id) return null;
  const m = host.getMissionById(id);
  if (!m || m.phase !== 'cargo_loaded') return null;

  host.cargoSlots[slotIndex] = null;
  m.cargoSlot = null;
  m.phase = 'carrying_to_lobby';
  host.invalidateNavCache();
  return m;
}

export function unlockLobbyDoor(host: DeliveryManager, missionId: string): ActiveMission | null {
  const m = host.getMissionById(missionId);
  if (!m || m.phase !== 'carrying_to_lobby') return null;
  m.phase = 'lobby_unlocked';
  host.invalidateNavCache();
  return m;
}

export function enterCorridor(host: DeliveryManager, missionId: string): ActiveMission | null {
  const m = host.getMissionById(missionId);
  if (!m || m.phase !== 'lobby_unlocked') return null;
  m.phase = 'in_corridor';
  host.invalidateNavCache();
  return m;
}

export function placeFoodAtDoor(host: DeliveryManager): ActiveMission | null {
  const m = host.getCorridorMission();
  if (!m || m.phase !== 'in_corridor') return null;
  m.phase = 'photo_mode';
  return m;
}

export function startKnockDelivery(host: DeliveryManager): ActiveMission | null {
  const m = host.getCorridorMission();
  if (!m || m.phase !== 'in_corridor') return null;
  m.phase = 'knock_waiting';
  return m;
}

export function startMeetFaceDelivery(host: DeliveryManager): ActiveMission | null {
  const m = host.getCorridorMission();
  if (!m || m.phase !== 'in_corridor') return null;
  m.phase = 'meet_waiting';
  return m;
}

export function finishAfterCorridorExit(host: DeliveryManager): void {
  const finished = host.activeMissions.find((m) => m.phase === 'corridor_exit');
  if (finished) {
    if (host.selectedMissionId === finished.order.id) {
      host.selectedMissionId = null;
    }
    host.activeMissions = host.activeMissions.filter((m) => m.order.id !== finished.order.id);
  }
  host.replenishAvailableOrders();
  host.invalidateNavCache();
}
