/**
 * The lights of the mid-block signalized crosswalks: a pole on each side of the road with a car signal facing the
 * oncoming lane and a walk signal facing across. Poles and housings are three InstancedMeshes; the five lamp colours
 * are five more whose per-instance colour is lit or dimmed when a crossing's phase changes (8 draw calls city-wide).
 */
import * as THREE from 'three';
import { MID_BLOCK_CROSSINGS, midBlockPhaseNow } from './midBlockSignals';
import { excludeFromMirrors } from '../renderLayers';

const LAMP_COLORS = {
  red: new THREE.Color(0xef4444),
  yellow: new THREE.Color(0xfacc15),
  green: new THREE.Color(0x22c55e),
  walkRed: new THREE.Color(0xef4444),
  walkGreen: new THREE.Color(0x22c55e),
} as const;
type LampKey = keyof typeof LAMP_COLORS;
const DIM = 0.12;

export class MidBlockLamps {
  public readonly root = new THREE.Group();
  private readonly lamps: Record<LampKey, THREE.InstancedMesh>;
  /** Last drawn state per crossing ('green' | 'yellow' | 'red') */
  private readonly last: string[] = [];
  private readonly tmp = new THREE.Color();
  private safe = false;

  constructor(parent: THREE.Object3D) {
    this.root.name = 'mid_block_signals';
    const n = MID_BLOCK_CROSSINGS.length * 2;
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 4.6, 6);
    const carBoxGeo = new THREE.BoxGeometry(0.42, 1.2, 0.24);
    const walkBoxGeo = new THREE.BoxGeometry(0.36, 0.72, 0.2);
    const lampGeo = new THREE.CircleGeometry(0.13, 10);
    const dark = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6 });
    const pole = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.5 }), n);
    const carBox = new THREE.InstancedMesh(carBoxGeo, dark, n);
    const walkBox = new THREE.InstancedMesh(walkBoxGeo, dark, n);
    const lampMat = () => new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.lamps = {
      red: new THREE.InstancedMesh(lampGeo, lampMat(), n),
      yellow: new THREE.InstancedMesh(lampGeo, lampMat(), n),
      green: new THREE.InstancedMesh(lampGeo, lampMat(), n),
      walkRed: new THREE.InstancedMesh(lampGeo, lampMat(), n),
      walkGreen: new THREE.InstancedMesh(lampGeo, lampMat(), n),
    };
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const one = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    MID_BLOCK_CROSSINGS.forEach((c, i) => {
      const ux = Math.sin(c.h);
      const uz = Math.cos(c.h);
      for (const side of [1, -1]) {
        const k = i * 2 + (side > 0 ? 0 : 1);
        // right of travel along side*u is side*r = side * (-uz, ux): traffic on this side approaches from -side*u
        const bx = c.x + -uz * side * (c.w / 2 + 0.7);
        const bz = c.z + ux * side * (c.w / 2 + 0.7);
        pole.setMatrixAt(k, m.compose(p.set(bx, 2.3, bz), q.identity(), one));
        // car signal faces the approaching cars (toward -side*u), walk signal faces across the road
        const faceCars = Math.atan2(-side * ux, -side * uz);
        const faceAcross = Math.atan2(uz * side, -ux * side);
        q.setFromEuler(e.set(0, faceCars, 0));
        const fwdX = Math.sin(faceCars) * 0.13;
        const fwdZ = Math.cos(faceCars) * 0.13;
        carBox.setMatrixAt(k, m.compose(p.set(bx, 4.1, bz), q, one));
        const lampAt = (key: LampKey, y: number, yaw: number, fx: number, fz: number) =>
          this.lamps[key].setMatrixAt(k, m.compose(p.set(bx + fx, y, bz + fz), q.setFromEuler(e.set(0, yaw, 0)), one));
        lampAt('red', 4.48, faceCars, fwdX, fwdZ);
        lampAt('yellow', 4.1, faceCars, fwdX, fwdZ);
        lampAt('green', 3.72, faceCars, fwdX, fwdZ);
        q.setFromEuler(e.set(0, faceAcross, 0));
        walkBox.setMatrixAt(k, m.compose(p.set(bx, 2.6, bz), q, one));
        const ax = Math.sin(faceAcross) * 0.11;
        const az = Math.cos(faceAcross) * 0.11;
        lampAt('walkRed', 2.78, faceAcross, ax, az);
        lampAt('walkGreen', 2.42, faceAcross, ax, az);
      }
    });
    for (const mesh of [pole, carBox, walkBox, ...Object.values(this.lamps)]) {
      mesh.instanceMatrix.needsUpdate = true;
      excludeFromMirrors(mesh);
      this.root.add(mesh);
    }
    for (const mesh of Object.values(this.lamps)) {
      for (let k = 0; k < n; k++) mesh.setColorAt(k, this.tmp.setRGB(DIM, DIM, DIM));
      mesh.instanceColor!.needsUpdate = true;
    }
    parent.add(this.root);
  }

  /** Lights each crossing's lamps for its phase (only the crossings whose phase changed are rewritten) */
  public update(): void {
    let changed = false;
    MID_BLOCK_CROSSINGS.forEach((_, i) => {
      const ph = midBlockPhaseNow(i);
      if (this.last[i] === ph.car) return;
      this.last[i] = ph.car;
      changed = true;
      const on: Record<LampKey, boolean> = {
        red: ph.car === 'red',
        yellow: ph.car === 'yellow',
        green: ph.car === 'green',
        walkRed: !ph.walk,
        walkGreen: ph.walk,
      };
      for (const key of Object.keys(this.lamps) as LampKey[]) {
        const c = this.tmp.copy(LAMP_COLORS[key]).multiplyScalar(on[key] ? 1 : DIM);
        this.lamps[key].setColorAt(i * 2, c);
        this.lamps[key].setColorAt(i * 2 + 1, c);
      }
    });
    if (changed) for (const mesh of Object.values(this.lamps)) mesh.instanceColor!.needsUpdate = true;
  }

  /** Colour-safe palette (설정 색약 친화 색): the same keys, safer colours */
  public setColorSafe(on: boolean, palette: { red: number; yellow: number; green: number }): void {
    if (on === this.safe) return;
    this.safe = on;
    LAMP_COLORS.red.setHex(palette.red);
    LAMP_COLORS.yellow.setHex(palette.yellow);
    LAMP_COLORS.green.setHex(palette.green);
    LAMP_COLORS.walkRed.setHex(palette.red);
    LAMP_COLORS.walkGreen.setHex(palette.green);
    this.last.length = 0; // redraw
  }
}
