/**
 * Storefront signs with real names (실제 상호 간판): the named OSM shops and services of a chunk get a lit signboard
 * with their name on the street-facing wall, on the ground-floor sign band. Only the chunks within one chunk of the
 * player get theirs - one canvas atlas (a row per sign) and one mesh per chunk, freed again when the player moves on
 * (like the delivery props' sign textures), so at most 9 extra draw calls. The layout maths is pure and unit tested.
 */
import * as THREE from 'three';
import type { ChunkData, StoreSignData } from './OpenWorldTypes';
import { excludeFromMirrors, freezeStatic } from '../renderLayers';

/** Sign band on the wall (the generated storefront signboards sit at 3.2-4.15 m) */
export const SIGN_Y0 = 3.22;
export const SIGN_Y1 = 4.12;
/** In front of the generated signboard (0.22 m deep) */
export const SIGN_OUT_M = 0.26;
const ROW_PX = 64;
const ATLAS_W = 512;
const MAX_SIGNS = 32;
const BG = ['#b91c1c', '#1d4ed8', '#047857', '#7c3aed', '#c2410c', '#0f766e', '#be185d', '#1e293b'];

const hashOf = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

/**
 * Quad corners of a sign (world x, y, z) in drawing order: the left and right ends as seen from the street (facing
 * the wall), bottom then top
 */
export function signCorners(s: StoreSignData): { bl: number[]; br: number[]; tl: number[]; tr: number[] } {
  const nx = Math.sin(s.h);
  const nz = Math.cos(s.h);
  // a viewer facing the wall looks along -n; their right is forward x up = (-fz, fx) with forward = -n: (nz, -nx)
  const rx = nz;
  const rz = -nx;
  const cx = s.x + nx * SIGN_OUT_M;
  const cz = s.z + nz * SIGN_OUT_M;
  const hw = s.w / 2;
  return {
    bl: [cx - rx * hw, SIGN_Y0, cz - rz * hw],
    br: [cx + rx * hw, SIGN_Y0, cz + rz * hw],
    tl: [cx - rx * hw, SIGN_Y1, cz - rz * hw],
    tr: [cx + rx * hw, SIGN_Y1, cz + rz * hw],
  };
}

/** One chunk's signs: the merged quads (UVs into the atlas rows) */
export function signGeometry(signs: readonly StoreSignData[]): THREE.BufferGeometry {
  const list = signs.slice(0, MAX_SIGNS);
  const rows = Math.max(1, list.length);
  const pos: number[] = [];
  const uv: number[] = [];
  const nor: number[] = [];
  list.forEach((s, i) => {
    const { bl, br, tl, tr } = signCorners(s);
    const v1 = 1 - i / rows;
    const v0 = 1 - (i + 1) / rows;
    const n = [Math.sin(s.h), 0, Math.cos(s.h)];
    for (const [p, u, v] of [
      [bl, 0, v0],
      [br, 1, v0],
      [tr, 1, v1],
      [bl, 0, v0],
      [tr, 1, v1],
      [tl, 0, v1],
    ] as Array<[number[], number, number]>) {
      pos.push(p[0], p[1], p[2]);
      uv.push(u, v);
      nor.push(n[0], n[1], n[2]);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  return g;
}

function signAtlas(signs: readonly StoreSignData[]): THREE.Texture {
  const list = signs.slice(0, MAX_SIGNS);
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W;
  canvas.height = ROW_PX * Math.max(1, list.length);
  const g = canvas.getContext('2d')!;
  list.forEach((s, i) => {
    const y = i * ROW_PX;
    g.fillStyle = BG[hashOf(s.n) % BG.length];
    g.fillRect(0, y, ATLAS_W, ROW_PX);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(0, y, ATLAS_W, 3);
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = 42;
    g.font = `800 ${size}px sans-serif`;
    // the sign is w metres wide on a 0.9 m band: keep the text inside, shrinking long names
    const maxW = ATLAS_W - 24;
    while (size > 18 && g.measureText(s.n).width > maxW) {
      size -= 2;
      g.font = `800 ${size}px sans-serif`;
    }
    g.fillText(s.n, ATLAS_W / 2, y + ROW_PX / 2 + 2, maxW);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class StoreSigns {
  public readonly root = new THREE.Group();
  private readonly live = new Map<string, { mesh: THREE.Mesh; tex: THREE.Texture }>();
  private lastKey = '';

  constructor(parent: THREE.Object3D) {
    this.root.name = 'store_signs';
    parent.add(this.root);
  }

  public get count(): number {
    return this.live.size;
  }

  /** Signs for the built chunks within one chunk of (ix, iz); rebuilt only when that set changes */
  public update(ix: number, iz: number, version: number, getBuilt: () => readonly ChunkData[]): void {
    const key = `${ix},${iz},${version}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const built = getBuilt();
    const want = new Map<string, ChunkData>();
    for (const c of built) {
      if (Math.abs(c.ix - ix) <= 1 && Math.abs(c.iz - iz) <= 1 && c.signs && c.signs.length > 0) want.set(`${c.ix},${c.iz}`, c);
    }
    for (const [k, v] of this.live) {
      if (want.has(k)) continue;
      v.mesh.removeFromParent();
      v.mesh.geometry.dispose();
      (v.mesh.material as THREE.Material).dispose();
      v.tex.dispose();
      this.live.delete(k);
    }
    for (const [k, c] of want) {
      if (this.live.has(k)) continue;
      const tex = signAtlas(c.signs!);
      const mesh = new THREE.Mesh(signGeometry(c.signs!), new THREE.MeshBasicMaterial({ map: tex }));
      mesh.name = `signs_${k}`;
      excludeFromMirrors(mesh);
      this.root.add(mesh);
      freezeStatic(mesh);
      this.live.set(k, { mesh, tex });
    }
  }
}
