import * as THREE from 'three';
import './style.css';
import { CityWorld } from './world/CityWorld';
import { TrafficSystem } from './world/TrafficSystem';
import { CORRIDOR_ORIGIN_Y, CorridorRoom } from './world/CorridorRoom';
import { RoadNavigator } from './world/RoadNavigator';
import { RoadNavLine3D } from './world/RoadNavLine3D';
import { WeatherManager } from './world/WeatherManager';
import { ScooterInput, ScooterPhysics } from './vehicle/ScooterPhysics';
import { ScooterMesh } from './vehicle/ScooterMesh';
import { OnFootInput, PlayerController } from './player/PlayerController';
import { PlayerMesh } from './player/PlayerMesh';
import { HandheldPhone3D } from './player/HandheldPhone3D';
import { HandheldFoodBag3D } from './player/HandheldFoodBag3D';
import { CameraController } from './camera/CameraController';
import { validateDeliveryPhotoFrame } from './camera/PhotoProofValidator';
import { GameAudio } from './audio/GameAudio';
import {
  DeliveryManager,
  MAX_CONCURRENT_ORDERS,
  RoutePoint,
  getInstructionMeta,
} from './delivery/DeliveryManager';
import { OrderDispatchManager } from './delivery/OrderDispatchManager';
import { Hud } from './ui/Hud';
import { ModalUi } from './ui/ModalUi';
import { collidesWithWorld } from './types';

const app = document.getElementById('app')!;

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

// Scene & Always 1st-Person Camera
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.08, 650);
scene.add(camera);

// Core modules
const world = new CityWorld(scene);
const traffic = new TrafficSystem(scene, world.busStops);
const corridorRoom = new CorridorRoom(scene);
const roadNavigator = new RoadNavigator();
const roadNavLine3D = new RoadNavLine3D(world.root); // Parented to world.root -> auto-occluded indoors!
const weather = new WeatherManager(scene);
const delivery = new DeliveryManager(world.locations);
const dispatch = new OrderDispatchManager(world.locations, {
  onOfferArrived: (offer) => {
    audio.playDispatchCallAlert();
    const label = offer.type === 'SINGLE' ? '🚀 한집배달' : '🛵 알뜰배달 (2건 묶음)';
    const hint =
      hud.phoneMap.placement === 'pocket'
        ? '[Tab]으로 휴대폰을 꺼낸 뒤 [Tab/V]로 20초 내 수락!'
        : '20초 내 [Tab] 또는 [V]로 수락하세요!';
    hud.showToast(`🔔 신규 콜 도착! ${label} · ₩${offer.totalFee.toLocaleString()} — ${hint}`, 4500);
  },
  onOfferUrgentTick: () => {
    audio.playDispatchCallAlert();
  },
  onOfferExpired: (offer) => {
    audio.playDispatchExpiredSound();
    const label = offer.type === 'SINGLE' ? '한집배달' : '알뜰배달';
    hud.showToast(`⏱ ${label} 콜 응답 시간 초과 (자동 거절 · 10초 후 새 콜 배정)`, 3200);
  },
});
const scooterPhysics = new ScooterPhysics();
const playerCtrl = new PlayerController();
const playerMesh = new PlayerMesh(scene);
const camController = new CameraController(renderer.domElement);
const audio = new GameAudio();

const tmpCargoPos = new THREE.Vector3();

const isPlayerNearCargoBox = (): boolean => {
  if (playerCtrl.state.inCorridor || playerCtrl.state.mode !== 'on_foot') return false;
  scooterMesh.getCargoBoxWorldPosition(tmpCargoPos);
  return Math.hypot(playerCtrl.state.x - tmpCargoPos.x, playerCtrl.state.z - tmpCargoPos.z) <= 2.4;
};

const playerHasPhonePhysically = (): boolean => {
  return hud.phoneMap.placement !== 'mounted' || playerCtrl.state.mode === 'riding';
};

const enterElevatorToCorridor = (missionId: string) => {
  const m = delivery.getMissionById(missionId);
  if (!m) return;
  // Physical phone possession check: cannot take proof photo upstairs if phone was left on scooter!
  if (hud.phoneMap.placement === 'mounted') {
    hud.showToast(
      '🚫 휴대폰이 오토바이 거치대에 있습니다! 배달 인증 사진을 찍으려면 먼저 오토바이에서 [Tab]으로 챙겨오세요',
      3800
    );
    return;
  }
  audio.playElevatorDing();
  hud.stowPhoneToPocket();
  modalUi.playElevatorTransition(
    `🛗 [#${m.order.orderNumber}] ${m.order.customer.name} ${m.order.unitNumber} 이동 중...`,
    () => {
      // Midpoint while screen is completely black: occlude entire outdoor world + nav line + rain & audio!
      world.setOutdoorVisible(false);
      traffic.root.visible = false;
      scooterMesh.root.visible = false;
      weather.update(0, 0, 0, 0, true, world.isNight);
      audio.updateWeatherAudio(0, true);

      corridorRoom.configureForUnit(m.order.unitNumber);
      corridorRoom.root.visible = true;

      delivery.enterCorridor(missionId);
      const sp = corridorRoom.elevatorSpawn;
      playerCtrl.teleportTo(sp.x, sp.y, sp.z, sp.heading, true);
      camController.onFootYaw = sp.heading;
      camController.resetLook();
    },
    () => {
      audio.playElevatorDing();
      const inst = getInstructionMeta(m.order.deliveryInstruction);
      const actionMsg =
        m.order.deliveryInstruction === 'KNOCK_DOOR'
          ? `🏢 ${m.order.unitNumber} 앞에서 [E]로 노크 후 음식을 내려놓으세요 (${inst.badge})`
          : m.order.deliveryInstruction === 'MEET_FACE'
            ? `🏢 ${m.order.unitNumber} 옆 인터폰 벨을 [E]로 눌러 대면 전달하세요 (${inst.badge})`
            : `🏢 ${m.order.unitNumber} 문 앞 발매트에서 [E]를 눌러 음식을 내려놓으세요 (${inst.badge})`;
      hud.showToast(actionMsg, 4200);
    }
  );
};

