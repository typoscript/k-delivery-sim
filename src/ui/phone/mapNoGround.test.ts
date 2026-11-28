import { describe, expect, it } from 'vitest';
import { drawRouteLayer } from './mapRouteLayers';
import { isNoGroundVehicleComplex } from '../../delivery/apartmentRules';
import type { MapFrame } from './mapFrame';
import type { DeliveryLocation } from '../../types';

const apt = (name: string): DeliveryLocation => ({
  id: name,
  name,
  x: 50,
  z: 50,
  type: 'residential',
  emoji: '🏢',
  residenceKind: 'apartment',
});
const names = Array.from({ length: 100 }, (_, i) => `지도테스트${i}아파트 101동`);
const banned = apt(names.find((n) => isNoGroundVehicleComplex(apt(n)))!);
const open = apt(names.find((n) => !isNoGroundVehicleComplex(apt(n)))!);

/** Draws the route layer with one drop-off stop and returns the texts written on the canvas */
function textsFor(location: DeliveryLocation, isCurrent: boolean): string[] {
  const texts: string[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, key) => (key === 'fillText' ? (s: string) => texts.push(s) : () => undefined),
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  const stop = { kind: 'dropoff', location, x: 50, z: 50, isCurrent };
  drawRouteLayer({
    ctx,
    player: { inCorridor: false, heading: 0 },
    navPlan: { recommendedStops: [stop], route: [] },
    elapsedTime: 0,
    rotateHeadingUp: false,
    toX: (x: number) => x * 2,
    toY: (z: number) => z * 2,
  } as unknown as MapFrame);
  return texts;
}

describe('phone map: 지상 차량 출입 금지 단지', () => {
  it('rings a no-vehicle complex on the route with a park-outside badge; other places get none', () => {
    expect(textsFor(banned, true)).toContain('🚫 정문 밖 주차');
    expect(textsFor(banned, false)).toContain('🚫 지상 차량X');
    expect(textsFor(open, true).some((t) => t.startsWith('🚫'))).toBe(false);
  });
});
