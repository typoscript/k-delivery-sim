/** Apartment elevator: LED floor display, cabin / door checks and the ride up / down */
import type { CorridorRoom } from '../CorridorRoom';

/** Redraws the live glowing red/amber LED floor indicator inside & outside the 3D apartment elevator */
/** @internal corridor/* */
export function redrawElevatorLedDisplay(host: CorridorRoom, floor: number, dir: 'up' | 'down' | 'idle'): void {
  const ctx = host.elevLedCtx;
  ctx.fillStyle = '#070b14';
  ctx.fillRect(0, 0, 256, 96);
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, 250, 90);

  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '●';
  ctx.fillStyle = dir === 'up' ? '#22c55e' : dir === 'down' ? '#f97316' : '#f59e0b';
  ctx.font = '900 44px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(arrow, 22, 49);

  ctx.fillStyle = '#ef4444';
  ctx.font = '900 54px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`${floor}F`, 234, 51);
  host.elevLedTex.needsUpdate = true;
}

export function isInsideElevatorCabin(host: CorridorRoom, px: number, pz: number): boolean {
  if (host.isVillaMode) return false;
  return pz < -8.0 && Math.abs(px) <= 1.18;
}

export function isElevatorDoorsOpen(host: CorridorRoom): boolean {
  return host.elevDoorOpenCur > 0.65;
}

/** Player presses floor button inside the 3D elevator cabin at 1F -> doors close, rides up to target floor! */
export function startElevatorRideUp(host: CorridorRoom): boolean {
  if (host.isVillaMode || host.elevatorPhase !== 'idle_1f') return false;
  host.elevatorPhase = 'moving_up';
  host.elevatorStepTimer = 0;
  host.elevDoorOpenTarget = 0;
  host.elevBtnGlowMat.emissiveIntensity = 3.2;
  host.redrawElevatorLedDisplay(host.elevatorCurrentFloor, 'up');
  return true;
}

/** Player presses corridor call button after delivery -> elevator doors slide open! */
export function openElevatorForExit(host: CorridorRoom): boolean {
  if (host.isVillaMode) return false;
  if (host.elevatorPhase === 'doors_open_exit' && host.elevDoorOpenTarget > 0.5) return false;
  host.elevatorPhase = 'doors_open_exit';
  host.elevDoorOpenTarget = 1;
  host.elevCallBtnMat.emissiveIntensity = 2.8;
  return true;
}

/** Player presses 1F button inside the 3D elevator cabin -> doors close, rides down to 1F! */
export function startElevatorRideDown(host: CorridorRoom): boolean {
  if (host.isVillaMode) return false;
  if (host.elevatorPhase === 'moving_down') return false;
  host.elevatorPhase = 'moving_down';
  host.elevatorStepTimer = 0;
  host.elevDoorOpenTarget = 0;
  host.elevBtnGlowMat.emissiveIntensity = 3.2;
  host.elevCallBtnMat.emissiveIntensity = 0.35;
  host.redrawElevatorLedDisplay(host.elevatorCurrentFloor, 'down');
  return true;
}
