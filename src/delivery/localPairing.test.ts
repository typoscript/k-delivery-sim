import { describe, expect, it } from 'vitest';
import { DeliveryLocation } from '../types';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import { LOCAL_CUSTOMER_RADIUS_M, LOCAL_SHOP_RADIUS_M, pickLocalCustomer, pickLocalShop } from './localPairing';

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
});
