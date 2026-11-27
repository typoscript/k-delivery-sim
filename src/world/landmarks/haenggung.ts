/** 팔달문·화성행궁·여민각·통닭거리 게이트·수원천 석교 (haenggung district) */
import * as THREE from 'three';
import type { SuwonLandmarksBuilder } from '../SuwonLandmarks';
import { createRichBannerTexture, createKoreanTiledRoof } from './landmarkParts';

// ============================================================================
// 1. 팔달구 행궁동 (팔달문 · 화성행궁 신풍루 · 여민각 · 수원 통닭거리 · 수원천 돌다리)
// ============================================================================
export function buildHaenggungLandmarks(host: SuwonLandmarksBuilder): void {
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.9 });
  const darkStoneMat = new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.92 });
  const pillarRedMat = new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.62 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.78 });
  const lanternMat = host.createGlowMat(0xfef3c7, 0xf59e0b, 0.55, 2.8, 0.35);

  // 1) 팔달문 (남문) — real OSM footprint at (-95.5, -375.3) inside 팔달문로터리!
  const paldal = host.findBuilding('팔달문');
  const pmX = paldal ? paldal.cx : -95.5;
  const pmZ = paldal ? paldal.cz : -375.3;
  const pmBaseH = paldal ? paldal.height : 7.5;
  {
    const g = new THREE.Group();
    g.position.set(pmX, 0, pmZ);

    // Granite fortress pedestal wrapping the base + crenellated parapets (여장)
    const baseW = 26.8;
    const baseD = 13.0;
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(baseW, pmBaseH, baseD), stoneMat);
    plinth.position.y = pmBaseH * 0.5;
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    g.add(plinth);

    // Arched 홍예문 dark stone gate tunnel recess on North & South facades
    const archVoidMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.95 });
    for (const sideZ of [-baseD * 0.5 - 0.08, baseD * 0.5 + 0.08]) {
      const archBox = new THREE.Mesh(new THREE.BoxGeometry(4.8, 4.2, 0.35), archVoidMat);
      archBox.position.set(0, 2.1, sideZ);
      const archTop = new THREE.Mesh(
        new THREE.CylinderGeometry(2.4, 2.4, 0.38, 16, 1, false, 0, Math.PI),
        archVoidMat
      );
      archTop.rotation.x = Math.PI / 2;
      archTop.rotation.z = Math.PI / 2;
      archTop.position.set(0, 4.2, sideZ);
      const keyStone = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.5, 0.45), darkStoneMat);
      keyStone.position.set(0, 6.7, sideZ);
      g.add(archBox, archTop, keyStone);
    }

    // Fortress battlements (여장) along the perimeter of the stone base
    for (let bx = -12; bx <= 12; bx += 3.0) {
      for (const bz of [-baseD * 0.5 + 0.35, baseD * 0.5 - 0.35]) {
        const merlon = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.35, 0.55), stoneMat);
        merlon.position.set(bx, pmBaseH + 0.65, bz);
        g.add(merlon);
      }
    }

    // 1st-story Joseon pavilion hall (누각 1층)
    const hall1Y = pmBaseH;
    const hall1 = new THREE.Mesh(new THREE.BoxGeometry(20.5, 4.2, 9.2), pillarRedMat);
    hall1.position.y = hall1Y + 2.1;
    g.add(hall1);

    // Perimeter vermilion columns
    for (let cx = -10.4; cx <= 10.4; cx += 3.46) {
      for (const cz of [-4.7, 4.7]) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 4.4, 8), pillarRedMat);
        col.position.set(cx, hall1Y + 2.2, cz);
        g.add(col);
      }
    }

    // Lower sweeping tiled roof (1층 처마)
    const lowerRoof = createKoreanTiledRoof(22.4, 11.4, 3.4);
    lowerRoof.position.y = hall1Y + 4.1;
    g.add(lowerRoof);

    // 2nd-story pavilion hall + upper sweeping roof (2층 팔작지붕)
    const hall2Y = hall1Y + 6.9;
    const hall2 = new THREE.Mesh(new THREE.BoxGeometry(15.2, 3.2, 7.0), pillarRedMat);
    hall2.position.y = hall2Y + 1.6;
    const upperRoof = createKoreanTiledRoof(17.4, 8.8, 3.8);
    upperRoof.position.y = hall2Y + 3.1;
    g.add(hall2, upperRoof);

    // Iconic gold-on-black 八達門 plaque on North & South faces
    const plaqueTex = createRichBannerTexture(
      '八 達 門  ·  팔 달 문',
      '사적 · 수원 화성 남문 (보물 제402호)',
      '#0f172a',
      '#d97706',
      '#fef08a',
      '#e2e8f0'
    );
    const plaqueMat = new THREE.MeshBasicMaterial({ map: plaqueTex });
    for (const s of [-1, 1]) {
      const plaque = new THREE.Mesh(new THREE.BoxGeometry(6.8, 1.8, 0.25), plaqueMat);
      plaque.position.set(0, hall2Y + 1.5, s * 4.2);
      if (s < 0) plaque.rotation.y = Math.PI;
      g.add(plaque);
    }

    // Warm traditional fortress uplight lanterns at the 4 corners
    for (const lx of [-11.5, 11.5]) {
      for (const lz of [-5.8, 5.8]) {
        const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.65, 1.0, 0.65), lanternMat);
        lantern.position.set(lx, pmBaseH + 1.6, lz);
        g.add(lantern);
      }
    }

    // Curved granite Ongseong (옹성) half-circle defensive walls hugging rotary island
    const wallSegs = 9;
    for (let i = 0; i < wallSegs; i++) {
      const a = -Math.PI * 0.36 + (i / (wallSegs - 1)) * Math.PI * 0.72;
      const r = 17.5;
      const wx = Math.sin(a) * r;
      const wz = -Math.cos(a) * r * 0.62 - 3.5;
      const seg = new THREE.Mesh(new THREE.BoxGeometry(4.4, 3.2, 1.2), darkStoneMat);
      seg.position.set(wx, 1.6, wz);
      seg.rotation.y = -a;
      g.add(seg);
    }

    host.ctx.root.add(g);
    host.registerLandmark('팔달문 (남문)', '팔달문', '🏯', pmX, pmZ, '#b91c1c');
  }

  // 2) 화성행궁 정문 신풍루 (新豊樓) + 봉수당 + 화령전 기와지붕
  const sinpung = host.findBuilding('신풍루');
  const spX = sinpung ? sinpung.cx : 118.1;
  const spZ = sinpung ? sinpung.cz : 96.8;
  const spH = sinpung ? sinpung.height : 7.5;
  {
    const g = new THREE.Group();
    g.position.set(spX, 0, spZ);

    // Crown existing OSM mass with iconic 2-tier Joseon palace gatehouse!
    const hall = new THREE.Mesh(new THREE.BoxGeometry(13.6, 3.8, 16.0), pillarRedMat);
    hall.position.y = spH + 1.9;
    const lowerRoof = createKoreanTiledRoof(15.2, 17.6, 2.8);
    lowerRoof.position.y = spH - 0.3;
    const upperRoof = createKoreanTiledRoof(14.2, 16.4, 3.8);
    upperRoof.position.y = spH + 3.6;

    // Glowing palace signboard facing 정조로 (-X side)
    const signTex = createRichBannerTexture(
      '新 豊 樓 · 화성행궁',
      'HWASEONG HAENGGUNG PALACE',
      '#7f1d1d',
      '#f59e0b',
      '#fef08a',
      '#fde68a'
    );
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 1.9, 8.6),
      new THREE.MeshBasicMaterial({ map: signTex })
    );
    sign.position.set(-7.4, spH + 2.2, 0);

    // Traditional hanging palace lanterns along the front eaves
    for (const lz of [-6.0, -2.0, 2.0, 6.0]) {
      const lan = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.72, 8), lanternMat);
      lan.position.set(-7.6, spH - 0.6, lz);
      g.add(lan);
    }

    g.add(hall, lowerRoof, upperRoof, sign);
    host.ctx.root.add(g);
    host.registerLandmark('화성행궁 신풍루', '화성행궁', '🏰', spX, spZ, '#991b1b');
  }

  // Add authentic Joseon tiled roofs to 봉수당 & 화령전
  for (const bName of ['봉수당', '화령전', '낙남헌']) {
    const b = host.findBuilding(bName);
    if (!b) continue;
    const roof = createKoreanTiledRoof(b.w * 0.96, b.d * 0.96, 3.6);
    roof.position.set(b.cx, b.height - 0.1, b.cz);
    host.ctx.root.add(roof);
  }

  // 3) 여민각 (與民閣 · 정조대왕 종각) — right north of spawn at (-107.2, 62.6)!
  const yeomin = host.findBuilding('여민각');
  const ymX = yeomin ? yeomin.cx : -107.2;
  const ymZ = yeomin ? yeomin.cz : 62.6;
  const ymH = yeomin ? yeomin.height : 7.5;
  {
    const g = new THREE.Group();
    g.position.set(ymX, 0, ymZ);

    // Open red-pillared bell pavilion above the base
    for (const px of [-5.2, 0, 5.2]) {
      for (const pz of [-4.6, 4.6]) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 4.8, 8), pillarRedMat);
        col.position.set(px, ymH + 2.4, pz);
        g.add(col);
      }
    }

    // Hanging Bronze Korean Bell (범종) in the center!
    const bronzeMat = new THREE.MeshStandardMaterial({
      color: 0x4d5d53,
      metalness: 0.72,
      roughness: 0.34,
    });
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.55, 2.8, 14), bronzeMat);
    bell.position.set(0, ymH + 2.3, 0);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(10.8, 0.45, 0.55), woodMat);
    beam.position.set(0, ymH + 4.3, 0);

    const roof = createKoreanTiledRoof(15.6, 13.8, 4.0);
    roof.position.y = ymH + 4.5;

    const ymSign = new THREE.Mesh(
      new THREE.BoxGeometry(6.4, 1.5, 0.25),
      new THREE.MeshBasicMaterial({
        map: createRichBannerTexture('🔔 여민각 (與民閣)', '수원 화성 종각', '#1e293b', '#f59e0b', '#fef08a'),
      })
    );
    ymSign.position.set(0, ymH + 3.6, -5.8);

    const bellGlow = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 8), lanternMat);
    bellGlow.position.set(0, ymH + 0.6, 0);

    g.add(bell, beam, roof, ymSign, bellGlow);
    host.ctx.root.add(g);
    host.registerLandmark('여민각 종각', '여민각', '🔔', ymX, ymZ, '#d97706');
  }

  // 4) 🍗 수원 통닭거리 시그니처 아치 게이트 (2개소 — 진미통닭/남문통닭 골목 입구!)
  const chickenGates: Array<{ x: number; z: number; heading: number; roadW: number }> = [
    { x: -156.5, z: -163.2, heading: 1.57, roadW: 8.6 },
    { x: -206.8, z: -173.4, heading: 2.83, roadW: 8.6 },
  ];
  const chickenBannerMat = new THREE.MeshBasicMaterial({
    map: createRichBannerTexture(
      '🍗 수원 통닭거리',
      'SUWON CHICKEN STREET · 팔달문 명물',
      '#7c2d12',
      '#fbbf24',
      '#fff7ed',
      '#fde047'
    ),
  });
  const warmNeonMat = host.createGlowMat(0xfbbf24, 0xf59e0b, 0.85, 2.8);

  for (const gate of chickenGates) {
    const g = new THREE.Group();
    g.position.set(gate.x, 0, gate.z);
    g.rotation.y = gate.heading;

    const halfSpan = gate.roadW * 0.5 + 1.25; // outside 8.6m street -> 0 traffic collision!
    const clearH = 5.75;

    for (const s of [-1, 1]) {
      const stoneFoot = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.1, 0.95), stoneMat);
      stoneFoot.position.set(s * halfSpan, 0.55, 0);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, clearH, 10), pillarRedMat);
      col.position.set(s * halfSpan, clearH * 0.5 + 0.4, 0);
      const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.65, 8), lanternMat);
      lantern.position.set(s * (halfSpan - 0.65), clearH - 0.4, 0);
      g.add(stoneFoot, col, lantern);
    }

    // Crossbeam + traditional mini tiled roof cap
    const spanW = halfSpan * 2 + 1.0;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(spanW, 0.5, 0.65), woodMat);
    beam.position.y = clearH + 0.2;
    const neonStrip = new THREE.Mesh(new THREE.BoxGeometry(spanW - 1.2, 0.14, 0.72), warmNeonMat);
    neonStrip.position.y = clearH - 0.08;

    const miniRoof = createKoreanTiledRoof(spanW + 1.2, 1.7, 1.3);
    miniRoof.position.y = clearH + 1.75;

    const signBoard = new THREE.Mesh(new THREE.BoxGeometry(Math.min(7.8, spanW - 1.6), 1.5, 0.32), chickenBannerMat);
    signBoard.position.y = clearH + 1.05;

    g.add(beam, neonStrip, miniRoof, signBoard);
    host.ctx.root.add(g);
  }
  host.registerLandmark('수원 통닭거리', '통닭거리', '🍗', -185, -165, '#ea580c');

  // 5) 🌊 수원천 (Suwoncheon Stream) 물길 + 전통 돌다리 (매향교 / 남수교)
  // Open stream channel runs cleanly north-south around x ≈ -226..-238 with 0 buildings!
  {
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      emissive: 0x0369a1,
      emissiveIntensity: 0.16,
      roughness: 0.18,
      metalness: 0.35,
    });
    // Trace real Suwoncheon channel parallel to 수원천로 (shifted slightly west into the 0-building gap)
    const streamPts: Array<[number, number]> = [
      [-218, 310],
      [-224, 240],
      [-230, 165],
      [-234, 92],
      [-239, 15],
      [-243, -55],
      [-245, -130],
      [-244, -200],
    ];
    for (let i = 0; i < streamPts.length - 1; i++) {
      const [ax, az] = streamPts[i];
      const [bx, bz] = streamPts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const h = Math.atan2(bx - ax, bz - az);
      const mx = (ax + bx) * 0.5;
      const mz = (az + bz) * 0.5;

      const waterStrip = new THREE.Mesh(new THREE.PlaneGeometry(8.2, len + 2.0), waterMat);
      waterStrip.rotation.order = 'YXZ';
      waterStrip.rotation.y = h;
      waterStrip.rotation.x = -Math.PI / 2;
      waterStrip.position.set(mx, 0.025, mz);
      host.ctx.root.add(waterStrip);

      // Granite stone embankments on both banks
      const rx = -Math.cos(h);
      const rz = Math.sin(h);
      for (const side of [-1, 1]) {
        const bank = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.45, len + 1.0), stoneMat);
        bank.position.set(mx + rx * side * 4.35, 0.22, mz + rz * side * 4.35);
        bank.rotation.y = h;
        host.ctx.root.add(bank);
      }
    }

    // Traditional granite stone railings (수원천 돌다리 — 매향교 & 통닭거리교) flanking crossings cleanly
    const bridges: Array<{ x: number; z: number; heading: number; roadW: number; label: string }> = [
      { x: -234, z: 95, heading: 1.52, roadW: 12.2, label: '🌉 수원천 매향교' },
      { x: -244, z: -158, heading: 1.65, roadW: 9.0, label: '🌉 수원천 통닭거리 돌다리' },
    ];
    for (const br of bridges) {
      const bg = new THREE.Group();
      bg.position.set(br.x, 0, br.z);
      bg.rotation.y = br.heading;
      const railOff = br.roadW * 0.5 + 0.85;
      for (const s of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.92, 11.4), stoneMat);
        rail.position.set(s * railOff, 0.48, 0);
        bg.add(rail);
        for (const pz of [-5.4, -1.8, 1.8, 5.4]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.35, 0.62), darkStoneMat);
          post.position.set(s * railOff, 0.68, pz);
          const cap = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), lanternMat);
          cap.position.set(s * railOff, 1.48, pz);
          bg.add(post, cap);
        }
      }
      const brSign = new THREE.Mesh(
        new THREE.BoxGeometry(3.4, 0.72, 0.18),
        new THREE.MeshBasicMaterial({ map: host.ctx.createSignTexture(br.label, '#1e3a8a', '#e0f2fe') })
      );
      brSign.position.set(railOff + 0.3, 2.2, 0);
      brSign.rotation.y = Math.PI / 2;
      bg.add(brSign);
      host.ctx.root.add(bg);
    }
    host.registerLandmark('수원천 돌다리 (매향교)', '수원천', '🌉', -234, 95, '#0284c7');
  }
}
