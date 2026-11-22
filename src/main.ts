import * as THREE from 'three';
import './style.css';
import { CityWorld } from './world/CityWorld';
import { TrafficSystem } from './world/TrafficSystem';
import { CORRIDOR_ORIGIN_Y, CorridorRoom } from './world/CorridorRoom';
import { ScooterInput, ScooterPhysics } from './vehicle/ScooterPhysics';
import { ScooterMesh } from './vehicle/ScooterMesh';
import { OnFootInput, PlayerController } from './player/PlayerController';
import { PlayerMesh } from './player/PlayerMesh';
import { HandheldPhone3D } from './player/HandheldPhone3D';
import { HandheldFoodBag3D } from './player/HandheldFoodBag3D';
import { CameraController } from './camera/CameraController';
import { GameAudio } from './audio/GameAudio';
import { DeliveryManager } from './delivery/DeliveryManager';
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
const traffic = new TrafficSystem(scene);
const corridorRoom = new CorridorRoom(scene);
const delivery = new DeliveryManager(world.locations);
const scooterPhysics = new ScooterPhysics();
const playerCtrl = new PlayerController();
const playerMesh = new PlayerMesh(scene);
const camController = new CameraController(renderer.domElement);
const audio = new GameAudio();

const tmpCargoPos = new THREE.Vector3();

const isPlayerNearCargoBox = (): boolean => {
  if (playerCtrl.state.inCorridor || playerCtrl.state.mode !== 'on_foot') return false;
  scooterMesh.getCargoBoxWorldPosition(tmpCargoPos);
  return Math.hypot(playerCtrl.state.x - tmpCargoPos.x, playerCtrl.state.z - tmpCargoPos.z) <= 2.3;
};

const enterElevatorToCorridor = () => {
  const m = delivery.activeMission;
  if (!m) return;
  audio.playElevatorDing();
  hud.stowPhoneToPocket();
  modalUi.playElevatorTransition(
    `🛗 ${m.order.customer.name} ${m.order.unitNumber}층으로 이동 중...`,
    () => {
      // Midpoint while screen is completely black: occlude entire outdoor world!
      world.setOutdoorVisible(false);
      traffic.root.visible = false;
      scooterMesh.root.visible = false;

      corridorRoom.configureForUnit(m.order.unitNumber);
      corridorRoom.root.visible = true;

      delivery.enterCorridor();
      const sp = corridorRoom.elevatorSpawn;
      playerCtrl.teleportTo(sp.x, sp.y, sp.z, sp.heading, true);
      camController.onFootYaw = sp.heading;
      camController.resetLook();
    },
    () => {
      audio.playElevatorDing();
      hud.showToast(
        `🏢 ${m.order.unitNumber} 문 앞 발매트에서 [E]를 눌러 음식을 내려놓으세요`,
        3600
      );
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
      hud.showToast('1층 복귀 완료! [Tab]으로 휴대폰을 꺼내 다음 배달 콜을 확인하세요', 3600);
    }
  );
};

const handleTakeDeliveryPhoto = () => {
  if (!delivery.activeMission || delivery.activeMission.phase !== 'photo_mode') return;
  audio.playCameraShutter();
  modalUi.triggerCameraFlash();

  // Render clean 3D corridor frame right before capturing proof photo thumbnail
  renderer.render(scene, camera);
  const photoDataUrl = renderer.domElement.toDataURL('image/jpeg', 0.85);

  const result = delivery.completePhotoSettlement();
  if (result) {
    audio.playChime('complete');
    window.setTimeout(() => {
      modalUi.showSettlement(result, photoDataUrl);
    }, 220);
  }
};

const modalUi = new ModalUi({
  onPosSuccess: () => {
    if (delivery.completePosPickup()) {
      audio.playChime('pickup');
      hud.showToast(
        '🛍️ 픽업 완료! 음식을 손에 들었습니다 → 오토바이 뒤편 배달통에서 [E]로 적재하세요',
        3800
      );
    }
  },
  onPinSuccess: () => {
    if (delivery.unlockLobbyDoor() && delivery.activeMission) {
      audio.playChime('accept');
      world.setLobbyDoorOpen(delivery.activeMission.order.customer.id);
      hud.showToast(
        '🔓 공동현관 문이 열렸습니다! [E]를 눌러 엘리베이터에 탑승하세요',
        3400
      );
    }
  },
  onTakePhoto: handleTakeDeliveryPhoto,
  onSettlementClose: () => {
    hud.showToast('배달 완료! 복도 엘리베이터 앞에서 [E]를 눌러 1층으로 내려가세요', 3600);
  },
  onKeypadBeep: (ok) => audio.playKeypadBeep(ok),
});

