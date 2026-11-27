import { describe, expect, it } from 'vitest';
import { OUT_OF_FUEL_PUSH_SPEED, ScooterPhysics } from './ScooterPhysics';

/**
 * Coordinate convention (CLAUDE.md): heading = 0 faces +Z, +X is LEFT of travel, -X is RIGHT.
 * leanAngle < 0 leans left (+X), > 0 leans right (-X).
 */
describe('ScooterPhysics crash slide', () => {
  const crashAtSpeed = (side: number) => {
    const physics = new ScooterPhysics();
    physics.setMounted(true);
    physics.state.heading = 0;
    physics.state.speed = 12;
    physics.triggerExternalCrash(side);
    return physics.state;
  };

  it('a left lowside slides outward to the right (-X)', () => {
    const s = crashAtSpeed(-1);
    expect(s.crashed).toBe(true);
    expect(s.slideVx).toBeLessThan(0);
  });

  it('a right lowside slides outward to the left (+X)', () => {
    const s = crashAtSpeed(1);
    expect(s.slideVx).toBeGreaterThan(0);
  });

  it('keeps forward momentum along +Z', () => {
    const s = crashAtSpeed(-1);
    expect(s.slideVz).toBeGreaterThan(0);
  });
});

describe('ScooterPhysics out of fuel', () => {
  it('cannot ride on an empty tank but can be pushed along at walking pace', () => {
    const physics = new ScooterPhysics();
    physics.setMounted(true);
    physics.state.fuel = 0;
    physics.state.outOfFuel = true;
    const input = { throttle: true, brake: false, steerLeft: false, steerRight: false, handbrake: false };
    const road = { isRaining: false, surface: 'none' as const, onSpeedBump: false };
    for (let i = 0; i < 300; i++) physics.step(1 / 60, input, [], road);
    expect(physics.state.speed).toBeGreaterThan(OUT_OF_FUEL_PUSH_SPEED * 0.9);
    expect(physics.state.speed).toBeLessThanOrEqual(OUT_OF_FUEL_PUSH_SPEED + 0.05);
    expect(physics.state.fuel).toBe(0);
  });
});
