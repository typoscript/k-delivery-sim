import type { InteractEnv } from './interactEnv';

/** Gas pump, repair shop and convenience store (they work with no delivery in progress); true when handled */
export function interactServiceStations(env: InteractEnv): boolean {
  const { world, delivery, scooterPhysics, playerCtrl, audio, hud, modalUi } = env.ctx;
  const { bikeGarage } = env;
  if (!playerCtrl.state.inCorridor && playerCtrl.state.mode === 'on_foot') {
    if (world.isPlayerNearGasPump(playerCtrl.state.x, playerCtrl.state.z)) {
      if (!world.isScooterOnGasPad(scooterPhysics.state.x, scooterPhysics.state.z)) {
        hud.showToast('⛽ 먼저 오토바이를 주유소 노란 주유 패드 위에 주차하세요!', 3200);
        return true;
      }
      if (scooterPhysics.state.fuel >= 99.5) {
        hud.showToast('⛽ 연료가 이미 가득 차 있습니다 (100%)', 2600);
        return true;
      }
      if (hud.phoneMap.placement === 'in_hand') hud.stowPhoneToPocket();
      else hud.phoneMap.setZoomed(false);
      modalUi.openFuelModal(scooterPhysics.state.fuel);
      return true;
    }

    if (world.isPlayerNearRepairShop(playerCtrl.state.x, playerCtrl.state.z)) {
      if (hud.phoneMap.placement === 'in_hand') hud.stowPhoneToPocket();
      else hud.phoneMap.setZoomed(false);
      modalUi.openRepairModal(
        scooterPhysics.state.damageLevel,
        scooterPhysics.state.crashCount,
        bikeGarage,
        delivery.career,
      );
      return true;
    }

    if (world.isPlayerNearConvenienceStore(playerCtrl.state.x, playerCtrl.state.z)) {
      if (hud.phoneMap.placement === 'in_hand') hud.stowPhoneToPocket();
      else hud.phoneMap.setZoomed(false);
      audio.playConvenienceChime();
      modalUi.openConvenienceModal(playerCtrl.state.stamina, hud.phoneMap.battery);
      return true;
    }
  }
  return false;
}
