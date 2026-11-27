import * as THREE from 'three';
import { createSidewalkTexture } from '../world/cityTextures';
import { ChunkStreamer } from '../world/openworld/ChunkStreamer';
import { createOpenWorldMaterials } from '../world/openworld/openWorldMaterials';
import { SUWON_OPEN_WORLD } from '../data/suwonUnified';

/**
 * Standalone open-world streaming preview (openworld.html).
 * Flies a first-person camera over the unified Suwon map while ChunkStreamer loads/unloads 200m chunks.
 * `?tour=1` drives an automatic route through all 4 legacy districts; `window.__openworld` exposes
 * stats & teleport for automated checks.
 */

const MAP_BASE = './map/suwon/';
const EYE_HEIGHT = 1.7;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('app')!.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x93c5fd);
// Denser than the single-district fog so chunks appearing ~400m away fade in instead of popping
scene.fog = new THREE.FogExp2(0xa5d4fb, 0.0028);
const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.08, 900);

const hemi = new THREE.HemisphereLight(0xe0f2fe, 0x475569, 0.92);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff7e6, 1.48);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 20;
sun.shadow.camera.far = 780;
const sd = 220;
Object.assign(sun.shadow.camera, { left: -sd, right: sd, top: sd, bottom: -sd });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

const statsEl = document.getElementById('ow-stats')!;
const buttonsEl = document.getElementById('ow-buttons')!;