const exitCorridorToStreet = () => {
  audio.playElevatorDing();
  hud.stowPhoneToPocket();
  modalUi.playElevatorTransition(
    '🛗 1층 로비로 내려가는 중...',
    () => {
      corridorRoom.root.visible = false;

      // Restore outdoor city & traffic visibility!
      world.setOutdoorVisible(true);
      world.setLobbyDoorOpen(null);
      traffic.root.visible = true;
      scooterMesh.root.visible = true;

      // Return player neatly beside their parked scooter outside
      const s = scooterPhysics.state;
      const leftX = Math.cos(s.heading);
      const leftZ = -Math.sin(s.heading);
      let rx = s.x + leftX * 1.45;
      let rz = s.z + leftZ * 1.45;
      if (collidesWithWorld(rx, rz, 0.5, world.obstacles)) {
        rx = s.x - leftX * 1.45;
        rz = s.z - leftZ * 1.45;
      }

      playerCtrl.teleportTo(rx, 0, rz, s.heading, false);
      camController.onFootYaw = s.heading;
      camController.resetLook();
      delivery.finishAfterCorridorExit();
    },
    () => {
      audio.playElevatorDing();
      const rem = delivery.activeMissions.length;
      hud.showToast(
        rem > 0
          ? `1층 복귀 완료! 남은 묶음 배달 ${rem}건의 다음 경로가 도로에 안내됩니다`
          : '1층 복귀 완료! [Tab]으로 휴대폰을 꺼내 다음 묶음 콜을 확인하세요',
        3800
      );
    }
  );
};

let npcTookFoodBag = false;

const finalizeCorridorSettlement = () => {
  renderer.render(scene, camera);
  const photoDataUrl = renderer.domElement.toDataURL('image/jpeg', 0.85);
  const result = delivery.completePhotoSettlement();
  if (result) {
    audio.playChime('complete');
    window.setTimeout(() => {
      modalUi.showSettlement(result, photoDataUrl);
    }, 200);
  }
};

const handleTakeDeliveryPhoto = () => {
  const m = delivery.getCorridorMission();
  if (!m || m.phase !== 'photo_mode') return;

  // Validate that BOTH the floor food bag AND door unit plaque are framed in central 60% viewfinder!
  const { foodBagMesh, doorPlateMesh } = corridorRoom.getProofTargets();
  const check = validateDeliveryPhotoFrame(camera, foodBagMesh, doorPlateMesh);

  if (!check.valid) {
    audio.playKeypadBeep(false);
    modalUi.showCameraValidationWarning(check);
    hud.showToast('⚠️ 현관문 호수와 음식 봉투가 모두 보이도록 찍어주세요!', 3400);
    return;
  }

  audio.playCameraShutter();
  modalUi.triggerCameraFlash();
  hud.showToast('✅ 인증 사진 확인 완료 — 배달 완료 승인!', 2600);
  finalizeCorridorSettlement();
};

const handleCargoSlotAction = (slotIndex: number) => {
  const carrying = delivery.getCarryingMission();
  const slotMission = delivery.getCargoSlotMission(slotIndex);

  if (slotMission === null) {
    if (!carrying) {
      hud.showToast(`슬롯 ${slotIndex + 1}은 비어 있습니다`);
      return;
    }
    const loaded = delivery.loadFoodIntoCargoSlot(slotIndex);
    if (loaded) {
      scooterMesh.triggerCargoBoxOpen();
      audio.playCargoBoxSound();
      modalUi.closeAll();
      hud.showToast(
        `📦 슬롯 ${slotIndex + 1}에 [#${loaded.order.orderNumber}] 적재 완료! (${loaded.order.customer.name} ${loaded.order.unitNumber})`,
        3600
      );
    }
    return;
  }

  // Slot is occupied -> unload if hands are free
  if (carrying) {
    hud.showToast(
      `🚫 이미 [#${carrying.order.orderNumber}] 음식을 들고 있습니다! 빈 슬롯에 먼저 적재하세요`,
      3000
    );
    return;
  }

  const unloaded = delivery.unloadFoodFromCargoSlot(slotIndex);
  if (unloaded) {
    scooterMesh.triggerCargoBoxOpen();
    audio.playCargoBoxSound();
    modalUi.closeAll();
    hud.showToast(
      `🛍️ 슬롯 ${slotIndex + 1}에서 [#${unloaded.order.orderNumber}] 꺼냄 → ${unloaded.order.customer.name} ${unloaded.order.unitNumber} (PIN ${unloaded.order.doorPin})`,
      3800
    );
  }
};

