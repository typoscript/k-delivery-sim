import { describe, expect, it } from 'vitest';
import { ROADWORK_WARN_DIST_M, VoiceNavigator } from './VoiceNavigator';
import { NO_ROADWORKS } from '../delivery/deliveryTypes';

describe('VoiceNavigator construction guidance', () => {
  it('announces a detour once per destination', () => {
    const v = new VoiceNavigator();
    const detour = { through: 0, points: [], avoided: 1 };
    expect(v.updateRoadworks(detour, 'A:p', 0, 0, true, false)).toBe('detour');
    expect(v.updateRoadworks(detour, 'A:p', 0, 0, true, false)).toBeNull();
    // next destination: announced again
    expect(v.updateRoadworks(detour, 'A:d', 0, 0, true, false)).toBe('detour');
    // not while walking, indoors or without a destination
    const w = new VoiceNavigator();
    expect(w.updateRoadworks(detour, 'A:p', 0, 0, false, false)).toBeNull();
    expect(w.updateRoadworks(detour, 'A:p', 0, 0, true, true)).toBeNull();
    expect(w.updateRoadworks(detour, null, 0, 0, true, false)).toBeNull();
    expect(w.updateRoadworks(NO_ROADWORKS, 'A:p', 0, 0, true, false)).toBeNull();
  });

  it('warns once when nearing each construction zone the route passes through', () => {
    const v = new VoiceNavigator();
    const through = { through: 2, points: [{ x: 0, z: 200 }, { x: 0, z: 400 }], avoided: 0 };
    expect(v.updateRoadworks(through, 'B:d', 0, 0, true, false)).toBeNull(); // 200m away
    expect(v.updateRoadworks(through, 'B:d', 0, 200 - ROADWORK_WARN_DIST_M + 5, true, false)).toBe('approach');
    expect(v.updateRoadworks(through, 'B:d', 0, 190, true, false)).toBeNull(); // same zone: once
    expect(v.updateRoadworks(through, 'B:d', 0, 330, true, false)).toBe('approach'); // the next one
  });
});
