import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { RoutePoint } from './RoadNavigator';

const MAX_PATH_POINTS = 40;
const MAX_RIBBON_QUADS = 128;
const LINE_Y = 0.16;
const RIBBON_Y = 0.12;
const RIBBON_HALF_WIDTH = 0.72;

/**
 * DrawCall-optimized 3D Road Navigation Polyline Renderer.
 * Renders an A* shortest path directly on the road surface in bright fluorescent neon green:
 *  - DrawCall #1: Three.js Line2 (fixed-size pre-allocated LineGeometry, world-unit width, animated dash)
 *  - DrawCall #2: Pre-allocated ground chevron ribbon Mesh with animated CanvasTexture
 * Zero per-frame allocations & zero draw calls when idle or indoors (parented to outdoor world root).
 */
export class RoadNavLine3D {
  public readonly root = new THREE.Group();

  private readonly line: Line2;
  private readonly lineGeo: LineGeometry;
  private readonly lineMat: LineMaterial;
  private readonly linePositions = new Float32Array(MAX_PATH_POINTS * 3);

  private readonly ribbonMesh: THREE.Mesh;
  private readonly ribbonGeo: THREE.BufferGeometry;
  private readonly ribbonPosAttr: THREE.BufferAttribute;
  private readonly ribbonUvAttr: THREE.BufferAttribute;
  private readonly ribbonTex: THREE.CanvasTexture;
  private readonly ribbonMat: THREE.MeshBasicMaterial;

  private active = false;

