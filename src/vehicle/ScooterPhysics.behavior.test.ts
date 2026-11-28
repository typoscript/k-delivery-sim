import { describe, expect, it } from 'vitest';
import { ScooterInput, ScooterPhysics } from './ScooterPhysics';
import { ObstacleBox } from '../types';

const DT = 1 / 60;
const idle: ScooterInput = { throttle: false, brake: false, steerLeft: false, steerRight: false, handbrake: false };

/**
 * Behaviour fingerprint of the riding physics: a scripted ride (accelerate, turn, speed bump, hard braking on a
 * wet manhole, an over-leaned rain corner, a wall, running dry) must hash the same. Math.random (crash side
 * on a straight slip) is seeded. After an intended handling change: `npx vitest -u`.
 */
function ride() {
  let seed = 99;
  const origRandom = Math.random;
  Math.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  try {
    const p = new ScooterPhysics();
    const crashes: string[] = [];
    const bumps: number[] = [];
    p.setOnCrash((side, speed, cause) => crashes.push(`${side}:${Math.round(speed)}:${cause}`));
    p.setOnSpeedBump((kmh) => bumps.push(Math.round(kmh)));
    p.placeAt(0, 0, 0);
    p.setMounted(true);
    const wall: ObstacleBox = { minX: -20, maxX: 20, minZ: 400, maxZ: 410 };
    let hash = 0;
    const mix = (x: number) => {
      hash = (Math.imul(hash, 31) + (Math.round(x) | 0)) | 0;
    };
    const run = (sec: number, input: Partial<ScooterInput>, road?: Parameters<ScooterPhysics['step']>[3], obstacles: ObstacleBox[] = []) => {
      for (let t = 0; t < sec; t += DT) {
        p.step(DT, { ...idle, ...input }, obstacles, road);
        const s = p.state;
        mix(s.x * 100);
        mix(s.z * 100);
        mix(s.heading * 1000);
        mix(s.speed * 100);
        mix(s.leanAngle * 1000);
        mix(s.fuel * 100);
        mix(s.crashed ? 1 : 0);
      }
    };
    run(5, { throttle: true });
    run(0.3, { throttle: true, steerLeft: true });
    run(0.5, { throttle: true }, { isRaining: false, surface: 'none', onSpeedBump: true, speedBumpLabel: 'bump' });
    run(1, { throttle: true });
    run(1.5, { brake: true }, { isRaining: true, surface: 'manhole' });
    run(3, {});
    p.reset();
    p.placeAt(0, 0, 0);
    p.setMounted(true);
    run(4, { throttle: true });
    run(3, { throttle: true, steerRight: true }, { isRaining: true, surface: 'none' });
    p.reset();
    p.placeAt(0, 380, 0);
    p.setMounted(true);
    run(4, { throttle: true }, undefined, [wall]);
    p.reset();
    p.placeAt(0, 0, 0);
    p.setMounted(true);
    p.state.fuel = 0.4;
    run(6, { throttle: true });
    const s = p.state;
    return { hash, crashes, bumps, damage: s.damageLevel, fuel: Math.round(s.fuel * 100), outOfFuel: s.outOfFuel };
  } finally {
    Math.random = origRandom;
  }
}

describe('ScooterPhysics behaviour', () => {
  it('rides the same way every run', () => {
    const a = ride();
    expect(ride()).toEqual(a);
    expect(a).toMatchSnapshot();
  });
});

describe('snow', () => {
  it('brakes worse than a wet road, which brakes worse than a dry one', () => {
    const stopDistance = (road: Parameters<ScooterPhysics['step']>[3]) => {
      const p = new ScooterPhysics();
      p.placeAt(0, 0, 0);
      p.setMounted(true);
      for (let t = 0; t < 4; t += DT) p.step(DT, { ...idle, throttle: true }, [], road);
      const z0 = p.state.z;
      for (let t = 0; t < 6 && p.state.speed > 0.05; t += DT) p.step(DT, { ...idle, brake: true }, [], road);
      return p.state.z - z0;
    };
    const dry = stopDistance({ isRaining: false, surface: 'none' });
    const wet = stopDistance({ isRaining: true, surface: 'none' });
    const snow = stopDistance({ isRaining: true, isSnowing: true, surface: 'none' });
    expect(wet).toBeGreaterThan(dry);
    expect(snow).toBeGreaterThan(wet);
  });
});