const modalUi = new ModalUi({
  onPosSuccess: (missionId) => {
    const res = delivery.completePosPickup(missionId);
    if (!res) return;
    if (res.status === 'cooking') {
      audio.playKeypadBeep(true);
      hud.showToast(
        `🍳 ${res.mission.order.shop.name} [#${res.mission.order.orderNumber}] 조리 중 (남은 시간: ${res.waitSec}초) — 대기 중 탑승·휴대폰 조작 가능!`,
        4200
      );
    } else {
      audio.playChime('pickup');
      hud.showToast(
        `🛍️ [#${res.mission.order.orderNumber}] 픽업 완료! 오토바이 뒤편 배달통 [E]로 슬롯에 적재하세요`,
        3800
      );
    }
  },
  onPinSuccess: (missionId) => {
    const unlocked = delivery.unlockLobbyDoor(missionId);
    if (unlocked) {
      audio.playChime('accept');
      world.setLobbyDoorOpen(unlocked.order.customer.id);
      hud.showToast(
        `🔓 ${unlocked.order.customer.name} 공동현관 개방! [E]를 눌러 엘리베이터에 탑승하세요`,
        3400
      );
    }
  },
  onCargoSlotAction: handleCargoSlotAction,
  onFuelTick: () => audio.playFuelPumpTick(),
  onFuelComplete: (addedPercent, cost) => {
    scooterPhysics.addFuel(addedPercent);
    delivery.recordFuelExpense(cost);
    audio.playPaymentCompleteSound();
    hud.showToast(
      `💳 결제가 완료되었습니다! 주유 완료 (+${addedPercent}% · -₩${cost.toLocaleString()})`,
      3800
    );
  },
  onRepairConfirm: (cost) => {
    scooterPhysics.repairVehicle();
    delivery.recordRepairExpense(cost);
    audio.playRepairSound();
    window.setTimeout(() => audio.playPaymentCompleteSound(), 420);
    hud.showToast(
      `🔧 정비 완료! 사이드미러·가속력 100% 복구 (수리비 -₩${cost.toLocaleString()})`,
      3800
    );
  },
  onTakePhoto: handleTakeDeliveryPhoto,
  onSettlementClose: () => {
    hud.showToast('배달 완료! 복도 엘리베이터 앞에서 [E]를 눌러 1층으로 내려가세요', 3600);
  },
  onKeypadBeep: (ok) => audio.playKeypadBeep(ok),
});

const handleContextInteract = () => {
  // Encapsulated outdoor service station interactions (work even with 0 active deliveries!)
  if (!playerCtrl.state.inCorridor && playerCtrl.state.mode === 'on_foot') {
    if (world.isPlayerNearGasPump(playerCtrl.state.x, playerCtrl.state.z)) {
      if (!world.isScooterOnGasPad(scooterPhysics.state.x, scooterPhysics.state.z)) {
        hud.showToast('⛽ 먼저 오토바이를 주유소 노란 주유 패드 위에 주차하세요!', 3200);
        return;
      }
      if (scooterPhysics.state.fuel >= 99.5) {
        hud.showToast('⛽ 연료가 이미 가득 차 있습니다 (100%)', 2600);
        return;
      }
      if (hud.phoneMap.placement === 'in_hand') hud.stowPhoneToPocket();
      else hud.phoneMap.setZoomed(false);
      modalUi.openFuelModal(scooterPhysics.state.fuel);
      return;
    }

    if (world.isPlayerNearRepairShop(playerCtrl.state.x, playerCtrl.state.z)) {
      if (!world.isScooterOnRepairPad(scooterPhysics.state.x, scooterPhysics.state.z)) {
        hud.showToast('🔧 먼저 오토바이를 정비소 주황 패드 위에 주차하세요!', 3200);
        return;
      }
      if (scooterPhysics.state.damageLevel === 0) {
        hud.showToast('🔧 오토바이 상태가 양호합니다! 수리가 필요 없습니다', 2600);
        return;
      }
      if (hud.phoneMap.placement === 'in_hand') hud.stowPhoneToPocket();
      else hud.phoneMap.setZoomed(false);
      modalUi.openRepairModal(scooterPhysics.state.damageLevel, scooterPhysics.state.crashCount);
      return;
    }
  }

  if (delivery.activeMissions.length === 0) {
    hud.showToast('진행 중인 배달이 없습니다 ([Tab] → [V]로 최대 3건 콜 수락)');
    return;
  }

  // Inside underground corridor
  if (playerCtrl.state.inCorridor) {
    const cm = delivery.getCorridorMission();
    if (!cm) return;

    if (cm.phase === 'in_corridor') {
      if (!corridorRoom.isNearTargetDoor(playerCtrl.state.x, playerCtrl.state.z)) {
        hud.showToast(`${cm.order.unitNumber} 현관문 앞으로 가까이 가세요`);
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
        npcTookFoodBag = false;
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
          npcTookFoodBag = true;
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
      if (corridorRoom.isNearElevator(playerCtrl.state.x, playerCtrl.state.z)) {
        exitCorridorToStreet();
      } else {
        hud.showToast('복도 끝 엘리베이터 앞으로 이동해서 [E]를 누르세요');
      }
      return;
    }
    return;
  }

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
        2600
      );
      return;
    }

    if (carrying) {
      hud.showToast(
        `🛍️ 이미 [#${carrying.order.orderNumber}] 음식을 손에 들고 있습니다! 먼저 오토바이 배달통에 [E]로 적재하세요`,
        3600
      );
      return;
    }

    if (shopMission.phase === 'pickup_ready') {
      const collected = delivery.collectReadyPickup(shopMission.order.id);
      if (collected) {
        audio.playChime('pickup');
        hud.showToast(
          `🛍️ [#${collected.order.orderNumber}] 픽업대 트레이에서 음식 수령 완료! 오토바이 뒤편 배달통 [E]로 적재하세요`,
          3800
        );
      }
      return;
    }

    if (hud.phoneMap.placement === 'in_hand') hud.stowPhoneToPocket();
    else hud.phoneMap.setZoomed(false);
    modalUi.openPosKeypad(shopMission.order, hasPhone);
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
    if (lobbyMission.phase === 'carrying_to_lobby') {
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
        3600
      );
    } else if (delivery.isCargoLoaded()) {
      hud.showToast('🛍️ 먼저 오토바이 뒤편 배달통에서 [E]로 해당 호수 음식을 꺼내오세요!', 3200);
    }
  }
};