  constructor(parent: THREE.Object3D) {
    // 1. Fluorescent neon-green Line2 polyline (fixed vertex count = zero buffer reallocation!)
    this.lineGeo = new LineGeometry();
    this.lineGeo.setPositions(this.linePositions);

    this.lineMat = new LineMaterial({
      color: 0x39ff14, // Fluorescent neon green
      linewidth: 0.36,
      worldUnits: true,
      dashed: true,
      dashScale: 1,
      dashSize: 3.2,
      gapSize: 1.5,
      dashOffset: 0,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
    });

    this.line = new Line2(this.lineGeo, this.lineMat);
    this.line.frustumCulled = false;
    this.line.renderOrder = 4;
    this.root.add(this.line);

    // 2. Glowing animated neon chevron ribbon (CanvasTexture + pre-allocated BufferGeometry)
    this.ribbonTex = this.createChevronCanvasTexture();
    this.ribbonMat = new THREE.MeshBasicMaterial({
      map: this.ribbonTex,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const maxVerts = MAX_RIBBON_QUADS * 6; // 2 triangles per segment quad
    this.ribbonPosAttr = new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3);
    this.ribbonUvAttr = new THREE.BufferAttribute(new Float32Array(maxVerts * 2), 2);
    this.ribbonPosAttr.setUsage(THREE.DynamicDrawUsage);
    this.ribbonUvAttr.setUsage(THREE.DynamicDrawUsage);

    this.ribbonGeo = new THREE.BufferGeometry();
    this.ribbonGeo.setAttribute('position', this.ribbonPosAttr);
    this.ribbonGeo.setAttribute('uv', this.ribbonUvAttr);
    this.ribbonGeo.setDrawRange(0, 0);

    this.ribbonMesh = new THREE.Mesh(this.ribbonGeo, this.ribbonMat);
    this.ribbonMesh.frustumCulled = false;
    this.ribbonMesh.renderOrder = 3;
    this.root.add(this.ribbonMesh);

    this.root.visible = false;
    parent.add(this.root);
  }

  private createChevronCanvasTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const ctx = c.getContext('2d')!;

    ctx.clearRect(0, 0, 256, 128);

    // Soft fluorescent green outer lane glow
    const grad = ctx.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0.0, 'rgba(57, 255, 20, 0.0)');
    grad.addColorStop(0.22, 'rgba(57, 255, 20, 0.24)');
    grad.addColorStop(0.5, 'rgba(74, 255, 110, 0.44)');
    grad.addColorStop(0.78, 'rgba(57, 255, 20, 0.24)');
    grad.addColorStop(1.0, 'rgba(57, 255, 20, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 128);

    // Crisp luminous neon chevrons pointing along +U (travel direction)
    ctx.strokeStyle = '#9dff6b';
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = '#39ff14';
    ctx.shadowBlur = 14;

    for (const cx of [70, 198]) {
      ctx.beginPath();
      ctx.moveTo(cx - 28, 30);
      ctx.lineTo(cx + 18, 64);
      ctx.lineTo(cx - 28, 98);
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  public setResolution(width: number, height: number): void {
    this.lineMat.resolution.set(width, height);
  }

  public setPath(points: RoutePoint[], isNight: boolean): void {
    if (!points || points.length < 2) {
      this.active = false;
      this.root.visible = false;
      return;
    }

    this.active = true;
    this.root.visible = true;

    // 1. Update fixed-size Line2 vertex array (pad tail with final point so buffer never reallocates)
    const count = Math.min(points.length, MAX_PATH_POINTS);
    for (let i = 0; i < MAX_PATH_POINTS; i++) {
      const pt = points[Math.min(i, count - 1)];
      this.linePositions[i * 3] = pt.x;
      this.linePositions[i * 3 + 1] = LINE_Y;
      this.linePositions[i * 3 + 2] = pt.z;
    }
    this.lineGeo.setPositions(this.linePositions);
    this.line.computeLineDistances();

    // 2. Build flat road-hugging ribbon quads along the A* path in-place
    const posArr = this.ribbonPosAttr.array as Float32Array;
    const uvArr = this.ribbonUvAttr.array as Float32Array;
    let quadCount = 0;
    let accumDist = 0;

    for (let i = 0; i < count - 1 && quadCount < MAX_RIBBON_QUADS; i++) {
      const a = points[i];
      const b = points[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const segLen = Math.hypot(dx, dz);
      if (segLen < 0.25) continue;

      // Perpendicular unit vector in XZ plane
      const nx = -dz / segLen;
      const nz = dx / segLen;
      const hx = nx * RIBBON_HALF_WIDTH;
      const hz = nz * RIBBON_HALF_WIDTH;

      const u0 = accumDist / 5.5;
      const u1 = (accumDist + segLen) / 5.5;
      accumDist += segLen;

      // Corner vertices: aL, aR, bL, bR
      const aLx = a.x + hx;
      const aLz = a.z + hz;
      const aRx = a.x - hx;
      const aRz = a.z - hz;
      const bLx = b.x + hx;
      const bLz = b.z + hz;
      const bRx = b.x - hx;
      const bRz = b.z - hz;

      const vOff = quadCount * 18;
      const uvOff = quadCount * 12;

      // Triangle 1: aL -> aR -> bL
      posArr[vOff] = aLx;
      posArr[vOff + 1] = RIBBON_Y;
      posArr[vOff + 2] = aLz;
      posArr[vOff + 3] = aRx;
      posArr[vOff + 4] = RIBBON_Y;
      posArr[vOff + 5] = aRz;
      posArr[vOff + 6] = bLx;
      posArr[vOff + 7] = RIBBON_Y;
      posArr[vOff + 8] = bLz;

      // Triangle 2: aR -> bR -> bL
      posArr[vOff + 9] = aRx;
      posArr[vOff + 10] = RIBBON_Y;
      posArr[vOff + 11] = aRz;
      posArr[vOff + 12] = bRx;
      posArr[vOff + 13] = RIBBON_Y;
      posArr[vOff + 14] = bRz;
      posArr[vOff + 15] = bLx;
      posArr[vOff + 16] = RIBBON_Y;
      posArr[vOff + 17] = bLz;

      uvArr[uvOff] = u0;
      uvArr[uvOff + 1] = 0;
      uvArr[uvOff + 2] = u0;
      uvArr[uvOff + 3] = 1;
      uvArr[uvOff + 4] = u1;
      uvArr[uvOff + 5] = 0;

      uvArr[uvOff + 6] = u0;
      uvArr[uvOff + 7] = 1;
      uvArr[uvOff + 8] = u1;
      uvArr[uvOff + 9] = 1;
      uvArr[uvOff + 10] = u1;
      uvArr[uvOff + 11] = 0;

      quadCount++;
    }

    this.ribbonPosAttr.needsUpdate = true;
    this.ribbonUvAttr.needsUpdate = true;
    this.ribbonGeo.setDrawRange(0, quadCount * 6);
    this.ribbonMat.opacity = isNight ? 0.92 : 0.72;
  }

  public updateAnimation(dt: number, elapsedTime: number): void {
    if (!this.active) return;
    // Animate dashes and chevrons flowing forward along the road toward the destination
    this.lineMat.dashOffset -= dt * 6.5;
    this.ribbonTex.offset.x = (this.ribbonTex.offset.x - dt * 1.35) % 1;
    this.lineMat.opacity = 0.86 + Math.sin(elapsedTime * 4.5) * 0.1;
  }
}
