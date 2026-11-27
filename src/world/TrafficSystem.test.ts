import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PASS_WAIT_SEC, TrafficSystem } from './TrafficSystem';
import { overlapsBody, passShiftFor, shiftedLeft, toBodyFrame } from './vehicleBodies';

const DT = 1 / 60;

interface TestCar {
  x: number;
  z: number;
  heading: number;
  speed: number;
  halfLength: number;
  halfWidth: number;
  edgeDist: number;
  progress: number;
  isBus: boolean;
}

describe('passShiftFor', () => {
  const car = { x: 0, z: 0, heading: 0, halfLength: 2.15, halfWidth: 0.96, speed: 0 };
  it('shifts left just enough to clear a scooter in the lane', () => {
    const s = passShiftFor(car, 0, 6, 0.9);
    expect(s).toBeCloseTo(0.96 + 0.9 + 0.35);
    // after the shift the scooter sits right of the swept lane
    const out = shiftedLeft(car, s);
    expect(toBodyFrame(out, 0, 6).side).toBeCloseTo(0.96 + 0.9 + 0.35);
    // obstacle slightly right of centre needs less shift, beside the lane needs none
    expect(passShiftFor(car, -0.5, 6, 0.9)).toBeLessThan(s);
    expect(passShiftFor(car, -3, 6, 0.9)).toBe(0);
    expect(passShiftFor(car, 0, -6, 0.9)).toBe(0); // behind
  });
  it('shiftedLeft moves toward +X for heading 0 (left of travel)', () => {
    expect(shiftedLeft(car, 2).x).toBeCloseTo(2);
  });
});

describe('TrafficSystem and a scooter left in the lane', () => {
  it('stops behind it, then goes around it without touching it', () => {
    // Deterministic traffic (spawns and route choices use Math.random)
    let seed = 20261127;
    const origRandom = Math.random;
    Math.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const traffic = new TrafficSystem(new THREE.Scene(), []);
    const cars = traffic.getCarBodies() as unknown as TestCar[];
    // a car with a long straight stretch ahead
    const c = cars.filter((v) => !v.isBus).sort((a, b) => b.edgeDist - b.progress - (a.edgeDist - a.progress))[0];
    expect(c.edgeDist - c.progress).toBeGreaterThan(40);
    const ahead = 16;
    const sc = { x: c.x + Math.sin(c.heading) * ahead, z: c.z + Math.cos(c.heading) * ahead };
    let stoppedFor = 0;
    let passed = false;
    // Player on foot 40m to the side of the road: close enough that this car is not recycled to another
    // street (cars farther than 165m from the player are), out of its lane
    const px = sc.x + Math.cos(c.heading) * 40;
    const pz = sc.z - Math.sin(c.heading) * 40;
    for (let t = 0; t < 25 && !passed; t += DT) {
      traffic.step(DT, t, false, px, pz, 0, false, () => {}, () => {}, undefined, [], sc);
      expect(overlapsBody(c, sc.x, sc.z, 0.72)).toBe(false);
      if (c.speed < 0.2) stoppedFor += DT;
      if (toBodyFrame(c, sc.x, sc.z).along < -(c.halfLength + 1)) passed = true;
    }
    Math.random = origRandom;
    expect(stoppedFor).toBeGreaterThan(PASS_WAIT_SEC - 0.5);
    expect(passed).toBe(true);
  });
});
