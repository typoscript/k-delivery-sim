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

/** Warm light of a lit shop interior seen through the glass at night */
const SHOP_INTERIOR_LIGHT = new THREE.Color(1.0, 0.62, 0.28);

/**
 * Ground-floor shopfronts (glass + signboards): lit vertex colours by day; at night (`setStorefrontNightGlow`)
 * the signboards light up in their own colour and the dark glass glows with warm interior light. The glow is
 * added in the shader (emissive = vertex colour x glow), so it stays one material / one draw call per chunk.
 */
export function createStorefrontMaterials(): { storefront: THREE.Material } {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const uniforms = { uSignGlow: { value: 0 }, uInteriorLight: { value: new THREE.Color(0, 0, 0) } };
  mat.userData.nightGlow = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSignGlow;\nuniform vec3 uInteriorLight;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        #ifdef USE_COLOR
          // signs glow in their own colour; the dark glass (low luminance) shows the lit shop inside
          float shopLum = dot(vColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          totalEmissiveRadiance += vColor.rgb * uSignGlow + uInteriorLight * (1.0 - smoothstep(0.02, 0.07, shopLum));
        #endif`
      );
  };
  mat.customProgramCacheKey = () => 'storefront-night-glow';
  return { storefront: mat };
}

/** Night glow of the storefront material: 0 = day (plain lit colours) .. 1 = night (signs and windows lit) */
export function setStorefrontNightGlow(mat: THREE.Material, nightness: number): void {
  const u = mat.userData.nightGlow as
    | { uSignGlow: { value: number }; uInteriorLight: { value: THREE.Color } }
    | undefined;
  if (!u) return;
  const k = Math.max(0, Math.min(1, nightness));
  u.uSignGlow.value = 0.6 * k;
  u.uInteriorLight.value.copy(SHOP_INTERIOR_LIGHT).multiplyScalar(0.2 * k);
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
