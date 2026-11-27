import * as THREE from 'three';
import type { RoadHazardManager } from '../RoadHazardManager';
import { ACTIVE_MAP_DATA } from '../../data/suwonDistricts';
import { mergeStaticByMaterial } from '../instancing';
import { GRADE_SEPARATED_NAME, HazardFrame, PARKED_RULE, POPOUT_COLLISION_RADIUS, POPOUT_GLOBAL_COOLDOWN_SEC, PopOutWarningEvent } from './hazardTypes';
import { PedestrianFactory } from '../PedestrianFactory';
import { PEDESTRIAN_COLLISION_MIN_KMH, PedestrianCollisionEvent } from '../PedestrianManager';

function createParcelLogoTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = '#0ea5e9';
  ctx.fillRect(0, 0, 256, 30);
  ctx.fillStyle = '#0f172a';
  ctx.font = '900 38px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('K-택배', 128, 76);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildParkedHazards(host: RoadHazardManager): void {
  const nodes = ACTIVE_MAP_DATA.nodes;
  const spawn = ACTIVE_MAP_DATA.meta.scooterSpawn;
  const logoTex = createParcelLogoTexture();
  const cargoMat = new THREE.MeshStandardMaterial({ map: logoTex, roughness: 0.55 });
  const cabMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.42 });
  const sedanMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.4 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9 });

  const candidates = ACTIVE_MAP_DATA.edges
    .filter((e) => e.width >= 8.4 && e.dist >= 24)
    .sort((a, b) => b.dist - a.dist);

  const { count: maxParked, spacing: parkedSpacing } = host.placementLimits(PARKED_RULE);
  for (const e of candidates) {
    if (host.parkedHazards.length >= maxParked) break;
    if (host.isLargeMap && GRADE_SEPARATED_NAME.test(e.name)) continue;
    const na = nodes[e.a];
    const nb = nodes[e.b];
    const dx = nb.x - na.x;
    const dz = nb.z - na.z;
    const len = Math.hypot(dx, dz) || 1;
    const fx = dx / len;
    const fz = dz / len;
    const rx = -fz;
    const rz = fx;
    const heading = Math.atan2(fx, fz);

    const mx = (na.x + nb.x) * 0.5 + rx * (e.width * 0.5 - 1.35);
    const mz = (na.z + nb.z) * 0.5 + rz * (e.width * 0.5 - 1.35);

    if (Math.hypot(mx - spawn.x, mz - spawn.z) < 42) continue;
    if (host.cameras.some((c) => Math.hypot(c.x - mx, c.z - mz) < 28)) continue;
    if (host.parkedHazards.some((h) => Math.hypot(h.x - mx, h.z - mz) < parkedSpacing)) continue;

    const isTruck = host.parkedHazards.length % 2 === 0;
    const name = isTruck ? '불법주정차 K-택배 탑차' : '비상등 불법주정차 승용차';
    const g = new THREE.Group();
    g.position.set(mx, 0, mz);
    g.rotation.y = heading;

    const hazardMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      emissive: 0xf59e0b,
      emissiveIntensity: 2.4,
    });

    if (isTruck) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(2.05, 1.95, 3.35), cargoMat);
      box.position.set(0, 1.62, -0.55);
      box.castShadow = true;
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.92, 1.4, 1.45), cabMat);
      cab.position.set(0, 1.15, 1.78);
      g.add(box, cab);
    } else {
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.72, 4.2), sedanMat);
      body.position.set(0, 0.7, 0);
      body.castShadow = true;
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.58, 2.1), sedanMat);
      cabin.position.set(0, 1.3, -0.15);
      g.add(body, cabin);
    }

    for (const [wx, wz] of [
      [-0.92, 1.4],
      [0.92, 1.4],
      [-0.92, -1.4],
      [0.92, -1.4],
    ]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 10), tireMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(wx, 0.34, wz);
      g.add(w);
    }

    for (const sx of [-0.82, 0.82]) {
      for (const sz of [-2.18, 2.2]) {
        const hz = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.08), hazardMat);
        hz.position.set(sx, 0.85, sz);
        g.add(hz);
      }
    }
    // One mesh per material for this static prop (blinking / flash materials keep working)
    mergeStaticByMaterial(g);
    host.root.add(g);
    host.registerStaticProp(g, mx, mz);

    // Collision box
    host.obstacles.push({
      minX: mx - 1.35,
      maxX: mx + 1.35,
      minZ: mz - 1.35,
      maxZ: mz + 1.35,
    });

    // Blind-spot pop-out pedestrian darting into open lane from front of parked vehicle
    const popStartX = mx + fx * 2.6 + rx * 0.6;
    const popStartZ = mz + fz * 2.6 + rz * 0.6;
    const popOutX = popStartX - rx * 2.75;
    const popOutZ = popStartZ - rz * 2.75;
    const popRig = host.pedFactory.createPedestrian();
    popRig.root.visible = false;
    host.root.add(popRig.root);

    host.parkedHazards.push({
      id: `park-${host.parkedHazards.length + 1}`,
      name,
      x: mx,
      z: mz,
      heading,
      isTruck,
      hazardMat,
      popRig,
      popState: 'hidden',
      popStartX,
      popStartZ,
      popOutX,
      popOutZ,
      popX: popStartX,
      popZ: popStartZ,
      popHeading: 0,
      popTimer: 0,
      popCooldown: 0,
      popFallSide: 1,
    });
  }
}

