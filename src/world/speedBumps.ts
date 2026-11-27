/** Speed bumps with their warning signs */
import * as THREE from 'three';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import { createSignTexture, createSpeedBumpTexture } from './cityTextures';
import type { CityWorld } from './CityWorld';

/** Builds 14 Korean yellow/black striped rounded speed bumps on real Suwon residential/alley roads */
export function buildSpeedBumps(host: CityWorld): void {
  const nodes = ACTIVE_MAP_DATA.nodes;
  const bumpMat = new THREE.MeshStandardMaterial({
    map: createSpeedBumpTexture(),
    roughness: 0.72,
    metalness: 0.08,
  });
  const signPoleMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.5, roughness: 0.5 });
  const signFaceMat = new THREE.MeshBasicMaterial({
    map: createSignTexture('⚠️ 과속방지턱', '#facc15', '#0f172a'),
  });

  // Pick up to 14 well-spaced residential / alley / secondary road segments!
  const candidates = ACTIVE_MAP_DATA.edges
    .filter((e) => !e.isMajor && e.dist >= 28 && e.width >= 7.0)
    .sort((a, b) => b.dist - a.dist);

  // Legacy district: 14 bumps; unified city: same density (~1 per 0.05 km^2 of road network) up to 160
  const maxBumps = host.unified ? 160 : 14;
  for (const e of candidates) {
    if (host.speedBumps.length >= maxBumps) break;
    const na = nodes[e.a];
    const nb = nodes[e.b];
    const mx = (na.x + nb.x) * 0.5;
    const mz = (na.z + nb.z) * 0.5;
    if (host.speedBumps.some((b) => Math.hypot(b.x - mx, b.z - mz) < 62)) continue;

    const angle = Math.atan2(nb.x - na.x, nb.z - na.z); // travel direction heading (0 = +Z)
    const humpLength = e.width * 0.92;

    const humpGeo = new THREE.CylinderGeometry(0.15, 0.15, humpLength, 10, 1, false, 0, Math.PI);
    humpGeo.rotateZ(Math.PI / 2); // arch bulges +Y, length along X, travel depth along Z
    humpGeo.scale(1, 1, 6.8);

    const hump = new THREE.Mesh(humpGeo, bumpMat);
    hump.position.set(mx, 0.036, mz);
    hump.rotation.y = angle;
    hump.receiveShadow = true;
    hump.castShadow = true;
    host.addProp(hump, mx, mz);

    // Curbside warning signpost
    const rx = -Math.cos(angle);
    const rz = Math.sin(angle);
    const sx = mx + rx * (e.width * 0.5 + 0.9);
    const sz = mz + rz * (e.width * 0.5 + 0.9);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.0, 6), signPoleMat);
    pole.position.set(sx, 1.0, sz);
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.34, 0.05), signFaceMat);
    board.position.set(sx, 1.85, sz);
    board.rotation.y = angle;
    host.addProp(pole, sx, sz);
    host.addProp(board, sx, sz);

    host.speedBumps.push({
      id: `bump-${host.speedBumps.length + 1}`,
      x: mx,
      z: mz,
      axis: Math.abs(Math.sin(angle)) > 0.7 ? 'ew' : 'ns',
      angle,
      halfLength: humpLength * 0.5,
      halfWidth: 1.25,
      label: e.name ? `${e.name} 과속방지턱` : '인계동 이면도로 과속방지턱',
    });
  }
}
