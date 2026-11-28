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
  loadBikeGarage,
} from './vehicle/ScooterModels';
import { PlayerController } from './player/PlayerController';
import { PlayerMesh } from './player/PlayerMesh';
import { HandheldPhone3D } from './player/HandheldPhone3D';
import { HandheldFoodBag3D } from './player/HandheldFoodBag3D';
import { CameraController } from './camera/CameraController';
import { GameAudio } from './audio/GameAudio';
import { VoiceNavigator } from './audio/VoiceNavigator';
import { DeliveryManager } from './delivery/DeliveryManager';
import { getUpgradeEffects } from './delivery/RiderCareer';
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
import { weekGoalsSummaryText } from './delivery/weeklyGoals';
import type { AppRefs } from './game/app/appRefs';
import { dispatchCallbacks } from './game/app/dispatchCallbacks';
import { modalCallbacks } from './game/app/modalCallbacks';
import { phoneCallbacks } from './game/app/phoneCallbacks';
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
/** Late-bound systems for the callback modules (read when a callback runs, never during construction) */
const refs: AppRefs = {
  get world() {
    return world;
  },
  get audio() {
    return audio;
  },
  get voiceNav() {
    return voiceNav;
  },
  get hud() {
    return hud;
  },
  get modalUi() {
    return modalUi;
  },
  get delivery() {
    return delivery;
  },
  get playerCtrl() {
    return playerCtrl;
  },
  get scooterPhysics() {
    return scooterPhysics;
  },
  get scooterMesh() {
    return scooterMesh;
  },
  get bikeGarage() {
    return bikeGarage;
  },
  get gameCtx() {
    return gameCtx;
  },
  get flow() {
    return flow;
  },
  get syncScooterUpgrades() {
    return syncScooterUpgrades;
  },
  get rejectIfInsufficientFunds() {
    return rejectIfInsufficientFunds;
  },
};
const dispatch = new OrderDispatchManager(world.locations, dispatchCallbacks(refs));
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
  // Map detail follows the quality too ("보통": no rooftop structures / alley poles, "낮음": bare streets)
  world.setMapDetail(s.graphicsQuality);
  graphics.invalidateShadows();
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
  // a loaded backup replaces the save: restart the game on it (nothing of this session may overwrite it)
  onSaveImported: () => {
    delivery.freezeSaves();
    window.setTimeout(() => window.location.reload(), 300);
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

const modalUi = new ModalUi(modalCallbacks(refs));

const hud = new Hud(
  phoneCallbacks(refs),
  () => flow.handleCycleWeather()
);
hud.phoneMap.messenger = delivery.messenger;
hud.phoneMap.notifPrefs = () => onboardingSettings.settings.notifications;
delivery.messenger.onMessage = (t, msg) => hud.phoneMap.notify('💬', `메신저 · ${t.title}`, msg.text);

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
// Returning riders: where this week stands (goals count today's work too; paid at the week's last clock-out)
window.setTimeout(() => {
  if (delivery.lifetimeCompleted === 0 && delivery.shiftDay === 1) return; // first-time riders get the tutorial
  const w = delivery.getWeekSummary();
  const left = w.lastDay - delivery.shiftDay;
  hud.showToast(
    `📆 ${w.week}주차 ${delivery.shiftDay}일차 · 주간 목표 ${weekGoalsSummaryText(delivery.getWeekGoalsLive())} · ${
      left === 0 ? '오늘 퇴근 때 정산' : `${left}일 남음`
    } (휴대폰 💳 뱅크 앱)`,
    5600
  );
}, 6000);
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
        delivery.setWeatherPrecipitation(mode === 'rain' || mode === 'snow' ? mode : null);
        traffic.setWeather(mode);
        pedestrians.setWeather(mode);
      },
      setMapDetail: (detail) => world.setMapDetail(detail),
      setSnowCover: (full) => world.updateSnowCover(1000, full),
      restoreSettings: () => applyGameSettings(onboardingSettings.settings),
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
