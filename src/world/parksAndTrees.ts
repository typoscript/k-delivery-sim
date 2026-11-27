/** Parks, street trees and park signs */
import * as THREE from 'three';
import { CITY_WORLD_LIMIT } from '../types';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import { createSignTexture } from './cityTextures';
import type { CityWorld } from './CityWorld';

/** Builds real Suwon Ingye-dong parks (효원공원 etc.) and InstancedMesh urban street trees */
export function buildParksAndTrees(host: CityWorld): void {
  const parkMat = new THREE.MeshStandardMaterial({ color: 0x4b9454, roughness: 0.92 });
  const treeCoords: Array<[number, number, number]> = [];

  for (const park of ACTIVE_MAP_DATA.parks) {
    if (park.pts.length < 3) continue;
    const shape = new THREE.Shape();
    shape.moveTo(park.pts[0][0], -park.pts[0][1]);
    for (let i = 1; i < park.pts.length; i++) {
      shape.lineTo(park.pts[i][0], -park.pts[i][1]);
    }
    shape.closePath();

    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, parkMat);
    mesh.position.y = 0.06;
    mesh.receiveShadow = true;
    host.root.add(mesh);

    // Scatter park trees neatly around park interior
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    let cx = 0, cz = 0;
    for (const [px, pz] of park.pts) {
      cx += px;
      cz += pz;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (pz < minZ) minZ = pz;
      if (pz > maxZ) maxZ = pz;
    }
    cx /= park.pts.length;
    cz /= park.pts.length;

    // Put trees along inset perimeter + center cluster
    for (let i = 0; i < park.pts.length; i++) {
      const [px, pz] = park.pts[i];
      const tx = cx + (px - cx) * 0.72;
      const tz = cz + (pz - cz) * 0.72;
      if (treeCoords.length < 180) {
        treeCoords.push([tx, tz, 0.9 + (i % 3) * 0.14]);
      }
    }
    if (park.name.includes('효원공원')) {
      // Landmark park sign for 효원공원!
      const sign = new THREE.Mesh(
        new THREE.BoxGeometry(6.8, 1.8, 0.3),
        new THREE.MeshBasicMaterial({ map: createSignTexture('🌳 효원공원 (인계동)', '#14532d', '#dcfce7') })
      );
      sign.position.set(cx, 3.2, cz);
      host.root.add(sign);
      host.zones.push({ name: '효원공원', x: cx, z: cz, type: 'residential' });
    }
  }

  // Real OSM Water Bodies (광교 호수공원 원천호수 등)
  if (ACTIVE_MAP_DATA.waters && ACTIVE_MAP_DATA.waters.length > 0) {
    const lakeMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      emissive: 0x0369a1,
      emissiveIntensity: 0.18,
      roughness: 0.14,
      metalness: 0.38,
    });
    for (const water of ACTIVE_MAP_DATA.waters) {
      if (water.pts.length < 3) continue;
      const wShape = new THREE.Shape();
      wShape.moveTo(water.pts[0][0], -water.pts[0][1]);
      for (let i = 1; i < water.pts.length; i++) {
        wShape.lineTo(water.pts[i][0], -water.pts[i][1]);
      }
      wShape.closePath();
      const wGeo = new THREE.ShapeGeometry(wShape);
      wGeo.rotateX(-Math.PI / 2);
      const wMesh = new THREE.Mesh(wGeo, lakeMat);
      wMesh.position.y = 0.068;
      wMesh.receiveShadow = true;
      host.root.add(wMesh);
    }
  }

  // Perimeter greenbelt trees
  const lim = CITY_WORLD_LIMIT;
  for (let p = -(lim - 30); p <= lim - 30; p += 38) {
    treeCoords.push([p, -(lim - 8), 1.15], [p, lim - 8, 1.15], [-(lim - 8), p, 1.15], [lim - 8, p, 1.15]);
  }

  if (treeCoords.length > 0) {
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 2.5, 6);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4f35, roughness: 0.9 });
    const crownGeo = new THREE.SphereGeometry(1.95, 8, 6);
    const crownMat = new THREE.MeshStandardMaterial({ color: 0x2f7a42, roughness: 0.85 });

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCoords.length);
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, treeCoords.length);
    const dummy = new THREE.Object3D();
    treeCoords.forEach(([x, z, s], i) => {
      dummy.position.set(x, 1.25 * s, z);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);

      dummy.position.set(x, 3.7 * s, z);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      crowns.setMatrixAt(i, dummy.matrix);
    });
    host.root.add(trunks, crowns);
  }
}
