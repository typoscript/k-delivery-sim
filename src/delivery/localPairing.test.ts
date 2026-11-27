import { describe, expect, it } from 'vitest';
import { DeliveryLocation } from '../types';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import {
  LOCAL_CUSTOMER_RADIUS_M,
  LOCAL_SHOP_RADIUS_M,
  MIN_CUSTOMER_DIST_M,
  pickLocalCustomer,
  pickLocalShop,
} from './localPairing';

const loc = (id: string, x: number, z: number, type: 'shop' | 'residential'): DeliveryLocation => ({
  id,
  name: id,
  x,
  z,
  type,
  emoji: '',
});

describe('local shop / customer pairing', () => {
  it('on the unified city, offers shops near the rider and customers near the shop', () => {
    const shops = ACTIVE_MAP_DATA.shops.map((s) => loc(s.id, s.x, s.z, 'shop'));
    const res = ACTIVE_MAP_DATA.residences.map((r) => loc(r.id, r.x, r.z, 'residential'));
    // Rider at each district spawn: every pick must stay local (no 5km cross-city orders)
    for (const sp of [ACTIVE_MAP_DATA.meta.playerSpawn, { x: shops[0].x, z: shops[0].z }]) {
      for (let i = 0; i < 200; i++) {
        const shop = pickLocalShop(shops, sp.x, sp.z);
        const customer = pickLocalCustomer(res, shop);
        expect(Math.hypot(shop.x - sp.x, shop.z - sp.z)).toBeLessThanOrEqual(LOCAL_SHOP_RADIUS_M);
        expect(Math.hypot(customer.x - shop.x, customer.z - shop.z)).toBeLessThanOrEqual(LOCAL_CUSTOMER_RADIUS_M);
      }
    }
  });

  it('falls back to the nearest locations when the rider is far from any district', () => {
    const shops = [loc('a', 0, 0, 'shop'), loc('b', 10, 0, 'shop'), loc('c', 5000, 0, 'shop')];
    const picked = new Set<string>();
    for (let i = 0; i < 100; i++) picked.add(pickLocalShop(shops, 2500, 0).id);
    expect(picked.size).toBeGreaterThan(0);
    expect(picked.has('c') || picked.has('a')).toBe(true);
  });

  it('keeps the old uniform pick on a small single-district map', () => {
    const shops = [loc('a', 0, 0, 'shop'), loc('b', 300, 300, 'shop'), loc('c', -300, 200, 'shop')];
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) seen.add(pickLocalShop(shops, 0, 0).id);
    expect(seen.size).toBe(3);
  });

  it('skips next-door customers when enough farther ones exist', () => {
    const shop = loc('s', 0, 0, 'shop');
    const res = [loc('near', 30, 0, 'residential'), loc('f1', 300, 0, 'residential'), loc('f2', 0, 400, 'residential'), loc('f3', -500, 0, 'residential')];
    for (let i = 0; i < 100; i++) {
      const c = pickLocalCustomer(res, shop);
      expect(Math.hypot(c.x, c.z)).toBeGreaterThanOrEqual(MIN_CUSTOMER_DIST_M);
    }
    // ... but still delivers next door when that is all there is
    const few = [loc('near', 30, 0, 'residential'), loc('f1', 300, 0, 'residential')];
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(pickLocalCustomer(few, shop).id);
    expect(seen.has('near')).toBe(true);
  });

  it('offers calls between the districts on the open world (generated spots)', () => {
    const shops = ACTIVE_MAP_DATA.shops.map((s) => loc(s.id, s.x, s.z, 'shop'));
    const res = ACTIVE_MAP_DATA.residences.map((r) => loc(r.id, r.x, r.z, 'residential'));
    expect(shops.filter((s) => s.id.startsWith('gen-')).length).toBeGreaterThan(100);
    expect(res.filter((r) => r.id.startsWith('gen-')).length).toBeGreaterThan(200);
    // Rider standing between districts: offered shop and customer are real local spots, not a 2km fallback
    const between = { x: 0, z: 0 };
    for (let i = 0; i < 100; i++) {
      const shop = pickLocalShop(shops, between.x, between.z);
      expect(Math.hypot(shop.x - between.x, shop.z - between.z)).toBeLessThanOrEqual(LOCAL_SHOP_RADIUS_M);
      const customer = pickLocalCustomer(res, shop);
      expect(Math.hypot(customer.x - shop.x, customer.z - shop.z)).toBeLessThanOrEqual(LOCAL_CUSTOMER_RADIUS_M);
    }
  });
});
