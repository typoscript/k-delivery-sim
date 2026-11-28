/** Outdoors each frame: the delivery target marker, shop pickup trays, bench customers and the scooter (cargo slots, mounted phone) */
import type { GameContext } from '../GameContext';
import type { FrameState } from '../gameLoop';
import type { NavigationPlan } from '../../delivery/DeliveryManager';

export function stepDeliveryVisuals(ctx: GameContext, f: FrameState, navPlan: NavigationPlan): void {
  const { world, weather, delivery, scooterPhysics, scooterMesh, hud, handheldPhone3D } = ctx;
  const { dt, elapsed, inCorridor } = f;
  // Outdoor Entrance Ground Marker + Shop Pickup Trays + 3-Slot Scooter Visuals
  // (Navigation path is shown ONLY on the smartphone GPS screen, never on the 3D road!)
  if (!inCorridor) {
    world.updateBeacon(navPlan.target, navPlan.isPickupTarget, elapsed);

    const cookingShopIds = new Set<string>();
    const readyShopIds = new Set<string>();
    for (const m of delivery.activeMissions) {
      if (m.phase === 'cooking_wait') cookingShopIds.add(m.order.shop.id);
      else if (m.phase === 'pickup_ready') readyShopIds.add(m.order.shop.id);
    }
    world.syncShopPickupTrays(cookingShopIds, readyShopIds, elapsed);
    // 산책로 쉼터: the customer of a riverside order waits on the bench, stands to take the food, waves goodbye
    const benchWaiting = [];
    let carryingTo: string | null = null;
    for (const m of delivery.activeMissions) {
      if (m.order.customer.residenceKind !== 'riverside' || m.phase === 'corridor_exit') continue;
      benchWaiting.push(m.order.customer);
      if (m.phase === 'carrying_to_lobby') carryingTo = m.order.customer.id;
    }
    world.syncBenchCustomers(dt, ctx.playerCtrl.state.x, ctx.playerCtrl.state.z, benchWaiting, carryingTo);

    scooterMesh.sync(scooterPhysics.state, elapsed, dt, world.isNight, weather.rainIntensity);
    scooterMesh.setCargoSlotsVisual(delivery.getCargoSlotOccupiedFlags());
    scooterMesh.setPhoneMounted(
      hud.phoneMap.placement === 'mounted' &&
        !hud.phoneMap.isZoomed &&
        !handheldPhone3D.isHoldingPhoneDuringMountAnim(),
    );
  }
}
