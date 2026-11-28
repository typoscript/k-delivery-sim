/**
 * Flooded walkways (하천 산책로 통제): while the streams are high, a sheet of running water covers each stream's
 * walkways and stepping stones - one mesh with the flowing stream material, rebuilt only when the loaded stream
 * pieces change. Stretches under a road or bridge are left out (the road stays dry and on top).
 */
import * as THREE from 'three';
import type { WaterLineData } from './openworld/OpenWorldTypes';
import { WALKWAY_M } from './streamPaths';
import { excludeFromMirrors } from './renderLayers';

/** Above the walkway (0.009) and the stepping stones' tops (0.16) */
export const FLOOD_Y = 0.2;
const STEP_M = 2;
const UV_PER_M = 0.05;

/** Quads (as triangles) covering the water and both walkways of each stream piece, skipping road stretches */
export function floodGeometry(
  lines: readonly WaterLineData[],
  curbOffset?: (x: number, z: number) => number,
): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const uv: number[] = [];
  for (const wl of lines) {
    const half = wl.width / 2 + WALKWAY_M + 0.2;
    let along = 0;
    for (let i = 1; i < wl.pts.length; i++) {
      const [ax, az] = wl.pts[i - 1];
      const [bx, bz] = wl.pts[i];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-6) continue;
      const fx = (bx - ax) / len;
      const fz = (bz - az) / len;
      const rx = -fz * half;
      const rz = fx * half;
      for (let s = 0; s < len; s += STEP_M) {
        const e = Math.min(len, s + STEP_M);
        const mx = ax + fx * ((s + e) / 2);
        const mz = az + fz * ((s + e) / 2);
        if (curbOffset && curbOffset(mx, mz) < 0.5) continue; // under a road / bridge
        const p0 = [ax + fx * s, az + fz * s];
        const p1 = [ax + fx * e, az + fz * e];
        const v0 = (along + s) * UV_PER_M;
        const v1 = (along + e) * UV_PER_M;
        const uR = half * 2 * UV_PER_M;
        const quad: Array<[number, number, number, number]> = [
          [p0[0] - rx, p0[1] - rz, 0, v0],
          [p0[0] + rx, p0[1] + rz, uR, v0],
          [p1[0] - rx, p1[1] - rz, 0, v1],
          [p1[0] - rx, p1[1] - rz, 0, v1],
          [p0[0] + rx, p0[1] + rz, uR, v0],
          [p1[0] + rx, p1[1] + rz, uR, v1],
        ];
        for (const [x, z, u, v] of quad) {
          pos.push(x, FLOOD_Y, z);
          uv.push(u, v);
        }
      }
      along += len;
    }
  }
  if (pos.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const n = new Float32Array(pos.length);
  for (let i = 1; i < n.length; i += 3) n[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  g.computeBoundingSphere();
  return g;
}

export class FloodOverlay {
  public readonly mesh: THREE.Mesh;
  private key = '';

  constructor(parent: THREE.Object3D, material: THREE.Material) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.mesh.name = 'flood_overlay';
    this.mesh.visible = false;
    excludeFromMirrors(this.mesh);
    parent.add(this.mesh);
  }

  /** Shows the flood over `lines` (rebuilt when they change) or hides it */
  public sync(flooded: boolean, lines: readonly WaterLineData[], version: number, curbOffset?: (x: number, z: number) => number): void {
    if (!flooded) {
      this.mesh.visible = false;
      return;
    }
    const key = `${version}`;
    if (key !== this.key) {
      this.key = key;
      this.mesh.geometry.dispose();
      this.mesh.geometry = floodGeometry(lines, curbOffset) ?? new THREE.BufferGeometry();
    }
    this.mesh.visible = true;
  }
}
