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
import { GameAudio } from './audio/GameAudio';
import { VoiceNavigator } from './audio/VoiceNavigator';
import { DeliveryManager, MAX_CONCURRENT_ORDERS } from './delivery/DeliveryManager';
import { RIDER_UPGRADES, getUpgradeEffects } from './delivery/RiderCareer';
import { OrderDispatchManager } from './delivery/OrderDispatchManager';
import { Hud } from './ui/Hud';
import { ModalUi } from './ui/ModalUi';
import { VisorRainOverlay } from './ui/VisorRainOverlay';
import { OnboardingAndSettings } from './ui/OnboardingAndSettings';
import { DistrictSelectorUi } from './ui/DistrictSelectorUi';
import { GameSettings } from './types';
import { ACTIVE_DISTRICT, IS_UNIFIED_MAP, SuwonDistrictId } from './data/suwonDistricts';
import { SUWON_OPEN_WORLD, nearestLegacyDistrictId } from './data/suwonUnified';
import { GameContext } from './game/GameContext';
import { DeliveryFlow, createDeliveryFlow } from './game/deliveryFlow';
import { installPhoneTouchInput } from './game/phoneTouchInput';
import { installCrashFeedback } from './game/crashFeedback';
import { installKeyboardInput } from './game/keyboardInput';
import { startGameLoop } from './game/gameLoop';
import { GameClock } from './game/GameClock';
import { WeatherSchedule } from './game/WeatherSchedule';
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
world.mapInfo.constructionZones = roadHazards.constructionMarkers;
roadNavigator.setRoadworks(roadHazards.constructionMarkers); // Mission routes detour around construction
world.mapInfo.rivalRiders = roadHazards.rivalRiderMarkers;
const weather = new WeatherManager(scene);
const visorRain = new VisorRainOverlay();
const voiceNav = new VoiceNavigator();
const delivery = new DeliveryManager(world.locations);
const dispatch = new OrderDispatchManager(world.locations, {
  onOfferArrived: (offer) => {
    const special = offer.orders.find((o) => o.special)?.special;
    if (special) {
      // Special orders announce themselves: distinct alert, then the usual call alert
      audio.playSpecialOrderAlert(special);
      window.setTimeout(() => audio.playDispatchCallAlert(), 450);
    } else {
      audio.playDispatchCallAlert();
    }
    voiceNav.speak(
      special === 'urgent'
        ? '급한 배달 콜이 도착했습니다. 제한시간이 짧습니다.'
        : special === 'group'
          ? '단체 주문 콜이 도착했습니다.'
          : offer.type === 'SINGLE'
            ? '새로운 한집배달 콜이 도착했습니다.'
            : '새로운 알뜰배달 묶음 콜이 도착했습니다.'
    );
    const label = offer.type === 'SINGLE' ? '🚀 한집배달' : '🛵 알뜰배달 (2건 묶음)';
    const hint =
      hud.phoneMap.placement === 'pocket'
        ? '[Tab]으로 휴대폰을 꺼낸 뒤 화면을 터치해 20초 내 수락하세요!'
        : '휴대폰 위쪽 콜 배너의 [수락]을 누르세요 (배너를 누르면 자세히)';
    const rivalHint = offer.rival ? ' · 🛵 근처 경쟁 라이더도 노리는 콜!' : '';
    hud.showToast(`🔔 신규 콜 도착! ${label} · ₩${offer.totalFee.toLocaleString()}${rivalHint} — ${hint}`, 4500);
  },
  onOfferTakenByRival: (offer) => {
    audio.playDispatchExpiredSound();
    const label = offer.type === 'SINGLE' ? '한집배달' : '알뜰배달';
    hud.showToast(`🛵 근처 경쟁 라이더가 ${label} 콜(₩${offer.totalFee.toLocaleString()})을 먼저 가져갔어요`, 3600);
  },
  onBoardCallTaken: (order) => {
    // Only worth a word while the rider is looking at the call list
    if (hud.phoneMap.isZoomed) hud.showToast(`🛵 다른 라이더가 #${order.orderNumber} 콜을 가져갔어요 (새 콜로 채워집니다)`, 2600);
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
  onCargoSlotAction: (slot: number) => flow.handleCargoSlotAction(slot),
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
  onTakePhoto: () => flow.handleTakeDeliveryPhoto(),
  onSettlementClose: () => flow.handleSettlementClose(),
  onKeypadBeep: (ok) => audio.playKeypadBeep(ok),
});

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
      flow.tryAcceptIncomingOffer();
    },
    onRejectDispatchOffer: () => flow.handleRejectIncomingOffer(),
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
    onClockOut: () => {
      const res = delivery.clockOut();
      if (!res) {
        hud.showToast('📦 배달 중인 주문을 모두 마친 뒤 퇴근할 수 있어요', 3200);
        return;
      }
      // Next working day starts at the shift start time (just before the lunch rush)
      gameCtx.clock.jumpTo(delivery.shiftClockMinute);
      applyGameClock(gameCtx, false);
      hud.phoneMap.setZoomed(false);
      audio.playShiftEndCadence();
      modalUi.openDailyReportModal(res.ledger, res);
      const bonus = res.awardedAtClockOut.reduce((a, g) => a + g.bonus, 0);
      const weekly = res.recap.weeklyBonus;
      hud.showToast(
        `🏁 ${res.day}일차 퇴근 완료${bonus > 0 ? ` · 🎯 목표 보너스 +₩${bonus.toLocaleString()}` : ''}${
          weekly > 0 ? ` · 📅 주간 보너스 +₩${weekly.toLocaleString()}` : ''
        } · ${res.nextDay}일차 ${gameCtx.clock.label} 출근!`,
        5200
      );
      voiceNav.speak(`${res.day}일차 근무를 마쳤습니다. 수고하셨습니다.`);
      res.recap.newAtClockOut.forEach((a, i) =>
        window.setTimeout(() => hud.showToast(`🏆 업적 달성! ${a.icon} ${a.title} · ${a.desc}`, 4600), 5600 + i * 4800)
      );
    },
    onInteractMission: () => flow.handleContextInteract(),
    onTogglePhone: () => flow.handleTogglePhone(),
    onToggleZoom: () => flow.handleTogglePhoneZoom(),
    onScreenTap: () => {
      audio.ensureStarted();
      audio.playPhoneScreenTap();
    },
  },
  () => flow.handleCycleWeather()
);

