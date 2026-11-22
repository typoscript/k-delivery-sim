import * as THREE from 'three';
import './style.css';
import { CityWorld } from './world/CityWorld';
import { TrafficSystem } from './world/TrafficSystem';
import { ScooterInput, ScooterPhysics } from './vehicle/ScooterPhysics';
import { ScooterMesh } from './vehicle/ScooterMesh';
import { OnFootInput, PlayerController } from './player/PlayerController';
import { PlayerMesh } from './player/PlayerMesh';
import { CameraController } from './camera/CameraController';
import { GameAudio } from './audio/GameAudio';
import { DeliveryManager } from './delivery/DeliveryManager';
import { Hud } from './ui/Hud';

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
const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.12, 650);

// Core modules
const world = new CityWorld(scene);
const traffic = new TrafficSystem(scene);
const delivery = new DeliveryManager(world.locations);
const scooterPhysics = new ScooterPhysics();
const scooterMesh = new ScooterMesh(scene);
const playerCtrl = new PlayerController();
const playerMesh = new PlayerMesh(scene);
const camController = new CameraController(renderer.domElement);
const audio = new GameAudio();

const handleDeliveryInteract = () => {
  const res = delivery.tryInteract(
    playerCtrl.state.x,
    playerCtrl.state.z,
    playerCtrl.state.mode === 'riding'
  );
  if (res.ok && res.event) {
    audio.playChime(res.event);
  }
  hud.showToast(res.message, 3200);
};

const handleTogglePhone = () => {
  if (playerCtrl.state.mode === 'knockdown') return;
  const res = hud.togglePhonePlacement(playerCtrl.state.mode === 'riding');
  scooterMesh.setPhoneMounted(res.placement === 'mounted');
  hud.showToast(res.message, 2200);
};

const hud = new Hud({
  onAcceptOrder: (orderId) => {
    audio.ensureStarted();
    const order = delivery.acceptOrder(orderId);
    if (order) {
      audio.playChime('accept');
      hud.showToast(
        `${order.shop.emoji} ${order.shop.name} 콜 수락! 픽업지로 이동하세요`,
        3000
      );
    }
  },
  onRefreshOrders: () => {
    delivery.refreshAvailableOrders();
    hud.showToast('신규 배달 콜을 새로고침했습니다');
  },
  onCancelMission: () => {
    delivery.cancelActiveMission();
    hud.showToast('진행 중인 배달을 취소했습니다');
  },
  onInteractMission: handleDeliveryInteract,
  onTogglePhone: handleTogglePhone,
});

// Wire lowside cornering crash -> rider ejection + crash sound + food damage!
scooterPhysics.setOnCrash((crashSide, impactSpeed) => {
  playerCtrl.ejectFromScooter(scooterPhysics.state, crashSide, impactSpeed);
  hud.stowPhoneToPocket();
  scooterMesh.setPhoneMounted(false);
  audio.playCrashSound();
  const dmg = delivery.applyCrashDamage();
  if (dmg > 0) {
    hud.showToast(`💥 코너링 과속 전도! 음식이 흔들려 파손되었습니다 (-${dmg}%)`, 3800);
  } else {
    hud.showToast('💥 너무 기울어 오토바이가 미끄러졌습니다! 일으켜 세우세요', 3400);
  }
});

// Input state
const pressed = new Set<string>();

window.addEventListener('pointerdown', () => audio.ensureStarted(), { once: true });

window.addEventListener('keydown', (e) => {
  audio.ensureStarted();

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
        world.obstacles
      );
      if (res.changed) {
        // Tuck phone into pocket when getting on/off so Tab cleanly pulls it out or mounts it
        hud.stowPhoneToPocket();
        scooterMesh.setPhoneMounted(false);
        audio.playMountSound(playerCtrl.state.mode === 'riding');
        camController.syncYawOnModeChange(playerCtrl.state, scooterPhysics.state);
      }
      hud.showToast(res.message);
      break;
    }
    case 'KeyE': {
      // On foot: pickup / dropoff delivery; Riding: right blinker
      if (playerCtrl.state.mode === 'on_foot') {
        handleDeliveryInteract();
      } else if (playerCtrl.state.mode === 'riding') {
        scooterPhysics.state.hazard = false;
        scooterPhysics.state.rightBlinker = !scooterPhysics.state.rightBlinker;
        if (scooterPhysics.state.rightBlinker) scooterPhysics.state.leftBlinker = false;
      }
      break;
    }
    case 'KeyQ': {
      if (playerCtrl.state.mode === 'riding') {
        scooterPhysics.state.hazard = false;
        scooterPhysics.state.leftBlinker = !scooterPhysics.state.leftBlinker;
        if (scooterPhysics.state.leftBlinker) scooterPhysics.state.rightBlinker = false;
      }
      break;
    }
    case 'KeyX': {
      if (playerCtrl.state.mode === 'riding') {
        scooterPhysics.state.hazard = !scooterPhysics.state.hazard;
        if (scooterPhysics.state.hazard) {
          scooterPhysics.state.leftBlinker = false;
          scooterPhysics.state.rightBlinker = false;
        }
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
      scooterPhysics.reset();
      playerCtrl.reset();
      hud.stowPhoneToPocket();
      scooterMesh.setPhoneMounted(false);
      camController.onFootYaw = Math.PI - 0.65;
      camController.resetLook();
      hud.showToast('캐릭터 및 오토바이 위치 초기화');
      break;
    }
    case 'Tab': {
      handleTogglePhone();
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

hud.showToast('[Tab]으로 주머니에서 휴대폰을 꺼내 배달 콜을 수락하세요!', 4500);

let lastTime = performance.now();
let elapsed = 0;

function animate(now: number): void {
  requestAnimationFrame(animate);

  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  elapsed += dt;

  const isRiding = playerCtrl.state.mode === 'riding';

  // Step AI traffic & intersection signals
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

  // Combine static buildings with live AI vehicles for collision checks
  const allObstacles = [...world.obstacles, ...traffic.getCarObstacleBoxes()];

  if (isRiding) {
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
    // Allow ArrowLeft/ArrowRight to turn 1st-person head smoothly while walking
    if (playerCtrl.state.mode === 'on_foot') {
      const turnDir =
        (pressed.has('ArrowLeft') ? 1 : 0) - (pressed.has('ArrowRight') ? 1 : 0);
      if (turnDir !== 0) {
        camController.rotateOnFootYaw(turnDir * 2.1 * dt);
      }
    }

    scooterPhysics.step(dt, null, allObstacles);
    const footInput: OnFootInput = {
      forward:
        (pressed.has('KeyW') || pressed.has('ArrowUp') ? 1 : 0) -
        (pressed.has('KeyS') || pressed.has('ArrowDown') ? 1 : 0),
      strafe: (pressed.has('KeyA') ? 1 : 0) - (pressed.has('KeyD') ? 1 : 0),
      sprint: pressed.has('ShiftLeft') || pressed.has('ShiftRight'),
      jump: pressed.has('Space'),
    };
    playerCtrl.step(dt, footInput, camController.onFootYaw, scooterPhysics.state, allObstacles);
  }

  // Update 3D beacon for active pickup or dropoff target
  const activeTarget = delivery.getCurrentTarget();
  const isPickup = delivery.activeMission?.phase === 'pickup';
  world.updateBeacon(activeTarget, isPickup, elapsed);

  scooterMesh.sync(scooterPhysics.state, elapsed);
  // Always 1st-person: hide player's own mesh so helmet/body never clips camera
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
    world.mapInfo
  );

  renderer.render(scene, camera);
}

requestAnimationFrame(animate);
