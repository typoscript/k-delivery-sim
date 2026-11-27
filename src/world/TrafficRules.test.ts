import { describe, expect, it } from 'vitest';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import {
  LANE_BLEND_DISTANCE,
  edgeDirection,
  getSignalAxis,
  laneBlendDecay,
  signalSpeedCap,
} from './TrafficRules';

describe('signalSpeedCap', () => {
  it('never limits speed on green', () => {
    expect(signalSpeedCap(12, 5, 'green')).toBe(Infinity);
  });

  it('brakes smoothly toward the stop line on red', () => {
    const far = signalSpeedCap(10, 25, 'red');
    const near = signalSpeedCap(10, 5, 'red');
    expect(far).toBeGreaterThan(near);
    expect(near).toBeGreaterThan(0);
  });

  it('holds a stopped vehicle at the line', () => {
    expect(signalSpeedCap(0.5, 0.3, 'red')).toBe(0);
  });

  it('lets a vehicle that cannot stop safely proceed (committed)', () => {
    // 12 m/s with 2m to the line needs 36 m/s^2 -> impossible, proceed
    expect(signalSpeedCap(12, 2, 'red')).toBe(Infinity);
    // yellow dilemma zone uses a gentler threshold
    expect(signalSpeedCap(10, 6, 'yellow')).toBe(Infinity);
  });

  it('lets a vehicle already inside the junction clear it', () => {
    expect(signalSpeedCap(3, -2, 'red')).toBe(Infinity);
  });
});

describe('getSignalAxis', () => {
  const signalNode = ACTIVE_MAP_DATA.nodes.find((n) => n.isSignal);

  it('gives perpendicular approaches through the same junction different phases', () => {
    expect(signalNode).toBeDefined();
    const id = signalNode!.id;
    const a = getSignalAxis(id, 0, 1);
    const b = getSignalAxis(id, 1, 0);
    expect(a).not.toBe(b);
  });

  it('gives opposite directions on the same road the same phase', () => {
    const id = signalNode!.id;
    expect(getSignalAxis(id, 0.3, 1)).toBe(getSignalAxis(id, -0.3, -1));
  });

  it('falls back to the world-axis rule for nodes without a signal', () => {
    const plain = ACTIVE_MAP_DATA.nodes.find((n) => !n.isSignal)!;
    expect(getSignalAxis(plain.id, 0, 1)).toBe('ns');
    expect(getSignalAxis(plain.id, 1, 0)).toBe('ew');
  });
});

describe('edgeDirection & laneBlendDecay', () => {
  it('returns a unit vector', () => {
    const e = ACTIVE_MAP_DATA.edges[0];
    const d = edgeDirection(e.a, e.b);
    expect(Math.hypot(d.fx, d.fz)).toBeCloseTo(1, 6);
  });

  it('decays the lane blend by 1/e every LANE_BLEND_DISTANCE metres travelled', () => {
    expect(laneBlendDecay(0)).toBe(1);
    expect(laneBlendDecay(LANE_BLEND_DISTANCE)).toBeCloseTo(Math.exp(-1), 6);
  });
});
