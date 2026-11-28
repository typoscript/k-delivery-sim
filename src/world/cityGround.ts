/** Base ground plane and the delivery locations (shops / residences) with their pickup trays and lobby doors */
import type { CityWorld } from './CityWorld';
import * as THREE from 'three';
import { CITY_WORLD_LIMIT } from '../types';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import { applySnowCover } from './snowCover';

const snowy = <T extends THREE.Material>(m: T): T => (applySnowCover(m), m);

export function buildBaseGround(host: CityWorld): void {
  // Outer Suwon suburban backdrop greenbelt
  const outerGround = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY_WORLD_LIMIT * 2 + 600, CITY_WORLD_LIMIT * 2 + 600),
    snowy(new THREE.MeshStandardMaterial({ color: 0x527358, roughness: 0.95 })),
  );
  outerGround.rotation.x = -Math.PI / 2;
  outerGround.position.y = -0.02;
  host.root.add(outerGround);

  // Korean urban sidewalk interlocking brick base across playable Suwon Ingye-dong district
  const sidewalkBase = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY_WORLD_LIMIT * 2, CITY_WORLD_LIMIT * 2),
    snowy(new THREE.MeshStandardMaterial({ map: host.sizedSidewalkTexture(), roughness: 0.88 })),
  );
  sidewalkBase.rotation.x = -Math.PI / 2;
  sidewalkBase.position.y = 0;
  sidewalkBase.receiveShadow = true;
  host.root.add(sidewalkBase);

  // Subtle perimeter boundary walls at ±CITY_WORLD_LIMIT
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.8 });
  const lim = CITY_WORLD_LIMIT;
  const walls: Array<[number, number, number, number]> = [
    [0, lim, lim * 2, 1.4],
    [0, -lim, lim * 2, 1.4],
    [lim, 0, 1.4, lim * 2],
    [-lim, 0, 1.4, lim * 2],
  ];
  for (const [x, z, w, l] of walls) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.4, l), wallMat);
    m.position.set(x, 0.7, z);
    host.root.add(m);
  }
}

export function initDeliveryLocations(host: CityWorld): void {
  for (const s of ACTIVE_MAP_DATA.shops) {
    host.locations.push({
      id: s.id,
      name: s.name,
      x: s.x,
      z: s.z,
      type: 'shop',
      emoji: s.emoji,
      facingHeading: s.facingHeading,
      menus: s.menus,
    });
  }
  for (const r of ACTIVE_MAP_DATA.residences) {
    host.locations.push({
      id: r.id,
      name: r.name,
      x: r.x,
      z: r.z,
      type: 'residential',
      residenceKind: r.residenceKind,
      emoji: r.emoji,
      facingHeading: r.facingHeading,
    });
  }
}
