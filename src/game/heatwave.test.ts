import { describe, expect, it } from 'vitest';
import { HEAT_COLD_FOOD_MUL, ION_DRINK_COOL_SEC, heatwaveActive } from './heatwave';
import { PlayerController } from '../player/PlayerController';
import { ScooterPhysics } from '../vehicle/ScooterPhysics';
import { stepFoodCondition } from '../delivery/cargoCare';
import { buildDeliveryOrder, createActiveMission } from '../delivery/orderFactory';
import { getUpgradeEffects } from '../delivery/riderCatalog';
import type { DeliveryLocation } from '../types';

/** Stamina after walking `sec` seconds outdoors, starting at 60% */
function walk(sec: number, heat: boolean, iceDrink = false): number {
  const pc = new PlayerController();
  const scooter = new ScooterPhysics();
  scooter.placeAt(500, 500, 0);
  pc.teleportTo(0, 0, 0, 0, false);
  pc.heatwave = heat;
  pc.state.stamina = 60;
  if (iceDrink) {
    pc.applyConvenienceDrink('ion_drink');
    pc.state.stamina = 60;
  }
  for (let t = 0; t < sec; t += 1 / 30)
    pc.step(1 / 30, { forward: 1, strafe: 0, sprint: false, jump: false }, 0, scooter.state, []);
  return pc.state.stamina;
}

describe('summer heatwave', () => {
  it('only on clear summer afternoons (12:00 - 16:30)', () => {
    expect(heatwaveActive('summer', 'clear', 13 * 60)).toBe(true);
    expect(heatwaveActive('summer', 'clear', 11 * 60)).toBe(false);
    expect(heatwaveActive('summer', 'clear', 17 * 60)).toBe(false);
    expect(heatwaveActive('summer', 'rain', 13 * 60)).toBe(false);
    expect(heatwaveActive('autumn', 'clear', 13 * 60)).toBe(false);
  });

  it('walking outdoors in the heat drains stamina; the iced ion drink keeps it off for a while', () => {
    expect(walk(5, false)).toBeGreaterThan(60); // normal: walking recovers
    expect(walk(5, true)).toBeLessThan(60); // heat: walking drains
    expect(walk(5, true, true)).toBeGreaterThan(60); // cooled down
    expect(ION_DRINK_COOL_SEC).toBeGreaterThanOrEqual(120);
  });

  it('chilled food warms up faster in the heat (hot food is not affected)', () => {
    const shop: DeliveryLocation = {
      id: 's',
      name: '카페',
      x: 0,
      z: 0,
      type: 'shop',
      emoji: '☕',
      menus: ['아이스 아메리카노'],
    };
    const home: DeliveryLocation = { id: 'h', name: '집', x: 100, z: 0, type: 'residential', emoji: '🏠' };
    const mission = () => {
      const m = createActiveMission(
        buildDeliveryOrder({
          id: 'o',
          orderNumber: 'A-1',
          type: 'SINGLE',
          shop,
          customer: home,
          surcharges: { rainBonus: 0, nightBonus: 0, peakBonus: 0 },
        }),
        0,
        () => 0.99,
      );
      m.pickedUp = true;
      m.phase = 'cargo_loaded';
      return m;
    };
    const scooter = new ScooterPhysics().state;
    const fx = getUpgradeEffects([]);
    const loss = (heat: boolean) => {
      const m = mission();
      for (let i = 0; i < 60; i++) stepFoodCondition([m], scooter, false, fx, 1, heat);
      return 100 - m.foodTemp;
    };
    expect(mission().order.foodTempType).toBe('cold');
    expect(loss(true) / loss(false)).toBeCloseTo(HEAT_COLD_FOOD_MUL, 2);
  });
});
