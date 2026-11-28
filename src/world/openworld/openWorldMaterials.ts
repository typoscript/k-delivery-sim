import * as THREE from 'three';
import { createAsphaltTexture, createBuildingMaterials } from '../cityTextures';
import { ChunkMaterials } from './ChunkMeshBuilder';

/** Shared (never per-chunk) materials for streamed open-world chunks — same facades as CityWorld */
export function createOpenWorldMaterials(): ChunkMaterials {
  const b = createBuildingMaterials();
  const asphalt = createAsphaltTexture();
  // Chunk road UVs are already in tiles (1 per 10m), so don't double the repeat
  asphalt.repeat.set(1, 1);
  return {
    walls: { shop: b.shopWallMat, apt: b.aptWallMat, villa: b.villaWallMat, public: b.publicWallMat },
    roof: b.roofMat,
    road: new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.9, metalness: 0.04 }),
    roadLine: new THREE.MeshBasicMaterial({ color: 0xfacc15 }),
    park: new THREE.MeshStandardMaterial({ color: 0x4d7c4f, roughness: 0.95 }),
    water: new THREE.MeshStandardMaterial({ color: 0x3b82c4, roughness: 0.25, metalness: 0.1 }),
    plaza: new THREE.MeshStandardMaterial({ color: 0xc29e83, roughness: 0.84 }),
    farBuildings: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }),
    ...createStorefrontMaterials(),
  };
}

/** Ground-floor shopfronts: dark glass with a warm lit interior; signboards unlit so they read at night too */
export function createStorefrontMaterials(): { storefrontGlass: THREE.Material; storefrontSign: THREE.Material } {
  return {
    storefrontGlass: new THREE.MeshLambertMaterial({ color: 0x3b5068, emissive: 0x3d3322, emissiveIntensity: 0.5 }),
    storefrontSign: new THREE.MeshBasicMaterial({ vertexColors: true }),
  };
}
