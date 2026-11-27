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
  build: () => { object: THREE.Object3D; dispose: () => void };
  live: { object: THREE.Object3D; dispose: () => void } | null;
}

export class ProximityCuller {
  private readonly entries: Entry[] = [];
  private readonly lazy: LazyEntry[] = [];
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
    build: () => { object: THREE.Object3D; dispose: () => void },
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
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    for (const e of this.entries) {
      e.obj.visible = chunkDistance(e, pc) <= e.radius;
    }
    for (const l of this.lazy) {
      const d = chunkDistance(l, pc);
      if (d <= l.radius && !l.live) {
        l.live = l.build();
        l.parent.add(l.live.object);
        this.liveLazyCount++;
      } else if (d > l.disposeRadius && l.live) {
        l.live.object.removeFromParent();
        l.live.dispose();
        l.live = null;
        this.liveLazyCount--;
      }
    }
  }
}
