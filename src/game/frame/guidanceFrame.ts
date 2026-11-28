/** Per-frame stage of the game loop (gameLoop.ts calls the stages in order each frame) */
import type { GameContext } from '../GameContext';
import type { FrameState, GameLoopHooks, LoopState } from '../gameLoop';
import { getUpgradeEffects } from '../../delivery/RiderCareer';
import type { NavigationPlan } from '../../delivery/DeliveryManager';

/** Voice guidance (turns, cameras, construction), phone battery, onboarding guide and the HUD */
export function stepGuidanceFrame(
  ctx: GameContext,
  hooks: GameLoopHooks,
  loop: LoopState,
  f: FrameState,
  navPlan: NavigationPlan,
): void {
  const {
    world,
    traffic,
    corridorRoom,
    roadHazards,
    weather,
    visorRain,
    voiceNav,
    delivery,
    dispatch,
    scooterPhysics,
    playerCtrl,
    audio,
    hud,
    modalUi,
    districtUi,
    onboardingSettings,
  } = ctx;
  const { isPlayerNearCargoBox } = hooks;
  const { perf } = loop;
  const { dt, elapsed, inCorridor, isRiding } = f;
  // Korean Web Speech API Voice Navigation (Turn-by-Turn + 80m Speed Camera Enforcement Alert)
  const navFocusKey = navPlan.focusMission
    ? `${navPlan.focusMission.order.id}:${navPlan.isPickupTarget ? 'p' : 'd'}`
    : null;
  voiceNav.updateSpeedCameraAlert(roadHazards.upcomingCamera, isRiding, inCorridor);
  voiceNav.updateTurnGuidance(navPlan.guidance, navFocusKey, isRiding, inCorridor);
  const roadworkNotice = voiceNav.updateRoadworks(
    navPlan.roadworks,
    navFocusKey,
    scooterPhysics.state.x,
    scooterPhysics.state.z,
    isRiding,
    inCorridor,
  );
  if (roadworkNotice === 'detour') hud.showToast('🚧 공사 구간을 피해 우회 경로로 안내합니다', 3200);
  else if (roadworkNotice === 'approach') hud.showToast('🚧 전방 공사 구간 · 1차선 통제, 서행하세요', 3200);

  perf.lap('weather/audio');
  // Step smartphone battery drain & handlebar-mount wireless charging (2x faster with fast_charger upgrade!)
  const chargeSpeedMul = getUpgradeEffects(delivery.career.upgrades).chargeSpeedMul;
  hud.phoneMap.stepBattery(
    dt,
    scooterPhysics.state.engineOn,
    () => {
      audio.playWirelessChargeStart();
      hud.showToast(
        chargeSpeedMul > 1.5
          ? '⚡ 고속 무선충전 거치대 작동! (2배 속도로 초고속 충전 중)'
          : '⚡ 오토바이 거치대 무선충전 시작! (주행 중 배터리 자동 충전)',
        2600,
      );
    },
    () => {
      audio.playLowBatteryBeep();
      voiceNav.speak('휴대폰 배터리가 부족합니다. 거치대에 장착해 충전하세요.');
      hud.showToast('🪫 휴대폰 배터리 15% 이하! 오토바이 거치대 [Tab] 무선충전 또는 🏪 편의점 충전 필요', 4200);
    },
    () => {
      audio.playLowBatteryBeep();
      hud.showToast(
        '🪫 휴대폰 배터리 방전! 오토바이 거치대 [Tab] 시동 무선충전 또는 🏪 K-24 편의점에서 충전하세요',
        4600,
      );
    },
    chargeSpeedMul,
  );

  // Update 1-Minute First-Shift Interactive Onboarding Guide progress
  onboardingSettings.updateOnboarding(playerCtrl.state, delivery, {
    financeTabOpen: hud.phoneMap.app === 'bank',
    isPeakTime: delivery.demandPhase.isPeak,
    phoneApp: hud.phoneMap.app,
    phoneOut: hud.phoneMap.placement !== 'pocket',
  });

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
      nearestGas:
        !inCorridor && scooterPhysics.state.fuel <= 30
          ? world.nearestGasStation(scooterPhysics.state.x, scooterPhysics.state.z)
          : null,
      nearCargoBox: isPlayerNearCargoBox(),
      nearGasPump: !inCorridor && world.isPlayerNearGasPump(playerCtrl.state.x, playerCtrl.state.z),
      scooterOnGasPad: !inCorridor && world.isScooterOnGasPad(scooterPhysics.state.x, scooterPhysics.state.z),
      nearRepairShop: !inCorridor && world.isPlayerNearRepairShop(playerCtrl.state.x, playerCtrl.state.z),
      scooterOnRepairPad: !inCorridor && world.isScooterOnRepairPad(scooterPhysics.state.x, scooterPhysics.state.z),
      nearConvenienceStore: !inCorridor && world.isPlayerNearConvenienceStore(playerCtrl.state.x, playerCtrl.state.z),
      nearCorridorTargetDoor:
        inCorridor && corridorRoom.isNearTargetDoor(playerCtrl.state.x, playerCtrl.state.z, playerCtrl.state.y),
      nearCorridorElevator:
        inCorridor && corridorRoom.isNearElevator(playerCtrl.state.x, playerCtrl.state.z, playerCtrl.state.y),
      insideElevatorCabin: inCorridor && corridorRoom.isInsideElevatorCabin(playerCtrl.state.x, playerCtrl.state.z),
      elevatorPhase: corridorRoom.elevatorPhase,
      elevatorCurrentFloor: corridorRoom.elevatorCurrentFloor,
      elevatorTargetFloor: corridorRoom.elevatorTargetFloor,
      elevatorDoorsOpen: corridorRoom.isElevatorDoorsOpen(),
      isVillaCorridor: inCorridor && corridorRoom.isVillaMode,
      villaCurrentFloor:
        inCorridor && corridorRoom.isVillaMode ? corridorRoom.getCurrentVillaFloor(playerCtrl.state.y) : 1,
      visorWetHint: !inCorridor && weather.isRaining && visorRain.dropletDensity >= 0.35,
      modalOpen: modalUi.activeModal !== 'none' || onboardingSettings.isSettingsOpen || districtUi.isOpen,
    },
  );
}