const handleContextInteract = () => {
  const m = delivery.activeMission;
  if (!m) {
    hud.showToast('진행 중인 배달이 없습니다 ([Tab] → [V]로 콜 수락)');
    return;
  }

  // Inside underground corridor
  if (playerCtrl.state.inCorridor) {
    if (m.phase === 'in_corridor') {
      if (corridorRoom.isNearTargetDoor(playerCtrl.state.x, playerCtrl.state.z)) {
        corridorRoom.placeFoodOnTargetMat();
        delivery.placeFoodAtDoor();
        hud.stowPhoneToPocket();
        audio.playCargoBoxSound();
        modalUi.openCameraViewfinder(m.order);
        hud.showToast('📸 음식을 발매트에 내려놓았습니다! [Space]로 인증 사진을 찍으세요', 3400);
      } else {
        hud.showToast(`${m.order.unitNumber} 문 앞 발매트로 가까이 가세요`);
      }
      return;
    }

    if (m.phase === 'corridor_exit') {
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

  if (m.phase === 'to_pickup' && delivery.isNearShopPickup(playerCtrl.state.x, playerCtrl.state.z)) {
    hud.stowPhoneToPocket();
    modalUi.openPosKeypad(m.order);
    return;
  }

  if (m.phase === 'carrying_to_box' && isPlayerNearCargoBox()) {
    delivery.loadFoodIntoCargoBox();
    scooterMesh.triggerCargoBoxOpen();
    audio.playCargoBoxSound();
    hud.showToast(
      `📦 배달통에 적재 완료! 이제 [F]로 탑승해 ${m.order.customer.name}으로 출발하세요`,
      3600
    );
    return;
  }

  if (m.phase === 'cargo_loaded' && isPlayerNearCargoBox()) {
    delivery.unloadFoodFromCargoBox();
    scooterMesh.triggerCargoBoxOpen();
    audio.playCargoBoxSound();
    hud.showToast(
      `🛍️ 배달통에서 음식을 꺼냈습니다! ${m.order.customer.name} 공동현관으로 이동하세요`,
      3600
    );
    return;
  }

  if (
    m.phase === 'carrying_to_lobby' &&
    delivery.isNearCustomerLobby(playerCtrl.state.x, playerCtrl.state.z)
  ) {
    hud.stowPhoneToPocket();
    modalUi.openPinKeypad(m.order);
    return;
  }

  if (
    m.phase === 'lobby_unlocked' &&
    delivery.isNearCustomerLobby(playerCtrl.state.x, playerCtrl.state.z)
  ) {
    enterElevatorToCorridor();
    return;
  }
};

const handleTogglePhone = () => {
  if (playerCtrl.state.mode === 'knockdown' || modalUi.activeModal !== 'none') return;
  const res = hud.togglePhonePlacement(playerCtrl.state.mode === 'riding');
  scooterMesh.setPhoneMounted(res.placement === 'mounted');
  hud.showToast(res.message, 2400);
};

const handleTogglePhoneZoom = () => {
  if (playerCtrl.state.mode === 'knockdown' || modalUi.activeModal !== 'none') return;
  const res = hud.togglePhoneZoom();
  hud.showToast(res.message, 2000);
};

const hud = new Hud({
  onAcceptOrder: (orderId) => {
    audio.ensureStarted();
    const order = delivery.acceptOrder(orderId);
    if (order) {
      audio.playChime('accept');
      hud.showToast(
        `${order.shop.emoji} ${order.shop.name} 콜 수락! 픽업번호 [#${order.orderNumber}]`,
        3200
      );
    }
  },
  onRefreshOrders: () => {
    delivery.refreshAvailableOrders();
    hud.showToast('신규 배달 콜을 새로고침했습니다');
  },
  onCancelMission: () => {
    delivery.cancelActiveMission();
    world.setLobbyDoorOpen(null);
    hud.showToast('진행 중인 배달을 취소했습니다');
  },
  onInteractMission: handleContextInteract,
  onTogglePhone: handleTogglePhone,
  onToggleZoom: handleTogglePhoneZoom,
});

// 3D Scooter, 3D Right-Hand Smartphone, 3D Left-Hand Takeout Food Bag!
const scooterMesh = new ScooterMesh(scene, hud.phoneMap.screenTexture);
const handheldPhone3D = new HandheldPhone3D(camera, hud.phoneMap.screenTexture);
const handheldFoodBag3D = new HandheldFoodBag3D(camera);

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
  if (hud.phoneMap.placement === 'mounted') targets.push(scooterMesh.mountedPhoneHitMesh);

  if (targets.length > 0 && raycaster.intersectObjects(targets, false).length > 0) {
    handleTogglePhoneZoom();
  }
});

// Wire lowside / car crash -> rider ejection + crash sound + food damage!
scooterPhysics.setOnCrash((crashSide, impactSpeed) => {
  playerCtrl.ejectFromScooter(scooterPhysics.state, crashSide, impactSpeed);
  hud.stowPhoneToPocket();
  scooterMesh.setPhoneMounted(false);
  audio.playCrashSound();
  const dmg = delivery.applyCrashDamage();
  if (dmg > 0) {
    hud.showToast(`💥 전도 사고! 배달통 음식이 흔들려 파손되었습니다 (-${dmg}%)`, 3800);
  } else {
    hud.showToast('💥 너무 기울어 오토바이가 미끄러졌습니다! 일으켜 세우세요', 3400);
  }
});

