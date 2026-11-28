import { describe, expect, it } from 'vitest';
import {
  CURB_OFFSET_M,
  PROP_BACK_M,
  classifyShop,
  fillShop,
  curbSpot,
  generateDeliverySpots,
  pointInRing,
  residenceKindOf,
  residenceName,
} from './delivery-spots.mjs';

describe('shop categories', () => {
  it('classifies by name keywords first, then cuisine / amenity tags', () => {
    expect(classifyShop({ name: '교촌치킨 매탄점', amenity: 'restaurant' }).id).toBe('chicken');
    expect(classifyShop({ name: '돼지국밥집', amenity: 'restaurant' }).id).toBe('gukbap');
    expect(classifyShop({ name: '스타벅스 수원역점', amenity: 'cafe' }).id).toBe('cafe');
    expect(classifyShop({ name: 'Domino Pizza', amenity: 'fast_food' }).id).toBe('pizza');
    expect(classifyShop({ name: '행복한집', amenity: 'restaurant', cuisine: 'chinese' }).id).toBe('chinese');
    expect(classifyShop({ name: '어느 카운터', amenity: 'cafe' }).id).toBe('cafe');
    expect(classifyShop({ name: '동네빵집', shop: 'bakery' }).id).toBe('bakery');
    expect(classifyShop({ name: '엄마손', amenity: 'restaurant' }).id).toBe('korean');
  });

  it('gives every category 3 menus and an emoji', () => {
    for (const name of ['치킨', '마라탕', '분식', '초밥', '빙수', '포차']) {
      const c = classifyShop({ name, amenity: 'restaurant' });
      expect(c.menus).toHaveLength(3);
      expect(c.emoji.length).toBeGreaterThan(0);
    }
  });
});

describe('gap-filling local shops', () => {
  it('are deterministic, neutral (no brands) and carry the category menus', () => {
    expect(fillShop(0.42, 0.7)).toEqual(fillShop(0.42, 0.7));
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      const { cat, name } = fillShop(i / 200, ((i * 37) % 200) / 200);
      seen.add(cat.id);
      expect(cat.menus).toHaveLength(3);
      expect(name).toMatch(/^\S+ \S+$/);
    }
    expect(seen.size).toBeGreaterThanOrEqual(10);
  });
});

describe('residences', () => {
  it('picks apartment / villa / officetel kinds from building tags and size', () => {
    expect(residenceKindOf({ building: 'apartments' }, 900, 45)).toBe('apartment');
    expect(residenceKindOf({ building: 'apartments' }, 200, 12)).toBe('walkup_villa');
    expect(residenceKindOf({ building: 'yes' }, 150, 9.9)).toBe('walkup_villa');
    expect(residenceKindOf({ building: 'yes', name: '센트럴 오피스텔' }, 600, 40)).toBe('officetel');
    expect(residenceKindOf({ building: 'yes' }, 40, 7.5)).toBeNull(); // too small (shed / kiosk)
    expect(residenceKindOf({ building: 'house' }, 2000, 6.5)).toBeNull(); // too big for a villa
  });

  it('names bare "101동" blocks after their apartment complex', () => {
    expect(residenceName('apartment', { name: '101동' }, '매탄위브하늘채', 0.1, 0.2)).toBe('매탄위브하늘채 101동');
    expect(residenceName('apartment', { name: '1002' }, '원천레이크파크', 0.1, 0.2)).toBe('원천레이크파크 1002동');
    expect(residenceName('apartment', { name: '래미안 102동' }, '단지', 0.1, 0.2)).toBe('래미안 102동');
    const a = residenceName('walkup_villa', {}, null, 0.3, 0.9);
    expect(a).toBe(residenceName('walkup_villa', {}, null, 0.3, 0.9)); // deterministic
    expect(a.length).toBeGreaterThan(1);
  });
});

describe('curb spot convention', () => {
  it('stands just outside the road edge on the building side, facing the road, prop behind', () => {
    // road along +Z at x = 0, 10m wide; building on the +X (west) side
    const s = curbSpot(20, 50, 0, 0, 0, 100, 10);
    expect(s.x).toBeCloseTo(5 + CURB_OFFSET_M);
    expect(s.z).toBeCloseTo(50);
    // facing (sin h, cos h) points back toward the road (-X)
    expect(Math.sin(s.facingHeading)).toBeCloseTo(-1);
    expect(Math.cos(s.facingHeading)).toBeCloseTo(0);
    // the game draws the prop at spot - facing * 1.1 -> farther from the road
    expect(s.propX).toBeCloseTo(s.x + PROP_BACK_M);
    expect(s.x - Math.sin(s.facingHeading) * PROP_BACK_M).toBeCloseTo(s.propX);
    // building on the other side flips the spot
    expect(curbSpot(-20, 50, 0, 0, 0, 100, 10).x).toBeCloseTo(-(5 + CURB_OFFSET_M));
  });
});

