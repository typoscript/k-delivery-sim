/** 수원역 유리 역사·시계탑·로데오 네온 게이트·백화점 스카이라인 & 스카이브릿지 (suwon_station district) */
import * as THREE from 'three';
import type { SuwonLandmarksBuilder } from '../SuwonLandmarks';
import { createRichBannerTexture, createClockFaceTexture } from './landmarkParts';

// ============================================================================
// 3. 팔달구 매산동 (수원역 대형 캐노피 & 시계탑 · 로데오거리 네온 아치 · AK/타임빌라스 스카이브릿지)
// ============================================================================
export function buildSuwonStationLandmarks(host: SuwonLandmarksBuilder): void {
  const st = host.ctx.mapData.meta.station;
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.68, roughness: 0.28 });
  const lightSteelMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.55, roughness: 0.3 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x7dd3fc,
    transparent: true,
    opacity: 0.42,
    roughness: 0.14,
    metalness: 0.28,
  });
  const korailBlueMat = host.createGlowMat(0x0284c7, 0x0ea5e9, 0.55, 2.2);
  const line1NavyMat = host.createGlowMat(0x1d4ed8, 0x3b82f6, 0.45, 2.0);
  const bundangYellowMat = host.createGlowMat(0xf59e0b, 0xfbbf24, 0.5, 2.1);

  // 1) 🚉 수원역 정면 대형 유리 역사 캐노피 & 시계탑 파사드
  // Place the grand front facade right on the east/front edge of 수원역 facing 덕영대로 (x ≈ 108, z ≈ -15) + station landmark!
  const stationBldg = host.findBuilding('수원역');
  {
    const g = new THREE.Group();
    const fx = stationBldg ? stationBldg.cx : st.x;
    const fz = stationBldg ? stationBldg.cz : st.z;
    const fh = stationBldg ? stationBldg.height : 19.5;
    g.position.set(fx, fh, fz);

    // Iconic curved multi-arch glass barrel roof crowning 수원역사 (axis along Z, arching +Y, spanning X!)
    for (let i = -2; i <= 2; i++) {
      const rib = new THREE.Mesh(
        new THREE.CylinderGeometry(14, 14, 1.1, 16, 1, true, 0, Math.PI),
        lightSteelMat
      );
      rib.rotation.x = Math.PI / 2;
      rib.rotation.z = Math.PI / 2;
      rib.scale.set(0.46, 1, 1.25);
      rib.position.set(0, 0.2, i * 24);
      g.add(rib);
    }
    const glassVault = new THREE.Mesh(
      new THREE.CylinderGeometry(13.5, 13.5, 98, 16, 1, true, 0, Math.PI),
      glassMat
    );
    glassVault.rotation.x = Math.PI / 2;
    glassVault.rotation.z = Math.PI / 2;
    glassVault.scale.set(0.44, 1, 1.25);
    glassVault.position.set(0, 0.1, 0);
    g.add(glassVault);

    // Giant illuminated SUWON STATION crown facade facing 덕영대로 (-X side)
    const headerSign = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 5.4, 34),
      new THREE.MeshBasicMaterial({
        map: createRichBannerTexture(
          '🚉  수 원 역  ·  SUWON STATION',
          'KTX  ·  수도권 1호선  ·  수인분당선  ·  AK PLAZA',
          '#0f172a',
          '#38bdf8',
          '#ffffff',
          '#fde047'
        ),
      })
    );
    headerSign.position.set(-42, 4.8, 22);

    // 3 glowing transit line color bars underneath
    const barKtx = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.65, 10.5), korailBlueMat);
    barKtx.position.set(-42.2, 1.6, 10.5);
    const barL1 = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.65, 10.5), line1NavyMat);
    barL1.position.set(-42.2, 1.6, 22);
    const barSb = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.65, 10.5), bundangYellowMat);
    barSb.position.set(-42.2, 1.6, 33.5);

    // Iconic circular Suwon Station Clock Tower above the main facade!
    const clockTower = new THREE.Mesh(new THREE.BoxGeometry(4.2, 11.5, 5.6), steelMat);
    clockTower.position.set(-42, 11.2, 22);
    const clockFaceMat = new THREE.MeshBasicMaterial({ map: createClockFaceTexture() });
    for (const s of [-1, 1]) {
      const dial = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 0.28, 24), clockFaceMat);
      dial.rotation.z = Math.PI / 2;
      dial.position.set(-42 + s * 2.2, 13.6, 22);
      g.add(dial);
    }

    g.add(headerSign, barKtx, barL1, barSb, clockTower);
    host.ctx.root.add(g);
  }

  // Street-level 수원역 지하상가/출구 canopy right at st (211.1, 12.3) + 환승 광장 totem near (102, 42)
  {
    const cg = new THREE.Group();
    cg.position.set(st.x, 0, st.z);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.32, 4.4), glassMat);
    roof.position.set(0, 3.6, 0);
    const fascia = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.55, 4.6), korailBlueMat);
    fascia.position.set(0, 3.95, 0);
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(7.2, 1.4, 0.3),
      new THREE.MeshBasicMaterial({
        map: createRichBannerTexture('🚉 수원역 광장', '1호선 · 수인분당선 · KTX', '#0c4a6e', '#38bdf8'),
      })
    );
    sign.position.set(0, 5.0, 0);
    cg.add(roof, fascia, sign);
    host.ctx.root.add(cg);
    host.registerLandmark('수원역 (KTX·1호선·분당선)', '수원역', '🚉', st.x, st.z, '#0284c7');
  }

  // 2) ✨ 수원역 로데오거리 대형 네온 아치 게이트 (2개소 — 스폰 바로 앞 매산로!)
  const neonMagenta = host.createGlowMat(0xf472b6, 0xec4899, 0.85, 3.0);
  const neonCyan = host.createGlowMat(0x22d3ee, 0x06b6d4, 0.85, 3.0);
  const neonGold = host.createGlowMat(0xfde047, 0xeab308, 0.85, 2.8);

  const rodeoBannerMat = new THREE.MeshBasicMaterial({
    map: createRichBannerTexture(
      '✨ 수원역 로데오거리',
      'SUWON STATION RODEO ST. · 24H FOOD & CAFE',
      '#1e1b4b',
      '#ec4899',
      '#ffffff',
      '#38bdf8'
    ),
  });

  const rodeoGates: Array<{ x: number; z: number; heading: number; roadW: number }> = [
    { x: -7.0, z: 46.9, heading: -1.14, roadW: 14.5 },
    { x: -96.2, z: 88.2, heading: 2.01, roadW: 14.5 },
  ];

  for (const rg of rodeoGates) {
    const g = new THREE.Group();
    g.position.set(rg.x, 0, rg.z);
    g.rotation.y = rg.heading;

    const halfSpan = rg.roadW * 0.5 + 1.4; // outside 14.5m road -> 0 obstruction!
    const clearH = 6.2;
    const totalW = halfSpan * 2 + 1.2;

    // Twin steel truss columns with glowing vertical neon strips
    for (const s of [-1, 1]) {
      const colA = new THREE.Mesh(new THREE.BoxGeometry(0.45, clearH + 1.2, 0.45), steelMat);
      colA.position.set(s * halfSpan, (clearH + 1.2) * 0.5, -0.45);
      const colB = new THREE.Mesh(new THREE.BoxGeometry(0.45, clearH + 1.2, 0.45), steelMat);
      colB.position.set(s * halfSpan, (clearH + 1.2) * 0.5, 0.45);
      const neonVert = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, clearH - 0.6, 0.18),
        s < 0 ? neonMagenta : neonCyan
      );
      neonVert.position.set(s * (halfSpan - 0.32), clearH * 0.5 + 0.3, 0);
      g.add(colA, colB, neonVert);
    }

    // Overhead truss bridge + 3 parallel glowing neon tubes
    const truss = new THREE.Mesh(new THREE.BoxGeometry(totalW, 0.62, 1.1), steelMat);
    truss.position.y = clearH + 0.32;
    const tube1 = new THREE.Mesh(new THREE.BoxGeometry(totalW - 0.4, 0.18, 1.22), neonMagenta);
    tube1.position.y = clearH + 0.72;
    const tube2 = new THREE.Mesh(new THREE.BoxGeometry(totalW - 0.4, 0.18, 1.22), neonCyan);
    tube2.position.y = clearH - 0.04;

    // Hanging glowing neon diamonds/pennants underneath
    for (let px = -halfSpan + 2.2; px <= halfSpan - 2.2; px += 2.6) {
      const drop = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.28, 0),
        Math.abs(Math.round(px)) % 2 === 0 ? neonGold : neonMagenta
      );
      drop.position.set(px, clearH - 0.42, 0);
      g.add(drop);
    }

    const header = new THREE.Mesh(new THREE.BoxGeometry(10.8, 2.0, 0.42), rodeoBannerMat);
    header.position.y = clearH + 1.85;

    g.add(truss, tube1, tube2, header);
    host.ctx.root.add(g);
  }
  host.registerLandmark('수원역 로데오거리', '로데오거리', '✨', -42, 66, '#ec4899');

  // 3) 🏬 AK& 수원 · 타임빌라스 · 롯데백화점 시그니처 LED 스카이라인 & 유리 스카이브릿지
  const akBldg = host.findBuilding('AK&');
  if (akBldg) {
    const akCrown = new THREE.Mesh(
      new THREE.BoxGeometry(20, 4.2, 1.2),
      new THREE.MeshBasicMaterial({
        map: createRichBannerTexture('AK PLAZA & 수원', 'SHOPPING · FOOD HALL', '#7f1d1d', '#f97316'),
      })
    );
    akCrown.position.set(akBldg.cx, akBldg.height + 2.5, akBldg.cz);
    akCrown.rotation.y = Math.PI / 2;
    host.ctx.root.add(akCrown);
    host.registerLandmark('AK& 수원 플라자', 'AK수원', '🏬', akBldg.cx, akBldg.cz, '#ea580c');
  }

  const tvBldg = host.findBuilding('타임빌라스');
  if (tvBldg) {
    const tvCrown = new THREE.Mesh(
      new THREE.BoxGeometry(24, 4.8, 1.2),
      new THREE.MeshBasicMaterial({
        map: createRichBannerTexture('TIMEVILLAS 수원', '롯데 타임빌라스 · LOTTE MALL', '#0f172a', '#22d3ee'),
      })
    );
    tvCrown.position.set(tvBldg.cx, tvBldg.height + 3.0, tvBldg.cz);
    host.ctx.root.add(tvCrown);
    host.registerLandmark('타임빌라스 수원', '타임빌라스', '🛍️', tvBldg.cx, tvBldg.cz, '#0891b2');
  }

  // Elevated glass Skybridge connecting 수원역 <-> AK& 수원 and 수원역 <-> 환승센터 (y = 14.5m, well above streets!)
  if (stationBldg && akBldg) {
    buildElevatedSkybridge(host, 
      stationBldg.cx + 12,
      stationBldg.maxZ - 8,
      akBldg.cx,
      akBldg.minZ + 8,
      14.8,
      glassMat,
      lightSteelMat,
      korailBlueMat
    );
  }
  const hubBldg = host.findBuilding('환승센터');
  if (stationBldg && hubBldg) {
    buildElevatedSkybridge(host, 
      stationBldg.cx + 42,
      stationBldg.cz,
      hubBldg.cx - 20,
      hubBldg.cz,
      14.2,
      glassMat,
      lightSteelMat,
      bundangYellowMat
    );
  }
}

export function buildElevatedSkybridge(host: SuwonLandmarksBuilder, 
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  y: number,
  glassMat: THREE.Material,
  steelMat: THREE.Material,
  accentMat: THREE.Material
): void {
  const len = Math.hypot(x2 - x1, z2 - z1);
  if (len < 6) return;
  const g = new THREE.Group();
  g.position.set((x1 + x2) * 0.5, y, (z1 + z2) * 0.5);
  g.rotation.y = Math.atan2(x2 - x1, z2 - z1);

  const floor = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.65, len), steelMat);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(7.0, 0.5, len), steelMat);
  roof.position.y = 4.2;
  const glassTube = new THREE.Mesh(new THREE.BoxGeometry(6.5, 3.5, len), glassMat);
  glassTube.position.y = 2.1;
  const stripL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.3, len), accentMat);
  stripL.position.set(-3.45, 0.1, 0);
  const stripR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.3, len), accentMat);
  stripR.position.set(3.45, 0.1, 0);

  g.add(floor, roof, glassTube, stripL, stripR);
  host.ctx.root.add(g);
}
