/**
 * The 산책로 쉼터 hand-over as the game runs it (deliveryFlow calls these; riversideFlow.test.ts calls the same):
 * at the bench, a carried riverside order becomes an in-person hand-over and settles on the spot; closing the
 * settlement ends the delivery right there (no corridor to walk out of).
 */
import type { ActiveMission } from './deliveryTypes';
import type { DeliveryManager } from './DeliveryManager';

/** The rider at a bench with that bench's food in hand: [E] hands it over */
export function isBenchHandoff(m: ActiveMission | null | undefined): boolean {
  return !!m && m.phase === 'carrying_to_lobby' && m.order.customer.residenceKind === 'riverside';
}

/**
 * Starts the hand-over of `missionId` (the customer takes the food): the mission is ready to settle. False when
 * it is not a carried riverside order.
 */
export function startBenchHandoff(delivery: DeliveryManager, missionId: string): boolean {
  const m = delivery.getMissionById(missionId);
  if (!m || !isBenchHandoff(m)) return false;
  m.phase = 'meet_waiting';
  return true;
}

/** The settlement of a hand-over was closed: the delivery ends on the walkway */
export function finishBenchHandoff(delivery: DeliveryManager): void {
  delivery.finishAfterCorridorExit();
}
