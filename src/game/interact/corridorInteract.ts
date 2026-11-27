import type { InteractEnv } from './interactEnv';

/** Inside the building: elevator buttons, the stairwell, the target door (photo / knock / face-to-face), leaving */
export function interactInCorridor(env: InteractEnv): void {
  const { corridorRoom, delivery, playerCtrl, audio, hud, modalUi } = env.ctx;
  const { state, exitCorridorToStreet, finalizeCorridorSettlement } = env;
  const cm = delivery.getCorridorMission();
  if (!cm) return;

  // 0. Real 3D Apartment Elevator Controls (Press target floor at 1F / Call elevator / Press 1F to descend!)
  if (!corridorRoom.isVillaMode) {
    const inCabin = corridorRoom.isInsideElevatorCabin(playerCtrl.state.x, playerCtrl.state.z);
    if (corridorRoom.elevatorPhase === 'moving_up' || corridorRoom.elevatorPhase === 'moving_down') {
      hud.showToast(`🛗 엘리베이터 이동 중... (현재 ${corridorRoom.elevatorCurrentFloor}층)`, 1600);
      return;
    }
    if (inCabin && corridorRoom.elevatorPhase === 'idle_1f') {
      if (corridorRoom.startElevatorRideUp()) {
        audio.playKeypadBeep(true);
        audio.playElevatorDoorSlide();
        audio.setElevatorHum(true);
        hud.showToast(`🛗 ${corridorRoom.elevatorTargetFloor}층 버튼을 눌렀습니다! 문이 닫히고 올라갑니다...`, 2800);
      }
      return;
    }
  }

  if (cm.phase === 'in_corridor') {
    if (!corridorRoom.isNearTargetDoor(playerCtrl.state.x, playerCtrl.state.z, playerCtrl.state.y)) {
      hud.showToast(
        corridorRoom.isVillaMode
          ? `🪜 원룸·빌라 계단을 올라 ${cm.order.unitNumber} 현관문 앞으로 가까이 가세요`
          : `${cm.order.unitNumber} 현관문 앞으로 가까이 가세요`,
      );
      return;
    }

    const inst = cm.order.deliveryInstruction;
    hud.stowPhoneToPocket();

    if (inst === 'PHOTO_DOOR') {
      // Branch 1: PHOTO_DOOR -> place on mat -> camera viewfinder -> Space shutter
      corridorRoom.placeFoodOnTargetMat();
      delivery.placeFoodAtDoor();
      audio.playCargoBoxSound();
      modalUi.openCameraViewfinder(cm.order);
      hud.showToast('📸 음식을 발매트에 내려놓았습니다! [Space]로 인증 사진을 찍으세요', 3400);
      return;
    }

    if (inst === 'KNOCK_DOOR') {
      // Branch 2: KNOCK_DOOR -> knock sound ("똑똑똑") -> auto place food on mat -> complete after 3s
      delivery.startKnockDelivery();
      audio.playDoorKnockSound();
      corridorRoom.placeFoodOnTargetMat();
      hud.showToast('✊ 똑똑똑! 문 앞에 음식을 내려놓았습니다... (3초 후 배달 완료)', 3100);
      window.setTimeout(() => {
        const cur = delivery.getCorridorMission();
        if (cur && cur.phase === 'knock_waiting') {
          finalizeCorridorSettlement();
        }
      }, 3000);
      return;
    }

    if (inst === 'MEET_FACE') {
      // Branch 3: MEET_FACE -> intercom bell ("누구세요? 배달이요!") -> 70° door open -> 3D NPC takes food!
      state.npcTookFoodBag = false;
      delivery.startMeetFaceDelivery();
      corridorRoom.triggerIntercomRing();
      audio.playIntercomBellAndVoice();
      hud.showToast('🔔 딩동! 고객: "누구세요?" — 라이더: "배달이요!"', 2400);

      window.setTimeout(() => {
        const cur = delivery.getCorridorMission();
        if (!cur || cur.phase !== 'meet_waiting') return;
        corridorRoom.openTargetDoorForNpc();
      }, 780);

      window.setTimeout(() => {
        const cur = delivery.getCorridorMission();
        if (!cur || cur.phase !== 'meet_waiting') return;
        state.npcTookFoodBag = true;
        corridorRoom.triggerNpcReceiveFood();
        audio.playCargoBoxSound();
        hud.showToast('🙋 고객이 음식을 직접 수령했습니다! "감사합니다, 수고하세요~"', 2200);
      }, 1620);

      window.setTimeout(() => {
        const cur = delivery.getCorridorMission();
        if (!cur || cur.phase !== 'meet_waiting') return;
        corridorRoom.retreatNpcSlightly();
        finalizeCorridorSettlement();
      }, 2850);
      return;
    }
    return;
  }

  if (cm.phase === 'corridor_exit') {
    if (corridorRoom.isVillaMode) {
      if (corridorRoom.isNearElevator(playerCtrl.state.x, playerCtrl.state.z, playerCtrl.state.y)) {
        exitCorridorToStreet();
      } else {
        hud.showToast('🪜 계단을 내려와 원룸·빌라 1층 현관 출구 앞으로 이동해서 [E]를 누르세요');
      }
      return;
    }

    // Real 3D Apartment Elevator Descent Sequence!
    const inCabin = corridorRoom.isInsideElevatorCabin(playerCtrl.state.x, playerCtrl.state.z);
    if (inCabin) {
      if (corridorRoom.startElevatorRideDown()) {
        audio.playKeypadBeep(true);
        audio.playElevatorDoorSlide();
        audio.setElevatorHum(true);
        hud.showToast('🛗 1층 버튼을 눌렀습니다! 문이 닫히고 1층 로비로 내려갑니다...', 2800);
      }
    } else if (corridorRoom.isNearElevator(playerCtrl.state.x, playerCtrl.state.z, playerCtrl.state.y)) {
      if (!corridorRoom.isElevatorDoorsOpen()) {
        if (corridorRoom.openElevatorForExit()) {
          audio.playKeypadBeep(true);
          audio.playElevatorDing();
          audio.playElevatorDoorSlide();
          hud.showToast('🛗 엘리베이터 문이 열립니다! 안으로 걸어 들어가 [E]로 1층 버튼을 누르세요', 3400);
        }
      } else {
        hud.showToast('🚶 엘리베이터 안으로 걸어 들어가 [E]를 눌러 1층으로 내려가세요', 2600);
      }
    } else {
      hud.showToast('복도 끝 엘리베이터 앞으로 이동해서 [E]로 호출하세요');
    }
    return;
  }
}
