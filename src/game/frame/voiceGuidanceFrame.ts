/** Voice guidance each frame: turn-by-turn, speed cameras ahead and construction detours (with their toasts) */
import type { GameContext } from '../GameContext';
import type { FrameState } from '../gameLoop';
import type { NavigationPlan } from '../../delivery/DeliveryManager';

export function stepVoiceGuidance(ctx: GameContext, f: FrameState, navPlan: NavigationPlan): void {
  const { roadHazards, voiceNav, scooterPhysics, hud } = ctx;
  const { inCorridor, isRiding } = f;
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
}
