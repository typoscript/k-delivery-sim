import * as THREE from 'three';
import { NO_MIRROR_LAYER } from './world/renderLayers';
import './style.css';
import { CityWorld } from './world/CityWorld';
import { TrafficSystem } from './world/TrafficSystem';
import { CorridorRoom } from './world/CorridorRoom';
import { RoadNavigator } from './world/RoadNavigator';
import { WeatherManager } from './world/WeatherManager';
import { PedestrianManager } from './world/PedestrianManager';
import { RoadHazardManager } from './world/RoadHazardManager';
import { ScooterPhysics } from './vehicle/ScooterPhysics';
import { ScooterMesh } from './vehicle/ScooterMesh';
import {
  SCOOTER_MODELS,
  SCOOTER_PAINTS,
  loadBikeGarage,
  saveBikeGarage,
} from './vehicle/ScooterModels';
import { PlayerController } from './player/PlayerController';
import { PlayerMesh } from './player/PlayerMesh';
import { HandheldPhone3D } from './player/HandheldPhone3D';
import { HandheldFoodBag3D } from './player/HandheldFoodBag3D';
import { CameraController } from './camera/CameraController';
import { validateDeliveryPhotoFrame } from './camera/PhotoProofValidator';
import { GameAudio } from './audio/GameAudio';
import { VoiceNavigator } from './audio/VoiceNavigator';
import { DeliveryManager, MAX_CONCURRENT_ORDERS, getInstructionMeta } from './delivery/DeliveryManager';
import { RIDER_UPGRADES, getUpgradeEffects } from './delivery/RiderCareer';
import { OrderDispatchManager } from './delivery/OrderDispatchManager';
import { Hud } from './ui/Hud';
import { ModalUi } from './ui/ModalUi';
import { VisorRainOverlay } from './ui/VisorRainOverlay';
import { OnboardingAndSettings } from './ui/OnboardingAndSettings';
import { DistrictSelectorUi } from './ui/DistrictSelectorUi';
import { GameSettings, collidesWithWorld } from './types';
import { ACTIVE_DISTRICT, IS_UNIFIED_MAP, SuwonDistrictId } from './data/suwonDistricts';
import { SUWON_OPEN_WORLD, nearestLegacyDistrictId } from './data/suwonUnified';
import { GameContext } from './game/GameContext';
import { installKeyboardInput } from './game/keyboardInput';
import { startGameLoop } from './game/gameLoop';
import { GameClock } from './game/GameClock';
import { applyGameClock } from './game/clockSync';
import { GraphicsRuntime } from './game/GraphicsRuntime';
import { runBenchmarkSuite } from './game/BenchmarkSuite';
import { PerfMonitor } from './game/PerfMonitor';

const app = document.getElementById('app')!;

/**
 * MSAA (hardware anti-aliasing): on by default, `?aa=off` disables it (WebGL context attribute, fixed
 * at startup). Measured with the benchmark suite on an Apple-GPU retina laptop: MSAA off saved only
 * ~1% GPU time across all 8 worst-case scenarios (4.91 vs 4.98ms), so quality wins by default; the
 * switch stays for weaker GPUs where multisampling at 2x pixel density costs more.
 */
function resolveAntialias(): boolean {
  return new URLSearchParams(window.location.search).get('aa') !== 'off';
}
const ANTIALIAS = resolveAntialias();

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: ANTIALIAS });
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
// Main view also renders the street props hidden from the side mirrors
camera.layers.enable(NO_MIRROR_LAYER);
scene.add(camera);

