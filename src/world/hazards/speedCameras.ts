import * as THREE from 'three';
import type { RoadHazardManager } from '../RoadHazardManager';
import { ACTIVE_MAP_DATA } from '../../data/suwonDistricts';
import { mergeStaticByMaterial } from '../instancing';
import { CAMERA_RULE, HazardFrame, SPEED_CAMERA_FINE, SPEED_CAMERA_GRACE_KMH, SPEED_CAMERA_LIMIT_KMH, SPEED_CAMERA_WARN_DIST, SpeedCameraTriggerEvent } from './hazardTypes';
import { UpcomingCameraAlert, clamp } from '../../types';

function createCameraSignTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fef08a';
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = '#dc2626';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, 246, 118);

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(62, 64, 40, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.stroke();

  ctx.fillStyle = '#0f172a';
  ctx.font = '900 40px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('50', 62, 66);

  ctx.font = '900 26px sans-serif';
  ctx.fillStyle = '#b91c1c';
  ctx.fillText('과속·신호', 175, 48);
  ctx.fillStyle = '#0f172a';
  ctx.fillText('단속 중', 175, 84);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildSpeedCameras(host: RoadHazardManager): void {
  const nodes = ACTIVE_MAP_DATA.nodes;
  const majorEdges = ACTIVE_MAP_DATA.edges
    .filter((e) => e.isMajor && e.dist >= 26)
    .sort((a, b) => b.dist - a.dist);

  const poleMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.65, roughness: 0.35 });
  const housingMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.45 });
  const signMat = new THREE.MeshBasicMaterial({ map: createCameraSignTexture() });

  const { count: maxCameras, spacing: cameraSpacing } = host.placementLimits(CAMERA_RULE);
  for (const e of majorEdges) {
    if (host.cameras.length >= maxCameras) break;
    const na = nodes[e.a];
    const nb = nodes[e.b];
    const mx = (na.x + nb.x) * 0.5;
    const mz = (na.z + nb.z) * 0.5;
    if (host.cameras.some((c) => Math.hypot(c.x - mx, c.z - mz) < cameraSpacing)) continue;

    const angle = Math.atan2(nb.x - na.x, nb.z - na.z);
    const axis: 'ns' | 'ew' = Math.abs(Math.cos(angle)) >= Math.abs(Math.sin(angle)) ? 'ns' : 'ew';
    const id = `cam-${host.cameras.length + 1}`;
    const label = e.name ? `${e.name} 단속 구간` : `인계동 간선도로 단속 ${host.cameras.length + 1}`;

    const g = new THREE.Group();
    const rx = -Math.cos(angle);
    const rz = Math.sin(angle);
    const poleX = mx + rx * (e.width * 0.5 + 1.2);
    const poleZ = mz + rz * (e.width * 0.5 + 1.2);
    g.position.set(poleX, 0, poleZ);
    g.rotation.y = angle;

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 6.1, 8), poleMat);
    pole.position.y = 3.05;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.14, 0.14), poleMat);
    arm.position.set(-2.1, 5.85, 0);
    const camBox = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.38, 0.68), housingMat);
    camBox.position.set(-3.4, 5.55, 0);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.7, 0.08), signMat);
    sign.position.set(-1.6, 5.42, 0);

    const ledMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xef4444,
      emissiveIntensity: 1.5,
    });
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), ledMat);
    led.position.set(-3.4, 5.55, 0.38);

    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), flashMat);
    flash.position.set(-3.4, 5.55, 0.4);

    g.add(pole, arm, camBox, sign, led, flash);
    // One mesh per material for this static prop (blinking / flash materials keep working)
    mergeStaticByMaterial(g);
    host.root.add(g);
    host.registerStaticProp(g, mx, mz);

    host.cameras.push({
      id,
      label,
      x: mx,
      z: mz,
      axis,
      limitKmh: SPEED_CAMERA_LIMIT_KMH,
      ledMat,
      flashMat,
      flashTimer: 0,
      cooldown: 0,
      wasInZone: false,
    });
    host.cameraMarkers.push({ id, x: mx, z: mz, limitKmh: SPEED_CAMERA_LIMIT_KMH });
  }
}

/** Per frame: LED blink, flash fade, 80m navi warning for the camera ahead, speeding tickets */
export function stepSpeedCameras(host: RoadHazardManager, f: HazardFrame, onSpeedCameraTriggered?: (ev: SpeedCameraTriggerEvent) => void, onCameraApproachBeep?: (isOverSpeed: boolean) => void): void {
  // --- 1. Fixed Speed & Red-Light Enforcement Cameras + 80m Navi Warning ---
  let closestCam: UpcomingCameraAlert | null = null;
  let closestCamDist = SPEED_CAMERA_WARN_DIST;

  for (const cam of host.cameras) {
    if (cam.cooldown > 0) cam.cooldown = Math.max(0, cam.cooldown - f.dt);
    if (cam.flashTimer > 0) {
      cam.flashTimer = Math.max(0, cam.flashTimer - f.dt);
      cam.flashMat.opacity = clamp(cam.flashTimer / 0.25, 0, 1);
    }
    cam.ledMat.emissiveIntensity = f.blinkOn ? 2.8 : 0.6;

    const toCamX = cam.x - f.scooter.x;
    const toCamZ = cam.z - f.scooter.z;
    const dist = Math.hypot(toCamX, toCamZ);

    if (f.scooter.isRiding && !f.scooter.crashed && dist > 6 && dist <= closestCamDist) {
      const align = (toCamX * f.scFwdX + toCamZ * f.scFwdZ) / dist;
      if (align > 0.62) {
        closestCamDist = dist;
        closestCam = {
          cameraId: cam.id,
          label: cam.label,
          distanceMeters: Math.round(dist),
          limitKmh: cam.limitKmh,
          isOverSpeed: f.speedKmh > cam.limitKmh + SPEED_CAMERA_GRACE_KMH,
        };
      }
    }

    const inZone = dist <= 8.5;
    if (inZone && !cam.wasInZone && cam.cooldown <= 0 && f.scooter.isRiding && !f.scooter.crashed) {
      // Speed cameras sit mid-block on major edges (never at a stop line), so they only enforce speed.
      // Red-light violations are judged at the intersection itself by TrafficSystem.
      const isSpeeding = f.speedKmh > cam.limitKmh + SPEED_CAMERA_GRACE_KMH;
      if (isSpeeding) {
        cam.cooldown = 14.0;
        cam.flashTimer = 0.28;
        onSpeedCameraTriggered?.({
          cameraId: cam.id,
          label: cam.label,
          kind: 'speeding',
          measuredKmh: Math.round(f.speedKmh),
          limitKmh: cam.limitKmh,
          fine: SPEED_CAMERA_FINE,
        });
      }
    }
    cam.wasInZone = inZone;
  }

  host.upcomingCamera = closestCam;
  if (host.overSpeedBeepTimer > 0) host.overSpeedBeepTimer = Math.max(0, host.overSpeedBeepTimer - f.dt);
  if (closestCam) {
    if (closestCam.cameraId !== host.lastWarnedCameraId) {
      host.lastWarnedCameraId = closestCam.cameraId;
      onCameraApproachBeep?.(closestCam.isOverSpeed);
      host.overSpeedBeepTimer = 1.6;
    } else if (closestCam.isOverSpeed && host.overSpeedBeepTimer <= 0) {
      onCameraApproachBeep?.(true);
      host.overSpeedBeepTimer = 1.4;
    }
  } else {
    host.lastWarnedCameraId = null;
  }
}
