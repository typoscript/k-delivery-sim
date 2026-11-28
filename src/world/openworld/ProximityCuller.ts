import * as THREE from 'three';
import { chunkCoordOf, chunkDistance, chunkKey } from './ChunkGrid';
import { ChunkGridSpec } from './OpenWorldTypes';

/**
 * Distance culling for static props spread over the whole open world (street lamps, bus stops, lobbies,
 * signal gantries, landmarks...). Props register with their world position; only props within
 * `radiusChunks` (Chebyshev chunk distance) of the player stay visible. Visibility is only re-evaluated
 * when the player crosses into another chunk, so per-frame cost is ~zero.
 *
 * Lazy props are created on first approach and disposed again once farther than `disposeRadiusChunks`
 * (for props that own big resources such as per-stop canvas sign textures).
 */

interface Entry {
  obj: THREE.Object3D;
  ix: number;
  iz: number;
  radius: number;
}

interface LazyEntry {
  ix: number;
  iz: number;
  radius: number;
  disposeRadius: number;
  parent: THREE.Object3D;
  /** null: not ready yet (e.g. waiting for chunk data) - retried on later updates while in range */
  build: () => { object: THREE.Object3D; dispose: () => void } | null;
  live: { object: THREE.Object3D; dispose: () => void } | null;
}

export class ProximityCuller {
  private readonly entries: Entry[] = [];
  private readonly lazy: LazyEntry[] = [];
  /** In-range lazy entries whose build said "not ready yet" */
  private readonly retry = new Set<LazyEntry>();
  private lastKey = '';
  public liveLazyCount = 0;

  constructor(
    private readonly spec: ChunkGridSpec,
    private readonly defaultRadius = 2
  ) {}

  public register(obj: THREE.Object3D, x: number, z: number, radiusChunks = this.defaultRadius): void {
    const c = chunkCoordOf(this.spec, x, z);
    this.entries.push({ obj, ix: c.ix, iz: c.iz, radius: radiusChunks });
    obj.visible = false;
    this.lastKey = '';
  }

  public registerLazy(
    parent: THREE.Object3D,
    x: number,
    z: number,
    build: () => { object: THREE.Object3D; dispose: () => void } | null,
    radiusChunks = this.defaultRadius,
    disposeRadiusChunks = radiusChunks + 2
  ): void {
    const c = chunkCoordOf(this.spec, x, z);
    this.lazy.push({ ix: c.ix, iz: c.iz, radius: radiusChunks, disposeRadius: disposeRadiusChunks, parent, build, live: null });
    this.lastKey = '';
  }

  public get count(): number {
    return this.entries.length + this.lazy.length;
  }

  /** Re-evaluates visibility only when the player enters a new chunk (or after new registrations) */
  public update(px: number, pz: number, force = false): void {
    const pc = chunkCoordOf(this.spec, px, pz);
    const key = chunkKey(pc.ix, pc.iz);
    if (!force && key === this.lastKey) {
      // only the few entries still waiting for data
      if (this.retry.size > 0) for (const l of [...this.retry]) this.tryBuild(l);
      return;
    }
    this.lastKey = key;
    for (const e of this.entries) {
      e.obj.visible = chunkDistance(e, pc) <= e.radius;
    }
    for (const l of this.lazy) {
      const d = chunkDistance(l, pc);
      if (d <= l.radius && !l.live) {
        this.tryBuild(l);
      } else if (d > l.radius) {
        this.retry.delete(l);
      }
      if (d > l.disposeRadius && l.live) {
        l.live.object.removeFromParent();
        l.live.dispose();
        l.live = null;
        this.liveLazyCount--;
      }
    }
  }

  /**
   * Drops the live lazy props under `parent` so the next update builds them again (e.g. after a detail setting
   * change their build reads). Props out of range just stay unbuilt until approached.
   */
  public rebuildLazy(parent: THREE.Object3D): void {
    for (const l of this.lazy) {
      if (l.parent !== parent || !l.live) continue;
      l.live.object.removeFromParent();
      l.live.dispose();
      l.live = null;
      this.liveLazyCount--;
    }
    this.lastKey = '';
  }

  private tryBuild(l: LazyEntry): void {
    const built = l.build();
    if (!built) {
      this.retry.add(l);
      return;
    }
    this.retry.delete(l);
    l.live = built;
    l.parent.add(built.object);
    this.liveLazyCount++;
  }
}