async function main(): Promise<void> {
  const world = SUWON_OPEN_WORLD;
  const b = world.meta.bounds;

  // Sidewalk-paved ground under the whole city (roads/buildings stream on top)
  const groundTex = createSidewalkTexture();
  groundTex.repeat.set((b.maxX - b.minX) / 4, (b.maxZ - b.minZ) / 4);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(b.maxX - b.minX, b.maxZ - b.minZ),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.88 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
  ground.receiveShadow = true;
  scene.add(ground);

  const streamer = new ChunkStreamer(scene, world, createOpenWorldMaterials(), {
    chunkBaseUrl: `${MAP_BASE}chunks/`,
  });

  // --- camera controls: heading 0 = +Z (north), +X = left/west (project convention)
  const start = world.legacyDistricts[0].playerSpawn;
  const pos = new THREE.Vector3(start.x, EYE_HEIGHT, start.z);
  let yaw = start.heading;
  let pitch = 0;
  const keys = new Set<string>();
  window.addEventListener('keydown', (e) => keys.add(e.code));
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());
  let dragging = false;
  renderer.domElement.addEventListener('pointerdown', () => (dragging = true));
  window.addEventListener('pointerup', () => (dragging = false));
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    yaw -= e.movementX * 0.004;
    pitch = Math.max(-1.4, Math.min(1.4, pitch - e.movementY * 0.004));
  });

  // --- automatic tour through all 4 districts (station spawns) and back
  const tourPts = [...world.legacyDistricts, world.legacyDistricts[0]].map((d) => d.playerSpawn);
  let tour: { leg: number; t: number; speed: number } | null = null;
  const startTour = (speed = 25) => {
    tour = { leg: 0, t: 0, speed };
  };

  const teleport = (x: number, z: number, heading = yaw) => {
    pos.set(x, EYE_HEIGHT, z);
    yaw = heading;
  };
  for (const d of world.legacyDistricts) {
    const btn = document.createElement('button');
    btn.textContent = d.badgeLabel || d.shortName;
    btn.onclick = () => teleport(d.playerSpawn.x, d.playerSpawn.z, d.playerSpawn.heading);
    buttonsEl.appendChild(btn);
  }
  const tourBtn = document.createElement('button');
  tourBtn.textContent = '🚀 자동 투어';
  tourBtn.onclick = () => startTour();
  buttonsEl.appendChild(tourBtn);
  if (new URLSearchParams(location.search).get('tour') === '1') startTour();

  // --- frame timing stats (worst frame catches streaming hitches)
  const frameTimes: number[] = [];
  let worstFrameMs = 0;
  let last = performance.now();

  const stats = () => {
    const s = streamer.stats;
    const info = renderer.info;
    const sorted = [...frameTimes].sort((a, b2) => a - b2);
    const avg = frameTimes.reduce((a, b2) => a + b2, 0) / Math.max(1, frameTimes.length);
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return {
      ...s,
      fps: Math.round(1000 / Math.max(1, avg)),
      p95FrameMs: +(sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(1),
      worstFrameMs: +worstFrameMs.toFixed(1),
      renderCalls: info.render.calls,
      renderTriangles: info.render.triangles,
      gpuGeometries: info.memory.geometries,
      gpuTextures: info.memory.textures,
      jsHeapMB: mem ? Math.round(mem.usedJSHeapSize / 1e6) : -1,
      x: Math.round(pos.x),
      z: Math.round(pos.z),
      touring: tour !== null,
    };
  };
  const resetFrameStats = () => {
    frameTimes.length = 0;
    worstFrameMs = 0;
  };
  (window as unknown as { __openworld: unknown }).__openworld = { streamer, stats, teleport, startTour, resetFrameStats, world };

  const fwd = new THREE.Vector3();
  function frame(now: number): void {
    requestAnimationFrame(frame);
    const frameMs = now - last;
    last = now;
    const dt = Math.min(frameMs / 1000, 0.05);
    frameTimes.push(frameMs);
    if (frameTimes.length > 240) frameTimes.shift();
    if (frameTimes.length > 30) worstFrameMs = Math.max(worstFrameMs, frameMs);

    if (tour) {
      const a = tourPts[tour.leg];
      const bpt = tourPts[tour.leg + 1];
      const len = Math.hypot(bpt.x - a.x, bpt.z - a.z) || 1;
      tour.t += (tour.speed * dt) / len;
      if (tour.t >= 1) {
        tour.leg++;
        tour.t = 0;
        if (tour.leg >= tourPts.length - 1) tour = null;
      } else {
        pos.set(a.x + (bpt.x - a.x) * tour.t, EYE_HEIGHT, a.z + (bpt.z - a.z) * tour.t);
        yaw = Math.atan2(bpt.x - a.x, bpt.z - a.z);
      }
    } else {
      const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 60 : 14) * dt;
      // forward = (sin yaw, cos yaw); right = forward x up = (-fz, fx)
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const mv = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      const st = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      pos.x += (fx * mv + -fz * st) * speed;
      pos.z += (fz * mv + fx * st) * speed;
      pos.y = Math.max(EYE_HEIGHT, pos.y + ((keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0)) * speed);
    }

    streamer.update(pos.x, pos.z);

    fwd.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    camera.position.copy(pos);
    camera.lookAt(pos.x + fwd.x, pos.y + fwd.y, pos.z + fwd.z);
    sun.position.set(pos.x + 160, 240, pos.z + 120);
    sun.target.position.set(pos.x, 0, pos.z);

    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);

  window.setInterval(() => {
    const s = stats();
    statsEl.textContent = [
      `위치 x=${s.x} z=${s.z}  청크 ${s.playerChunk}${s.touring ? '  (투어 중)' : ''}`,
      `청크 상주 ${s.resident} (빌드 ${s.built} · 받는 중 ${s.fetching} · 대기 ${s.awaitingBuild})`,
      `건물 ${s.buildings}동 · 충돌체 ${s.colliders} · 삼각형 ${s.renderTriangles.toLocaleString()}`,
      `드로우콜 ${s.renderCalls} · GPU 지오메트리 ${s.gpuGeometries} · 텍스처 ${s.gpuTextures}`,
      `FPS ${s.fps} · p95 ${s.p95FrameMs}ms · 최악 ${s.worstFrameMs}ms · JS ${s.jsHeapMB}MB`,
      `누적 로드 ${s.totalLoaded} · 해제 ${s.totalUnloaded} · 취소 ${s.totalAborted} · 오류 ${s.fetchErrors}`,
    ].join('\n');
  }, 250);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

main().catch((e) => {
  statsEl.textContent = `오류: ${(e as Error).message}`;
  console.error(e);
});
