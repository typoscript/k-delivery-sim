import { describe, expect, it } from 'vitest';
import { offerBannerText } from './topbarBanners';
import type { DispatchOffer } from '../../delivery/OrderDispatchManager';

const offer = (over: Partial<DispatchOffer> = {}): DispatchOffer =>
  ({
    id: 'O1',
    type: 'SINGLE',
    orders: [{ special: undefined }],
    totalFee: 11400,
    totalRainBonus: 0,
    totalNightBonus: 0,
    totalPeakBonus: 1000,
    totalDistanceMeters: 491,
    timeLimitSec: 300,
    remainingOfferSec: 16.2,
    durationOfferSec: 20,
    pulseTick: 1,
    rival: null,
    rivalTakesAtSec: -Infinity,
    ...over,
  }) as unknown as DispatchOffer;

describe('compact call banner text', () => {
  it('shows type, fee, seconds left, distance and surcharges', () => {
    expect(offerBannerText(offer())).toEqual({ title: '🚀 한집 ₩11,400', meta: '17초 · 491m · 🔥피크' });
  });

  it('marks bundles, special orders and a competing rival', () => {
    expect(offerBannerText(offer({ type: 'ALTTLE_BUNDLE', totalPeakBonus: 0 })).title).toBe('🛵 알뜰 2건 ₩11,400');
    expect(offerBannerText(offer({ orders: [{ special: 'urgent' }] as never })).title).toBe('⏱️ 급한 배달 ₩11,400');
    expect(offerBannerText(offer({ rival: { rivalId: 'r', distM: 42.4 } })).meta).toContain('🛵경쟁 42m');
  });
});
