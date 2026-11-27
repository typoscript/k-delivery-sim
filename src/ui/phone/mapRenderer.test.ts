import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { installCanvasStub } from '../../test/sceneFingerprint';
import { ACTIVE_MAP_DATA } from '../../data/suwonDistricts';
import type { PlayerState } from '../../player/PlayerController';
import type { ScooterState } from '../../vehicle/ScooterPhysics';

installCanvasStub();
// Streamed chunks load asynchronously over fetch; the map then draws from the map data itself
globalThis.fetch = (() => new Promise(() => {})) as typeof fetch;
const { CityWorld } = await import('../../world/CityWorld');
const { DeliveryManager } = await import('../../delivery/DeliveryManager');
const { RoadNavigator } = await import('../../world/RoadNavigator');
const { renderMapToContext } = await import('./mapRenderer');
const { createMapViewState } = await import('./mapView');

/** 2D context that records every call and property write (numbers to 0.01) and hashes the log */
function recordingContext(): { ctx: CanvasRenderingContext2D; summary: () => { calls: number; hash: number } } {
  let calls = 0;
  let hash = 0;
  const mix = (s: string) => {
    for (let i = 0; i < s.length; i++) hash = (Math.imul(hash, 31) + s.charCodeAt(i)) | 0;
  };
  const fmt = (v: unknown): string =>
    typeof v === 'number' ? (Math.round(v * 100) / 100).toString() : typeof v === 'string' ? v : typeof v;
  const gradient = { addColorStop: (o: number, c: string) => mix(`stop(${fmt(o)},${c})`) };
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (_t, key) => {
      if (key === 'canvas') return { width: 400, height: 700 };
      return (...args: unknown[]) => {
        calls++;
        mix(`${String(key)}(${args.map(fmt).join(',')})`);
        if (key === 'createRadialGradient' || key === 'createLinearGradient') return gradient;
        if (key === 'measureText') return { width: String(args[0]).length * 6 };
        return undefined;
      };
    },
    set: (_t, key, value) => {
      mix(`${String(key)}=${fmt(value)}`);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, summary: () => ({ calls, hash }) };
}

function drawScenarios() {
  // Orders are rolled with Math.random: same seed -> same orders, route and markers
  let seed = 4242;
  const origRandom = Math.random;
  Math.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  try {
    return drawSeeded();
  } finally {
    Math.random = origRandom;
  }
}

function drawSeeded() {
  const world = new CityWorld(new THREE.Scene());
  const s = ACTIVE_MAP_DATA.meta.playerSpawn;
  world.updateStreaming(s.x, s.z);
  const dm = new DeliveryManager(world.locations);
  dm.setReferencePosition(s.x, s.z);
  dm.refreshAvailableOrders();
  for (const o of dm.availableOrders.slice(0, 2)) dm.acceptOrder(o.id);
  const player = { x: s.x, z: s.z, heading: 0.4, mode: 'riding', inCorridor: false } as unknown as PlayerState;
  const scooter = { x: s.x + 2, z: s.z + 1, heading: 0.4, speed: 6 } as unknown as ScooterState;
  const nav = dm.getNavigationPlan(s.x, s.z, 0.4, s.x + 2, s.z + 1, false, 12, new RoadNavigator());
  const signal = { ns: 'green', ew: 'red', remainingSec: 7 } as const;
  const out: Record<string, { calls: number; hash: number }> = {};
  for (const [name, night, headingUp] of [
    ['north-up day', false, false],
    ['heading-up night', true, true],
  ] as const) {
    const rec = recordingContext();
    const view = createMapViewState();
    view.camX = s.x + 30;
    view.camZ = s.z - 20;
    renderMapToContext(rec.ctx, 400, 700, 2, view, player, scooter, nav, signal, night, 12.5, world.mapInfo, headingUp);
    out[name] = rec.summary();
  }
  return { out, routePoints: nav.route.length };
}

/**
 * The phone map draws the same thing every time for the same inputs. The snapshot pins the exact sequence of canvas
 * calls, so splitting / reordering the renderer must keep it; update with `npx vitest -u` only for intended changes.
 */
describe('phone map renderer', () => {
  it('draws the same canvas calls for the same inputs', () => {
    const a = drawScenarios();
    expect(drawScenarios()).toEqual(a);
    expect(a.routePoints).toBeGreaterThan(1);
    for (const r of Object.values(a.out)) expect(r.calls).toBeGreaterThan(200);
    expect(a.out).toMatchSnapshot();
  });
});
