import * as THREE from 'three';
import { createAsphaltTexture, createBuildingMaterials } from '../cityTextures';
import { ChunkMaterials, ROAD_TEXT_ROWS } from './ChunkMeshBuilder';

/** Shared (never per-chunk) materials for streamed open-world chunks — same facades as CityWorld */
export function createOpenWorldMaterials(): ChunkMaterials {
  const b = createBuildingMaterials();
  for (const m of [b.shopWallMat, b.aptWallMat, b.villaWallMat, b.publicWallMat]) m.vertexColors = true;
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
    ...createRoadEdgeMaterials(),
    ...createRoadTextMaterial(),
  };
}

/** Road paint (yellow / white) and concrete curbs of chunk roads: one vertex-coloured material */
export function createRoadEdgeMaterials(): { roadMarkings: THREE.Material } {
  return { roadMarkings: new THREE.MeshLambertMaterial({ vertexColors: true }) };
}

/** Ground-floor shopfronts (glass + signboards): unlit vertex colours so signs read at night too */
export function createStorefrontMaterials(): { storefront: THREE.Material } {
  return { storefront: new THREE.MeshBasicMaterial({ vertexColors: true }) };
}

/** Road lettering atlas: one row per word (see ROAD_TEXT_ROWS), white paint on transparent */
export function createRoadTextMaterial(): { roadText: THREE.Material } {
  const words = ROAD_TEXT_ROWS;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128 * words.length;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    words.forEach((w, i) => {
      ctx.fillStyle = w === '어린이보호구역' ? '#f8fafc' : '#f1f5f9';
      ctx.font = `900 ${w.length > 4 ? 64 : 92}px sans-serif`;
      ctx.fillText(w, 256, 128 * i + 66, 500);
    });
  }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return {
    roadText: new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      opacity: 0.9,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
  };
}