const tryAcceptIncomingOffer = (): boolean => {
  if (!dispatch.activeOffer) return false;
  const isRiding = playerCtrl.state.mode === 'riding';
  // Only accept via Tab/V when player physically sees/has the phone (mounted while riding, or in hand on foot)
  const phoneVisibleToPlayer =
    (hud.phoneMap.placement === 'mounted' && isRiding) ||
    (hud.phoneMap.placement === 'in_hand' && !isRiding);
  if (!phoneVisibleToPlayer) return false;

  const accepted = dispatch.acceptCurrentOffer(delivery);
  if (!accepted) return false;

  audio.playChime('accept');
  if (accepted.type === 'SINGLE') {
    const o = accepted.orders[0];
    hud.showToast(
      `🚀 한집배달 수락! ${o.shop.emoji} ${o.shop.name} [#${o.orderNumber}] · ₩${accepted.totalFee.toLocaleString()} (제한 300초)`,
      4200
    );
  } else {
    const codes = accepted.orders.map((o) => `#${o.orderNumber}`).join(', ');
    hud.showToast(
      `🛵 알뜰배달 2건 수락! [${codes}] · ₩${accepted.totalFee.toLocaleString()} (탑박스 2슬롯 분할 · 500초)`,
      4400
    );
  }
  return true;
};

const handleRejectIncomingOffer = () => {
  const rejected = dispatch.rejectCurrentOffer();
  if (rejected) {
    audio.playDispatchExpiredSound();
    hud.showToast('신규 콜을 거절했습니다 (10초 쿨다운 후 새 콜 배정)', 3000);
  }
};

const handleTogglePhone = () => {
  if (playerCtrl.state.mode === 'knockdown' || modalUi.activeModal !== 'none') return;
  // If 20s call popup is currently open on visible phone -> Tab accepts cleanly without key conflict!
  if (tryAcceptIncomingOffer()) return;

  const isRiding = playerCtrl.state.mode === 'riding';
  const nearScooter = !playerCtrl.state.inCorridor && playerCtrl.state.canMountScooter;
  const res = hud.togglePhonePlacement(isRiding, nearScooter);

  if (res.anim === 'mount') {
    handheldPhone3D.startMountAnimation();
  } else if (res.anim === 'unmount') {
    scooterMesh.setPhoneMounted(false);
    handheldPhone3D.startUnmountAnimation();
  }
  hud.showToast(res.message, 2600);
};

const handleTogglePhoneZoom = () => {
  if (playerCtrl.state.mode === 'knockdown' || modalUi.activeModal !== 'none') return;
  // If 20s call popup is currently open on visible phone -> V accepts cleanly without key conflict!
  if (tryAcceptIncomingOffer()) return;

  const res = hud.togglePhoneZoom(playerCtrl.state.mode === 'riding');
  hud.showToast(res.message, 2400);
};

const handleCycleWeather = () => {
  const next = weather.cycleMode();
  world.setWeather(next);
  delivery.setWeatherRaining(next === 'rain');
  if (next === 'rain' && !scooterPhysics.state.headlights) {
    scooterPhysics.state.headlights = true;
  }
  const msg =
    next === 'rain'
      ? '🌧️ 비(우천) 모드! 빗길 맨홀·횡단보도 슬립 주의 · 신규 콜 우천 할증 +₩1,500!'
      : next === 'cloudy'
        ? '☁️ 흐림 모드 (조명 톤 다운)'
        : '☀️ 맑음 모드 (건조 노면)';
  hud.showToast(msg, 3800);
};

