import { describe, expect, it } from 'vitest';
import { EXPOSURE_RECOVER_MUL, PlayerController } from '../player/PlayerController';
import { ScooterPhysics } from '../vehicle/ScooterPhysics';
import { RIDER_UPGRADE_LIST, getUpgradeEffects } from '../delivery/riderCatalog';
import { buildWeatherReport } from './weatherReport';

/** Stamina gained standing still outdoors for 1 s from 20% */
function rest(wet: boolean, cold: boolean): number {
  const pc = new PlayerController();
  const scooter = new ScooterPhysics();
  scooter.placeAt(500, 500, 0);
  pc.teleportTo(0, 0, 0, 0, false);
  pc.exposure = { wet, cold };
  pc.state.stamina = 20;
  for (let t = 0; t < 1; t += 1 / 30)
    pc.step(1 / 30, { forward: 0, strafe: 0, sprint: false, jump: false }, 0, scooter.state, []);
  return pc.state.stamina - 20;
}

describe('weather gear', () => {
  it('a raincoat and winter gear are on sale at the repair shop', () => {
    const ids = RIDER_UPGRADE_LIST.map((u) => u.id);
    expect(ids).toEqual(expect.arrayContaining(['raincoat', 'winter_gear']));
    const fx = getUpgradeEffects(['raincoat']);
    expect(fx.rainProof).toBe(true);
    expect(fx.rainVisorMul).toBeLessThan(0.5);
    expect(fx.coldProof).toBe(false);
    expect(getUpgradeEffects(['winter_gear']).coldProof).toBe(true);
  });

  it('soaked or freezing without gear, stamina comes back slower (both: slower still)', () => {
    const dry = rest(false, false);
    expect(rest(true, false) / dry).toBeCloseTo(EXPOSURE_RECOVER_MUL, 1);
    expect(rest(false, true) / dry).toBeCloseTo(EXPOSURE_RECOVER_MUL, 1);
    expect(rest(true, true)).toBeLessThan(rest(true, false));
  });

  it('the weather app tells what gear the weather calls for', () => {
    const base = {
      workDay: 1,
      minute: 13 * 60,
      mode: 'clear' as const,
      forecast: ['clear', 'rain', 'rain', 'cloudy', 'clear', 'clear'] as const,
      heatwave: false,
      blackIce: false,
      puddles: 0,
      night: false,
    };
    const t = (i: object) => buildWeatherReport({ ...base, ...i } as never).alerts.map((a) => a.title);
    expect(t({ gear: { raincoat: false, winterGear: true } })).toContain('2시간 뒤 비 예보');
    expect(t({ mode: 'rain', gear: { raincoat: false, winterGear: true } })).toContain('우비 없음');
    expect(t({ mode: 'rain', gear: { raincoat: true, winterGear: true } })).not.toContain('우비 없음');
    expect(
      t({ workDay: 9, minute: 4 * 60, gear: { raincoat: true, winterGear: false } }).some((x) => x.endsWith('추위')),
    ).toBe(true);
  });
});
