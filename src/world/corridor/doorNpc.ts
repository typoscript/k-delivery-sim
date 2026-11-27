/** At the customer's door: food bag on the mat, intercom, door opening and the customer NPC handover */
import type { CorridorRoom } from '../CorridorRoom';

export function placeFoodOnTargetMat(host: CorridorRoom): void {
  const target = host.getActiveDoors()[host.targetDoorIndex];
  host.foodPlacedOnMat = true;
  host.placedFoodBag.position.set(target.matX, target.y + 0.18, target.matZ);
  host.placedFoodBag.rotation.y = target.facingX > 0 ? Math.PI / 2 : -Math.PI / 2;
  host.placedFoodBag.visible = true;
  host.targetHighlightRing.visible = false;
}

/** Triggered when player presses [E] at intercom doorbell for MEET_FACE delivery */
export function triggerIntercomRing(host: CorridorRoom): void {
  host.bellFlashTimer = 1.6;
  host.targetHighlightRing.visible = false;
}

/** Smoothly pivots target door inward to 70° and brings 3D NPC to doorway */
export function openTargetDoorForNpc(host: CorridorRoom): void {
  host.targetDoorOpenAngle = (70 * Math.PI) / 180;
  host.npcVisible = true;
  host.npcGroup.visible = true;
  host.npcStepTarget = 1;
}

/** NPC extends right arm forward and receives the 3D takeout food bag from the rider */
export function triggerNpcReceiveFood(host: CorridorRoom): void {
  host.npcArmReachTarget = 1;
  host.npcHeldBag.visible = true;
}

/** NPC steps slightly back inside after thanking the rider */
export function retreatNpcSlightly(host: CorridorRoom): void {
  host.npcArmReachTarget = 0.25;
  host.npcStepTarget = 0.45;
}