const hud = new Hud(
  {
    onAcceptOrder: (orderId) => {
      audio.ensureStarted();
      const order = delivery.acceptOrder(orderId);
      if (order) {
        audio.playChime('accept');
        const rainNote = order.rainBonus > 0 ? ` · 🌧️ 우천할증 +₩${order.rainBonus.toLocaleString()}` : '';
        hud.showToast(
          `${order.shop.emoji} ${order.shop.name} [#${order.orderNumber}] 수락! (${delivery.activeMissions.length}/${MAX_CONCURRENT_ORDERS}건${rainNote})`,
          3400
        );
      } else if (!delivery.canAcceptMoreOrders()) {
        hud.showToast(`최대 ${MAX_CONCURRENT_ORDERS}건까지 동시 묶음 배달이 가능합니다!`, 2600);
      }
    },
    onAcceptDispatchOffer: () => {
      audio.ensureStarted();
      tryAcceptIncomingOffer();
    },
    onRejectDispatchOffer: handleRejectIncomingOffer,
    onRefreshOrders: () => {
      delivery.refreshAvailableOrders();
      hud.showToast(
        delivery.isWeatherRaining
          ? '🌧️ 우천 할증(+₩1,500) 신규 배달 콜을 새로고침했습니다'
          : '신규 배달 콜을 새로고침했습니다'
      );
    },
    onCancelMission: (orderId) => {
      const removed = delivery.cancelMission(orderId);
      if (removed) {
        world.setLobbyDoorOpen(null);
        hud.showToast(`[#${removed.order.orderNumber}] 배달 주문을 취소했습니다`);
      }
    },
    onSelectMission: (missionId) => {
      delivery.setSelectedMission(missionId);
      if (missionId === null) {
        hud.showToast('🧭 자동 최적 추천 동선 안내로 전환했습니다', 2400);
      } else {
        const m = delivery.getMissionById(missionId);
        if (m) {
          hud.showToast(`🧭 [#${m.order.orderNumber}] 경로를 우선 안내합니다`, 2400);
        }
      }
    },
    onOpenDailyReport: () => {
      hud.phoneMap.setZoomed(false);
      modalUi.openDailyReportModal(delivery.getDailyLedger());
    },
    onInteractMission: handleContextInteract,
    onTogglePhone: handleTogglePhone,
    onToggleZoom: handleTogglePhoneZoom,
  },
  handleCycleWeather
);

// 3D Scooter, 3D Right-Hand Smartphone, 3D Left-Hand Takeout Food Bag!
const scooterMesh = new ScooterMesh(scene, hud.phoneMap.screenTexture);
const handheldPhone3D = new HandheldPhone3D(camera, hud.phoneMap.screenTexture);
const handheldFoodBag3D = new HandheldFoodBag3D(camera);

handheldPhone3D.setOnMountClick((mounting) => {
  audio.playPhoneMountClick(mounting);
});

// Click-to-zoom raycast on the 3D phone (in hand or on scooter mount)
const raycaster = new THREE.Raycaster();
const clickNdc = new THREE.Vector2();
let downX = 0;
let downY = 0;

renderer.domElement.addEventListener('pointerdown', (e) => {
  downX = e.clientX;
  downY = e.clientY;
});

renderer.domElement.addEventListener('pointerup', (e) => {
  if (
    e.button !== 0 ||
    modalUi.activeModal !== 'none' ||
    hud.phoneMap.placement === 'pocket' ||
    hud.phoneMap.isZoomed
  ) {
    return;
  }
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;

  clickNdc.x = (e.clientX / window.innerWidth) * 2 - 1;
  clickNdc.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(clickNdc, camera);

  const targets: THREE.Object3D[] = [];
  if (hud.phoneMap.placement === 'in_hand') targets.push(handheldPhone3D.hitMesh);
  if (hud.phoneMap.placement === 'mounted' && playerCtrl.state.mode === 'riding') {
    targets.push(scooterMesh.mountedPhoneHitMesh);
  }

  if (targets.length > 0 && raycaster.intersectObjects(targets, false).length > 0) {
    handleTogglePhoneZoom();
  }
});

// Wire lowside / wet slip / car crash -> rider ejection + crash sound + food damage across all loaded slots!
scooterPhysics.setOnCrash((crashSide, impactSpeed, cause) => {
  playerCtrl.ejectFromScooter(scooterPhysics.state, crashSide, impactSpeed);
  handheldPhone3D.cancelMountAnimation();
  hud.phoneMap.setZoomed(false);
  if (hud.phoneMap.placement === 'in_hand') {
    hud.stowPhoneToPocket();
  }
  audio.playCrashSound();
  const isRainSlip = cause === 'rain_manhole' || cause === 'rain_paint' || cause === 'rain_corner';
  const { damagedCount, loss } = delivery.applyCrashDamage(isRainSlip);

  const causePrefix =
    cause === 'rain_manhole'
      ? '🌧️💥 빗길 금속 맨홀 뚜껑에서 미끄러져 전도!'
      : cause === 'rain_paint'
        ? '🌧️💥 빗길 횡단보도 흰색 페인트선에서 슬립 전도!'
        : cause === 'rain_corner'
          ? '🌧️💥 빗길 노면 접지력 상실로 전도!'
          : '💥 전도 사고!';

  const dmgStage = scooterPhysics.state.damageLevel;
  const bikeDmgNote = ` (차량 ${dmgStage}단계 파손: 가속력 -${dmgStage * 10}% · 미러 흔들림)`;
  if (damagedCount > 0) {
    hud.showToast(
      `${causePrefix} 배달통 음식 ${damagedCount}건 파손 (-${loss}%)${bikeDmgNote}`,
      4600
    );
  } else {
    hud.showToast(`${causePrefix}${bikeDmgNote}`, 4000);
  }
});

