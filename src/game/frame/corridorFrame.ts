/** Indoors each frame: the corridor / elevator animation, its floor sounds and arrival announcements */
import type { GameContext } from '../GameContext';
import type { FrameState, GameLoopHooks } from '../gameLoop';
import { getInstructionMeta } from '../../delivery/DeliveryManager';

export function stepCorridorFrame(ctx: GameContext, hooks: GameLoopHooks, f: FrameState): void {
  const { world, corridorRoom, voiceNav, delivery, playerCtrl, audio, hud } = ctx;
  const { dt, elapsed } = f;
  const { exitCorridorToStreet } = hooks;
  world.mapInfo.upcomingCamera = null;
  corridorRoom.updateVisual(elapsed, dt, playerCtrl.state.z, {
    onFloorTick: () => {
      audio.playElevatorFloorTick();
    },
    onDoorSlide: () => {
      audio.playElevatorDoorSlide();
    },
    onArrivedTargetFloor: (floor) => {
      audio.setElevatorHum(false);
      audio.playElevatorDing();
      voiceNav.speak(`${floor}층입니다. 문이 열립니다.`);
      const cm = delivery.getCorridorMission();
      const inst = cm ? getInstructionMeta(cm.order.deliveryInstruction) : null;
      const unit = cm?.order.unitNumber ?? `${floor}층`;
      hud.showToast(
        `🔔 띵동! ${floor}층 도착! 엘리베이터에서 내려 ${unit}로 이동하세요${inst ? ` (${inst.badge})` : ''}`,
        4600,
      );
    },
    onArrivedGroundFloor: () => {
      audio.setElevatorHum(false);
      audio.playElevatorDing();
      voiceNav.speak('1층 로비에 도착했습니다.');
      exitCorridorToStreet();
    },
  });
}