// 3D Scooter, 3D Right-Hand Smartphone, 3D Left-Hand Takeout Food Bag!
const scooterMesh = new ScooterMesh(scene, hud.phoneMap.screenTexture);
scooterMesh.applyCustomization(bikeGarage.modelId, bikeGarage.paintId);
const handheldPhone3D = new HandheldPhone3D(camera, hud.phoneMap.screenTexture);
const handheldFoodBag3D = new HandheldFoodBag3D(camera);

handheldPhone3D.setOnMountClick((mounting) => {
  audio.playPhoneMountClick(mounting);
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
  // Resume the saved working day's time (a new rider starts at 10:40, just before the lunch rush)
  clock: new GameClock(delivery.shiftClockMinute),
  weatherSchedule: new WeatherSchedule(weather.mode),
};
// Save the shift clock regularly and when the page is hidden / closed so a reload resumes the same time
window.setInterval(() => delivery.persistCareer(), 15000);
window.addEventListener('pagehide', () => delivery.persistCareer());
applyGameClock(gameCtx, false);
const flow: DeliveryFlow = createDeliveryFlow(gameCtx, { bikeGarage });
installPhoneTouchInput(gameCtx, flow);
installCrashFeedback(gameCtx);

const pressed = installKeyboardInput(gameCtx, {
  handleContextInteract: flow.handleContextInteract,
  handleCycleWeather: flow.handleCycleWeather,
  handleTogglePhone: flow.handleTogglePhone,
  handleTogglePhoneZoom: flow.handleTogglePhoneZoom,
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
  exitCorridorToStreet: flow.exitCorridorToStreet,
  isPlayerNearCargoBox: flow.isPlayerNearCargoBox,
  isNpcHoldingFoodBag: () => flow.state.npcTookFoodBag,
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
        // Benchmark scenes pin the weather: keep the automatic schedule from changing it mid-run
        gameCtx.weatherSchedule.override(mode);
        gameCtx.weatherSchedule.remainingMin = Number.POSITIVE_INFINITY;
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
  (window as unknown as { __kds: unknown }).__kds = { world, dispatch, scooterPhysics, playerCtrl, camController, clock: gameCtx.clock, weatherSchedule: gameCtx.weatherSchedule, corridorRoom, modalUi, hud, audio, traffic, roadHazards, delivery, roadNavigator, pedestrians, renderer, graphics, onboardingSettings };
}
