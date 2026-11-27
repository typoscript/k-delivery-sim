import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { installCanvasStub } from '../test/sceneFingerprint';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import {
  HAZARD_RECYCLE_DISTANCE,
  HAZARD_RESPAWN_MAX_RADIUS,
  HAZARD_RESPAWN_MIN_RADIUS,
  RoadHazardManager,
} from './RoadHazardManager';
import { SignalStateSnapshot } from './TrafficSystem';
import { SIDEWALK_TICKET_FINE } from '../game/trafficViolations';
import { ScooterProximityInfo } from './PedestrianManager';


installCanvasStub();

const SIGNAL: SignalStateSnapshot = { ns: 'green', ew: 'red', remainingSec: 30 };
const DT = 1 / 30;

function minPairDistance(pts: Array<{ x: number; z: number }>): number {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) best = Math.min(best, Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z));
  return best;
}

describe('RoadHazardManager on the unified open world', () => {
  const spawn = ACTIVE_MAP_DATA.meta.playerSpawn;

  it('scales static hazards with road coverage and keeps them spread out', () => {
    const t0 = performance.now();
    const mgr = new RoadHazardManager(new THREE.Group());
    const ms = performance.now() - t0;
    const c = mgr.placementCounts;
    console.log(
      `[RoadHazardManager] coverage ${mgr.roadCoverageKm2.toFixed(1)}km2 -> cameras ${c.cameras}, parked ${c.parked}, construction ${c.construction} (${ms.toFixed(0)}ms)`
    );
    expect(mgr.isLargeMap).toBe(true);
    expect(c.cameras).toBeGreaterThan(6);
    expect(c.cameras).toBeLessThanOrEqual(60);
    expect(c.parked).toBeGreaterThan(6);
    expect(c.parked).toBeLessThanOrEqual(120);
    expect(c.construction).toBeGreaterThan(3);
    expect(c.construction).toBeLessThanOrEqual(30);
    expect(minPairDistance(mgr.cameraMarkers)).toBeGreaterThanOrEqual(320);
    expect(minPairDistance(mgr.constructionMarkers)).toBeGreaterThanOrEqual(600);
  });

  it('a nearby patrol car writes red-light / sidewalk tickets, one per cooldown', () => {
    const mgr = new RoadHazardManager(new THREE.Group());
    const [p] = mgr.movingUnitPositions.filter((u) => u.id.startsWith('patrol') || u.id.startsWith('police'));
    expect(p).toBeDefined();
    expect(mgr.witnessTicket('patrol_sidewalk', p.x + 5000, p.z, 20)).toBeNull(); // nobody around
    const t = mgr.witnessTicket('patrol_sidewalk', p.x + 10, p.z, 24)!;
    expect(t).toMatchObject({ kind: 'patrol_sidewalk', fine: SIDEWALK_TICKET_FINE, measuredKmh: 24 });
    // that car is now on cooldown; another car may still be close, but never the same one twice
    const again = mgr.witnessTicket('patrol_red_light', p.x + 10, p.z, 30);
    expect(again?.cameraId).not.toBe(t.cameraId);
  });

  it('starts police and rivals near the player spawn', () => {
    const mgr = new RoadHazardManager(new THREE.Group());
    for (const u of mgr.movingUnitPositions) {
      expect(Math.hypot(u.x - spawn.x, u.z - spawn.z)).toBeLessThanOrEqual(HAZARD_RESPAWN_MAX_RADIUS + 10);
    }
  });

  it('recycles police and rivals to 120~250m around a far-away player', () => {
    const mgr = new RoadHazardManager(new THREE.Group());
    // Player rides off ~2km away (any road node 1.8~2.4km from spawn)
    const target = ACTIVE_MAP_DATA.nodes.find((n) => {
      const d = Math.hypot(n.x - spawn.x, n.z - spawn.z);
      return d > 1800 && d < 2400;
    })!;
    expect(target).toBeDefined();
    const scooter: ScooterProximityInfo = {
      x: target.x,
      z: target.z,
      heading: 0,
      speedMps: 0,
      isRiding: true,
      crashed: false,
    };
    let elapsed = 0;
    for (let t = 0; t < 2.5; t += DT) {
      elapsed += DT;
      mgr.step(DT, elapsed, false, scooter, SIGNAL);
    }
    expect(mgr.recycledCount).toBe(6);
    for (const u of mgr.movingUnitPositions) {
      const d = Math.hypot(u.x - target.x, u.z - target.z);
      expect(d).toBeLessThan(HAZARD_RECYCLE_DISTANCE);
      // start node in the ring, then lane offset + <= 25% along the edge + ~1s of driving
      expect(d).toBeGreaterThan(HAZARD_RESPAWN_MIN_RADIUS - 40);
    }
    // Markers follow the units (phone map)
    const pos = mgr.movingUnitPositions;
    expect(mgr.patrolMarkers[0].x).toBeCloseTo(pos[0].x, 5);
    expect(mgr.rivalRiderMarkers[0].z).toBeCloseTo(pos[2].z, 5);

    // Keep driving around there: units stay with the player and never wander off
    for (let t = 0; t < 60; t += DT) {
      elapsed += DT;
      mgr.step(DT, elapsed, false, scooter, SIGNAL);
      for (const u of mgr.movingUnitPositions) {
        expect(Math.hypot(u.x - target.x, u.z - target.z)).toBeLessThan(HAZARD_RECYCLE_DISTANCE + 30);
      }
    }
  });

  it('follows the on-foot player position when given instead of the parked scooter', () => {
    const mgr = new RoadHazardManager(new THREE.Group());
    const target = ACTIVE_MAP_DATA.nodes.find((n) => Math.hypot(n.x - spawn.x, n.z - spawn.z) > 1500)!;
    const parkedScooter: ScooterProximityInfo = {
      x: spawn.x,
      z: spawn.z,
      heading: 0,
      speedMps: 0,
      isRiding: false,
      crashed: false,
    };
    let elapsed = 0;
    for (let t = 0; t < 2.5; t += DT) {
      elapsed += DT;
      mgr.step(DT, elapsed, false, parkedScooter, SIGNAL, undefined, undefined, undefined, undefined, undefined, {
        x: target.x,
        z: target.z,
      });
    }
    for (const u of mgr.movingUnitPositions) {
      expect(Math.hypot(u.x - target.x, u.z - target.z)).toBeLessThan(HAZARD_RECYCLE_DISTANCE);
    }
  });
});
