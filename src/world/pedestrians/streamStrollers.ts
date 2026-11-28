/**
 * Strollers on the stream walkways (하천 산책로): a few people walk along the walkways near the player, turn back at
 * the end of the path and now and then cross the water on a row of stepping stones. They are their own small crowd
 * (the sidewalk crowd's graph is built from the roads), placed around the player only, with a private seeded random
 * sequence so the sidewalk crowd's behaviour fingerprint is untouched. The path maths is pure and unit tested.
 */
import * as THREE from 'three';
import type { WaterLineData } from '../openworld/OpenWorldTypes';
import { STONE_STEP_M, WALKWAY_M, steppingStoneRows } from '../streamPaths';
import {
  PedestrianFactory,
  PedestrianRig,
  setPedestrianDetail,
  setPedestrianWeather,
  withPrivateRandom,
} from '../PedestrianFactory';
import { seededRandom } from '../../seededRandom';

export const MAX_STROLLERS = 6;
/** Strollers appear this far from the player (not right in view) and are dropped beyond DESPAWN_M */
export const SPAWN_MIN_M = 30;
export const SPAWN_MAX_M = 120;
export const DESPAWN_M = 170;
/** Chance to take a row of stepping stones when passing one */
export const CROSS_CHANCE = 0.35;
const NEAR_RIG_M = 32;
/** Strollers keep this far from a road edge (they never walk over a bridge deck drawn across the walkway) */
const ROAD_CLEAR_M = 0.8;

/** Length of a stream piece's centre line */
export function lineLength(wl: WaterLineData): number {
  let len = 0;
  for (let i = 1; i < wl.pts.length; i++) len += Math.hypot(wl.pts[i][0] - wl.pts[i - 1][0], wl.pts[i][1] - wl.pts[i - 1][1]);
  return len;
}

/**
 * Point `s` metres along a stream piece on the walkway of `side` (+1 = left of the flow direction, -1 = right),
 * with the walking direction (unit) along the line
 */
export function walkwayPoint(
  wl: WaterLineData,
  s: number,
  side: number,
): { x: number; z: number; fx: number; fz: number } {
  const off = side * (wl.width / 2 + WALKWAY_M / 2);
  let walked = 0;
  for (let i = 1; i < wl.pts.length; i++) {
    const [px, pz] = wl.pts[i - 1];
    const [qx, qz] = wl.pts[i];
    const len = Math.hypot(qx - px, qz - pz);
    if (len < 1e-6) continue;
    if (s <= walked + len || i === wl.pts.length - 1) {
      const t = Math.max(0, Math.min(1, (s - walked) / len));
      const fx = (qx - px) / len;
      const fz = (qz - pz) / len;
      // left of the walking direction (heading 0 = +Z has +X on its left): left = (fz, 0, -fx)
      return { x: px + (qx - px) * t + fz * off, z: pz + (qz - pz) * t - fx * off, fx, fz };
    }
    walked += len;
  }
  const [x, z] = wl.pts[0];
  return { x, z, fx: 0, fz: 1 };
}

