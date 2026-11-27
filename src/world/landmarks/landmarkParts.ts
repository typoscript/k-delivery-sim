/** Shared landmark building blocks: banner / clock textures, Korean tiled roof, building orientation */
import * as THREE from 'three';
import { OsmBuildingData } from '../../data/suwonTypes';

/** Estimates primary horizontal alignment angle of a rectangular OSM building footprint */
export function estimateBuildingAngle(b: OsmBuildingData): number {
  if (b.pts.length < 2) return 0;
  let bestLen = 0;
  let bestAngle = 0;
  for (let i = 0; i < b.pts.length; i++) {
    const [x1, z1] = b.pts[i];
    const [x2, z2] = b.pts[(i + 1) % b.pts.length];
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len > bestLen) {
      bestLen = len;
      bestAngle = Math.atan2(x2 - x1, z2 - z1);
    }
  }
  return bestAngle;
}

/** Creates a detailed double-sided Korean signboard texture with optional sub-label */
export function createRichBannerTexture(
  mainText: string,
  subText: string,
  bgHex: string,
  borderHex: string,
  fgHex = '#ffffff',
  subHex = '#fde68a'
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 768;
  c.height = 192;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, 768, 192);

  ctx.strokeStyle = borderHex;
  ctx.lineWidth = 10;
  ctx.strokeRect(10, 10, 748, 172);

  ctx.fillStyle = fgHex;
  ctx.font = '900 54px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(mainText, 384, subText ? 76 : 98);

  if (subText) {
    ctx.fillStyle = subHex;
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText(subText, 384, 140);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Creates a glowing circular clock face texture for Suwon Station clocktower */
export function createClockFaceTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, 256, 256);

  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.arc(128, 128, 114, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#0284c7';
  ctx.lineWidth = 12;
  ctx.stroke();

  // Hour ticks
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = i % 3 === 0 ? 7 : 3;
    ctx.beginPath();
    ctx.moveTo(128 + Math.sin(a) * 86, 128 - Math.cos(a) * 86);
    ctx.lineTo(128 + Math.sin(a) * 102, 128 - Math.cos(a) * 102);
    ctx.stroke();
  }

  // Clock hands (10:10 aesthetic)
  ctx.strokeStyle = '#0f172a';
  ctx.lineCap = 'round';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(128, 128);
  ctx.lineTo(84, 88);
  ctx.stroke();

  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(128, 128);
  ctx.lineTo(186, 86);
  ctx.stroke();

  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(128, 128, 8, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Builds a traditional Korean hip-and-gable tiled roof (팔작지붕) centered at local y=0 */
export function createKoreanTiledRoof(width: number, depth: number, height: number): THREE.Group {
  const g = new THREE.Group();
  const tileMat = new THREE.MeshStandardMaterial({
    color: 0x2b323d,
    roughness: 0.78,
    metalness: 0.14,
  });
  const dancheongGreen = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.65 });
  const dancheongRed = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.65 });
  const ridgeMat = new THREE.MeshStandardMaterial({ color: 0xd6d3d1, roughness: 0.7 });

  // Lower flared eave skirt
  const eaveUnder = new THREE.Mesh(
    new THREE.BoxGeometry(width * 1.16, 0.34, depth * 1.16),
    dancheongGreen
  );
  eaveUnder.position.y = 0.15;
  const eaveBand = new THREE.Mesh(
    new THREE.BoxGeometry(width * 1.12, 0.24, depth * 1.12),
    dancheongRed
  );
  eaveBand.position.y = 0.42;

  // Sweeping sloped tiled roof (4-sided pyramid scaled to width x depth)
  const roofGeo = new THREE.ConeGeometry(1, height, 4);
  roofGeo.rotateY(Math.PI / 4);
  const roof = new THREE.Mesh(roofGeo, tileMat);
  roof.scale.set(width * 0.86, 1, depth * 0.86);
  roof.position.y = 0.5 + height * 0.5;
  roof.castShadow = true;

  // Upper ridge beam (용마루) with upturned end finials (취두)
  const ridgeLen = Math.max(width, depth) * 0.55;
  const ridgeAlongX = width >= depth;
  const ridge = new THREE.Mesh(
    new THREE.BoxGeometry(ridgeAlongX ? ridgeLen : 0.42, 0.42, ridgeAlongX ? 0.42 : ridgeLen),
    ridgeMat
  );
  ridge.position.y = 0.5 + height + 0.08;

  const endOff = ridgeLen * 0.5;
  for (const s of [-1, 1]) {
    const finial = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.68, 0.46), ridgeMat);
    finial.position.set(ridgeAlongX ? s * endOff : 0, 0.5 + height + 0.28, ridgeAlongX ? 0 : s * endOff);
    g.add(finial);
  }

  g.add(eaveUnder, eaveBand, roof, ridge);
  return g;
}
