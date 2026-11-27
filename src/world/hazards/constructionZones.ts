import * as THREE from 'three';
import type { RoadHazardManager } from '../RoadHazardManager';
import { ACTIVE_MAP_DATA } from '../../data/suwonDistricts';
import { mergeStaticByMaterial } from '../instancing';
import { CONSTRUCTION_RULE, GRADE_SEPARATED_NAME, HazardFrame } from './hazardTypes';

function createConstructionSignTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f97316';
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = '#0f172a';
  for (let x = -40; x < 300; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 128);
    ctx.lineTo(x + 18, 128);
    ctx.lineTo(x + 36, 98);
    ctx.lineTo(x + 18, 98);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(14, 14, 228, 76);
  ctx.fillStyle = '#0f172a';
  ctx.font = '900 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🚧 도로 공사 중', 128, 42);
  ctx.font = 'bold 20px sans-serif';
  ctx.fillStyle = '#dc2626';
  ctx.fillText('1차선 통제 · 서행', 128, 72);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildConstructionZones(host: RoadHazardManager): void {
  const nodes = ACTIVE_MAP_DATA.nodes;
  const spawn = ACTIVE_MAP_DATA.meta.scooterSpawn;
  const coneOrangeMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.45 });
  const coneStripeMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, emissive: 0xffffff, emissiveIntensity: 0.2 });
  const coneBaseMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });
  const dirtMat = new THREE.MeshStandardMaterial({ color: 0x5c4738, roughness: 0.96 });
  const signMat = new THREE.MeshBasicMaterial({ map: createConstructionSignTexture() });

  const coneGeo = new THREE.ConeGeometry(0.22, 0.72, 10);
  const bandGeo = new THREE.CylinderGeometry(0.11, 0.16, 0.14, 10);
  const baseGeo = new THREE.BoxGeometry(0.46, 0.06, 0.46);

  const candidates = ACTIVE_MAP_DATA.edges
    .filter((e) => e.isMajor && e.dist >= 32)
    .sort((a, b) => b.dist - a.dist);

  const { count: maxZones, spacing: zoneSpacing } = host.placementLimits(CONSTRUCTION_RULE);
  for (const e of candidates) {
    if (host.constructionZones.length >= maxZones) break;
    if (host.isLargeMap && GRADE_SEPARATED_NAME.test(e.name)) continue;
    const na = nodes[e.a];
    const nb = nodes[e.b];
    const dx = nb.x - na.x;
    const dz = nb.z - na.z;
    const len = Math.hypot(dx, dz) || 1;
    const rx = -dz / len;
    const rz = dx / len;
    const heading = Math.atan2(dx, dz);

    const cx = (na.x + nb.x) * 0.5 + rx * (e.width * 0.5 - 1.5);
    const cz = (na.z + nb.z) * 0.5 + rz * (e.width * 0.5 - 1.5);

    if (Math.hypot(cx - spawn.x, cz - spawn.z) < 55) continue;
    if (host.cameras.some((c) => Math.hypot(c.x - cx, c.z - cz) < 35)) continue;
    if (host.parkedHazards.some((h) => Math.hypot(h.x - cx, h.z - cz) < 35)) continue;
    if (host.constructionZones.some((z) => Math.hypot(z.x - cx, z.z - cz) < zoneSpacing)) continue;

    const g = new THREE.Group();
    g.position.set(cx, 0, cz);
    g.rotation.y = heading;

    const patch = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 6.2), dirtMat);
    patch.position.set(0, 0.04, 0);
    g.add(patch);

    for (const [ox, oz] of [
      [-0.7, -4.4],
      [-1.3, -2.4],
      [-1.3, 0],
      [-1.3, 2.4],
      [-0.7, 4.4],
    ]) {
      const b = new THREE.Mesh(baseGeo, coneBaseMat);
      b.position.set(ox, 0.04, oz);
      const c = new THREE.Mesh(coneGeo, coneOrangeMat);
      c.position.set(ox, 0.41, oz);
      const bd = new THREE.Mesh(bandGeo, coneStripeMat);
      bd.position.set(ox, 0.48, oz);
      g.add(b, c, bd);
    }

    const board = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.92, 0.12), signMat);
    board.position.set(0, 0.72, -3.5);
    const strobeMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xf59e0b,
      emissiveIntensity: 3.0,
    });
    const strobe = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.22, 10), strobeMat);
    strobe.position.set(0, 1.32, -3.5);
    g.add(board, strobe);
    // One mesh per material for this static prop (blinking / flash materials keep working)
    mergeStaticByMaterial(g);
    host.root.add(g);
    host.registerStaticProp(g, cx, cz);

    host.obstacles.push({
      minX: cx - 1.5,
      maxX: cx + 1.5,
      minZ: cz - 1.5,
      maxZ: cz + 1.5,
    });

    const id = `const-${host.constructionZones.length + 1}`;
    const label = e.name ? `${e.name} 공사구간` : `인계동 도로 공사구간 ${host.constructionZones.length + 1}`;
    host.constructionZones.push({ id, label, x: cx, z: cz, strobeMat });
    host.constructionMarkers.push({ id, x: cx, z: cz, label, edgeA: e.a, edgeB: e.b });
  }
}

/** Per frame: blinking amber strobes */
export function stepConstructionZones(host: RoadHazardManager, f: HazardFrame): void {
  // --- 3. Construction Strobes & Rival AI Delivery Scooters ---
  for (const cz of host.constructionZones) {
    cz.strobeMat.emissiveIntensity = f.blinkOn ? 3.8 : 0.25;
  }
}