describe('generateDeliverySpots', () => {
  // A 600m straight residential road along +Z with side streets, one food place and some buildings
  const nodes = [
    { id: 0, x: 0, z: -300, isSignal: false },
    { id: 1, x: 0, z: 0, isSignal: false },
    { id: 2, x: 0, z: 300, isSignal: false },
    { id: 3, x: -80, z: 0, isSignal: false }, // side street to the east at z = 0 (junction at node 1)
  ];
  const edge = (a, b, highway = 'residential', width = 8.6) => ({ a, b, dist: 0, width, highway, name: '', isMajor: false });
  const edges = [edge(0, 1), edge(1, 2), edge(1, 3)];
  const box = (id, cx, cz, w, d, tags, height = 9.9) => {
    const ring = [
      [cx - w / 2, cz - d / 2],
      [cx + w / 2, cz - d / 2],
      [cx + w / 2, cz + d / 2],
      [cx - w / 2, cz + d / 2],
    ];
    return { id, type: 'way', tags, kind: 'residential', ring, area: w * d, height, cx, cz, minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 };
  };
  const buildings = [
    box(1, 20, 100, 14, 12, { building: 'yes' }),
    box(2, -20, 160, 14, 12, { building: 'yes' }),
    box(3, 30, -150, 30, 25, { building: 'apartments', name: '101동' }, 45),
    box(4, 15, 4, 12, 10, { building: 'yes' }), // right at the junction -> rejected
    box(5, 200, 100, 14, 12, { building: 'yes' }), // 195m from any road -> rejected
  ];
  const project = (lat, lon) => ({ x: lon, z: lat }); // test elements use lat=z, lon=x
  const elements = [
    { type: 'node', id: 10, lat: 220, lon: 12, tags: { amenity: 'restaurant', name: '교촌치킨' } },
    { type: 'node', id: 11, lat: 230, lon: 12, tags: { amenity: 'cafe' } }, // unnamed -> ignored
    {
      type: 'way',
      id: 12,
      tags: { landuse: 'residential', name: '매탄위브' },
      ring: [
        { x: 0, z: -200 },
        { x: 100, z: -200 },
        { x: 100, z: -100 },
        { x: 0, z: -100 },
      ],
    },
  ];
  const base = {
    elements,
    buildings,
    nodes,
    edges,
    busStops: [],
    legacyDistricts: [],
    chunkOf: (x, z) => `${Math.floor(x / 200)}_${Math.floor(z / 200)}`,
    project,
    outerRing: (el) => el.ring ?? null,
  };

  it('puts spots on the curb of the nearest road, outside buildings and clear of junctions', () => {
    const { shops, residences } = generateDeliverySpots(base);
    expect(shops.map((s) => s.name)).toEqual(['교촌치킨']);
    expect(shops[0].menus).toHaveLength(3);
    expect(shops[0].x).toBeCloseTo(4.3 + CURB_OFFSET_M, 1);
    const ids = residences.map((r) => r.id).sort();
    expect(ids).toEqual(['gen-res-w1', 'gen-res-w2', 'gen-res-w3']);
    const apt = residences.find((r) => r.id === 'gen-res-w3');
    expect(apt.name).toBe('매탄위브 101동');
    expect(apt.residenceKind).toBe('apartment');
    for (const s of [...shops, ...residences]) {
      expect(Math.abs(Math.abs(s.x) - (4.3 + CURB_OFFSET_M))).toBeLessThan(0.11); // on the curb of the main road
      for (const b of buildings) expect(pointInRing(s.x, s.z, b.ring)).toBe(false);
      expect(Math.hypot(s.x, s.z)).toBeGreaterThan(10); // not in the junction at (0, 0)
      // facing points toward the road centre line (x = 0)
      expect(Math.sign(Math.sin(s.facingHeading))).toBe(-Math.sign(s.x));
    }
  });

  it('is deterministic and leaves the hand-tuned districts alone', () => {
    expect(generateDeliverySpots(base)).toEqual(generateDeliverySpots(base));
    const legacy = {
      origin: { x: 0, z: 150 },
      halfSize: 120,
      serviceSpots: { gas: { x: 999, z: 999 }, repair: { x: 999, z: 999 } },
      shops: [],
      residences: [],
    };
    const { shops, residences } = generateDeliverySpots({ ...base, legacyDistricts: [legacy] });
    expect(shops).toHaveLength(0); // the restaurant at z = 220 is inside the district square
    expect(residences.map((r) => r.id)).toEqual(['gen-res-w3']);
  });

  it('places OSM gas stations on the curb with their name, keeping clear of buildings', () => {
    const fuel = { type: 'node', id: 30, lat: -40, lon: 18, tags: { amenity: 'fuel', name: 'S-OIL' } };
    const { fuelStations } = generateDeliverySpots({ ...base, elements: [...elements, fuel] });
    expect(fuelStations).toHaveLength(1);
    const f = fuelStations[0];
    expect(f.name).toBe('S-OIL 주유소');
    expect(Math.abs(f.x)).toBeCloseTo(4.3 + 2.5, 1); // station centre 2.5m outside the road edge
    expect(Math.abs(f.roadX)).toBeLessThan(0.2); // nearest road point on the centre line
    for (const b of buildings) expect(pointInRing(f.x, f.z, b.ring)).toBe(false);
  });
});


