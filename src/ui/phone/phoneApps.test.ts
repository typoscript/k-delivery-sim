import { describe, expect, it } from 'vitest';
import { PHONE_APPS, dock3DLayout, hitDock3D } from './weatherApp';

describe('phone app dock', () => {
  it('the 3D dock is a strip at the bottom of the screen, one pill per app, and taps hit them', () => {
    const w = 360;
    const h = 680;
    const pills = dock3DLayout(w);
    expect(pills.map((p) => p.id)).toEqual(PHONE_APPS.map((a) => a.id));
    for (const p of pills) expect(hitDock3D((p.x0 + p.x1) / 2, h - 15, w, h)).toBe(p.id);
    expect(hitDock3D(pills[0].x0 + 5, 300, w, h)).toBeNull(); // the app itself
    expect(hitDock3D(5, h - 15, w, h)).toBeNull(); // the strip's margin
  });
});
