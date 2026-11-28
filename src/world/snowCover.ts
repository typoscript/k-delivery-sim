/**
 * Snow cover: while it snows, surfaces facing up (roofs, sidewalks, parks, tree tops, car roofs) slowly turn white,
 * and melt again after the snow stops. One shared uniform drives every patched material (`applySnowCover`), so it
 * costs no extra draw calls or textures - only a few shader instructions. Roads get only a light slush.
 */
import * as THREE from 'three';

/** 0 = bare .. 1 = fully covered (shared by every patched material) */
export const SNOW_COVER = { value: 0 };

const SNOW_WHITE = 'vec3(0.9, 0.92, 0.95)';
/** Real seconds of snowfall to cover the city, and of dry weather to melt it again */
export const SNOW_COVER_SEC = 90;
export const SNOW_MELT_SEC = 150;

/**
 * Patches a lit material so its up-facing surfaces whiten with SNOW_COVER (`strength`: how white it gets at full
 * cover; `upFrom`: how steep a face still gets snow, lower for round tree crowns seen from below). Keeps any existing onBeforeCompile (wet asphalt, storefront glow). Not for InstancedMesh materials.
 */
export function applySnowCover(mat: THREE.Material, strength = 1, upFrom = 0.55): void {
  if (mat.userData.snowCover !== undefined) return;
  mat.userData.snowCover = strength;
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey();
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.uniforms.uSnowCover = SNOW_COVER;
    shader.uniforms.uSnowStrength = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vSnowUp;')
      .replace(
        '#include <defaultnormal_vertex>',
        '#include <defaultnormal_vertex>\n  vSnowUp = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz).y;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vSnowUp;\nuniform float uSnowCover;\nuniform float uSnowStrength;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float snowAmt = uSnowCover * uSnowStrength * smoothstep(${upFrom.toFixed(2)}, ${(upFrom + 0.3).toFixed(2)}, vSnowUp);
        diffuseColor.rgb = mix(diffuseColor.rgb, ${SNOW_WHITE}, snowAmt);`,
      );
  };
  mat.customProgramCacheKey = () => `${prevKey}|snow${strength}|${upFrom}`;
  mat.needsUpdate = true;
}

/**
 * Advances the cover: builds up while snowing (`snowing` 0..1 intensity), melts otherwise. `dt` in seconds of game
 * frame time (never wall-clock). Returns the new cover.
 */
export function stepSnowCover(cover: number, snowing: number, dt: number): number {
  if (snowing > 0.5) return Math.min(1, cover + dt / SNOW_COVER_SEC);
  return Math.max(0, cover - dt / SNOW_MELT_SEC);
}
