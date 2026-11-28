/** Traffic signals: the shared 18s phase cycle, the instanced signal gantries and the player's red-light check */
import * as THREE from 'three';
import { excludeFromMirrors, freezeStatic } from '../renderLayers';
import { buildInstanced, placeMatrix, NEARBY_INSTANCES } from '../instancing';

/** Signal gantries farther than this are not drawn (fog hides them anyway) */
const SIGNAL_DRAW_RADIUS_M = 320;
import { ACTIVE_MAP_DATA } from '../../data/suwonDistricts';
import { getSignalAxis, signalNodesNear } from '../TrafficRules';
import type { SignalColor, SignalStateSnapshot, TrafficSystem } from '../TrafficSystem';
import { CYCLE_DURATION } from './trafficTypes';
import { MID_BLOCK_CROSSINGS, midBlockPhaseNow } from './midBlockSignals';

/** Signal phase at a game time: NS green 7s, yellow 2s, then EW green 7s, yellow 2s (18s cycle) */
export function signalPhaseAt(elapsedTime: number): SignalStateSnapshot {
  const t = elapsedTime % CYCLE_DURATION;
  if (t < 7.0) return { ns: 'green', ew: 'red', remainingSec: 7.0 - t };
  if (t < 9.0) return { ns: 'yellow', ew: 'red', remainingSec: 9.0 - t };
  if (t < 16.0) return { ns: 'red', ew: 'green', remainingSec: 16.0 - t };
  return { ns: 'red', ew: 'yellow', remainingSec: 18.0 - t };
}

/** Lights the shared lamp materials for the current phase */
export function applySignalLamps(host: TrafficSystem, ns: SignalColor, ew: SignalColor): void {
  host.nsRedMat.emissiveIntensity = ns === 'red' ? 2.8 : 0.05;
  host.nsYellowMat.emissiveIntensity = ns === 'yellow' ? 2.8 : 0.05;
  host.nsGreenMat.emissiveIntensity = ns === 'green' ? 2.8 : 0.05;
  host.ewRedMat.emissiveIntensity = ew === 'red' ? 2.8 : 0.05;
  host.ewYellowMat.emissiveIntensity = ew === 'yellow' ? 2.8 : 0.05;
  host.ewGreenMat.emissiveIntensity = ew === 'green' ? 2.8 : 0.05;
}

/** The riding player entering a signalized junction on red (8m from its centre, 5s cooldown) */
export function checkPlayerRedLight(
  host: TrafficSystem,
  clampedDt: number,
  playerX: number,
  playerZ: number,
  playerSpeedMps: number,
  isRiding: boolean,
  ns: SignalColor,
  ew: SignalColor,
  onRedLightViolation: () => void,
): void {
  if (host.violationCooldown > 0) host.violationCooldown = Math.max(0, host.violationCooldown - clampedDt);
  if (isRiding && Math.abs(playerSpeedMps) > 4.5 && host.violationCooldown <= 0) {
    const moveX = playerX - host.prevPlayerX;
    const moveZ = playerZ - host.prevPlayerZ;
    if (Math.hypot(moveX, moveZ) > 0.05) {
      host.nearSignals.length = 0;
      for (const id of signalNodesNear(playerX, playerZ, 8.0, host.nearSignals)) {
        const sn = ACTIVE_MAP_DATA.nodes[id];
        const prevD = Math.hypot(host.prevPlayerX - sn.x, host.prevPlayerZ - sn.z);
        const curD = Math.hypot(playerX - sn.x, playerZ - sn.z);
        if (prevD > 8.0 && curD <= 8.0) {
          const mySig = getSignalAxis(sn.id, moveX, moveZ) === 'ns' ? ns : ew;
          if (mySig === 'red') {
            host.violationCooldown = 5.0;
            onRedLightViolation();
          }
          break;
        }
      }
      // mid-block signalized crosswalks: crossing the stop band on the car red
      if (host.violationCooldown <= 0) {
        for (let i = 0; i < MID_BLOCK_CROSSINGS.length; i++) {
          const c = MID_BLOCK_CROSSINGS[i];
          if (Math.abs(c.x - playerX) > 14 || Math.abs(c.z - playerZ) > 14) continue;
          const ux = Math.sin(c.h);
          const uz = Math.cos(c.h);
          const prevAlong = (host.prevPlayerX - c.x) * ux + (host.prevPlayerZ - c.z) * uz;
          const along = (playerX - c.x) * ux + (playerZ - c.z) * uz;
          const across = Math.abs((playerX - c.x) * -uz + (playerZ - c.z) * ux);
          if (across > c.w / 2 + 1 || Math.sign(prevAlong) === Math.sign(along)) continue;
          if (midBlockPhaseNow(i).car === 'red') {
            host.violationCooldown = 5.0;
            onRedLightViolation();
          }
          break;
        }
      }
    }
  }
  host.prevPlayerX = playerX;
  host.prevPlayerZ = playerZ;
}

