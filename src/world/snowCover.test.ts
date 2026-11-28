import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SNOW_COVER, SNOW_COVER_SEC, SNOW_MELT_SEC, applySnowCover, stepSnowCover } from './snowCover';

describe('snow cover', () => {
  it('builds up while it snows and melts slower after it stops', () => {
    let c = 0;
    for (let t = 0; t < SNOW_COVER_SEC / 2; t += 0.5) c = stepSnowCover(c, 1, 0.5);
    expect(c).toBeCloseTo(0.5, 2);
    for (let t = 0; t < SNOW_COVER_SEC; t += 0.5) c = stepSnowCover(c, 1, 0.5);
    expect(c).toBe(1);
    for (let t = 0; t < SNOW_MELT_SEC / 2; t += 0.5) c = stepSnowCover(c, 0, 0.5);
    expect(c).toBeCloseTo(0.5, 2);
    for (let t = 0; t < SNOW_MELT_SEC; t += 0.5) c = stepSnowCover(c, 0, 0.5);
    expect(c).toBe(0);
  });

  it('patches up-facing whitening into the shader, keeping an existing patch, once per material', () => {
    const mat = new THREE.MeshStandardMaterial();
    let earlier = 0;
    mat.onBeforeCompile = () => {
      earlier++;
    };
    applySnowCover(mat, 0.3);
    applySnowCover(mat, 1); // ignored: already patched
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: '#include <common>\n#include <defaultnormal_vertex>',
      fragmentShader: '#include <common>\n#include <color_fragment>',
    };
    mat.onBeforeCompile(shader as never, {} as never);
    expect(earlier).toBe(1);
    expect(shader.uniforms.uSnowCover).toBe(SNOW_COVER);
    expect(shader.uniforms.uSnowStrength.value).toBe(0.3);
    expect(shader.vertexShader).toContain('vSnowUp =');
    expect(shader.fragmentShader).toContain('smoothstep(0.55, 0.85, vSnowUp)');
    expect(mat.customProgramCacheKey()).toContain('snow0.3');
  });
});
