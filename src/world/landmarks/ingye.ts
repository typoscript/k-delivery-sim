/** 수원시청역 출입구·나혜석거리 아치·효원공원 팔각정·LED 전광판 (ingye district) */
import * as THREE from 'three';
import type { SuwonLandmarksBuilder } from '../SuwonLandmarks';
import { estimateBuildingAngle, createRichBannerTexture } from './landmarkParts';

// ============================================================================
// 2. 팔달구 인계동 (수원시청역 출입구 · 나혜석거리 아치 · 효원공원 팔각정 · 대형 전광판)
// ============================================================================
export function buildIngyeLandmarks(host: SuwonLandmarksBuilder): void {
  const st = host.ctx.mapData.meta.station;
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.65, roughness: 0.3 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.44,
    roughness: 0.14,
    metalness: 0.25,
  });
  const yellowLineMat = host.createGlowMat(0xf59e0b, 0xd97706, 0.45, 1.9);

  // 1) 🚇 수원시청역 (수인분당선) 시그니처 지하철 출입구 캐노피 & 폴사인
  {
    const g = new THREE.Group();
    g.position.set(st.x, 0, st.z);
    g.rotation.y = -0.32; // aligned with 효원로 boulevard

    // Modern sloped glass-and-steel Korean subway entrance canopy
    const baseCurb = new THREE.Mesh(
      new THREE.BoxGeometry(7.2, 0.9, 4.2),
      new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.75 })
    );
    baseCurb.position.set(0, 0.45, -0.3);

    // Dark downward staircase entrance pit visual
    const stairPit = new THREE.Mesh(
      new THREE.BoxGeometry(5.6, 0.16, 3.0),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.95 })
    );
    stairPit.position.set(0, 0.08, -0.1);
    for (let i = 0; i < 4; i++) {
      const step = new THREE.Mesh(
        new THREE.BoxGeometry(5.2, 0.08, 0.45),
        new THREE.MeshStandardMaterial({ color: 0x334155 })
      );
      step.position.set(0, 0.16 - i * 0.02, 0.9 - i * 0.55);
      g.add(step);
    }

    // Slanted curved steel roof ribs + translucent skylight roof
    const canopyRoof = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.22, 4.8), glassMat);
    canopyRoof.position.set(0, 3.45, -0.1);
    canopyRoof.rotation.x = 0.16;

    for (const rx of [-3.5, -1.2, 1.2, 3.5]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.3, 0.18), steelMat);
      post.position.set(rx, 1.65, -2.1);
      const frontPost = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.8, 0.18), steelMat);
      frontPost.position.set(rx, 1.9, 1.85);
      g.add(post, frontPost);
    }

    // Iconic Suin-Bundang Line yellow glowing header band + subway sign
    const yellowBand = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.55, 0.42), yellowLineMat);
    yellowBand.position.set(0, 3.92, 1.92);

    const stationBanner = new THREE.Mesh(
      new THREE.BoxGeometry(7.4, 1.25, 0.26),
      new THREE.MeshBasicMaterial({
        map: createRichBannerTexture(
          'K243  수원시청역',
          '수인·분당선 · 2번 출구 · 나혜석거리',
          '#0f172a',
          '#f59e0b',
          '#fef08a',
          '#f8fafc'
        ),
      })
    );
    stationBanner.position.set(0, 4.72, 1.92);

    // Tall illuminated Korean subway pole totem beside entrance
    const totemPole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 6.2, 10), steelMat);
    totemPole.position.set(4.5, 3.1, 1.6);
    const totemCircle = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.25, 20), yellowLineMat);
    totemCircle.rotation.x = Math.PI / 2;
    totemCircle.position.set(4.5, 6.2, 1.6);
    const totemLabel = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.72, 0.2),
      new THREE.MeshBasicMaterial({ map: host.ctx.createSignTexture('🚇 수인분당선', '#f59e0b', '#0f172a') })
    );
    totemLabel.position.set(4.5, 5.1, 1.6);

    g.add(baseCurb, stairPit, canopyRoof, yellowBand, stationBanner, totemPole, totemCircle, totemLabel);
    host.ctx.root.add(g);
    host.registerLandmark('수원시청역 (수인분당선)', '수원시청역', '🚇', st.x, st.z, '#f59e0b');
  }

  // 2) 🎨 나혜석거리 문화의 거리 시그니처 가로 아치 & 야간 페스툰 조명
  // Place arches cleanly spanning over the pedestrian plazas + 권광로/효원로 entry!
  const artCoralMat = host.createGlowMat(0xf43f5e, 0xe11d48, 0.45, 2.2);
  const artCyanMat = host.createGlowMat(0x38bdf8, 0x0ea5e9, 0.45, 2.1);
  const whiteSteelMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.32, metalness: 0.4 });
  const bulbMat = host.createGlowMat(0xfef3c7, 0xfde047, 0.4, 2.8);

  const nahyeArches: Array<{ x: number; z: number; heading: number; spanW: number }> = [
    // Pedestrian plaza gateway near central 권광로 south (-52, -203)
    { x: -62, z: -206, heading: -1.89, spanW: 11.2 },
    // Pedestrian plaza east segment (188, 26)
    { x: 188, z: 26, heading: -1.25, spanW: 11.2 },
    // Main 효원로 gateway near spawn (-37, -37.2) so players see it right away!
    { x: -37.0, z: -37.2, heading: -1.89, spanW: 14.8 },
  ];
  const nahyeBannerMat = new THREE.MeshBasicMaterial({
    map: createRichBannerTexture(
      '🎨 나혜석거리 · 인계동',
      'NA HYESEOK CULTURE STREET · SUWON',
      '#1e1b4b',
      '#f43f5e',
      '#ffffff',
      '#fda4af'
    ),
  });

  for (const ar of nahyeArches) {
    const g = new THREE.Group();
    g.position.set(ar.x, 0, ar.z);
    g.rotation.y = ar.heading;

    const half = ar.spanW * 0.5;
    const clearH = 6.0;

    // Sculptural curved white steel twin columns + glowing accent fins
    for (const s of [-1, 1]) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.6, clearH, 0.85), whiteSteelMat);
      col.position.set(s * half, clearH * 0.5, 0);
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.16, clearH - 1.0, 1.05), s < 0 ? artCoralMat : artCyanMat);
      fin.position.set(s * (half - 0.34), clearH * 0.5 + 0.3, 0);
      g.add(col, fin);
    }

    // Sweeping overhead arc ribbon
    const archBridge = new THREE.Mesh(new THREE.BoxGeometry(ar.spanW + 1.2, 0.55, 0.9), whiteSteelMat);
    archBridge.position.y = clearH + 0.25;
    const neonTop = new THREE.Mesh(new THREE.BoxGeometry(ar.spanW + 0.4, 0.18, 0.98), artCoralMat);
    neonTop.position.y = clearH + 0.62;
    const neonBot = new THREE.Mesh(new THREE.BoxGeometry(ar.spanW - 0.4, 0.14, 0.98), artCyanMat);
    neonBot.position.y = clearH - 0.08;

    const banner = new THREE.Mesh(new THREE.BoxGeometry(Math.min(8.6, ar.spanW - 1.6), 1.55, 0.34), nahyeBannerMat);
    banner.position.y = clearH + 1.45;

    // Festive warm bulbs hanging under the arch
    for (let bx = -half + 1.4; bx <= half - 1.4; bx += 1.6) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), bulbMat);
      bulb.position.set(bx, clearH - 0.28, 0);
      g.add(bulb);
    }

    g.add(archBridge, neonTop, neonBot, banner);
    host.ctx.root.add(g);
  }
  host.registerLandmark('나혜석거리 문화광장', '나혜석거리', '🎨', -62, -206, '#e11d48');

  // 3) 🏯 효원공원(인계 근린공원) 전통 팔각정 정자 — inside open parks (#1 & #2)!
  const pavilionSpots: Array<{ x: number; z: number; title: string }> = [
    { x: 180.2, z: 109.8, title: '🌳 효원공원 · 팔각정' },
    { x: 20.6, z: -219.2, title: '🌳 인계공원 · 정자 쉼터' },
  ];
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xb0b8c1, roughness: 0.88 });
  const redPillarMat = new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.6 });
  const tileMat = new THREE.MeshStandardMaterial({ color: 0x2b323d, roughness: 0.78 });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.7, roughness: 0.25 });

  for (const spot of pavilionSpots) {
    const g = new THREE.Group();
    g.position.set(spot.x, 0, spot.z);

    // Octagonal stone plinth + steps
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 6.2, 1.15, 8), stoneMat);
    plinth.position.y = 0.58;
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    g.add(plinth);

    // 8 vermilion wooden columns + low wooden railings
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 3.6, 8), redPillarMat);
      col.position.set(Math.sin(a) * 4.5, 2.95, Math.cos(a) * 4.5);
      g.add(col);
    }

    // Sweeping 2-tier octagonal tiled roof + golden spire finial
    const roofLower = new THREE.Mesh(new THREE.ConeGeometry(7.2, 2.4, 8), tileMat);
    roofLower.position.y = 5.7;
    roofLower.castShadow = true;
    const roofUpper = new THREE.Mesh(new THREE.ConeGeometry(4.5, 2.2, 8), tileMat);
    roofUpper.position.y = 7.4;
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), goldMat);
    finial.position.y = 8.65;

    const eaveLantern = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), bulbMat);
    eaveLantern.position.y = 4.25;

    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(5.6, 1.25, 0.24),
      new THREE.MeshBasicMaterial({ map: host.ctx.createSignTexture(spot.title, '#14532d', '#dcfce7') })
    );
    sign.position.set(0, 4.9, 5.4);

    g.add(roofLower, roofUpper, finial, eaveLantern, sign);
    host.ctx.root.add(g);
  }
  host.registerLandmark('효원공원 팔각정', '효원공원', '🏯', 180.2, 109.8, '#15803d');

  // 4) 📺 수원시청역 사거리 대형 LED 미디어 전광판 타워 (atop 수원프라자 & 롯데시네마)
  const plazaBldg = host.findBuilding('수원프라자');
  if (plazaBldg) {
    const screenTex = createRichBannerTexture(
      'SUWON INGYE · 수원시청역',
      '⚡ K-DELIVERY LIVE · 효원로 중심상권',
      '#0c4a6e',
      '#38bdf8',
      '#ffffff',
      '#7dd3fc'
    );
    const screenMat = host.createGlowMat(0xffffff, 0x38bdf8, 0.25, 0.95, 0.2);
    screenMat.map = screenTex;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(14.5, 6.2, 1.0), steelMat);
    frame.position.set(plazaBldg.cx, plazaBldg.height + 3.4, plazaBldg.cz);
    frame.rotation.y = estimateBuildingAngle(plazaBldg);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(13.8, 5.4), screenMat);
    face.position.set(0, 0, 0.54);
    const backFace = new THREE.Mesh(new THREE.PlaneGeometry(13.8, 5.4), screenMat);
    backFace.position.set(0, 0, -0.54);
    backFace.rotation.y = Math.PI;
    frame.add(face, backFace);
    host.ctx.root.add(frame);
  }
}
