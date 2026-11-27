/** Bus stops and street lamps (with their night light pools) */
import * as THREE from 'three';
import { excludeFromMirrors, freezeStatic } from './renderLayers';
import { buildInstanced, mergeStaticByMaterial, placeMatrix } from './instancing';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import { createSignTexture, createLampPoolTexture } from './cityTextures';
import type { CityWorld } from './CityWorld';

/** Builds 8 real Suwon City Hall Station / NewCore / Ingye bus stops from OSM */
export function buildBusStops(host: CityWorld): void {
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.65, roughness: 0.35 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xbae6fd,
    transparent: true,
    opacity: 0.42,
    roughness: 0.15,
  });
  const benchMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.65 });

  for (const bs of ACTIVE_MAP_DATA.busStops) {
    host.busStops.push({
      name: bs.name,
      x: bs.x,
      z: bs.z,
      shelterX: bs.shelterX,
      shelterZ: bs.shelterZ,
      facingHeading: bs.facingHeading,
      edgeIndex: bs.edgeIndex,
    });

    const buildShelter = () => {
    const g = new THREE.Group();
    g.position.set(bs.shelterX, 0.05, bs.shelterZ);
    g.rotation.y = bs.facingHeading;

    const roof = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.14, 1.6), steelMat);
    roof.position.set(0, 2.55, 0);
    const backGlass = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.0, 0.08), glassMat);
    backGlass.position.set(0, 1.35, -0.65);
    const bench = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.12, 0.48), benchMat);
    bench.position.set(0, 0.5, -0.3);

    const signMat = new THREE.MeshBasicMaterial({
      map: createSignTexture(`🚌 ${bs.name.slice(0, 12)}`, '#1d4ed8', '#ffffff'),
    });
    const signBoard = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.55, 0.12), signMat);
    signBoard.position.set(0, 2.95, 0.65);
    g.add(roof, backGlass, bench, signBoard);
    const dispose = () => {
      for (const m of [roof, backGlass, bench, signBoard]) m.geometry.dispose();
      // geometries created by the per-material merge
      g.traverse((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.dispose());
      signMat.map?.dispose();
      signMat.dispose();
    };
    return { object: g, dispose };
    };
    if (host.culler) {
      // 228 city-wide stops: build (and texture) each shelter only when the player gets close
      host.culler.registerLazy(host.root, bs.shelterX, bs.shelterZ, () => {
        const built = buildShelter();
        mergeStaticByMaterial(built.object);
        excludeFromMirrors(built.object);
        freezeStatic(built.object);
        return built;
      });
    } else {
      host.root.add(buildShelter().object);
    }
  }
}

export function buildStreetLamps(host: CityWorld): void {
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.6, roughness: 0.4 });
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.11, 6.2, 6);
  const lampGeo = new THREE.BoxGeometry(0.52, 0.14, 0.26);

  const lampPositions: Array<[number, number]> = [];
  for (const n of ACTIVE_MAP_DATA.nodes) {
    if (!n.isSignal) continue;
    lampPositions.push([n.x + 8.0, n.z + 8.0], [n.x - 8.0, n.z - 8.0]);
  }
  const poolMat = new THREE.MeshBasicMaterial({
    map: createLampPoolTexture(),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const poolGeo = new THREE.PlaneGeometry(14, 14);
  poolGeo.rotateX(-Math.PI / 2);

  // All lamp poles / heads / night light pools city-wide: 3 InstancedMeshes (was 3 meshes per lamp)
  const poles = buildInstanced(poleGeo, poleMat, lampPositions.map(([lx, lz]) => placeMatrix(lx, 3.15, lz)));
  const heads = buildInstanced(lampGeo, host.lampGlowMat, lampPositions.map(([lx, lz]) => placeMatrix(lx, 6.25, lz)));
  // Warm golden streetlamp light pools projected onto asphalt at night (zero PointLight cost!)
  const pools = buildInstanced(poolGeo, poolMat, lampPositions.map(([lx, lz]) => placeMatrix(lx, 0.072, lz)));
  poles.castShadow = true;
  for (const m of [poles, heads]) {
    excludeFromMirrors(m);
    host.root.add(m);
    freezeStatic(m);
  }
  excludeFromMirrors(pools);
  host.streetLampPoolGroup.add(pools);
  freezeStatic(pools);
  host.streetLampPoolGroup.visible = false;
  host.root.add(host.streetLampPoolGroup);
}
