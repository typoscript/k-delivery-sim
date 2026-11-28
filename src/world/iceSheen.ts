/**
 * A faint glassy sheen on frozen bridge decks (다리 위 결빙): a translucent, glossy layer just above the road where a
 * bridge patch is iced, so a careful rider can spot it in the headlight. One InstancedMesh (one draw call) redrawn
 * only when the frozen spots change. Shaded street ice stays invisible.
 */
import * as THREE from 'three';
import { BlackIceField, MAX_ICE_SHEENS, iceSheenRects } from './blackIce';
import { excludeFromMirrors } from './renderLayers';

/** Just above the road surface (major roads 0.042) and below the paint (0.054) */
const SHEEN_Y = 0.048;

export class IceSheen {
  public readonly mesh: THREE.InstancedMesh;
  private version = -1;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();

  constructor(parent: THREE.Object3D) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xdbeafe,
      transparent: true,
      opacity: 0.26,
      roughness: 0.04,
      metalness: 0.55,
      depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_ICE_SHEENS);
    this.mesh.count = 0;
    this.mesh.name = 'ice_sheen';
    this.mesh.frustumCulled = false;
    excludeFromMirrors(this.mesh);
    parent.add(this.mesh);
  }

  /** Redraws the sheens when the frozen spots changed */
  public sync(ice: BlackIceField): void {
    if (ice.version === this.version) return;
    this.version = ice.version;
    const rects = iceSheenRects(ice.patches);
    rects.forEach((r, i) => {
      this.q.setFromEuler(this.e.set(0, r.heading, 0));
      this.m.compose(this.p.set(r.x, SHEEN_Y, r.z), this.q, this.s.set(r.width, 1, r.length));
      this.mesh.setMatrixAt(i, this.m);
    });
    this.mesh.count = rects.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = rects.length > 0;
  }
}
