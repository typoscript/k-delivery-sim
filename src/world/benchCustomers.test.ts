import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BENCH_GOODBYE_SEC, BENCH_SHOW_M, BenchCustomers, benchPose, benchSeat } from './benchCustomers';
import type { DeliveryLocation } from '../types';

const bench: DeliveryLocation = {
  id: 'gen-riv-1',
  name: '수원천 산책로 쉼터 1',
  x: 100,
  z: 0,
  type: 'residential',
  residenceKind: 'riverside',
  emoji: '🌿',
  facingHeading: Math.PI / 2, // facing +X (the water)
};

describe('bench customers', () => {
  it('poses: sit while waiting, stand for the food, wave after the hand-over', () => {
    expect(benchPose(false, false)).toBe('sitting');
    expect(benchPose(false, true)).toBe('standing');
    expect(benchPose(true, true)).toBe('waving');
    const seat = benchSeat(bench);
    expect(seat.x).toBeCloseTo(100 - 1.1); // on the bench, back from the walkway spot
    expect(seat.heading).toBeCloseTo(Math.PI / 2);
  });

  it('a customer sits on the bench while the order is on its way, waves, then leaves', () => {
    const c = new BenchCustomers(new THREE.Group());
    c.update(0.1, 100 + BENCH_SHOW_M + 50, 0, [bench], null); // too far: nobody yet
    expect(c.poses()).toEqual([]);
    c.update(0.1, 90, 0, [bench], null);
    expect(c.poses()).toEqual([{ id: bench.id, pose: 'sitting' }]);
    c.update(0.1, 98, 0, [bench], bench.id); // the rider brings the food
    expect(c.root.children[0].position.y).toBe(0); // standing
    c.update(0.1, 98, 0, [], null); // handed over
    expect(c.poses()[0].pose).toBe('waving');
    for (let t = 0; t < BENCH_GOODBYE_SEC + 0.5; t += 0.5) c.update(0.5, 98, 0, [], null);
    expect(c.poses()).toEqual([]);
    expect(c.root.children).toHaveLength(0);
  });
});