// Core modules
const world = new CityWorld(scene);
const traffic = new TrafficSystem(scene, world.busStops);
const corridorRoom = new CorridorRoom(scene);
const roadNavigator = new RoadNavigator();
const pedestrians = new PedestrianManager(world.root); // Independent 25-block crosswalk AI (paused indoors!)
const roadHazards = new RoadHazardManager(world.root); // Speed cameras, police patrols, construction zones, rival riders & pop-outs!
world.mapInfo.speedCameras = roadHazards.cameraMarkers;
world.mapInfo.policePatrols = roadHazards.patrolMarkers;
world.mapInfo.constructionZones = roadHazards.constructionMarkers;
world.mapInfo.rivalRiders = roadHazards.rivalRiderMarkers;
const weather = new WeatherManager(scene);
const visorRain = new VisorRainOverlay();
const voiceNav = new VoiceNavigator();
const delivery = new DeliveryManager(world.locations);
const dispatch = new OrderDispatchManager(world.locations, {
  onOfferArrived: (offer) => {
    audio.playDispatchCallAlert();
    voiceNav.speak(
      offer.type === 'SINGLE'
        ? '새로운 한집배달 콜이 도착했습니다.'
        : '새로운 알뜰배달 묶음 콜이 도착했습니다.'
    );
    const label = offer.type === 'SINGLE' ? '🚀 한집배달' : '🛵 알뜰배달 (2건 묶음)';
    const hint =
      hud.phoneMap.placement === 'pocket'
        ? '[Tab]으로 휴대폰을 꺼낸 뒤 화면을 터치해 20초 내 수락하세요!'
        : hud.phoneMap.isZoomed
          ? '스마트폰 화면의 [콜 수락] 버튼을 클릭해 터치하세요!'
          : '3D 휴대폰 화면의 [👆 바로 터치 수락]을 직접 클릭하세요!';
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
const bikeGarage = loadBikeGarage();
scooterPhysics.setBikeCustomization(bikeGarage.modelId, bikeGarage.paintId);

const syncScooterUpgrades = () => {
  const fx = getUpgradeEffects(delivery.career.upgrades);
  scooterPhysics.setUpgradeModifiers({
    accelMul: fx.accelMul,
    speedMul: fx.speedMul,
    fuelBurnMul: fx.fuelBurnMul,
    gripMul: fx.gripMul,
  });
};
syncScooterUpgrades();
const playerCtrl = new PlayerController();
const playerMesh = new PlayerMesh(scene);
const camController = new CameraController(renderer.domElement);
const audio = new GameAudio();

const graphics = new GraphicsRuntime(renderer, world.sunLight);

const applyGameSettings = (s: GameSettings) => {
  audio.setMasterVolume(s.masterVolume);
  voiceNav.setEnabled(s.voiceNaviEnabled);
  voiceNav.setVolume(Math.min(1, s.masterVolume * 1.05));
  camController.sensitivity = s.mouseSensitivity;

  // Resolution range, shadow map size / refresh rate and dynamic resolution per quality level
  graphics.apply(s);
};

/** Unified open world: [P] district list moves the rider there instantly (missions, cargo & career kept) */
const teleportToDistrict = (id: SuwonDistrictId) => {
  if (playerCtrl.state.inCorridor) {
    hud.showToast('🏢 건물 안에서는 다른 구역으로 이동할 수 없습니다', 2600);
    return;
  }
  const d = SUWON_OPEN_WORLD.legacyDistricts.find((x) => x.id === id);
  if (!d) return;
  scooterPhysics.placeAt(d.scooterSpawn.x, d.scooterSpawn.z, d.scooterSpawn.heading);
  playerCtrl.teleportTo(d.playerSpawn.x, 0, d.playerSpawn.z, d.playerSpawn.heading, false);
  camController.onFootYaw = d.playerSpawn.heading;
  camController.resetLook();
  hud.stowPhoneToPocket();
  scooterMesh.setPhoneMounted(false);
  delivery.setReferencePosition(d.playerSpawn.x, d.playerSpawn.z);
  delivery.invalidateNavCache();
  world.updateStreaming(d.playerSpawn.x, d.playerSpawn.z);
  graphics.invalidateShadows();
  hud.showToast(`${d.badgeLabel.replace(' ▾', '')}(으)로 이동했습니다! 진행 중인 배달은 그대로 유지됩니다`, 3600);
};

const districtUi = new DistrictSelectorUi({
  onTeleport: teleportToDistrict,
  getCurrentId: () => nearestLegacyDistrictId(playerCtrl.state.x, playerCtrl.state.z),
});

const onboardingSettings = new OnboardingAndSettings({
  onApplySettings: (s) => {
    applyGameSettings(s);
  },
  onOpenDistrictSelector: () => {
    districtUi.open();
  },
  onTutorialCompleted: () => {
    audio.playChime('complete');
    voiceNav.speak('첫 배달을 성공적으로 마쳤습니다! 이제 프로 라이더로 활동해 보세요.');
    hud.showToast('🎓 첫 출근 튜토리얼 완료! 훌륭한 라이더 데뷔를 축하합니다!', 4800);
  },
});
applyGameSettings(onboardingSettings.settings);

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
  const isVilla = m.order.customer.residenceKind === 'walkup_villa';
  if (!isVilla) {
    audio.playElevatorDoorSlide();
  }
  hud.stowPhoneToPocket();
  modalUi.playQuickDoorTransition(
    isVilla
      ? `🪜 [#${m.order.orderNumber}] ${m.order.customer.name} 원룸·빌라 1층 계단실 진입 중...`
      : `🛗 [#${m.order.orderNumber}] ${m.order.customer.name} 1층 엘리베이터 탑승 중...`,
    () => {
      // Midpoint while screen is black: occlude entire outdoor world + nav line + rain & audio!
      world.setOutdoorVisible(false);
      traffic.root.visible = false;
      scooterMesh.root.visible = false;
      weather.update(0, 0, 0, 0, true, world.isNight);
      audio.updateWeatherAudio(0, true);

      corridorRoom.configureForUnit(m.order.unitNumber, m.order.customer.residenceKind ?? 'apartment');
      corridorRoom.root.visible = true;

      delivery.enterCorridor(missionId);
      const sp = corridorRoom.getSpawnPoint();
      playerCtrl.teleportTo(sp.x, sp.y, sp.z, sp.heading, true);
      camController.onFootYaw = sp.heading;
      camController.resetLook();
    },
    () => {
      if (isVilla) {
        const inst = getInstructionMeta(m.order.deliveryInstruction);
        hud.showToast(
          `🪜 원룸·빌라 계단실 진입! (엘리베이터 없음) 계단을 걸어 올라가 ${m.order.unitNumber}로 배달하세요 (${inst.badge})`,
          4600
        );
      } else {
        hud.showToast(
          `🛗 아파트 1층 엘리베이터 탑승 완료! [E]를 눌러 ${corridorRoom.elevatorTargetFloor}층 버튼을 누르세요`,
          4400
        );
      }
    }
  );
};

const exitCorridorToStreet = () => {
  const wasVilla = corridorRoom.isVillaMode;
  audio.setElevatorHum(false);
  if (!wasVilla) audio.playElevatorDoorSlide();
  hud.stowPhoneToPocket();
  modalUi.playQuickDoorTransition(
    wasVilla ? '🚪 원룸·빌라 1층 현관 출구로 나가는 중...' : '🛗 1층 로비 도착 · 밖으로 나가는 중...',
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
      if (collidesWithWorld(rx, rz, 0.5, world.getCollisionObstacles())) {
        rx = s.x - leftX * 1.45;
        rz = s.z - leftZ * 1.45;
      }

      playerCtrl.teleportTo(rx, 0, rz, s.heading, false);
      camController.onFootYaw = s.heading;
      camController.resetLook();
      delivery.finishAfterCorridorExit();
    },
    () => {
      const rem = delivery.activeMissions.length;
      hud.showToast(
        rem > 0
          ? `1층 복귀 완료! 남은 묶음 배달 ${rem}건의 다음 경로를 휴대폰 내비에서 확인하세요`
          : '1층 복귀 완료! [Tab]으로 휴대폰을 꺼내 다음 묶음 콜을 확인하세요',
        3800
      );
    }
  );
};

let npcTookFoodBag = false;
let pendingMissionBonusPopup: { target: number; bonus: number; totalWallet: number } | null = null;

const finalizeCorridorSettlement = () => {
  renderer.render(scene, camera);
  const photoDataUrl = renderer.domElement.toDataURL('image/jpeg', 0.85);
  const result = delivery.completePhotoSettlement();
  if (result) {
    audio.playChime('complete');
    if (result.tierPromotedTo) {
      audio.playMissionBonusFanfare();
      voiceNav.speak(`축하합니다! ${result.tierPromotedTo.name} 등급으로 승급했습니다!`);
      hud.showToast(
        `🎉 승급 축하! ${result.tierPromotedTo.icon} ${result.tierPromotedTo.name} 달성! (건당 배달 보너스 +₩${result.tierPromotedTo.bonusPerDelivery.toLocaleString()})`,
        5200
      );
    }
    if (result.missionJustCompleted) {
      pendingMissionBonusPopup = {
        target: delivery.getDailyMissionStatus().target,
        bonus: result.missionBonusAwarded,
        totalWallet: result.totalEarnings,
      };
    }
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

/** Blocks garage purchases the wallet can't cover; returns true when the purchase was rejected */
function rejectIfInsufficientFunds(cost: number): boolean {
  if (delivery.totalEarnings >= cost) return false;
  audio.playKeypadBeep(false);
  const short = cost - delivery.totalEarnings;
  hud.showToast(
    `💰 지갑 잔액이 부족합니다! (필요 ₩${cost.toLocaleString()} · ₩${short.toLocaleString()} 더 필요)`,
    3400
  );
  return true;
}

const modalUi = new ModalUi({
  onPosSuccess: (missionId) => {
    const res = delivery.completePosPickup(missionId);
    if (!res) return;
    const regularUnlockSuffix = res.justBecameRegular
      ? ` · 🎉 ${res.mission.order.shop.name} 단골 매장 등극! (다음 픽업부터 우선 조리 우대)`
      : '';
    if (res.status === 'cooking') {
      audio.playKeypadBeep(true);
      if (res.isRegularPerk && res.savedWaitSec > 0) {
        hud.showToast(
          `⭐ 단골 매장 우대! ${res.mission.order.shop.name} 사장님이 먼저 챙겨주셨어요 (대기 -${res.savedWaitSec}초 → ${res.waitSec}초 남음)`,
          4400
        );
      } else {
        hud.showToast(
          `🍳 ${res.mission.order.shop.name} [#${res.mission.order.orderNumber}] 조리 중 (남은 시간: ${res.waitSec}초) — 대기 중 탑승·휴대폰 조작 가능!${regularUnlockSuffix}`,
          4400
        );
      }
    } else {
      audio.playChime('pickup');
      if (res.isRegularPerk && res.savedWaitSec > 0) {
        hud.showToast(
          `⭐ 단골 매장 즉시 픽업! 사장님이 먼저 준비해 두셨어요 (-${res.savedWaitSec}초 단축) · 배달통 [E] 적재하세요`,
          4200
        );
      } else if (res.isRegularPerk) {
        hud.showToast(
          `⭐ 단골 매장 [#${res.mission.order.orderNumber}] 픽업 완료! 오토바이 뒤편 배달통 [E]로 슬롯에 적재하세요`,
          3800
        );
      } else {
        hud.showToast(
          `🛍️ [#${res.mission.order.orderNumber}] 픽업 완료! 오토바이 뒤편 배달통 [E]로 슬롯에 적재하세요${regularUnlockSuffix}`,
          4200
        );
      }
    }
  },
  onPinSuccess: (missionId) => {
      const unlocked = delivery.unlockLobbyDoor(missionId);
      if (unlocked) {
        audio.playChime('accept');
        world.setLobbyDoorOpen(unlocked.order.customer.id);
        const isVilla = unlocked.order.customer.residenceKind === 'walkup_villa';
        hud.showToast(
          isVilla
            ? `🔓 ${unlocked.order.customer.name} 공동현관 개방! (원룸·빌라 계단) [E]로 진입해 계단을 올라가세요`
            : `🔓 ${unlocked.order.customer.name} 공동현관 개방! [E]를 눌러 1층 엘리베이터에 탑승하세요`,
          3600
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
  onSelectBikeModel: (modelId, cost) => {
    if (bikeGarage.modelId === modelId) return;
    if (cost > 0 && rejectIfInsufficientFunds(cost)) return;
    if (cost > 0) {
      delivery.recordRepairExpense(cost);
    }
    if (!bikeGarage.ownedModels.includes(modelId)) {
      bikeGarage.ownedModels.push(modelId);
    }
    bikeGarage.modelId = modelId;
    saveBikeGarage(bikeGarage);
    scooterPhysics.setBikeCustomization(bikeGarage.modelId, bikeGarage.paintId);
    scooterMesh.applyCustomization(bikeGarage.modelId, bikeGarage.paintId);
    audio.playRepairSound();
    modalUi.renderRepairGarageContent(
      scooterPhysics.state.damageLevel,
      scooterPhysics.state.crashCount,
      bikeGarage,
      delivery.career
    );
    const spec = SCOOTER_MODELS[modelId];
    hud.showToast(
      `${spec.icon} ${spec.name} 기종으로 변경했습니다!${cost > 0 ? ` (-₩${cost.toLocaleString()})` : ' (보유 기종 무료 교체)'}`,
      3600
    );
  },
  onSelectBikePaint: (paintId, cost) => {
    if (bikeGarage.paintId === paintId) return;
    if (cost > 0 && rejectIfInsufficientFunds(cost)) return;
    if (cost > 0) {
      delivery.recordRepairExpense(cost);
    }
    if (!bikeGarage.ownedPaints.includes(paintId)) {
      bikeGarage.ownedPaints.push(paintId);
    }
    bikeGarage.paintId = paintId;
    saveBikeGarage(bikeGarage);
    scooterPhysics.setBikeCustomization(bikeGarage.modelId, bikeGarage.paintId);
    scooterMesh.applyCustomization(bikeGarage.modelId, bikeGarage.paintId);
    audio.playKeypadBeep(true);
    modalUi.renderRepairGarageContent(
      scooterPhysics.state.damageLevel,
      scooterPhysics.state.crashCount,
      bikeGarage,
      delivery.career
    );
    const paint = SCOOTER_PAINTS[paintId];
    hud.showToast(
      `🎨 커스텀 도색 [${paint.name}] 적용 완료!${cost > 0 ? ` (-₩${cost.toLocaleString()})` : ''}`,
      2800
    );
  },
  onBuyUpgrade: (upgradeId, cost) => {
    const spec = RIDER_UPGRADES[upgradeId];
    if (delivery.hasUpgrade(upgradeId)) {
      hud.showToast(`${spec.icon} ${spec.name} 장비는 이미 장착되어 있습니다!`, 2400);
      return;
    }
    if (rejectIfInsufficientFunds(cost)) return;
    if (delivery.buyUpgrade(upgradeId, cost)) {
      syncScooterUpgrades();
      audio.playRepairSound();
      window.setTimeout(() => audio.playPaymentCompleteSound(), 320);
      modalUi.renderRepairGarageContent(
        scooterPhysics.state.damageLevel,
        scooterPhysics.state.crashCount,
        bikeGarage,
        delivery.career
      );
      hud.showToast(
        `⚙️ ${spec.icon} ${spec.name} 장착 완료! (${spec.statBadge} · 영구 저장됨)`,
        4000
      );
    }
  },
  onConvenienceBuy: (item, cost) => {
    delivery.recordConvenienceExpense(cost);
    audio.playConvenienceChime();
    if (item === 'energy_drink') {
      playerCtrl.applyConvenienceDrink('energy_drink');
      hud.showToast(
        `⚡ 에너지드링크 구매 (-₩${cost.toLocaleString()})! 체력 100% + 60초 도보·계단 부스트 ON`,
        3800
      );
    } else if (item === 'iced_coffee') {
      playerCtrl.applyConvenienceDrink('iced_coffee');
      hud.showToast(
        `☕ 아이스 아메리카노 구매 (-₩${cost.toLocaleString()})! 체력 +60% + 45초 회복 2배`,
        3800
      );
    } else {
      hud.phoneMap.rechargeBatteryFull();
      audio.playWirelessChargeStart();
      hud.showToast(
        `🔋 급속 보조배터리 충전 완료 (-₩${cost.toLocaleString()})! 스마트폰 배터리 100%`,
        3800
      );
    }
  },
  onTakePhoto: handleTakeDeliveryPhoto,
  onSettlementClose: () => {
    if (pendingMissionBonusPopup) {
      const info = pendingMissionBonusPopup;
      pendingMissionBonusPopup = null;
      audio.playMissionBonusFanfare();
      modalUi.showMissionBonusPopup(info.target, info.bonus, info.totalWallet);
      hud.showToast(`🏆 일일 배달 미션 달성! +₩${info.bonus.toLocaleString()} 보너스 지급!`, 4600);
      return;
    }
    hud.showToast(
      corridorRoom.isVillaMode
        ? '배달 완료! 원룸·빌라 계단을 내려와 1층 현관 출구 앞에서 [E]로 나가세요'
        : '배달 완료! 복도 엘리베이터로 돌아가 [E] 호출 후 탑승해 1층으로 내려가세요',
      3800
    );
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
      if (hud.phoneMap.placement === 'in_hand') hud.stowPhoneToPocket();
      else hud.phoneMap.setZoomed(false);
      modalUi.openRepairModal(
        scooterPhysics.state.damageLevel,
        scooterPhysics.state.crashCount,
        bikeGarage,
        delivery.career
      );
      return;
    }

    if (world.isPlayerNearConvenienceStore(playerCtrl.state.x, playerCtrl.state.z)) {
      if (hud.phoneMap.placement === 'in_hand') hud.stowPhoneToPocket();
      else hud.phoneMap.setZoomed(false);
      audio.playConvenienceChime();
      modalUi.openConvenienceModal(playerCtrl.state.stamina, hud.phoneMap.battery);
      return;
    }
  }

  if (delivery.activeMissions.length === 0) {
    hud.showToast('진행 중인 배달이 없습니다 ([Tab] → [V]로 최대 3건 콜 수락)');
    return;
  }

  // Inside underground corridor (Real 3D Apartment Elevator OR 원룸·빌라 Stairwell)
  if (playerCtrl.state.inCorridor) {
    const cm = delivery.getCorridorMission();
    if (!cm) return;

    // 0. Real 3D Apartment Elevator Controls (Press target floor at 1F / Call elevator / Press 1F to descend!)
    if (!corridorRoom.isVillaMode) {
      const inCabin = corridorRoom.isInsideElevatorCabin(playerCtrl.state.x, playerCtrl.state.z);
      if (corridorRoom.elevatorPhase === 'moving_up' || corridorRoom.elevatorPhase === 'moving_down') {
        hud.showToast(
          `🛗 엘리베이터 이동 중... (현재 ${corridorRoom.elevatorCurrentFloor}층)`,
          1600
        );
        return;
      }
      if (inCabin && corridorRoom.elevatorPhase === 'idle_1f') {
        if (corridorRoom.startElevatorRideUp()) {
          audio.playKeypadBeep(true);
          audio.playElevatorDoorSlide();
          audio.setElevatorHum(true);
          hud.showToast(
            `🛗 ${corridorRoom.elevatorTargetFloor}층 버튼을 눌렀습니다! 문이 닫히고 올라갑니다...`,
            2800
          );
        }
        return;
      }
    }

    if (cm.phase === 'in_corridor') {
      if (!corridorRoom.isNearTargetDoor(playerCtrl.state.x, playerCtrl.state.z, playerCtrl.state.y)) {
        hud.showToast(
          corridorRoom.isVillaMode
            ? `🪜 원룸·빌라 계단을 올라 ${cm.order.unitNumber} 현관문 앞으로 가까이 가세요`
            : `${cm.order.unitNumber} 현관문 앞으로 가까이 가세요`
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
    modalUi.openPosKeypad(
      shopMission.order,
      hasPhone,
      delivery.isRegularShop(shopMission.order.shop.id)
    );
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

const tryAcceptIncomingOffer = (fromDirect3DTouch = false): boolean => {
  if (!dispatch.activeOffer) return false;
  // Touch-only smartphone interaction: accept ONLY via zoomed screen click OR direct 3D phone screen UV touch!
  if (!hud.phoneMap.isZoomed && !fromDirect3DTouch) return false;

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
    onScreenTap: () => {
      audio.ensureStarted();
      audio.playPhoneScreenTap();
    },
  },
  handleCycleWeather
);

// 3D Scooter, 3D Right-Hand Smartphone, 3D Left-Hand Takeout Food Bag!
const scooterMesh = new ScooterMesh(scene, hud.phoneMap.screenTexture);
scooterMesh.applyCustomization(bikeGarage.modelId, bikeGarage.paintId);
const handheldPhone3D = new HandheldPhone3D(camera, hud.phoneMap.screenTexture);
const handheldFoodBag3D = new HandheldFoodBag3D(camera);

handheldPhone3D.setOnMountClick((mounting) => {
  audio.playPhoneMountClick(mounting);
});

// In-world 3D Smartphone Hover Hand & Direct UV Touch Raycaster (no zoom needed for 3D call accept/reject!)
const raycaster = new THREE.Raycaster();
const clickNdc = new THREE.Vector2();
let downX = 0;
let downY = 0;

const getVisible3DPhoneTargets = (): THREE.Object3D[] => {
  const targets: THREE.Object3D[] = [];
  if (
    modalUi.activeModal !== 'none' ||
    hud.phoneMap.placement === 'pocket' ||
    hud.phoneMap.isZoomed
  ) {
    return targets;
  }
  if (hud.phoneMap.placement === 'in_hand') targets.push(handheldPhone3D.hitMesh);
  if (hud.phoneMap.placement === 'mounted' && playerCtrl.state.mode === 'riding') {
    targets.push(scooterMesh.mountedPhoneHitMesh);
  }
  return targets;
};

renderer.domElement.addEventListener('pointermove', (e) => {
  const targets = getVisible3DPhoneTargets();
  if (targets.length === 0) {
    hud.phoneMap.setExternal3DHandHover(false, e.clientX, e.clientY);
    return;
  }
  clickNdc.x = (e.clientX / window.innerWidth) * 2 - 1;
  clickNdc.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(clickNdc, camera);
  const hits = raycaster.intersectObjects(targets, false);
  hud.phoneMap.setExternal3DHandHover(hits.length > 0, e.clientX, e.clientY);
});

renderer.domElement.addEventListener('pointerleave', () => {
  hud.phoneMap.setExternal3DHandHover(false, 0, 0);
});

renderer.domElement.addEventListener('pointerdown', (e) => {
  downX = e.clientX;
  downY = e.clientY;
  if (e.button !== 0) return;
  const targets = getVisible3DPhoneTargets();
  if (targets.length === 0) return;
  clickNdc.x = (e.clientX / window.innerWidth) * 2 - 1;
  clickNdc.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(clickNdc, camera);
  if (raycaster.intersectObjects(targets, false).length > 0) {
    hud.phoneMap.triggerExternal3DHandTap(e.clientX, e.clientY);
  }
});

renderer.domElement.addEventListener('pointerup', (e) => {
  if (e.button !== 0) return;
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;

  const targets = getVisible3DPhoneTargets();
  if (targets.length === 0) return;

  clickNdc.x = (e.clientX / window.innerWidth) * 2 - 1;
  clickNdc.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(clickNdc, camera);

  const hits = raycaster.intersectObjects(targets, false);
  if (hits.length > 0) {
    audio.ensureStarted();
    const uv = hits[0].uv;
    if (uv) {
      const action = hud.phoneMap.handle3DScreenTouch(uv.x, uv.y, dispatch.activeOffer !== null);
      if (action === 'accept_offer') {
        tryAcceptIncomingOffer(true);
        return;
      }
      if (action === 'reject_offer') {
        handleRejectIncomingOffer();
        return;
      }
    }
    hud.phoneMap.setExternal3DHandHover(false, e.clientX, e.clientY);
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
  const damageSeverity =
    cause === 'pedestrian_hit'
      ? 'pedestrian_hit'
      : cause === 'rain_manhole' || cause === 'rain_paint' || cause === 'rain_corner'
        ? 'rain_slip'
        : 'normal';
  const { damagedCount, loss } = delivery.applyCrashDamage(damageSeverity);

  const causePrefix =
    cause === 'pedestrian_hit'
      ? '🚨💥 보행자 접촉 사고로 슬립 전도!'
      : cause === 'rain_manhole'
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

// Wire Korean Road Speed Bump suspension thud & high-speed cargo shock damage!
scooterPhysics.setOnSpeedBump((speedKmh, label) => {
  const intensity = Math.min(1, Math.max(0.2, (speedKmh - 10) / 36));
  audio.playSpeedBumpThud(intensity);
  const res = delivery.applySpeedBumpImpact(speedKmh);
  if (res.damagedCount > 0) {
    if (res.spillHit) {
      audio.playLiquidSlosh();
    }
    hud.showToast(
      `⚠️ ${label} 고속 통과 (${Math.round(speedKmh)}km/h)! 서스펜션 충격으로 배달통 음식 -${res.maxLoss}% 파손 (22km/h 이하 서행 권장)`,
      3600
    );
  }
});

const gameCtx: GameContext = {
  renderer,
  scene,
  camera,
  world,
  traffic,
  corridorRoom,
  roadNavigator,
  pedestrians,
  roadHazards,
  weather,
  visorRain,
  voiceNav,
  delivery,
  dispatch,
  scooterPhysics,
  scooterMesh,
  playerCtrl,
  playerMesh,
  camController,
  audio,
  hud,
  modalUi,
  districtUi,
  onboardingSettings,
  handheldPhone3D,
  handheldFoodBag3D,
  clock: new GameClock(),
};
applyGameClock(gameCtx, false);

const pressed = installKeyboardInput(gameCtx, {
  handleContextInteract,
  handleCycleWeather,
  handleTogglePhone,
  handleTogglePhoneZoom,
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

hud.showToast(
  IS_UNIFIED_MAP
    ? `🗺️ 수원 통합 오픈월드 · ${ACTIVE_DISTRICT.shortName} 출근 완료! 도시 전체를 달릴 수 있어요 · [P] 구역 바로 이동`
    : `${ACTIVE_DISTRICT.icon} ${ACTIVE_DISTRICT.shortName} 출근 완료! [Tab]→[V] 콜 수락 · [P]로 수원 구역 변경 가능`,
  5200
);
if (IS_UNIFIED_MAP) {
  // Keep the HUD district badge / phone area name in sync with where the rider actually is
  window.setInterval(() => districtUi.refreshCurrent(), 1000);
}

startGameLoop(gameCtx, {
  pressed,
  exitCorridorToStreet,
  isPlayerNearCargoBox,
  isNpcHoldingFoodBag: () => npcTookFoodBag,
  graphics,
});

// Worst-case benchmark suite: `?bench=suite` (or `__benchSuite()`) - results in the F9 overlay & console
const runSuite = async () => {
  const perf = (window as unknown as { __perf: PerfMonitor }).__perf;
  perf.toggleOverlay(true);
  const rows = await runBenchmarkSuite(
    {
      perf,
      teleport: (id) => teleportToDistrict(id),
      isRiding: () => playerCtrl.state.mode === 'riding',
      toggleMount: () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF' }));
      },
      setNight: (on) => {
        if (gameCtx.clock.isNight !== on) gameCtx.clock.toggleDayNight();
        applyGameClock(gameCtx, false);
      },
      setWeather: (mode) => {
        weather.setMode(mode);
        world.setWeather(mode);
        delivery.setWeatherRaining(mode === 'rain');
      },
      turnView: (dy) => {
        camController.onFootYaw += dy;
      },
      pathTo: (x, z) => roadNavigator.findShortestPath(scooterPhysics.state.x, scooterPhysics.state.z, x, z).points,
      placeScooter: (x, z, heading) => {
        const st = scooterPhysics.state;
        st.x = x;
        st.z = z;
        st.heading = heading;
        st.speed = 0;
      },
      districtSpawn: (id) => SUWON_OPEN_WORLD.legacyDistricts.find((d) => d.id === id)?.playerSpawn ?? { x: 0, z: 0 },
      graphicsInfo: () => ({ pixelRatio: graphics.pixelRatio, antialias: ANTIALIAS }),
    },
    (msg) => (perf.statusLine = msg)
  );
  perf.lastSuite = rows as unknown as Array<Record<string, string | number | null>>;
  perf.statusLine = `벤치마크 완료 · MSAA ${ANTIALIAS ? 'ON' : 'OFF'} · DPR ${window.devicePixelRatio}`;
  (window as unknown as { __benchResult: unknown }).__benchResult = { antialias: ANTIALIAS, dpr: window.devicePixelRatio, rows };
  return rows;
};
(window as unknown as { __benchSuite: unknown }).__benchSuite = runSuite;
if (IS_UNIFIED_MAP && new URLSearchParams(window.location.search).get('bench') === 'suite') {
  window.setTimeout(() => void runSuite(), 5000);
}

// Dev-only handle for automated playtests (stripped from production builds)
if (import.meta.env.DEV) {
  (window as unknown as { __kds: unknown }).__kds = { world, scooterPhysics, playerCtrl, camController, clock: gameCtx.clock, traffic, roadHazards, delivery, roadNavigator, pedestrians, renderer, graphics, onboardingSettings };
}
