/** Finding missions: the one in hand / in the corridor / in focus, cargo slots, and the nearest pickup or lobby */
import type { DeliveryManager } from './DeliveryManager';
import { DeliveryLocation } from '../types';
import { ActiveMission, CARGO_SLOT_COUNT, INTERACT_ZONE_RADIUS, MissionPhase } from './deliveryTypes';

/** Backward-compatible primary mission accessor (carried / corridor / pinned / first active) */
export function activeMissionOf(host: DeliveryManager): ActiveMission | null {
  return (
    host.getCorridorMission() ??
    host.getCarryingMission() ??
    (host.selectedMissionId
      ? (host.activeMissions.find((m) => m.order.id === host.selectedMissionId) ?? null)
      : null) ??
    host.activeMissions[0] ??
    null
  );
}

export function getMissionById(host: DeliveryManager, id: string | null): ActiveMission | null {
  if (!id) return null;
  return host.activeMissions.find((m) => m.order.id === id) ?? null;
}

export function getCorridorMission(host: DeliveryManager): ActiveMission | null {
  return (
    host.activeMissions.find(
      (m) =>
        m.phase === 'in_corridor' ||
        m.phase === 'photo_mode' ||
        m.phase === 'knock_waiting' ||
        m.phase === 'meet_waiting' ||
        m.phase === 'corridor_exit',
    ) ?? null
  );
}

export function getCarryingMission(host: DeliveryManager): ActiveMission | null {
  return (
    host.activeMissions.find(
      (m) =>
        m.phase === 'carrying_to_box' ||
        m.phase === 'carrying_to_lobby' ||
        m.phase === 'lobby_unlocked' ||
        m.phase === 'in_corridor',
    ) ?? null
  );
}

export function isCarryingFood(host: DeliveryManager): boolean {
  return host.getCarryingMission() !== null;
}

export function isCargoLoaded(host: DeliveryManager): boolean {
  return host.cargoSlots.some((id) => id !== null);
}

export function getLoadedCargoCount(host: DeliveryManager): number {
  let count = 0;
  for (const id of host.cargoSlots) {
    if (id !== null) count++;
  }
  return count;
}

export function getCargoSlotOccupiedFlags(host: DeliveryManager): [boolean, boolean, boolean] {
  return [host.cargoSlots[0] !== null, host.cargoSlots[1] !== null, host.cargoSlots[2] !== null];
}

export function getCargoSlotMission(host: DeliveryManager, slotIndex: number): ActiveMission | null {
  if (slotIndex < 0 || slotIndex >= CARGO_SLOT_COUNT) return null;
  const id = host.cargoSlots[slotIndex];
  return id ? host.getMissionById(id) : null;
}

export function getFirstEmptyCargoSlot(host: DeliveryManager): number {
  for (let i = 0; i < CARGO_SLOT_COUNT; i++) {
    if (host.cargoSlots[i] === null) return i;
  }
  return -1;
}

/** Food in the top box (loaded missions) */
export function loadedCargo(host: DeliveryManager): ActiveMission[] {
  const out: ActiveMission[] = [];
  for (const id of host.cargoSlots) {
    const m = id ? host.getMissionById(id) : null;
    if (m && m.phase === 'cargo_loaded') out.push(m);
  }
  return out;
}

/** Returns the highest-priority shop mission near the player's outdoor pickup counter (pickup_ready > to_pickup > cooking_wait) */
export function getMissionNearShopPickup(host: DeliveryManager, x: number, z: number): ActiveMission | null {
  const priority = (phase: MissionPhase) =>
    phase === 'pickup_ready' ? 3 : phase === 'to_pickup' ? 2 : phase === 'cooking_wait' ? 1 : 0;

  let best: ActiveMission | null = null;
  let bestPri = 0;
  let bestDist = INTERACT_ZONE_RADIUS;
  for (const m of host.activeMissions) {
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
export function getMissionNearCustomerLobby(host: DeliveryManager, x: number, z: number): ActiveMission | null {
  const carrying = host.getCarryingMission();
  if (!carrying) return null;
  if (carrying.phase !== 'carrying_to_lobby' && carrying.phase !== 'lobby_unlocked') return null;
  const c = carrying.order.customer;
  return Math.hypot(x - c.x, z - c.z) <= INTERACT_ZONE_RADIUS ? carrying : null;
}

/** Helper: checks if player is standing right in front of any residential lobby (to warn about wrong bag) */
export function getNearestResidenceWithin(
  host: DeliveryManager,
  x: number,
  z: number,
  radius = INTERACT_ZONE_RADIUS,
): DeliveryLocation | null {
  let best: DeliveryLocation | null = null;
  let bestD = radius;
  for (const r of host.residences) {
    const d = Math.hypot(x - r.x, z - r.z);
    if (d <= bestD) {
      best = r;
      bestD = d;
    }
  }
  return best;
}
