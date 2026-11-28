/** The rider in first person each frame: the phone and food bag in hand, the rider mesh, the camera and the photo viewfinder check */
import type { GameContext } from '../GameContext';
import type { FrameState, GameLoopHooks } from '../gameLoop';
import { validateDeliveryPhotoFrame } from '../../camera/PhotoProofValidator';

export function stepFirstPerson(ctx: GameContext, hooks: GameLoopHooks, f: FrameState): void {
  const {
    camera,
    corridorRoom,
    delivery,
    scooterPhysics,
    scooterMesh,
    playerCtrl,
    playerMesh,
    camController,
    hud,
    modalUi,
    handheldPhone3D,
    handheldFoodBag3D,
  } = ctx;
  const { dt, elapsed, inCorridor, isRiding } = f;
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
}
