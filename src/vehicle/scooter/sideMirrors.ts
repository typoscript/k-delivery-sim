import * as THREE from 'three';
import { ScooterState } from '../ScooterPhysics';

/** Side mirror view distance */
const MIRROR_FAR_M = 150;
const RT_W = 256;
const RT_H = 160;

function mirrorTarget(): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(RT_W, RT_H, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
  });
  // Horizontally flipped for a true reflection
  rt.texture.wrapS = THREE.RepeatWrapping;
  rt.texture.repeat.set(-1, 1);
  rt.texture.offset.set(1, 0);
  return rt;
}

/**
 * Live rear-view side mirrors on the handlebars: a render target + rear-facing camera per side, the mirror head
 * meshes, and the per-frame mirror passes (only while riding).
 */
export class SideMirrors {
  private readonly leftRT = mirrorTarget();
  private readonly rightRT = mirrorTarget();
  // 150m is plenty for a 256px mirror and lets frustum culling drop far chunks
  private readonly leftCam = new THREE.PerspectiveCamera(62, RT_W / RT_H, 0.25, MIRROR_FAR_M);
  private readonly rightCam = new THREE.PerspectiveCamera(62, RT_W / RT_H, 0.25, MIRROR_FAR_M);
  private readonly leftAnchor = new THREE.Object3D();
  private readonly rightAnchor = new THREE.Object3D();
  private readonly glassMeshes: THREE.Mesh[] = [];
  /** Mirror head groups (the handlebar sync keeps them upright) */
  public readonly heads: Array<{ group: THREE.Group; side: number }> = [];
  private frame = 0;
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpTarget = new THREE.Vector3();

  /** Mirror head (housing, chrome rim, live glass, camera anchor) for side +1 (left) / -1 (right) */
  public createHead(side: number, darkMat: THREE.Material, chromeMat: THREE.Material): THREE.Group {
    const isLeft = side > 0;
    // Mirror head assembly angled cleanly toward driver's 1st-person eyes
    const mirrorHead = new THREE.Group();
    mirrorHead.position.set(side * 0.41, 1.355, -0.21);
    // Slight inward yaw toward center driver eye & upward tilt
    mirrorHead.rotation.y = side * 0.22;
    mirrorHead.rotation.x = 0.12;

    // Mirror back housing & chrome rim
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.145, 0.026), darkMat);
    const rim = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.155, 0.012), chromeMat);
    rim.position.z = -0.01;
    mirrorHead.add(housing, rim);

    // Live Rear-View Mirror Glass Plane facing driver (-Z local)
    const rt = isLeft ? this.leftRT : this.rightRT;
    const mirrorGlassMat = new THREE.MeshBasicMaterial({
      map: rt.texture,
      toneMapped: false,
    });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.128), mirrorGlassMat);
    glass.position.z = -0.018;
    glass.rotation.y = Math.PI; // face driver (-Z)
    mirrorHead.add(glass);
    this.glassMeshes.push(glass);

    // Anchor point for the rear-facing mirror camera
    const anchor = isLeft ? this.leftAnchor : this.rightAnchor;
    anchor.position.set(side * 0.04, 0, -0.08);
    mirrorHead.add(anchor);

    this.heads.push({ group: mirrorHead, side });
    return mirrorHead;
  }

  /** Renders the rear views (call with the scooter's world matrices up to date) */
  public render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, state: ScooterState): void {
    const backX = -Math.sin(state.heading);
    const backZ = -Math.cos(state.heading);
    const leftX = Math.cos(state.heading);
    const leftZ = -Math.sin(state.heading);

    // Temporarily hide mirror glass planes to avoid sampling the RenderTarget while rendering to it
    for (const m of this.glassMeshes) m.visible = false;

    const prevTarget = renderer.getRenderTarget();
    // Reuse this frame's shadow map instead of re-rendering it for every mirror pass
    // (each renderer.render() would otherwise redraw the whole shadow map again)
    const prevShadowAuto = renderer.shadowMap.autoUpdate;
    const prevShadowNeeds = renderer.shadowMap.needsUpdate;
    renderer.shadowMap.autoUpdate = false;
    // A scheduled shadow refresh must happen in the MAIN pass (the mirror cameras don't see the
    // main-camera-only props, so a mirror pass would bake a shadow map without them)
    renderer.shadowMap.needsUpdate = false;
    // Alternate the mirrors: each one refreshes every other frame (~30Hz at 60fps), halving the cost
    this.frame++;
    const doLeft = this.frame % 2 === 0;

    // Left mirror camera: rear + slight outward-left view (shows left lane behind rider!)
    this.aim(this.leftCam, this.leftAnchor, backX + leftX * 0.22, backZ + leftZ * 0.22);
    if (doLeft) {
      renderer.setRenderTarget(this.leftRT);
      renderer.render(scene, this.leftCam);
    }

    // Right mirror camera: rear + slight outward-right view (shows right lane & curb behind rider!)
    this.aim(this.rightCam, this.rightAnchor, backX - leftX * 0.22, backZ - leftZ * 0.22);
    if (!doLeft) {
      renderer.setRenderTarget(this.rightRT);
      renderer.render(scene, this.rightCam);
    }

    renderer.setRenderTarget(prevTarget);
    renderer.shadowMap.autoUpdate = prevShadowAuto;
    renderer.shadowMap.needsUpdate = prevShadowNeeds;
    for (const m of this.glassMeshes) m.visible = true;
  }

  /** Places a mirror camera at its anchor, looking 25m back along (dirX, dirZ) and slightly down */
  private aim(cam: THREE.PerspectiveCamera, anchor: THREE.Object3D, dirX: number, dirZ: number): void {
    anchor.getWorldPosition(this.tmpPos);
    cam.position.copy(this.tmpPos);
    this.tmpTarget.set(this.tmpPos.x + dirX * 25, this.tmpPos.y - 1.1, this.tmpPos.z + dirZ * 25);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.tmpTarget);
  }
}
