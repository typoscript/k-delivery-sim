/** Per-frame pose & lights: body position / lean, steering, wheel spin, blinkers, brake glow and the headlight beam */
import type { ScooterMesh } from '../ScooterMesh';
import { ScooterState } from '../ScooterPhysics';

export function sync(
  host: ScooterMesh,
  state: ScooterState,
  elapsedTime: number,
  dt = 0.016,
  isNight = false,
  rainIntensity = 0,
): void {
  if (host.cargoLidTimer > 0) {
    host.cargoLidTimer = Math.max(0, host.cargoLidTimer - dt);
  }
  const targetLidRot = host.cargoLidTimer > 0 ? 1.15 : 0;
  host.cargoLidPivot.rotation.x += (targetLidRot - host.cargoLidPivot.rotation.x) * Math.min(1, dt * 10);
  const lidVisibleOpen = host.cargoLidPivot.rotation.x > 0.12;
  for (let i = 0; i < 3; i++) {
    host.cargoSlotBags[i].visible = lidVisibleOpen && host.cargoSlotOccupied[i];
  }
  const fallenOffset = state.crashed ? 0.24 : 0;
  host.root.position.set(state.x, fallenOffset, state.z);
  host.root.rotation.y = state.heading;

  host.bodyTiltGroup.rotation.z = state.leanAngle;
  host.bodyTiltGroup.rotation.x = state.pitchAngle;

  host.handlebarGroup.rotation.y = state.steerAngle;
  host.frontWheel.rotation.x = state.wheelSpin;
  host.rearWheel.rotation.x = state.wheelSpin;

  host.kickstandGroup.rotation.x = state.mounted || state.crashed ? 1.25 : 0;

  // Real Road-Illuminating 3D Headlight Beam (sweeps into turns!) & Brake Tail-Light Glow
  const beamOn = state.headlights && !state.crashed;
  const beamHex = state.modelId === 'electric' ? 0xd8f3ff : state.modelId === 'cub' ? 0xffe8b6 : 0xfff8e2;
  host.headlightSpot.color.setHex(beamHex);
  host.headlightFill.color.setHex(beamHex);
  host.headlightConeMat.color.setHex(beamHex);

  // Aim headlight beam smoothly in the steering direction so dark corners light up!
  const steerSweepX = Math.sin(state.steerAngle) * 9.5;
  host.headlightSpot.target.position.set(steerSweepX, -0.75, 22);
  host.headlightSpot.intensity = beamOn ? (isNight ? 155 : 48) : 0;
  host.headlightFill.intensity = beamOn && isNight ? 14 : 0;

  const showCone = beamOn && (isNight || rainIntensity > 0.25);
  host.headlightConeMesh.visible = showCone;
  if (showCone) {
    host.headlightConeMesh.rotation.y = state.steerAngle * 0.55;
    host.headlightConeMat.opacity = isNight ? 0.085 + rainIntensity * 0.065 : rainIntensity * 0.045;
  }

  host.headlightMat.emissiveIntensity = state.headlights ? 3.0 : state.mounted ? 0.5 : 0.1;
  host.brakeLightMat.emissiveIntensity = state.braking ? 3.6 : state.headlights ? 0.95 : 0.15;
  host.brakeGlowLight.intensity = !state.crashed && isNight ? (state.braking ? 13 : state.headlights ? 2.4 : 0) : 0;

  const blinkOn = Math.floor(elapsedTime * 2.5) % 2 === 0;
  const leftActive = (state.leftBlinker || state.hazard) && blinkOn;
  const rightActive = (state.rightBlinker || state.hazard) && blinkOn;

  host.leftBlinkerMat.emissiveIntensity = leftActive ? 3.2 : 0;
  host.rightBlinkerMat.emissiveIntensity = rightActive ? 3.2 : 0;
  host.dashLeftLedMat.emissiveIntensity = leftActive ? 3.4 : 0.06;
  host.dashRightLedMat.emissiveIntensity = rightActive ? 3.4 : 0.06;
  host.leftBlinkerGlow.intensity = leftActive ? 2.2 : 0;
  host.rightBlinkerGlow.intensity = rightActive ? 2.2 : 0;

  // Low-fuel flashing red warning LED on 3D dashboard (<= 10% fuel)
  const fuelWarnBlink = state.lowFuelWarning && Math.floor(elapsedTime * 4.0) % 2 === 0;
  host.dashFuelWarnLedMat.emissiveIntensity = fuelWarnBlink ? 3.8 : state.lowFuelWarning ? 0.6 : 0.04;

  // Exterior crash damage visual: crooked & vibrating side mirrors!
  const speedVib = 0.35 + Math.min(Math.abs(state.speed) / 14, 1) * 0.9;
  for (const mh of host.mirrors.heads) {
    if (state.damageLevel > 0) {
      const rattle = Math.sin(elapsedTime * (22 + mh.side * 5)) * 0.045 * state.damageLevel * speedVib;
      const crook = mh.side * 0.065 * state.damageLevel;
      mh.group.rotation.y = mh.side * 0.22 + crook + rattle * 0.65;
      mh.group.rotation.x = 0.12 - 0.04 * state.damageLevel + rattle;
      mh.group.rotation.z = mh.side * 0.08 * state.damageLevel + rattle * 0.5;
    } else {
      mh.group.rotation.y = mh.side * 0.22;
      mh.group.rotation.x = 0.12;
      mh.group.rotation.z = 0;
    }
  }

  // Update 3D Digital Dashboard Fuel Gauge LCD (~12Hz throttle)
  if (elapsedTime - host.lastDashDrawTime >= 0.08 || host.lastDashDrawTime < 0) {
    host.lastDashDrawTime = elapsedTime;
    host.renderDashboardCluster(state, elapsedTime);
  }
}
