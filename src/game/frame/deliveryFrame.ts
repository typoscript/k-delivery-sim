/** Per-frame stage of the game loop (gameLoop.ts calls the stages in order each frame) */
import type { GameContext } from '../GameContext';
import type { FrameState, GameLoopHooks, LoopState } from '../gameLoop';
import type { NavigationPlan } from '../../delivery/DeliveryManager';

/** Urgent deliveries start ticking with this many seconds left */
const URGENT_WARN_SEC = 30;

/** Urgent-order ticks, kitchen timers, cargo sloshing, customer chats, call dispatch; returns the route plan */
export function stepDeliveryFrame(
  ctx: GameContext,
  _hooks: GameLoopHooks,
  _loop: LoopState,
  f: FrameState,
): NavigationPlan {
  const { roadNavigator, roadHazards, voiceNav, delivery, dispatch, scooterPhysics, playerCtrl, audio, hud } = ctx;
  const { dt, elapsed, inCorridor, isRiding, movementBlocked } = f;
  // Urgent deliveries: warn at 30s left, then tick every second until the time is up
  for (const m of delivery.activeMissions) {
    if (m.order.special !== 'urgent' || m.phase === 'corridor_exit' || m.remainingTimeSec <= 0) continue;
    const before = Math.ceil(m.remainingTimeSec);
    const after = Math.ceil(m.remainingTimeSec - dt);
    if (before === after || after > URGENT_WARN_SEC) continue;
    if (after === URGENT_WARN_SEC) {
      hud.showToast(
        `⏱️ [#${m.order.orderNumber}] 급한 배달 ${URGENT_WARN_SEC}초 남음! 늦으면 급송 할증이 없어요`,
        3000,
      );
      voiceNav.speak('급한 배달, 30초 남았습니다.');
    }
    audio.playUrgentTick(after <= 5);
  }
  // Step active mission delivery countdowns, peak-time cooking timers, cargo physics & live customer chat!
  delivery.stepTimers(dt, (readyMission) => {
    audio.playFoodReadyDingDong();
    voiceNav.speak(`${readyMission.order.shop.name} 음식이 준비되었습니다. 픽업대에서 수령하세요.`);
    hud.showToast(
      `🔔 ${readyMission.order.shop.emoji} ${readyMission.order.shop.name} [#${readyMission.order.orderNumber}]: "음식이 준비되었습니다!" 픽업대 트레이에서 [E]로 수령하세요`,
      4600,
    );
  });
  delivery.stepCargoPhysics(dt, scooterPhysics.state, isRiding, (ordNo, menuName) => {
    audio.playLiquidSlosh();
    hud.showToast(`🍲 [#${ordNo}] ${menuName} 국물/음료 출렁임! 급코너·급브레이크 시 음식 상태가 감소합니다`, 2600);
  });
  hud.phoneMap.ridingNow = isRiding;
  delivery.stepCustomerChatEvents(dt, inCorridor, isRiding, (chatEv) => {
    // 방해 금지 while riding: the message waits in the messenger / notification center, no ping or pop-up
    if (hud.phoneMap.quietNow) return;
    audio.playCustomerChatPing();
    voiceNav.speak('고객님께 새 메시지가 도착했습니다.');
    hud.showCustomerChatPopup(chatEv);
  });
  dispatch.step(dt, delivery, inCorridor, movementBlocked, roadHazards.rivalRiderMarkers, playerCtrl.state);

  // Compute bundled multi-stop A* Navigation Plan (internally cached & throttled)
  return delivery.getNavigationPlan(
    playerCtrl.state.x,
    playerCtrl.state.z,
    playerCtrl.state.heading,
    scooterPhysics.state.x,
    scooterPhysics.state.z,
    inCorridor,
    elapsed,
    roadNavigator,
  );
}
