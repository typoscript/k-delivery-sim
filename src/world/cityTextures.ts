import * as THREE from 'three';
import { seededRandom } from '../seededRandom';

/**
 * Shared procedural city textures & building materials.
 * Used by CityWorld (legacy single-district map) and the open-world chunk mesh builder so both look identical.
 * Facade / night-window textures use world-metre UVs with repeat 0.08 (one tile per 12.5m).
 */

export function createAsphaltTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#2d343e';
  ctx.fillRect(0, 0, 256, 256);
  // Fixed seed: the road surface looks the same on every load
  const rand = seededRandom(0xa5f1);
  for (let i = 0; i < 1600; i++) {
    const v = 36 + Math.floor(rand() * 22);
    ctx.fillStyle = `rgb(${v},${v + 3},${v + 6})`;
    ctx.fillRect(rand() * 256, rand() * 256, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

export function createSidewalkTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#b4b8bf';
  ctx.fillRect(0, 0, 128, 128);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      ctx.fillStyle = (row + col) % 2 === 0 ? '#aeb3bc' : '#babdc3';
      ctx.fillRect(col * 32 + 1, row * 32 + 1, 30, 30);
    }
  }
  ctx.strokeStyle = 'rgba(71, 85, 105, 0.3)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 128; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 128);
    ctx.moveTo(0, i);
    ctx.lineTo(128, i);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(110, 110);
  return tex;
}

export function createFacadeTexture(baseHex: string, winHex: string, cols = 4, rows = 6): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 256, 256);

  const cw = 256 / cols;
  const rh = 256 / rows;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      ctx.fillStyle = winHex;
      ctx.fillRect(col * cw + 7, r * rh + 6, cw - 14, rh - 14);
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(col * cw + 9, r * rh + 8, (cw - 18) * 0.45, (rh - 18) * 0.4);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(0.08, 0.08);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createPuddleRoughnessTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#adadad';
  ctx.fillRect(0, 0, 256, 256);

  const puddles: Array<[number, number, number, number]> = [
    [56, 64, 42, 26],
    [184, 72, 36, 24],
    [124, 152, 54, 32],
    [48, 206, 38, 22],
    [208, 198, 44, 28],
  ];
  for (const [px, py, radX, radY] of puddles) {
    const grad = ctx.createRadialGradient(px, py, 3, px, py, Math.max(radX, radY));
    grad.addColorStop(0, '#0e0e0e');
    grad.addColorStop(0.6, '#222222');
    grad.addColorStop(1, 'rgba(173,173,173,0)');
    ctx.save();
    ctx.translate(px, py);
    ctx.scale(1, radY / radX);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, radX, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

export function createNightWindowEmissiveTexture(
  cols = 4,
  rows = 6,
  litChance = 0.52,
  palette: string[] = ['#fde68a', '#fef3c7', '#bae6fd', '#fed7aa']
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 256, 256);

  const cw = 256 / cols;
  const rh = 256 / rows;
  let seed = cols * 37 + rows * 91;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      if (rand() < litChance) {
        ctx.fillStyle = palette[Math.floor(rand() * palette.length)];
        ctx.fillRect(col * cw + 8, r * rh + 7, cw - 16, rh - 16);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(0.08, 0.08);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface BuildingMaterialSet {
  shopWallMat: THREE.MeshStandardMaterial;
  aptWallMat: THREE.MeshStandardMaterial;
  villaWallMat: THREE.MeshStandardMaterial;
  publicWallMat: THREE.MeshStandardMaterial;
  roofMat: THREE.MeshStandardMaterial;
}

/** Facade wall materials per building category + shared flat roof material */
export function createBuildingMaterials(): BuildingMaterialSet {
  const shopWallMat = new THREE.MeshStandardMaterial({
    map: createFacadeTexture('#d8e1ec', '#1e3a5f', 4, 5),
    emissiveMap: createNightWindowEmissiveTexture(4, 5, 0.68, ['#fef08a', '#bae6fd', '#fbcfe8', '#fed7aa']),
    emissive: 0xffffff,
    emissiveIntensity: 0,
    roughness: 0.45,
    metalness: 0.2,
  });
  const aptWallMat = new THREE.MeshStandardMaterial({
    map: createFacadeTexture('#e6e2d8', '#334155', 5, 8),
    emissiveMap: createNightWindowEmissiveTexture(5, 8, 0.46, ['#fde68a', '#fef3c7', '#ffedd5']),
    emissive: 0xffffff,
    emissiveIntensity: 0,
    roughness: 0.72,
  });
  const villaWallMat = new THREE.MeshStandardMaterial({
    map: createFacadeTexture('#c89c82', '#263242', 3, 4),
    emissiveMap: createNightWindowEmissiveTexture(3, 4, 0.54, ['#fde68a', '#fed7aa', '#fef9c3']),
    emissive: 0xffffff,
    emissiveIntensity: 0,
    roughness: 0.84,
  });
  const publicWallMat = new THREE.MeshStandardMaterial({
    map: createFacadeTexture('#cbd5e1', '#0f2942', 4, 6),
    emissiveMap: createNightWindowEmissiveTexture(4, 6, 0.42, ['#bae6fd', '#e0f2fe', '#fef3c7']),
    emissive: 0xffffff,
    emissiveIntensity: 0,
    roughness: 0.4,
    metalness: 0.25,
  });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.88 });
  return { shopWallMat, aptWallMat, villaWallMat, publicWallMat, roofMat };
}

export type BuildingWallCategory = 'shop' | 'apt' | 'villa' | 'public';

/** Same category rule CityWorld uses: residential <= 16m is a low-rise villa, taller is an apartment */
export function buildingWallCategory(kind: 'shop' | 'residential' | 'public', height: number): BuildingWallCategory {
  if (kind === 'shop') return 'shop';
  if (kind === 'residential') return height <= 16 ? 'villa' : 'apt';
  return 'public';
}

export function createSignTexture(title: string, bg: string, fg = '#ffffff'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = 'rgba(255,255,255,0.38)';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 500, 116);
  ctx.fillStyle = fg;
  ctx.font = 'bold 46px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, 256, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createManholeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#3b424c';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = '#1f2937';
  ctx.lineWidth = 3;
  for (const r of [46, 30, 14]) {
    ctx.beginPath();
    ctx.arc(64, 64, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createSpeedBumpTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#facc15';
  for (let x = -64; x < 320; x += 36) {
    ctx.beginPath();
    ctx.moveTo(x, 64);
    ctx.lineTo(x + 18, 64);
    ctx.lineTo(x + 36, 0);
    ctx.lineTo(x + 18, 0);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 4);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createLampPoolTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255, 224, 150, 0.42)');
  grad.addColorStop(0.45, 'rgba(251, 191, 36, 0.16)');
  grad.addColorStop(1, 'rgba(251, 191, 36, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
