/** Per-frame corridor animation: elevator doors & ride, unit doors, customer NPC and lights */
import type { CorridorRoom, ElevatorEvents } from '../CorridorRoom';

export function updateVisual(
  host: CorridorRoom,
  elapsedTime: number,
  dt = 0.016,
  playerZ = 0,
  events?: ElevatorEvents,
): void {
  if (!host.root.visible) return;
  const step = Math.min(1, dt * 5.2);

  // 1. Live 3D Apartment Elevator Ride & Sliding Steel Doors
  if (!host.isVillaMode) {
    if (host.elevatorPhase === 'moving_up') {
      host.elevRideVibeY = Math.sin(elapsedTime * 34) * 0.0045;
      host.elevatorStepTimer += dt;
      if (host.elevatorStepTimer >= host.elevatorSecPerFloor) {
        host.elevatorStepTimer -= host.elevatorSecPerFloor;
        host.elevatorCurrentFloor = Math.min(host.elevatorTargetFloor, host.elevatorCurrentFloor + 1);
        if (host.elevatorCurrentFloor >= host.elevatorTargetFloor) {
          host.elevatorPhase = 'arrived_floor';
          host.elevRideVibeY = 0;
          host.elevDoorOpenTarget = 1;
          host.elevBtnGlowMat.emissiveIntensity = 0.25;
          host.redrawElevatorLedDisplay(host.elevatorCurrentFloor, 'idle');
          events?.onDoorSlide?.(true);
          events?.onArrivedTargetFloor?.(host.elevatorCurrentFloor);
        } else {
          host.redrawElevatorLedDisplay(host.elevatorCurrentFloor, 'up');
          events?.onFloorTick?.(host.elevatorCurrentFloor);
        }
      }
    } else if (host.elevatorPhase === 'moving_down') {
      host.elevRideVibeY = Math.sin(elapsedTime * 34) * 0.0045;
      host.elevatorStepTimer += dt;
      if (host.elevatorStepTimer >= host.elevatorSecPerFloor) {
        host.elevatorStepTimer -= host.elevatorSecPerFloor;
        host.elevatorCurrentFloor = Math.max(1, host.elevatorCurrentFloor - 1);
        if (host.elevatorCurrentFloor <= 1) {
          host.elevatorPhase = 'idle_1f';
          host.elevRideVibeY = 0;
          host.elevBtnGlowMat.emissiveIntensity = 0.25;
          host.redrawElevatorLedDisplay(1, 'idle');
          events?.onArrivedGroundFloor?.();
        } else {
          host.redrawElevatorLedDisplay(host.elevatorCurrentFloor, 'down');
          events?.onFloorTick?.(host.elevatorCurrentFloor);
        }
      }
    } else {
      host.elevRideVibeY = 0;
      // Gently auto-close elevator doors behind the player once they walk out into the corridor!
      if (host.elevatorPhase === 'arrived_floor' && host.elevDoorOpenTarget > 0.5 && playerZ > -5.2) {
        host.elevDoorOpenTarget = 0;
        events?.onDoorSlide?.(false);
      }
    }

    // Smoothly animate double stainless-steel sliding elevator doors
    const doorStep = Math.min(1, dt * 3.6);
    host.elevDoorOpenCur += (host.elevDoorOpenTarget - host.elevDoorOpenCur) * doorStep;
    const slideOffset = 0.46 + host.elevDoorOpenCur * 0.84;
    host.elevDoorL.position.x = -slideOffset;
    host.elevDoorR.position.x = slideOffset;
  }

  if (host.targetHighlightRing.visible) {
    const s = 1 + Math.sin(elapsedTime * 4.5) * 0.08;
    host.targetHighlightRing.scale.set(s, s, 1);
  }

  const targetDoor = host.getActiveDoors()[host.targetDoorIndex];
  if (targetDoor) {
    host.currentDoorOpenAngle += (host.targetDoorOpenAngle - host.currentDoorOpenAngle) * step;
    targetDoor.doorPivot.rotation.y = host.currentDoorOpenAngle;

    if (host.bellFlashTimer > 0) {
      host.bellFlashTimer = Math.max(0, host.bellFlashTimer - dt);
      const blink = Math.floor(elapsedTime * 10) % 2 === 0;
      targetDoor.bellLedMat.emissive.setHex(blink ? 0xfacc15 : 0x22c55e);
      targetDoor.bellLedMat.emissiveIntensity = blink ? 3.5 : 1.0;
    }
  }

  if (host.npcVisible) {
    host.npcStepCur += (host.npcStepTarget - host.npcStepCur) * Math.min(1, dt * 4.5);
    host.npcArmReachCur += (host.npcArmReachTarget - host.npcArmReachCur) * Math.min(1, dt * 7.0);

    host.npcGroup.position.z = -0.82 + host.npcStepCur * 0.66;
    host.npcRightArmPivot.rotation.x = -host.npcArmReachCur * 1.18;
  }
}
