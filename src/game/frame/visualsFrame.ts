/** Per-frame stage of the game loop (gameLoop.ts calls the stages in order each frame) */
import type { GameContext } from '../GameContext';
import type { FrameState, GameLoopHooks, LoopState } from '../gameLoop';
import { validateDeliveryPhotoFrame } from '../../camera/PhotoProofValidator';
import type { NavigationPlan } from '../../delivery/DeliveryManager';

/** Delivery markers, scooter, first-person hands, camera, photo viewfinder, weather and engine audio */
export function stepVisualsFrame(
  ctx: GameContext,
  hooks: GameLoopHooks,
  loop: LoopState,
  f: FrameState,
  navPlan: NavigationPlan,
): void {
  const {
    camera,
    world,
    corridorRoom,
    weather,
    visorRain,
    delivery,
    scooterPhysics,
    scooterMesh,
    playerCtrl,
    playerMesh,
    camController,
    audio,
    hud,
    modalUi,
    handheldPhone3D,
    handheldFoodBag3D,
  } = ctx;
  const { perf } = loop;
  const { dt, elapsed, inCorridor, isRiding } = f;
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

    scooterMesh.sync(scooterPhysics.state, elapsed, dt, world.isNight, weather.rainIntensity);
    scooterMesh.setCargoSlotsVisual(delivery.getCargoSlotOccupiedFlags());
    scooterMesh.setPhoneMounted(
      hud.phoneMap.placement === 'mounted' &&
        !hud.phoneMap.isZoomed &&
        !handheldPhone3D.isHoldingPhoneDuringMountAnim(),
    );
  }

  // 1st-person 3D Right Hand Smartphone & 3D Left Hand Food Bag!
  handheldPhone3D.update(
    hud.phoneMap.placement === 'in_hand' && !hud.phoneMap.isZoomed && modalUi.activeModal === 'none',
    playerCtrl.state,
    dt,
    elapsed,
  );
  const showHandBag =
    (delivery.isCarryingFood() ||
      (delivery.getCorridorMission()?.phase === 'meet_waiting' && !hooks.isNpcHoldingFoodBag())) &&
    !isRiding &&
    modalUi.activeModal !== 'transition';
  handheldFoodBag3D.update(showHandBag, playerCtrl.state, dt, elapsed);

  playerMesh.sync(playerCtrl.state, scooterMesh.riderMountPoint, scooterPhysics.state.steerAngle, true);

  camController.update(camera, playerCtrl.state, scooterPhysics.state, scooterMesh, dt);

  // Live viewfinder framing validation (Bounding Box + vector.project(camera)) when in PHOTO_DOOR camera mode!
  if (inCorridor && modalUi.activeModal === 'camera') {
    const { foodBagMesh, doorPlateMesh } = corridorRoom.getProofTargets();
    const proofStatus = validateDeliveryPhotoFrame(camera, foodBagMesh, doorPlateMesh);
    modalUi.updateCameraProofStatus(proofStatus);
  }

  perf.lap('visuals');
  // Weather local rain particles (InstancedMesh), 1st-person helmet visor droplets, wet asphalt & audio!
  weather.update(dt, camera.position.x, camera.position.y, camera.position.z, inCorridor, world.isNight);
  // a raincoat's hood keeps most drops off the visor
  const visorRainMul = ctx.delivery.hasUpgrade('raincoat') ? 0.35 : 1;
  visorRain.update(dt, weather.rainIntensity * visorRainMul, inCorridor, scooterPhysics.state.speed, isRiding);
  if (!inCorridor) {
    world.updateWeatherVisuals(weather.rainIntensity, elapsed);
  }
  // snow keeps settling (and melting) while the rider is indoors too
  world.updateSnowCover(dt, weather.isSnowing);
  audio.updateWeatherAudio(weather.rainIntensity, inCorridor);
  audio.update(scooterPhysics.state, elapsed);
}
