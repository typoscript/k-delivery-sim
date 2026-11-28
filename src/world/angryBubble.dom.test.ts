// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { loadGamePageDom } from '../test/domFixture';
import { PedestrianManager } from './PedestrianManager';

describe('💢 over splashed pedestrians (DOM)', () => {
  beforeEach(() => loadGamePageDom());

  it('shows the bubble on the people splashed, then hides it after a few seconds', () => {
    const peds = new PedestrianManager(new THREE.Scene());
    const a = peds.agents[0];
    a.visible = true;
    a.fsm = 'WALKING';
    const before = Math.random;
    expect(peds.splashNear(a.x, a.z, 1)).toBeGreaterThanOrEqual(1);
    expect(Math.random).toBe(before);
    expect(a.rig.angryBubble?.visible).toBe(true);
    const signal = { ns: 'green', ew: 'red', remainingSec: 5 } as const;
    for (let i = 0; i < 100; i++) peds.update(0.05, signal as never, a.x, a.z, a.x + 500, a.z, false);
    expect(a.rig.angryBubble?.visible).toBe(false);
  });
});