// Input state
const pressed = new Set<string>();

window.addEventListener('pointerdown', () => audio.ensureStarted(), { once: true });

window.addEventListener('keydown', (e) => {
  audio.ensureStarted();

  // Let active modal (POS / PIN / Camera shutter / Settlement / Transition) handle keys first!
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
        hud.stowPhoneToPocket();
        scooterMesh.setPhoneMounted(false);
        audio.playMountSound(playerCtrl.state.mode === 'riding');
        camController.syncYawOnModeChange(playerCtrl.state, scooterPhysics.state);
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
      hud.showToast(night ? '야간 모드 (라이트 자동 ON)' : '주간 모드');
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
});

hud.showToast('[Tab] 휴대폰 꺼내기 → [V] 확대로 콜 수락 후 야외 픽업대로 이동하세요!', 4800);

let lastTime = performance.now();
let elapsed = 0;

function animate(now: number): void {
  requestAnimationFrame(animate);

  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  elapsed += dt;

  const inCorridor = playerCtrl.state.inCorridor;
  const isRiding = playerCtrl.state.mode === 'riding';
  const movementBlocked = modalUi.isBlockingMovement();

  // Only simulate outdoor traffic & lobby doors when outdoors (full CPU/GPU occlusion inside corridor!)
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
    corridorRoom.updateVisual(elapsed);
  }

  const allObstacles = inCorridor
    ? []
    : [...world.obstacles, ...traffic.getCarObstacleBoxes()];

  if (isRiding && !movementBlocked) {
    const scooterInput: ScooterInput = {
      throttle: pressed.has('KeyW') || pressed.has('ArrowUp'),
      brake: pressed.has('KeyS') || pressed.has('ArrowDown'),
      steerLeft: pressed.has('KeyA') || pressed.has('ArrowLeft'),
      steerRight: pressed.has('KeyD') || pressed.has('ArrowRight'),
      handbrake: pressed.has('Space'),
    };
    scooterPhysics.step(dt, scooterInput, allObstacles);
    playerCtrl.step(
      dt,
      { forward: 0, strafe: 0, sprint: false, jump: false },
      camController.onFootYaw,
      scooterPhysics.state,
      allObstacles
    );
  } else {
    if (!inCorridor) {
      scooterPhysics.step(dt, null, allObstacles);
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

  // Outdoor 3D beacon (only visible outdoors for pickup / customer lobby)
  if (!inCorridor) {
    const activeTarget = delivery.getCurrentOutdoorTarget();
    const isPickup = delivery.activeMission?.phase === 'to_pickup';
    world.updateBeacon(activeTarget, isPickup, elapsed);
    scooterMesh.sync(scooterPhysics.state, elapsed, dt);
    scooterMesh.setCargoLoadedVisual(delivery.isCargoLoaded());
    scooterMesh.setPhoneMounted(
      hud.phoneMap.placement === 'mounted' && !hud.phoneMap.isZoomed
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
  handheldFoodBag3D.update(
    delivery.isCarryingFood() && !isRiding && modalUi.activeModal !== 'transition',
    playerCtrl.state,
    dt,
    elapsed
  );

  // Always 1st-person: hide player's own body mesh
  playerMesh.sync(
    playerCtrl.state,
    scooterMesh.riderMountPoint,
    scooterPhysics.state.steerAngle,
    true
  );

  camController.update(camera, playerCtrl.state, scooterPhysics.state, scooterMesh, dt);
  audio.update(scooterPhysics.state, elapsed);

  hud.update(
    playerCtrl.state,
    scooterPhysics.state,
    delivery,
    traffic.signalState,
    world.isNight,
    audio.muted,
    elapsed,
    world.mapInfo,
    {
      nearCargoBox: isPlayerNearCargoBox(),
      nearCorridorTargetDoor:
        inCorridor && corridorRoom.isNearTargetDoor(playerCtrl.state.x, playerCtrl.state.z),
      nearCorridorElevator:
        inCorridor && corridorRoom.isNearElevator(playerCtrl.state.x, playerCtrl.state.z),
      modalOpen: modalUi.activeModal !== 'none',
    }
  );

  // Only render scooter mirrors when outdoors & riding (zero wasted GPU passes inside corridor!)
  if (!inCorridor && isRiding) {
    scooterMesh.renderMirrors(renderer, scene, scooterPhysics.state);
  }

  // Safety guard: keep corridor Y aligned if camera ever inspects
  void CORRIDOR_ORIGIN_Y;
  renderer.render(scene, camera);
}

requestAnimationFrame(animate);
