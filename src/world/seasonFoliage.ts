/**
 * Seasonal foliage: tree crowns turn pink in spring (cherry blossoms), stay green in summer, go orange / yellow in
 * autumn and dry brown in winter. Patched into the tree materials' shaders: only leaf-green colours are recoloured
 * (trunks, poles and lamps keep theirs), two shades per season picked from each tree's own green so neighbouring
 * trees differ. One set of shared uniforms - no extra draw calls or textures.
 */
import * as THREE from 'three';
import type { SeasonId } from '../game/seasons';

/** Shared uniforms of every patched material */
export const FOLIAGE = {
  uFoliageMix: { value: 0 },
  uFoliageA: { value: new THREE.Color() },
  uFoliageB: { value: new THREE.Color() },
};

/** Two leaf colours and how far leaves turn to them, per season */
export const FOLIAGE_LOOK: Record<SeasonId, { a: number; b: number; mix: number }> = {
  spring: { a: 0xf9a8d4, b: 0xfbcfe8, mix: 0.8 },
  summer: { a: 0x2f6b2f, b: 0x3f7d3a, mix: 0 },
  autumn: { a: 0xea580c, b: 0xeab308, mix: 0.88 },
  winter: { a: 0x8d8279, b: 0x7a6e64, mix: 0.95 },
};

export function setFoliageSeason(season: SeasonId): void {
  const look = FOLIAGE_LOOK[season];
  FOLIAGE.uFoliageMix.value = look.mix;
  FOLIAGE.uFoliageA.value.setHex(look.a);
  FOLIAGE.uFoliageB.value.setHex(look.b);
}

/** Recolours the leaf-green parts of a material by season (keeps any existing onBeforeCompile) */
export function applySeasonFoliage(mat: THREE.Material): void {
  if (mat.userData.seasonFoliage) return;
  mat.userData.seasonFoliage = true;
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey();
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    Object.assign(shader.uniforms, FOLIAGE);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uFoliageMix;\nuniform vec3 uFoliageA;\nuniform vec3 uFoliageB;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          // leaves only: clearly green (trunks are brown, poles grey)
          float leaf = smoothstep(0.02, 0.06, diffuseColor.g - max(diffuseColor.r, diffuseColor.b));
          vec3 seasonLeaf = mix(uFoliageA, uFoliageB, step(0.5, fract(diffuseColor.g * 7.0)));
          diffuseColor.rgb = mix(diffuseColor.rgb, seasonLeaf, leaf * uFoliageMix);
        }`,
      );
  };
  mat.customProgramCacheKey = () => `${prevKey}|foliage`;
  mat.needsUpdate = true;
}
