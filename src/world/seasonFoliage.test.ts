import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FOLIAGE, FOLIAGE_LOOK, applySeasonFoliage, setFoliageSeason } from './seasonFoliage';
import { applySnowCover } from './snowCover';

describe('seasonal foliage', () => {
  it('sets the shared leaf colours per season (summer stays green)', () => {
    setFoliageSeason('autumn');
    expect(FOLIAGE.uFoliageMix.value).toBe(FOLIAGE_LOOK.autumn.mix);
    expect(FOLIAGE.uFoliageA.value.getHex()).toBe(FOLIAGE_LOOK.autumn.a);
    setFoliageSeason('summer');
    expect(FOLIAGE.uFoliageMix.value).toBe(0);
  });

  it('recolours leaves after the vertex colours and before the snow (snow still covers autumn leaves)', () => {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    applySeasonFoliage(mat);
    applySnowCover(mat, 0.85, 0.05);
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: '#include <common>\n#include <defaultnormal_vertex>',
      fragmentShader: '#include <common>\n#include <color_fragment>\n#include <alphamap_fragment>',
    };
    mat.onBeforeCompile(shader as never, {} as never);
    const fs = shader.fragmentShader;
    expect(shader.uniforms.uFoliageMix).toBe(FOLIAGE.uFoliageMix);
    expect(fs.indexOf('#include <color_fragment>')).toBeLessThan(fs.indexOf('seasonLeaf'));
    expect(fs.indexOf('seasonLeaf')).toBeLessThan(fs.indexOf('snowAmt'));
    expect(fs.indexOf('snowAmt')).toBeLessThan(fs.indexOf('#include <alphamap_fragment>'));
    expect(mat.customProgramCacheKey()).toContain('foliage');
  });
});
