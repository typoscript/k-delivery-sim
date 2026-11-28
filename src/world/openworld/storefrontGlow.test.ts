import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createStorefrontMaterials, setStorefrontNightGlow } from './openWorldMaterials';

describe('storefront night glow', () => {
  it('lit colours by day; signs and warm shop windows glow at night, scaled by nightness', () => {
    const { storefront } = createStorefrontMaterials();
    expect((storefront as THREE.MeshLambertMaterial).vertexColors).toBe(true);
    const u = storefront.userData.nightGlow;
    setStorefrontNightGlow(storefront, 0);
    expect(u.uSignGlow.value).toBe(0);
    expect(u.uInteriorLight.value.r).toBe(0);
    setStorefrontNightGlow(storefront, 1);
    const night = u.uSignGlow.value;
    expect(night).toBeGreaterThan(0.5);
    expect(u.uInteriorLight.value.r).toBeGreaterThan(u.uInteriorLight.value.b); // warm
    setStorefrontNightGlow(storefront, 0.5);
    expect(u.uSignGlow.value).toBeCloseTo(night / 2);
    // the glow is patched into the lit shader (same material, no extra draw call)
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: '',
      fragmentShader: '#include <common>\nvoid main() {\n#include <emissivemap_fragment>\n}',
    };
    storefront.onBeforeCompile(shader as never, {} as never);
    expect(shader.uniforms.uSignGlow).toBe(u.uSignGlow);
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance += vColor.rgb * uSignGlow');
  });
});