export function buildTrafficSignals(host: TrafficSystem): void {
  const poleMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.45,
    metalness: 0.65,
  });
  const housingMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.55,
  });
  const poleGeo = new THREE.CylinderGeometry(0.1, 0.13, 5.4, 7);
  const armGeo = new THREE.BoxGeometry(0.12, 0.12, 3.6);
  const boxGeo = new THREE.BoxGeometry(1.5, 0.48, 0.26);
  const lampGeo = new THREE.CircleGeometry(0.14, 10);

  // Every gantry part is ONE InstancedMesh for the whole city (was ~11 meshes per gantry,
  // 940 gantries): pole, arm, housing and the 3 lamp colours per signal phase.
  const poleM: THREE.Matrix4[] = [];
  const armM: THREE.Matrix4[] = [];
  const boxM: THREE.Matrix4[] = [];
  const lampM = {
    ns: [[], [], []] as THREE.Matrix4[][],
    ew: [[], [], []] as THREE.Matrix4[][],
  };
  const flip = new THREE.Matrix4().makeRotationY(Math.PI);
  for (const n of ACTIVE_MAP_DATA.nodes) {
    if (!n.isSignal) continue;
    // Place 2 diagonal corner signal gantries at each signalized Suwon intersection
    const corners: Array<[number, number, number, boolean]> = [
      [n.x + 7.2, n.z + 7.2, 0, true],
      [n.x - 7.2, n.z - 7.2, Math.PI / 2, false],
    ];
    for (const [cx, cz, rotY, isNS] of corners) {
      const base = placeMatrix(cx, 0, cz, rotY);
      poleM.push(base.clone().multiply(new THREE.Matrix4().makeTranslation(0, 2.7, 0)));
      armM.push(base.clone().multiply(new THREE.Matrix4().makeTranslation(0, 5.2, -1.7)));
      boxM.push(base.clone().multiply(new THREE.Matrix4().makeTranslation(0, 5.15, -3.1)));
      const lamps = isNS ? lampM.ns : lampM.ew;
      for (const faceDir of [-1, 1]) {
        const zOff = -3.1 + faceDir * 0.14;
        [-0.46, 0, 0.46].forEach((lx, ci) => {
          const local = new THREE.Matrix4().makeTranslation(lx, 5.15, zOff);
          if (faceDir < 0) local.multiply(flip);
          lamps[ci].push(base.clone().multiply(local));
        });
      }
    }
  }
  const parts: THREE.InstancedMesh[] = [
    buildInstanced(poleGeo, poleMat, poleM),
    buildInstanced(armGeo, poleMat, armM),
    buildInstanced(boxGeo, housingMat, boxM),
    buildInstanced(lampGeo, host.nsRedMat, lampM.ns[0]),
    buildInstanced(lampGeo, host.nsYellowMat, lampM.ns[1]),
    buildInstanced(lampGeo, host.nsGreenMat, lampM.ns[2]),
    buildInstanced(lampGeo, host.ewRedMat, lampM.ew[0]),
    buildInstanced(lampGeo, host.ewYellowMat, lampM.ew[1]),
    buildInstanced(lampGeo, host.ewGreenMat, lampM.ew[2]),
  ];
  parts[0].castShadow = true;
  for (const m of parts) {
    excludeFromMirrors(m);
    host.root.add(m);
    freezeStatic(m);
    // 940 gantries city-wide: draw only those around the player
    NEARBY_INSTANCES.register(m, SIGNAL_DRAW_RADIUS_M);
  }
}