// Input state
const pressed = new Set<string>();

window.addEventListener('pointerdown', () => audio.ensureStarted(), { once: true });

window.addEventListener('keydown', (e) => {
  audio.ensureStarted();

  // Let active modal (POS / PIN / Cargo / Camera shutter / Settlement / Transition) handle keys first!
  if (modalUi.handleKeyDown(e)) {
    return;
  }

  const code = e.code;
  if (
    code === 'Space' ||
    code === 'Tab' ||
    code === 'ArrowUp' ||
    code === 'ArrowDown' ||
    code === 'ArrowLeft' ||
    code === 'ArrowRight' ||
    code === 'F1'
  ) {
    e.preventDefault();
  }

  const firstPress = !pressed.has(code);
  pressed.add(code);
  if (!firstPress) return;

  switch (code) {
    case 'KeyF': {
      const res = playerCtrl.tryToggleMount(
        scooterPhysics.state,
        (mounted) => scooterPhysics.setMounted(mounted),
        world.obstacles,
        delivery.isCarryingFood()
      );
      if (res.changed) {
        const nowRiding = playerCtrl.state.mode === 'riding';
        if (nowRiding) {
          if (hud.phoneMap.placement === 'in_hand') {
            hud.stowPhoneToPocket();
          }
          hud.phoneMap.setZoomed(false);
        } else {
          // Physical phone possession: if mounted on scooter, it stays on the scooter when dismounting!
          hud.phoneMap.setZoomed(false);
        }
        audio.playMountSound(nowRiding);
        camController.syncYawOnModeChange(playerCtrl.state, scooterPhysics.state);

        if (!nowRiding && hud.phoneMap.placement === 'mounted') {
          hud.showToast(
            '하차 완료 (📱 휴대폰이 오토바이 거치대에 남아있습니다 — [Tab]으로 챙기세요)',
            3400
          );
          break;
        }
      }
      hud.showToast(res.message);
      break;
    }
    case 'KeyE': {
      if (playerCtrl.state.mode === 'on_foot') {
        handleContextInteract();
      } else if (playerCtrl.state.mode === 'riding') {
        const on = scooterPhysics.toggleRightBlinker();
        hud.showToast(on ? '▶ 우측 깜빡이 ON (회전 후 자동 해제)' : '우측 깜빡이 OFF', 1600);
      }
      break;
    }
    case 'KeyQ': {
      if (playerCtrl.state.mode === 'riding') {
        const on = scooterPhysics.toggleLeftBlinker();
        hud.showToast(on ? '◀ 좌측 깜빡이 ON (회전 후 자동 해제)' : '좌측 깜빡이 OFF', 1600);
      }
      break;
    }
    case 'KeyX': {
      if (playerCtrl.state.mode === 'riding') {
        const on = scooterPhysics.toggleHazard();
        hud.showToast(on ? '⚠ 비상등 ON' : '비상등 OFF', 1600);
      }
      break;
    }
    case 'KeyL': {
      scooterPhysics.state.headlights = !scooterPhysics.state.headlights;
      hud.showToast(scooterPhysics.state.headlights ? '헤드라이트 ON' : '헤드라이트 OFF');
      break;
    }
    case 'KeyN': {
      const night = world.toggleDayNight();
      if (night && !scooterPhysics.state.headlights) {
        scooterPhysics.state.headlights = true;
      }
      lastRenderedRouteRef = null;
      hud.showToast(night ? '야간 모드 (라이트 자동 ON)' : '주간 모드');
      break;
    }
    case 'KeyU': {
      handleCycleWeather();
      break;
    }
    case 'KeyM': {
      const muted = audio.toggleMute();
      hud.showToast(muted ? '사운드 음소거' : '사운드 켜짐');
      break;
    }
    case 'KeyH': {
      if (playerCtrl.state.mode === 'riding') {
        audio.setHorn(true);
      }
      break;
    }
    case 'KeyR': {
      camController.resetLook();
      break;
    }
    case 'Backspace': {
      if (playerCtrl.state.inCorridor) {
        const sp = corridorRoom.elevatorSpawn;
        playerCtrl.teleportTo(sp.x, sp.y, sp.z, sp.heading, true);
        camController.onFootYaw = sp.heading;
      } else {
        scooterPhysics.reset();
        playerCtrl.reset();
        camController.onFootYaw = Math.PI - 0.65;
      }
      hud.stowPhoneToPocket();
      scooterMesh.setPhoneMounted(false);
      camController.resetLook();
      delivery.invalidateNavCache();
      hud.showToast('위치 초기화 완료');
      break;
    }
    case 'Tab': {
      handleTogglePhone();
      break;
    }
    case 'KeyV': {
      handleTogglePhoneZoom();
      break;
    }
    case 'Escape': {
      if (hud.phoneMap.isZoomed) {
        handleTogglePhoneZoom();
      }
      break;
    }
    case 'F1': {
      hud.toggleHelp();
      break;
    }
  }
});