/** Distance along the line (s) of each stepping-stone row of a stream piece */
export function stoneRowStations(wl: WaterLineData, curbOffset?: (x: number, z: number) => number): number[] {
  const rows = steppingStoneRows(wl, curbOffset);
  return rows.map((r) => {
    const mid = r.stones[Math.floor(r.stones.length / 2)];
    // nearest station of the row's middle stone
    let best = 0;
    let bestD = Infinity;
    const len = lineLength(wl);
    for (let s = 0; s <= len; s += 1) {
      const p = walkwayPoint(wl, s, 0);
      const d = Math.hypot(p.x - mid[0], p.z - mid[1]);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  });
}

interface Stroller {
  rig: PedestrianRig;
  line: WaterLineData;
  len: number;
  stations: number[];
  s: number;
  dir: 1 | -1;
  side: 1 | -1;
  speed: number;
  /** Crossing on the stones: progress 0..1 from `side` to the other bank, at station `crossAt` */
  crossing: number | null;
  crossAt: number;
  /** Station last decided about (so each row is decided once per pass) */
  lastStation: number;
  x: number;
  z: number;
  heading: number;
}

export class StreamStrollers {
  public readonly root = new THREE.Group();
  private readonly factory = new PedestrianFactory();
  private readonly pool: PedestrianRig[] = [];
  private readonly live: Stroller[] = [];
  private readonly rand = seededRandom(0x5eed51);
  private weather: 'clear' | 'cloudy' | 'rain' | 'snow' = 'clear';
  /** Metres to the nearest road edge (negative on a road): a road over the walkway (bridge) turns strollers back */
  private curbOffset: ((x: number, z: number) => number) | undefined;

  constructor(parent: THREE.Object3D) {
    this.root.name = 'stream_strollers';
    parent.add(this.root);
  }

  public get count(): number {
    return this.live.length;
  }

  /** Positions of the strollers (tests / debugging) */
  public positions(): Array<{ x: number; z: number; crossing: boolean }> {
    return this.live.map((s) => ({ x: s.x, z: s.z, crossing: s.crossing !== null }));
  }

  public setWeather(w: 'clear' | 'cloudy' | 'rain' | 'snow'): void {
    if (w === this.weather) return;
    this.weather = w;
    for (const s of this.live) setPedestrianWeather(s.rig, w);
  }

  /** Steps the strollers around the player on the loaded stream pieces (`lines`) */
  public update(
    dt: number,
    px: number,
    pz: number,
    lines: readonly WaterLineData[],
    curbOffset?: (x: number, z: number) => number,
  ): void {
    this.curbOffset = curbOffset;
    // drop strollers far away or on a stream piece that was unloaded
    for (let i = this.live.length - 1; i >= 0; i--) {
      const s = this.live[i];
      if (!lines.includes(s.line) || Math.hypot(s.x - px, s.z - pz) > DESPAWN_M) this.release(i);
    }
    if (this.live.length < MAX_STROLLERS && lines.length > 0) this.trySpawn(px, pz, lines, curbOffset);
    for (const s of this.live) this.step(s, dt, px, pz);
  }

  private trySpawn(
    px: number,
    pz: number,
    lines: readonly WaterLineData[],
    curbOffset?: (x: number, z: number) => number,
  ): void {
    const line = lines[Math.floor(this.rand() * lines.length)];
    const len = lineLength(line);
    if (len < 20) return;
    const s0 = this.rand() * len;
    const side: 1 | -1 = this.rand() < 0.5 ? 1 : -1;
    const p = walkwayPoint(line, s0, side);
    const d = Math.hypot(p.x - px, p.z - pz);
    if (d < SPAWN_MIN_M || d > SPAWN_MAX_M) return;
    if (curbOffset && curbOffset(p.x, p.z) < ROAD_CLEAR_M) return;
    const rig =
      this.pool.pop() ??
      withPrivateRandom(() => this.factory.createPedestrian(this.rand() < 0.5 ? 'male' : 'female'));
    setPedestrianWeather(rig, this.weather);
    this.root.add(rig.root);
    const stations = stoneRowStations(line, curbOffset);
    this.live.push({
      rig,
      line,
      len,
      stations,
      s: s0,
      dir: this.rand() < 0.5 ? 1 : -1,
      side,
      speed: 1.0 + this.rand() * 0.45,
      crossing: null,
      crossAt: 0,
      lastStation: -1,
      x: p.x,
      z: p.z,
      heading: 0,
    });
  }

  private step(s: Stroller, dt: number, px: number, pz: number): void {
    const d = Math.min(dt, 0.05);
    let fx: number;
    let fz: number;
    if (s.crossing !== null) {
      // across the water: from this bank's walkway to the other one, stone to stone
      const a = walkwayPoint(s.line, s.crossAt, s.side);
      const b = walkwayPoint(s.line, s.crossAt, -s.side);
      const span = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      s.crossing = Math.min(1, s.crossing + (s.speed * 0.8 * d) / span);
      s.x = a.x + (b.x - a.x) * s.crossing;
      s.z = a.z + (b.z - a.z) * s.crossing;
      fx = (b.x - a.x) / span;
      fz = (b.z - a.z) / span;
      if (s.crossing >= 1) {
        s.crossing = null;
        s.side = s.side === 1 ? -1 : 1;
      }
    } else {
      const next = s.s + s.dir * s.speed * d;
      const ahead = walkwayPoint(s.line, next, s.side);
      if (next <= 0 || next >= s.len || (this.curbOffset && this.curbOffset(ahead.x, ahead.z) < ROAD_CLEAR_M)) {
        s.dir = s.dir === 1 ? -1 : 1; // end of the path or a road / bridge across it: turn back
      } else {
        s.s = next;
      }
      const station = s.stations.findIndex((st) => Math.abs(st - s.s) < STONE_STEP_M * 0.5);
      if (station >= 0 && station !== s.lastStation) {
        s.lastStation = station;
        if (this.rand() < CROSS_CHANCE) {
          s.crossing = 0;
          s.crossAt = s.stations[station];
        }
      }
      const p = walkwayPoint(s.line, s.s, s.side);
      s.x = p.x;
      s.z = p.z;
      fx = p.fx * s.dir;
      fz = p.fz * s.dir;
    }
    s.heading = Math.atan2(fx, fz);
    const r = s.rig.root;
    r.position.set(s.x, 0, s.z);
    r.rotation.y = s.heading;
    const near = setPedestrianDetail(s.rig, Math.hypot(s.x - px, s.z - pz) < NEAR_RIG_M);
    if (near) PedestrianFactory.updateWalkAnimation(s.rig, s.speed, dt);
  }

  private release(i: number): void {
    const s = this.live[i];
    s.rig.root.removeFromParent();
    this.pool.push(s.rig);
    this.live.splice(i, 1);
  }
}
