import { describe, expect, it } from 'vitest';
import { callBannerRect, hitCallBanner } from './callBanner3D';

const W = 360; // 3D phone canvas width

describe('3D phone call banner taps', () => {
  it('maps the accept / reject buttons and the banner body', () => {
    const r = callBannerRect(W);
    const midY = r.y + r.h / 2;
    expect(hitCallBanner(r.x + r.w - 32, midY, W)).toBe('reject_offer');
    expect(hitCallBanner(r.x + r.w - 100, midY, W)).toBe('accept_offer');
    expect(hitCallBanner(r.x + 40, midY, W)).toBe('expand_offer');
  });

  it('ignores taps outside the banner (the map below stays tappable)', () => {
    const r = callBannerRect(W);
    expect(hitCallBanner(W / 2, r.y + r.h + 40, W)).toBeNull();
    expect(hitCallBanner(W / 2, 10, W)).toBeNull();
  });
});