/** Per frame: hazard blinkers and the blind-spot pedestrian popping out from behind a double-parked vehicle */
export function stepParkedHazards(host: RoadHazardManager, f: HazardFrame, onPopOutWarning?: (ev: PopOutWarningEvent) => void, onPopOutPedestrianHit?: (ev: PedestrianCollisionEvent) => void): void {
  // --- 4. Double-Parked Hazard Blinkers & Blind-Spot Pop-Out Pedestrians ---
  if (host.globalPopOutCooldown > 0) {
    host.globalPopOutCooldown = Math.max(0, host.globalPopOutCooldown - f.dt);
  }

  const canHitPopOut =
    f.scooter.isRiding && !f.scooter.crashed && f.speedKmh >= PEDESTRIAN_COLLISION_MIN_KMH;

  for (const h of host.parkedHazards) {
    h.hazardMat.emissiveIntensity = f.blinkOn ? 2.8 : 0.12;
    if (h.popCooldown > 0) h.popCooldown = Math.max(0, h.popCooldown - f.dt);

    if (
      h.popState === 'hidden' &&
      h.popCooldown <= 0 &&
      host.globalPopOutCooldown <= 0 &&
      f.scooter.isRiding &&
      !f.scooter.crashed &&
      f.speedKmh >= 18
    ) {
      const toHazX = h.popStartX - f.scooter.x;
      const toHazZ = h.popStartZ - f.scooter.z;
      const dist = Math.hypot(toHazX, toHazZ);
      if (dist >= 10 && dist <= 23) {
        const alignment = (toHazX * f.scFwdX + toHazZ * f.scFwdZ) / dist;
        if (alignment > 0.58) {
          h.popState = 'popping_out';
          h.popX = h.popStartX;
          h.popZ = h.popStartZ;
          h.popHeading = Math.atan2(h.popOutX - h.popStartX, h.popOutZ - h.popStartZ);
          h.popTimer = 0;
          h.popCooldown = 32.0;
          host.globalPopOutCooldown = POPOUT_GLOBAL_COOLDOWN_SEC;
          h.popRig.root.visible = true;
          onPopOutWarning?.({ hazardName: h.name });
        }
      }
    }

    if (h.popState === 'hidden') continue;

    if (canHitPopOut && h.popState !== 'fallen') {
      const dHit = Math.hypot(h.popX - f.scooter.x, h.popZ - f.scooter.z);
      if (dHit <= POPOUT_COLLISION_RADIUS) {
        h.popState = 'fallen';
        h.popTimer = 5.5;
        const leftX = Math.cos(f.scooter.heading);
        const leftZ = -Math.sin(f.scooter.heading);
        const sideDot = (h.popX - f.scooter.x) * leftX + (h.popZ - f.scooter.z) * leftZ;
        h.popFallSide = sideDot >= 0 ? 1 : -1;

        onPopOutPedestrianHit?.({
          pedestrianId: 900 + host.parkedHazards.indexOf(h),
          pedX: h.popX,
          pedZ: h.popZ,
          impactSpeedKmh: f.speedKmh,
          hitSide: h.popFallSide,
        });
      }
    }

    if (h.popState === 'popping_out') {
      const dx = h.popOutX - h.popX;
      const dz = h.popOutZ - h.popZ;
      const rem = Math.hypot(dx, dz);
      const runSpeed = 2.6;
      if (rem <= 0.08) {
        h.popX = h.popOutX;
        h.popZ = h.popOutZ;
        h.popState = 'holding';
        h.popTimer = 1.65;
      } else {
        const step = Math.min(rem, runSpeed * f.dt);
        h.popX += (dx / rem) * step;
        h.popZ += (dz / rem) * step;
      }
      h.popRig.root.position.set(h.popX, 0.04, h.popZ);
      h.popRig.root.rotation.y = h.popHeading;
      PedestrianFactory.updateWalkAnimation(h.popRig, runSpeed, f.dt);
    } else if (h.popState === 'holding') {
      h.popTimer -= f.dt;
      const faceRider = Math.atan2(f.scooter.x - h.popX, f.scooter.z - h.popZ);
      h.popRig.root.position.set(h.popX, 0.04, h.popZ);
      h.popRig.root.rotation.y = faceRider;
      PedestrianFactory.updateStartledAnimation(h.popRig, f.elapsedTime, f.dt);
      if (h.popTimer <= 0) {
        h.popState = 'retreating';
        h.popHeading = Math.atan2(h.popStartX - h.popX, h.popStartZ - h.popZ);
      }
    } else if (h.popState === 'retreating') {
      const dx = h.popStartX - h.popX;
      const dz = h.popStartZ - h.popZ;
      const rem = Math.hypot(dx, dz);
      const speed = 2.1;
      if (rem <= 0.1) {
        h.popState = 'hidden';
        h.popRig.root.visible = false;
      } else {
        const step = Math.min(rem, speed * f.dt);
        h.popX += (dx / rem) * step;
        h.popZ += (dz / rem) * step;
        h.popRig.root.position.set(h.popX, 0.04, h.popZ);
        h.popRig.root.rotation.y = h.popHeading;
        PedestrianFactory.updateWalkAnimation(h.popRig, speed, f.dt);
      }
    } else if (h.popState === 'fallen') {
      h.popTimer -= f.dt;
      h.popRig.root.position.set(h.popX, 0.04, h.popZ);
      PedestrianFactory.updateFallenAnimation(h.popRig, h.popFallSide, f.dt);
      if (h.popTimer <= 0) {
        h.popState = 'hidden';
        h.popRig.root.visible = false;
      }
    }
  }
}
