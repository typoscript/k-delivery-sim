/** 광교 district landmarks */
import * as THREE from 'three';
import type { SuwonLandmarksBuilder } from '../SuwonLandmarks';
import { estimateBuildingAngle, createRichBannerTexture } from './landmarkParts';

// ============================================================================
// 4. 영통구 광교신도시 (광교중앙역 · 갤러리아 광교 · 광교 호수공원 수변 전망대 · 도청로 아치)
// ============================================================================
export function buildGwanggyoLandmarks(host: SuwonLandmarksBuilder): void {
  const st = host.ctx.mapData.meta.station;
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.65, roughness: 0.28 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35, metalness: 0.25 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x7dd3fc,
    transparent: true,
    opacity: 0.44,
    roughness: 0.14,
    metalness: 0.28,
  });
  const shinbundangRed = host.createGlowMat(0xdc2626, 0xef4444, 0.5, 2.2);
  const lakeCyan = host.createGlowMat(0x06b6d4, 0x22d3ee, 0.55, 2.4);
  const emeraldGlow = host.createGlowMat(0x10b981, 0x34d399, 0.5, 2.2);
  const warmAmber = host.createGlowMat(0xf59e0b, 0xfbbf24, 0.55, 2.4);

  // 1) 🚇 광교중앙역 (신분당선 · 경기도청) 시그니처 레드라인 지하철 출입구 & 폴사인
  {
    const g = new THREE.Group();
    g.position.set(st.x, 0, st.z);
    g.rotation.y = 0.68;

    const canopy = new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.26, 4.6), glassMat);
    canopy.position.set(0, 3.6, 0);
    const redBand = new THREE.Mesh(new THREE.BoxGeometry(8.0, 0.52, 4.8), shinbundangRed);
    redBand.position.set(0, 3.95, 0);

    for (const rx of [-3.6, 0, 3.6]) {
      const postA = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.6, 0.2), steelMat);
      postA.position.set(rx, 1.8, -2.0);
      const postB = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.6, 0.2), steelMat);
      postB.position.set(rx, 1.8, 2.0);
      g.add(postA, postB);
    }

    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(7.6, 1.3, 0.28),
      new THREE.MeshBasicMaterial({
        map: createRichBannerTexture(
          'D17  광교중앙역',
          '신분당선 · 경기도청 · 아주대 · 경기융합타운',
          '#7f1d1d',
          '#f87171',
          '#ffffff',
          '#fef08a'
        ),
      })
    );
    sign.position.set(0, 4.9, 0);

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 6.4, 10), steelMat);
    pole.position.set(4.8, 3.2, 1.4);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.26, 20), shinbundangRed);
    disc.rotation.x = Math.PI / 2;
    disc.position.set(4.8, 6.4, 1.4);

    g.add(canopy, redBand, sign, pole, disc);
    host.ctx.root.add(g);
    host.registerLandmark('광교중앙역 (신분당선)', '광교중앙역', '🚇', st.x, st.z, '#dc2626');
  }

  // 2) 💎 갤러리아 백화점 광교점 — OMA 모자이크 스톤 & 다이아몬드 유리 리본 파사드!
  const galleria = host.findBuilding('갤러리아');
  if (galleria) {
    const g = new THREE.Group();
    g.position.set(galleria.cx, 0, galleria.cz);
    g.rotation.y = estimateBuildingAngle(galleria);

    // Iconic faceted terracotta-stone prism accent + glowing diagonal glass loop
    const prismW = Math.min(galleria.w * 0.88, 56);
    const prismD = Math.min(galleria.d * 0.88, 44);
    const crownH = galleria.height;

    const glassRibbon = new THREE.Mesh(
      new THREE.BoxGeometry(prismW + 2.4, 3.6, prismD + 2.4),
      glassMat
    );
    glassRibbon.position.y = crownH * 0.55;
    glassRibbon.rotation.z = 0.08;

    const ledRibbon = new THREE.Mesh(
      new THREE.BoxGeometry(prismW + 2.6, 0.45, prismD + 2.6),
      warmAmber
    );
    ledRibbon.position.y = crownH * 0.55 + 1.9;
    ledRibbon.rotation.z = 0.08;

    const roofSign = new THREE.Mesh(
      new THREE.BoxGeometry(22, 4.6, 1.1),
      new THREE.MeshBasicMaterial({
        map: createRichBannerTexture(
          '💎 GALLERIA 광교',
          '갤러리아 백화점 · 수원컨벤션센터',
          '#292524',
          '#f59e0b',
          '#fef3c7',
          '#fdba74'
        ),
      })
    );
    roofSign.position.set(0, crownH + 2.8, 0);

    g.add(glassRibbon, ledRibbon, roofSign);
    host.ctx.root.add(g);
    host.registerLandmark('갤러리아 백화점 광교', '갤러리아', '💎', galleria.cx, galleria.cz, '#d97706');
  }

  // 3) 🌊 광교 호수공원 수변 전망 데크 & 원천호수 분수대 (real lake shore at x=-325, z=290)
  {
    const lx = -325;
    const lz = 294;
    const g = new THREE.Group();
    g.position.set(lx, 0, lz);
    g.rotation.y = -0.35;

    // Wooden lakeside promenade pier deck jutting over 원천호수
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.82 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(16, 0.45, 9.5), deckMat);
    deck.position.set(0, 0.42, 0);

    // Modern white sculptural curved lakeside pavilion canopy (어반레비 전망대)
    for (const px of [-6.5, 0, 6.5]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 4.8, 8), whiteMat);
      post.position.set(px, 2.8, -3.5);
      g.add(post);
    }
    const waveCanopy = new THREE.Mesh(new THREE.BoxGeometry(15.5, 0.32, 5.2), whiteMat);
    waveCanopy.position.set(0, 5.2, -1.6);
    waveCanopy.rotation.x = -0.14;
    const cyanTrim = new THREE.Mesh(new THREE.BoxGeometry(15.6, 0.18, 0.28), lakeCyan);
    cyanTrim.position.set(0, 5.55, 0.9);

    // Sparkling lakeside water fountain column on 원천호수!
    const fountainBase = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.0, 0.4, 16), whiteMat);
    fountainBase.position.set(0, 0.25, 12.5);
    const fountainJet = new THREE.Mesh(
      new THREE.ConeGeometry(1.7, 9.5, 12),
      host.createGlowMat(0xbae6fd, 0x38bdf8, 0.35, 1.6, 0.15)
    );
    fountainJet.position.set(0, 5.0, 12.5);

    const lakeSign = new THREE.Mesh(
      new THREE.BoxGeometry(8.2, 1.65, 0.3),
      new THREE.MeshBasicMaterial({
        map: createRichBannerTexture(
          '🌊 광교 호수공원',
          'GWANGGYO LAKE PARK · 원천호수 수변데크',
          '#0c4a6e',
          '#38bdf8',
          '#ffffff',
          '#7dd3fc'
        ),
      })
    );
    lakeSign.position.set(0, 6.4, -1.6);

    g.add(deck, waveCanopy, cyanTrim, fountainBase, fountainJet, lakeSign);
    host.ctx.root.add(g);
    host.registerLandmark('광교 호수공원 (원천호수)', '광교호수공원', '🌊', lx, lz, '#0284c7');
  }

  // 4) 🏙️ 광교신도시 도청로 · 센트럴타운로 시그니처 에코 웨이브 아치 (2개소)
  const ggArches: Array<{ x: number; z: number; heading: number; roadW: number }> = [
    { x: 156.7, z: -62.2, heading: 0.81, roadW: 13.0 },
    { x: -163.4, z: 104.8, heading: -2.33, roadW: 12.0 },
  ];
  const ggBannerMat = new THREE.MeshBasicMaterial({
    map: createRichBannerTexture(
      '🌊 광교신도시 · 수원 영통구',
      '경기도청 · 광교중앙역 · 광교호수공원',
      '#064e3b',
      '#34d399',
      '#ffffff',
      '#a7f3d0'
    ),
  });

  for (const ar of ggArches) {
    const g = new THREE.Group();
    g.position.set(ar.x, 0, ar.z);
    g.rotation.y = ar.heading;

    const halfSpan = ar.roadW * 0.5 + 1.4;
    const clearH = 6.2;
    const spanW = halfSpan * 2 + 1.0;

    for (const s of [-1, 1]) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.58, clearH + 0.8, 0.88), whiteMat);
      col.position.set(s * halfSpan, (clearH + 0.8) * 0.5, 0);
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, clearH - 0.6, 1.02),
        s < 0 ? lakeCyan : emeraldGlow
      );
      strip.position.set(s * (halfSpan - 0.32), clearH * 0.5 + 0.2, 0);
      g.add(col, strip);
    }

    const bridge = new THREE.Mesh(new THREE.BoxGeometry(spanW, 0.58, 0.95), whiteMat);
    bridge.position.y = clearH + 0.3;
    const topStrip = new THREE.Mesh(new THREE.BoxGeometry(spanW - 0.6, 0.18, 1.04), emeraldGlow);
    topStrip.position.y = clearH + 0.68;
    const botStrip = new THREE.Mesh(new THREE.BoxGeometry(spanW - 0.6, 0.16, 1.04), lakeCyan);
    botStrip.position.y = clearH - 0.04;

    const banner = new THREE.Mesh(new THREE.BoxGeometry(9.6, 1.75, 0.36), ggBannerMat);
    banner.position.y = clearH + 1.65;

    g.add(bridge, topStrip, botStrip, banner);
    host.ctx.root.add(g);
  }

  const lib = host.findBuilding('경기도서관');
  if (lib) {
    host.registerLandmark('경기도청 · 경기융합타운', '경기도청', '🏛️', lib.cx, lib.cz, '#059669');
  }
}