describe('riverside spots', () => {
  it('benches along a named stream on its left bank, away from the roads, numbered along the stream', async () => {
    const { riversideSpots, RIVERSIDE_FIRST_M, RIVERSIDE_SPACING_M } = await import('./delivery-spots.mjs');
    // a 1 km stream running north, split into two OSM ways; a road across it at z = 570
    const streams = [
      { name: '수원천', width: 18, pts: [{ x: 0, z: 0 }, { x: 0, z: 500 }] },
      { name: '수원천', width: 18, pts: [{ x: 0, z: 500 }, { x: 0, z: 1000 }] },
      { name: '', width: 5, pts: [{ x: 50, z: 0 }, { x: 50, z: 900 }] },
    ];
    const nodes = [
      { id: 0, x: -100, z: 570 },
      { id: 1, x: 100, z: 570 },
    ];
    const edges = [{ a: 0, b: 1, width: 10 }];
    const spots = riversideSpots(streams, nodes, edges);
    // each way starts its own spacing; the unnamed stream gets none
    expect(spots.map((s) => s.z)).toEqual([RIVERSIDE_FIRST_M, 500 + RIVERSIDE_FIRST_M]);
    // a road right by a spot drops it
    const blocked = riversideSpots(streams, [{ id: 0, x: -100, z: 150 }, { id: 1, x: 100, z: 150 }], edges);
    expect(blocked.map((s) => s.z)).toEqual([500 + RIVERSIDE_FIRST_M]);
    expect(RIVERSIDE_SPACING_M).toBeGreaterThan(300);
    expect(spots.map((s) => s.name)).toEqual(spots.map((_, i) => `수원천 산책로 쉼터 ${i + 1}`));
    for (const s of spots) {
      expect(s.x).toBeCloseTo(9 + 0.9); // left bank of a north-running stream = +X
      expect(s.residenceKind).toBe('riverside');
      expect(s.facingHeading).toBeCloseTo(-Math.PI / 2, 1); // facing the water (-X)
    }
    expect(new Set(spots.map((s) => s.id)).size).toBe(spots.length);
  });
});

describe('pedestrian crossings', () => {
  it('snaps marked crossings onto their road, skipping junction / unmarked / duplicate ones', async () => {
    const { snapCrossings, crossingPoints } = await import('./crossings.mjs');
    // a 200 m road along +Z with a signal at its start
    const nodes = [
      { id: 0, x: 0, z: 0, isSignal: true },
      { id: 1, x: 0, z: 200, isSignal: false },
    ];
    const edges = [{ a: 0, b: 1, width: 12 }];
    const out = snapCrossings(
      [
        { x: 1.5, z: 100, kind: 'marked' }, // mid-block: kept, snapped to the centre line
        { x: -1, z: 102, kind: 'uncontrolled' }, // same crossing drawn as a way: merged
        { x: 0, z: 8, kind: 'traffic_signals' }, // the junction's own crosswalk: skipped
        { x: 0, z: 150, kind: 'unmarked' }, // no paint: skipped
        { x: 40, z: 150, kind: 'marked' }, // not on this road: skipped
        { x: 0, z: 160, kind: 'traffic_signals' }, // a signalized mid-block crossing: kept
      ],
      nodes,
      edges,
    );
    expect(out).toEqual([
      { x: 0, z: 100, h: 0, w: 12 },
      { x: 0, z: 160, h: 0, w: 12, sig: true },
    ]);
    const pts = crossingPoints(
      [
        { type: 'node', lat: 1, lon: 2, tags: { highway: 'crossing', crossing: 'marked' } },
        { type: 'way', tags: { footway: 'crossing' , 'crossing:markings': 'zebra' }, geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 10 }] },
      ],
      (lat, lon) => ({ x: lon, z: lat }),
    );
    expect(pts).toEqual([
      { x: 2, z: 1, kind: 'marked' },
      { x: 5, z: 0, kind: 'marked' },
    ]);
  });
});
