/**
 * Running water of the streams (하천 물결): a soft ripple texture on the stream material that scrolls along each
 * stream's OSM direction (= the flow), faster and choppier after rain. One shared material; the texture is drawn
 * once with seededRandom. The flow speed maths is pure and unit tested.
 */
import * as THREE from 'three';
import { seededRandom } from '../seededRandom';

/** Ribbon UVs advance 0.05 per metre along a stream (ChunkMeshBuilder): flow speed in UV units per second */
const UV_PER_M = 0.05;

/** Water speed (m/s) for the rain intensity (0..1): a lazy summer stream to a fast brown one after a downpour */
export function streamFlowSpeed(rainIntensity: number): number {
  return 0.6 + 1.4 * Math.max(0, Math.min(1, rainIntensity));
}

/** Loudness 0..1 of running water for a listener `d` metres from the water's edge (louder after rain) */
export function streamSoundLevel(d: number, rainIntensity: number): number {
  if (!(d < 45)) return 0;
  const near = 1 - Math.max(0, d) / 45;
  return Math.min(1, near * near * (0.55 + 0.45 * Math.max(0, Math.min(1, rainIntensity))));
}

function rippleTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size, size);
  const rand = seededRandom(0x57a3);
  // short pale streaks along the flow (v), the base colour comes from the material
  for (let i = 0; i < 70; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 8 + rand() * 22;
    g.strokeStyle = `rgba(190, 225, 255, ${0.25 + rand() * 0.35})`;
    g.lineWidth = 1 + rand() * 1.5;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + (rand() - 0.5) * 6, y + len / 2, x, y + len);
    g.stroke();
    // wrap the streak at the edge so the tile repeats seamlessly
    if (y + len > size) {
      g.beginPath();
      g.moveTo(x, y - size);
      g.lineTo(x, y + len - size);
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class StreamWater {
  public readonly material: THREE.MeshStandardMaterial;
  private readonly map: THREE.Texture;

  constructor() {
    this.map = rippleTexture();
    this.material = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      emissive: 0x0369a1,
      emissiveIntensity: 0.18,
      roughness: 0.14,
      metalness: 0.38,
      map: this.map,
    });
  }

  /** Scrolls the ripples downstream; muddier and rougher in rain */
  public update(dt: number, rainIntensity: number): void {
    const speed = streamFlowSpeed(rainIntensity);
    // the texture moves toward larger v (downstream) when its offset decreases
    this.map.offset.y = (this.map.offset.y - speed * UV_PER_M * Math.min(dt, 0.1)) % 1;
    const r = Math.max(0, Math.min(1, rainIntensity));
    this.material.color.setRGB(0.008 + r * 0.2, 0.33 - r * 0.08, 0.55 - r * 0.25);
    this.material.roughness = 0.14 + r * 0.3;
  }
}
