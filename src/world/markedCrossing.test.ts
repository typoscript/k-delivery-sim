import { describe, expect, it } from 'vitest';
import { CROSSWALK_STOP_DECEL, isMarkedCrossingSafe, isRoadCrossingClear, type VehicleBody } from './vehicleBodies';
import { crossingStations } from './PedestrianGraph';

// a crosswalk across a road running along Z: from (-6, 0) to (6, 0)
const car = (z: number, speed: number): VehicleBody =>
  ({ x: -2, z, heading: 0, speed, halfLength: 2.2, halfWidth: 0.95 }) as VehicleBody;

describe('painted crosswalks', () => {
  it('pedestrians step out unless a car is on it or too close to stop', () => {
    // a car 25 m away at 40 km/h can stop (stopping distance ~15 m): a painted crosswalk is safe,
    // an unmarked crossing (wait for a real gap) is not
    const approaching = car(-25, 11);
    expect(isMarkedCrossingSafe(-6, 0, 6, 0, [approaching])).toBe(true);
    expect(isRoadCrossingClear(-6, 0, 6, 0, [approaching], 1.1)).toBe(false);
    // 8 m away at the same speed: it cannot stop any more
    expect(isMarkedCrossingSafe(-6, 0, 6, 0, [car(-8, 11)])).toBe(false);
    // standing on the crossing: wait; standing just before it: go
    expect(isMarkedCrossingSafe(-6, 0, 6, 0, [car(0.5, 0)])).toBe(false);
    expect(isMarkedCrossingSafe(-6, 0, 6, 0, [car(-5, 0)])).toBe(true);
    expect(CROSSWALK_STOP_DECEL).toBeGreaterThan(2);
  });

  it('finds the road edge and the distance along it of each crosswalk', () => {
    const nodes = [
      { x: 0, z: 0 },
      { x: 0, z: 100 },
      { x: 50, z: 100 },
    ];
    const edges = [
      { a: 0, b: 1, width: 10 },
      { a: 1, b: 2, width: 8 },
    ];
    const st = crossingStations(nodes, edges, [
      { x: 0, z: 70 },
      { x: 0.4, z: 30 },
      { x: 20, z: 100 },
      { x: 30, z: 40 }, // not on a road
    ]);
    expect(st.get(0)?.map(Math.round)).toEqual([30, 70]);
    expect(st.get(1)?.map(Math.round)).toEqual([20]);
    expect(st.size).toBe(2);
  });
});