window.addEventListener('keyup', (e) => {
  pressed.delete(e.code);
  if (e.code === 'KeyH') {
    audio.setHorn(false);
  }
});

window.addEventListener('blur', () => {
  pressed.clear();
  audio.setHorn(false);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  roadNavLine3D.setResolution(window.innerWidth, window.innerHeight);
});

hud.showToast('[Tab] 휴대폰 꺼내기 → [V] 확대에서 최대 3건 묶음 콜 수락 & A* 내비 안내 시작!', 5200);

let lastTime = performance.now();
let elapsed = 0;
let lastRenderedRouteRef: RoutePoint[] | null = null;

function animate(now: number): void {
  requestAnimationFrame(animate);

  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  elapsed += dt;

  const inCorridor = playerCtrl.state.inCorridor;
  const isRiding = playerCtrl.state.mode === 'riding';
  const movementBlocked = modalUi.isBlockingMovement();

  if (!inCorridor) {
    world.updateLobbyDoors(dt);
    traffic.step(
      dt,
      elapsed,
      world.isNight,
      playerCtrl.state.x,
      playerCtrl.state.z,
      scooterPhysics.state.speed,
      isRiding,
      () => {
        const fine = delivery.applyFine(1000);
        hud.showToast(
          fine > 0
            ? `🚨 신호 위반! 빨간불 교차로 통과 (-₩${fine.toLocaleString()})`
            : '🚨 신호 위반! 교차로 빨간불에 정지하세요!',
          3200
        );
      },
      (carX, carZ) => {
        const relX = carX - scooterPhysics.state.x;
        const relZ = carZ - scooterPhysics.state.z;
        const leftX = Math.cos(scooterPhysics.state.heading);
        const leftZ = -Math.sin(scooterPhysics.state.heading);
        const hitSide = relX * leftX + relZ * leftZ >= 0 ? 1 : -1;
        scooterPhysics.triggerExternalCrash(hitSide);
      }
    );
  } else {
    corridorRoom.updateVisual(elapsed, dt);
  }

  const allObstacles = inCorridor
    ? []
    : [...world.obstacles, ...traffic.getCarObstacleBoxes()];

  const roadCondition = inCorridor
    ? { isRaining: false, surface: 'none' as const }
    : {
        isRaining: weather.isRaining,
        surface: world.getSlipSurfaceAt(scooterPhysics.state.x, scooterPhysics.state.z),
      };

  if (isRiding && !movementBlocked) {
    const scooterInput: ScooterInput = {
      throttle: pressed.has('KeyW') || pressed.has('ArrowUp'),
      brake: pressed.has('KeyS') || pressed.has('ArrowDown'),
      steerLeft: pressed.has('KeyA') || pressed.has('ArrowLeft'),
      steerRight: pressed.has('KeyD') || pressed.has('ArrowRight'),
      handbrake: pressed.has('Space'),
    };
    scooterPhysics.step(dt, scooterInput, allObstacles, roadCondition);
    playerCtrl.step(
      dt,
      { forward: 0, strafe: 0, sprint: false, jump: false },
      camController.onFootYaw,
      scooterPhysics.state,
      allObstacles
    );
  } else {
    if (!inCorridor) {
      scooterPhysics.step(dt, null, allObstacles, roadCondition);
    }

    if (playerCtrl.state.mode === 'on_foot' && !movementBlocked) {
      const turnDir =
        (pressed.has('ArrowLeft') ? 1 : 0) - (pressed.has('ArrowRight') ? 1 : 0);
      if (turnDir !== 0) {
        camController.rotateOnFootYaw(turnDir * 2.1 * dt);
      }
    }

    const footInput: OnFootInput = movementBlocked
      ? { forward: 0, strafe: 0, sprint: false, jump: false }
      : {
          forward:
            (pressed.has('KeyW') || pressed.has('ArrowUp') ? 1 : 0) -
            (pressed.has('KeyS') || pressed.has('ArrowDown') ? 1 : 0),
          strafe: (pressed.has('KeyA') ? 1 : 0) - (pressed.has('KeyD') ? 1 : 0),
          sprint: pressed.has('ShiftLeft') || pressed.has('ShiftRight'),
          jump: pressed.has('Space') && modalUi.activeModal !== 'camera',
        };
    playerCtrl.step(
      dt,
      footInput,
      camController.onFootYaw,
      scooterPhysics.state,
      allObstacles,
      (x, z) => corridorRoom.clampPlayerInside(x, z)
    );
  }

  // Step active mission delivery countdowns, peak-time cooking timers, & 20s dispatch state machine
  delivery.stepTimers(dt, (readyMission) => {
    audio.playFoodReadyDingDong();
    hud.showToast(
      `🔔 ${readyMission.order.shop.emoji} ${readyMission.order.shop.name} [#${readyMission.order.orderNumber}]: "음식이 준비되었습니다!" 픽업대 트레이에서 [E]로 수령하세요`,
      4600
    );
  });
  dispatch.step(dt, delivery, inCorridor, modalUi.isBlockingMovement());

  // Compute bundled multi-stop A* Navigation Plan (internally cached & throttled)
  const navPlan = delivery.getNavigationPlan(
    playerCtrl.state.x,
    playerCtrl.state.z,
    playerCtrl.state.heading,
    scooterPhysics.state.x,
    scooterPhysics.state.z,
    inCorridor,
    elapsed,
    roadNavigator
  );

  // Outdoor 3D Beacon + Shop Pickup Trays + Fluorescent Neon-Green A* Road Nav Line + 3-Slot Scooter Visuals
  if (!inCorridor) {
    world.updateBeacon(navPlan.target, navPlan.isPickupTarget, elapsed);

    const cookingShopIds = new Set<string>();
    const readyShopIds = new Set<string>();
    for (const m of delivery.activeMissions) {
      if (m.phase === 'cooking_wait') cookingShopIds.add(m.order.shop.id);
      else if (m.phase === 'pickup_ready') readyShopIds.add(m.order.shop.id);
    }
    world.syncShopPickupTrays(cookingShopIds, readyShopIds, elapsed);

    const routeFor3D = navPlan.isCargoBoxTarget ? [] : navPlan.route;
    if (routeFor3D !== lastRenderedRouteRef) {
      lastRenderedRouteRef = routeFor3D;
      roadNavLine3D.setPath(routeFor3D, world.isNight);
    }
    roadNavLine3D.updateAnimation(dt, elapsed);

    scooterMesh.sync(scooterPhysics.state, elapsed, dt);
    scooterMesh.setCargoSlotsVisual(delivery.getCargoSlotOccupiedFlags());
    scooterMesh.setPhoneMounted(
      hud.phoneMap.placement === 'mounted' &&
        !hud.phoneMap.isZoomed &&
        !handheldPhone3D.isHoldingPhoneDuringMountAnim()
    );
  }

  // 1st-person 3D Right Hand Smartphone & 3D Left Hand Food Bag!
  handheldPhone3D.update(
    hud.phoneMap.placement === 'in_hand' &&
      !hud.phoneMap.isZoomed &&
      modalUi.activeModal === 'none',
    playerCtrl.state,
    dt,
    elapsed
  );
  const showHandBag =
    (delivery.isCarryingFood() ||
      (delivery.getCorridorMission()?.phase === 'meet_waiting' && !npcTookFoodBag)) &&
    !isRiding &&
    modalUi.activeModal !== 'transition';
  handheldFoodBag3D.update(showHandBag, playerCtrl.state, dt, elapsed);

  playerMesh.sync(
    playerCtrl.state,
    scooterMesh.riderMountPoint,
    scooterPhysics.state.steerAngle,
    true
  );

  camController.update(camera, playerCtrl.state, scooterPhysics.state, scooterMesh, dt);

  // Live viewfinder framing validation (Bounding Box + vector.project(camera)) when in PHOTO_DOOR camera mode!
  if (inCorridor && modalUi.activeModal === 'camera') {
    const { foodBagMesh, doorPlateMesh } = corridorRoom.getProofTargets();
    const proofStatus = validateDeliveryPhotoFrame(camera, foodBagMesh, doorPlateMesh);
    modalUi.updateCameraProofStatus(proofStatus);
  }

  // Weather local rain particles (InstancedMesh), wet asphalt shader, & rain audio (instantly muted indoors!)
  weather.update(dt, camera.position.x, camera.position.y, camera.position.z, inCorridor, world.isNight);
  if (!inCorridor) {
    world.updateWeatherVisuals(weather.rainIntensity, elapsed);
  }
  audio.updateWeatherAudio(weather.rainIntensity, inCorridor);
  audio.update(scooterPhysics.state, elapsed);

  hud.update(
    playerCtrl.state,
    scooterPhysics.state,
    delivery,
    dispatch.activeOffer,
    navPlan,
    traffic.signalState,
    world.isNight,
    weather.mode,
    audio.muted,
    elapsed,
    world.mapInfo,
    {
      nearCargoBox: isPlayerNearCargoBox(),
      nearGasPump: !inCorridor && world.isPlayerNearGasPump(playerCtrl.state.x, playerCtrl.state.z),
      scooterOnGasPad:
        !inCorridor && world.isScooterOnGasPad(scooterPhysics.state.x, scooterPhysics.state.z),
      nearRepairShop:
        !inCorridor && world.isPlayerNearRepairShop(playerCtrl.state.x, playerCtrl.state.z),
      scooterOnRepairPad:
        !inCorridor && world.isScooterOnRepairPad(scooterPhysics.state.x, scooterPhysics.state.z),
      nearCorridorTargetDoor:
        inCorridor && corridorRoom.isNearTargetDoor(playerCtrl.state.x, playerCtrl.state.z),
      nearCorridorElevator:
        inCorridor && corridorRoom.isNearElevator(playerCtrl.state.x, playerCtrl.state.z),
      modalOpen: modalUi.activeModal !== 'none',
    }
  );

  // Only render scooter mirrors when outdoors & riding
  if (!inCorridor && isRiding) {
    scooterMesh.renderMirrors(renderer, scene, scooterPhysics.state);
  }

  void CORRIDOR_ORIGIN_Y;
  renderer.render(scene, camera);
}

requestAnimationFrame(animate);
