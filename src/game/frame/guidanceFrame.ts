/** Per-frame stage of the game loop (gameLoop.ts calls the stages in order each frame) */
import { stepVoiceGuidance } from './voiceGuidanceFrame';
import { stepPhoneBattery } from './phoneBatteryFrame';
import type { GameContext } from '../GameContext';
import type { FrameState, GameLoopHooks, LoopState } from '../gameLoop';
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
    weather,
    visorRain,
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
  const { elapsed, inCorridor } = f;
  stepVoiceGuidance(ctx, f, navPlan);
  perf.lap('weather/audio');
  stepPhoneBattery(ctx, f);
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
