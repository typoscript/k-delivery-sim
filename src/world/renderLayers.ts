import * as THREE from 'three';

/**
 * Render layer for small street props that are pointless in the 256x160 side mirrors (crosswalk paint,
 * lamps, signal gantries, lobbies, pedestrians...). The main camera renders layer 0 + this layer;
 * the mirror cameras only render layer 0 (roads, buildings, vehicles), which cuts their draw calls.
 */
export const NO_MIRROR_LAYER = 2;

/** Moves an object and all its current descendants to the main-camera-only layer */
export function excludeFromMirrors(obj: THREE.Object3D): void {
  obj.traverse((o) => o.layers.set(NO_MIRROR_LAYER));
}

const NOOP_UPDATE = (): void => {};

/**
 * Freezes a never-moving object: its subtree's world matrices are computed once now and the per-frame
 * scene.updateMatrixWorld() then skips the whole subtree. (Three.js still walks and recomposes every
 * descendant even with `matrixWorldAutoUpdate = false`, which cost ~5ms/frame for the city's ~29k
 * street-prop objects.) A descendant that later moves must refresh itself with
 * `obj.updateMatrix(); obj.updateMatrixWorld(true)` — its parent's world matrix stays valid.
 */
export function freezeStatic(obj: THREE.Object3D): void {
  obj.updateMatrixWorld(true);
  obj.updateMatrixWorld = NOOP_UPDATE;
}

/**
 * Marks a never-moving container (scene, world roots...) as static: it no longer recomputes its own
 * matrix every frame, which would otherwise force a full update of every descendant.
 */
export function makeStaticContainer(obj: THREE.Object3D): void {
  obj.updateMatrix();
  obj.matrixAutoUpdate = false;
}

/**
 * For containers of distance-culled moving things (pedestrians, road hazards): hidden children are
 * skipped by the per-frame matrix update and catch up the frame they become visible again.
 */
export function skipHiddenChildrenInMatrixUpdates(container: THREE.Object3D): void {
  container.updateMatrixWorld = function (this: THREE.Object3D, force?: boolean): void {
    if (this.matrixAutoUpdate) this.updateMatrix();
    let f = force === true;
    if (this.matrixWorldNeedsUpdate || f) {
      if (this.parent === null) this.matrixWorld.copy(this.matrix);
      else this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
      this.matrixWorldNeedsUpdate = false;
      f = true;
    }
    for (const child of this.children) {
      if (child.visible) child.updateMatrixWorld(f);
    }
  };
}
