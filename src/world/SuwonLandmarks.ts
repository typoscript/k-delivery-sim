import * as THREE from 'three';
import { SuwonDistrictId, SuwonMapDataset, OsmBuildingData } from '../data/suwonTypes';
import { CityZoneMarker, LandmarkMarker } from '../types';

export interface SuwonLandmarksContext {
  root: THREE.Group;
  districtId: SuwonDistrictId;
  mapData: SuwonMapDataset;
  zones: CityZoneMarker[];
  landmarks: LandmarkMarker[];
  createSignTexture: (title: string, bg: string, fg?: string) => THREE.CanvasTexture;
}

/**
 * Builds iconic, low-poly 3D Suwon signature landmarks tailored to each real OSM district:
 * - haenggung: 팔달문 (남문) 2층 성곽 누각·홍예문·옹성, 화성행궁 신풍루/봉수당/화령전 기와지붕,
 *              여민각 종각(범종), 수원 통닭거리 전통 아치 게이트, 수원천 물길 & 전통 석교
 * - ingye: 수원시청역(수인분당선) 지하철 출입구 캐노피 & 폴사인, 나혜석거리 문화 아치 & 야간 페스툰 조명,
 *          효원공원(인계 근린공원) 전통 팔각정 정자, 수원시청역 사거리 대형 LED 미디어 전광판
 * - suwon_station: 수원역(KTX·1호선·분당선) 대형 유리 역사 캐노피 & 시계탑 파사드,
 *                  수원역 로데오거리 대형 네온 아치 게이트, AK&·타임빌라스·롯데백화점 LED 스카이라인 & 유리 스카이브릿지
 */
export class SuwonLandmarksBuilder {
  private readonly glowEntries: Array<{
    mat: THREE.MeshStandardMaterial;
    dayIntensity: number;
    nightIntensity: number;
  }> = [];

  private readonly ctx: SuwonLandmarksContext;

  constructor(ctx: SuwonLandmarksContext) {
    this.ctx = ctx;
    if (ctx.districtId === 'haenggung') {
      this.buildHaenggungLandmarks();
    } else if (ctx.districtId === 'ingye') {
      this.buildIngyeLandmarks();
    } else {
      this.buildSuwonStationLandmarks();
    }
  }

  public setNightMode(isNight: boolean): void {
    for (const entry of this.glowEntries) {
      entry.mat.emissiveIntensity = isNight ? entry.nightIntensity : entry.dayIntensity;
    }
  }

  private createGlowMat(
    color: number,
    emissive: number,
    dayIntensity: number,
    nightIntensity: number,
    roughness = 0.25
  ): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive,
      emissiveIntensity: dayIntensity,
      roughness,
    });
    this.glowEntries.push({ mat, dayIntensity, nightIntensity });
    return mat;
  }

  private registerLandmark(
    name: string,
    shortLabel: string,
    icon: string,
    x: number,
    z: number,
    color: string
  ): void {
    this.ctx.landmarks.push({ name, shortLabel, icon, x, z, color });
    this.ctx.zones.push({ name, x, z, type: 'shop' });
  }

  private findBuilding(keyword: string): OsmBuildingData | undefined {
    return this.ctx.mapData.buildings.find((b) => b.name && b.name.includes(keyword));
  }

  /** Estimates primary horizontal alignment angle of a rectangular OSM building footprint */
  private estimateBuildingAngle(b: OsmBuildingData): number {
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
  private createRichBannerTexture(
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
  private createClockFaceTexture(): THREE.CanvasTexture {
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
  private createKoreanTiledRoof(width: number, depth: number, height: number): THREE.Group {
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

  // ============================================================================
  // 1. 팔달구 행궁동 (팔달문 · 화성행궁 신풍루 · 여민각 · 수원 통닭거리 · 수원천 돌다리)
  // ============================================================================
  private buildHaenggungLandmarks(): void {
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.9 });
    const darkStoneMat = new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.92 });
    const pillarRedMat = new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.62 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.78 });
    const lanternMat = this.createGlowMat(0xfef3c7, 0xf59e0b, 0.55, 2.8, 0.35);

    // 1) 팔달문 (남문) — real OSM footprint at (-95.5, -375.3) inside 팔달문로터리!
    const paldal = this.findBuilding('팔달문');
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
      const lowerRoof = this.createKoreanTiledRoof(22.4, 11.4, 3.4);
      lowerRoof.position.y = hall1Y + 4.1;
      g.add(lowerRoof);

      // 2nd-story pavilion hall + upper sweeping roof (2층 팔작지붕)
      const hall2Y = hall1Y + 6.9;
      const hall2 = new THREE.Mesh(new THREE.BoxGeometry(15.2, 3.2, 7.0), pillarRedMat);
      hall2.position.y = hall2Y + 1.6;
      const upperRoof = this.createKoreanTiledRoof(17.4, 8.8, 3.8);
      upperRoof.position.y = hall2Y + 3.1;
      g.add(hall2, upperRoof);

      // Iconic gold-on-black 八達門 plaque on North & South faces
      const plaqueTex = this.createRichBannerTexture(
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

      this.ctx.root.add(g);
      this.registerLandmark('팔달문 (남문)', '팔달문', '🏯', pmX, pmZ, '#b91c1c');
    }

    // 2) 화성행궁 정문 신풍루 (新豊樓) + 봉수당 + 화령전 기와지붕
    const sinpung = this.findBuilding('신풍루');
    const spX = sinpung ? sinpung.cx : 118.1;
    const spZ = sinpung ? sinpung.cz : 96.8;
    const spH = sinpung ? sinpung.height : 7.5;
    {
      const g = new THREE.Group();
      g.position.set(spX, 0, spZ);

      // Crown existing OSM mass with iconic 2-tier Joseon palace gatehouse!
      const hall = new THREE.Mesh(new THREE.BoxGeometry(13.6, 3.8, 16.0), pillarRedMat);
      hall.position.y = spH + 1.9;
      const lowerRoof = this.createKoreanTiledRoof(15.2, 17.6, 2.8);
      lowerRoof.position.y = spH - 0.3;
      const upperRoof = this.createKoreanTiledRoof(14.2, 16.4, 3.8);
      upperRoof.position.y = spH + 3.6;

      // Glowing palace signboard facing 정조로 (-X side)
      const signTex = this.createRichBannerTexture(
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
      this.ctx.root.add(g);
      this.registerLandmark('화성행궁 신풍루', '화성행궁', '🏰', spX, spZ, '#991b1b');
    }

    // Add authentic Joseon tiled roofs to 봉수당 & 화령전
    for (const bName of ['봉수당', '화령전', '낙남헌']) {
      const b = this.findBuilding(bName);
      if (!b) continue;
      const roof = this.createKoreanTiledRoof(b.w * 0.96, b.d * 0.96, 3.6);
      roof.position.set(b.cx, b.height - 0.1, b.cz);
      this.ctx.root.add(roof);
    }

    // 3) 여민각 (與民閣 · 정조대왕 종각) — right north of spawn at (-107.2, 62.6)!
    const yeomin = this.findBuilding('여민각');
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

      const roof = this.createKoreanTiledRoof(15.6, 13.8, 4.0);
      roof.position.y = ymH + 4.5;

      const ymSign = new THREE.Mesh(
        new THREE.BoxGeometry(6.4, 1.5, 0.25),
        new THREE.MeshBasicMaterial({
          map: this.createRichBannerTexture('🔔 여민각 (與民閣)', '수원 화성 종각', '#1e293b', '#f59e0b', '#fef08a'),
        })
      );
      ymSign.position.set(0, ymH + 3.6, -5.8);

      const bellGlow = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 8), lanternMat);
      bellGlow.position.set(0, ymH + 0.6, 0);

      g.add(bell, beam, roof, ymSign, bellGlow);
      this.ctx.root.add(g);
      this.registerLandmark('여민각 종각', '여민각', '🔔', ymX, ymZ, '#d97706');
    }

    // 4) 🍗 수원 통닭거리 시그니처 아치 게이트 (2개소 — 진미통닭/남문통닭 골목 입구!)
    const chickenGates: Array<{ x: number; z: number; heading: number; roadW: number }> = [
      { x: -156.5, z: -163.2, heading: 1.57, roadW: 8.6 },
      { x: -206.8, z: -173.4, heading: 2.83, roadW: 8.6 },
    ];
    const chickenBannerMat = new THREE.MeshBasicMaterial({
      map: this.createRichBannerTexture(
        '🍗 수원 통닭거리',
        'SUWON CHICKEN STREET · 팔달문 명물',
        '#7c2d12',
        '#fbbf24',
        '#fff7ed',
        '#fde047'
      ),
    });
    const warmNeonMat = this.createGlowMat(0xfbbf24, 0xf59e0b, 0.85, 2.8);

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

      const miniRoof = this.createKoreanTiledRoof(spanW + 1.2, 1.7, 1.3);
      miniRoof.position.y = clearH + 1.75;

      const signBoard = new THREE.Mesh(new THREE.BoxGeometry(Math.min(7.8, spanW - 1.6), 1.5, 0.32), chickenBannerMat);
      signBoard.position.y = clearH + 1.05;

      g.add(beam, neonStrip, miniRoof, signBoard);
      this.ctx.root.add(g);
    }
    this.registerLandmark('수원 통닭거리', '통닭거리', '🍗', -185, -165, '#ea580c');

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
        this.ctx.root.add(waterStrip);

        // Granite stone embankments on both banks
        const rx = -Math.cos(h);
        const rz = Math.sin(h);
        for (const side of [-1, 1]) {
          const bank = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.45, len + 1.0), stoneMat);
          bank.position.set(mx + rx * side * 4.35, 0.22, mz + rz * side * 4.35);
          bank.rotation.y = h;
          this.ctx.root.add(bank);
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
          new THREE.MeshBasicMaterial({ map: this.ctx.createSignTexture(br.label, '#1e3a8a', '#e0f2fe') })
        );
        brSign.position.set(railOff + 0.3, 2.2, 0);
        brSign.rotation.y = Math.PI / 2;
        bg.add(brSign);
        this.ctx.root.add(bg);
      }
      this.registerLandmark('수원천 돌다리 (매향교)', '수원천', '🌉', -234, 95, '#0284c7');
    }
  }

  // ============================================================================
  // 2. 팔달구 인계동 (수원시청역 출입구 · 나혜석거리 아치 · 효원공원 팔각정 · 대형 전광판)
  // ============================================================================
  private buildIngyeLandmarks(): void {
    const st = this.ctx.mapData.meta.station;
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.65, roughness: 0.3 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.44,
      roughness: 0.14,
      metalness: 0.25,
    });
    const yellowLineMat = this.createGlowMat(0xf59e0b, 0xd97706, 0.45, 1.9);

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
          map: this.createRichBannerTexture(
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
        new THREE.MeshBasicMaterial({ map: this.ctx.createSignTexture('🚇 수인분당선', '#f59e0b', '#0f172a') })
      );
      totemLabel.position.set(4.5, 5.1, 1.6);

      g.add(baseCurb, stairPit, canopyRoof, yellowBand, stationBanner, totemPole, totemCircle, totemLabel);
      this.ctx.root.add(g);
      this.registerLandmark('수원시청역 (수인분당선)', '수원시청역', '🚇', st.x, st.z, '#f59e0b');
    }

    // 2) 🎨 나혜석거리 문화의 거리 시그니처 가로 아치 & 야간 페스툰 조명
    // Place arches cleanly spanning over the pedestrian plazas + 권광로/효원로 entry!
    const artCoralMat = this.createGlowMat(0xf43f5e, 0xe11d48, 0.45, 2.2);
    const artCyanMat = this.createGlowMat(0x38bdf8, 0x0ea5e9, 0.45, 2.1);
    const whiteSteelMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.32, metalness: 0.4 });
    const bulbMat = this.createGlowMat(0xfef3c7, 0xfde047, 0.4, 2.8);

    const nahyeArches: Array<{ x: number; z: number; heading: number; spanW: number }> = [
      // Pedestrian plaza gateway near central 권광로 south (-52, -203)
      { x: -62, z: -206, heading: -1.89, spanW: 11.2 },
      // Pedestrian plaza east segment (188, 26)
      { x: 188, z: 26, heading: -1.25, spanW: 11.2 },
      // Main 효원로 gateway near spawn (-37, -37.2) so players see it right away!
      { x: -37.0, z: -37.2, heading: -1.89, spanW: 14.8 },
    ];
    const nahyeBannerMat = new THREE.MeshBasicMaterial({
      map: this.createRichBannerTexture(
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
      this.ctx.root.add(g);
    }
    this.registerLandmark('나혜석거리 문화광장', '나혜석거리', '🎨', -62, -206, '#e11d48');

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
        new THREE.MeshBasicMaterial({ map: this.ctx.createSignTexture(spot.title, '#14532d', '#dcfce7') })
      );
      sign.position.set(0, 4.9, 5.4);

      g.add(roofLower, roofUpper, finial, eaveLantern, sign);
      this.ctx.root.add(g);
    }
    this.registerLandmark('효원공원 팔각정', '효원공원', '🏯', 180.2, 109.8, '#15803d');

    // 4) 📺 수원시청역 사거리 대형 LED 미디어 전광판 타워 (atop 수원프라자 & 롯데시네마)
    const plazaBldg = this.findBuilding('수원프라자');
    if (plazaBldg) {
      const screenTex = this.createRichBannerTexture(
        'SUWON INGYE · 수원시청역',
        '⚡ K-DELIVERY LIVE · 효원로 중심상권',
        '#0c4a6e',
        '#38bdf8',
        '#ffffff',
        '#7dd3fc'
      );
      const screenMat = this.createGlowMat(0xffffff, 0x38bdf8, 0.25, 0.95, 0.2);
      screenMat.map = screenTex;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(14.5, 6.2, 1.0), steelMat);
      frame.position.set(plazaBldg.cx, plazaBldg.height + 3.4, plazaBldg.cz);
      frame.rotation.y = this.estimateBuildingAngle(plazaBldg);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(13.8, 5.4), screenMat);
      face.position.set(0, 0, 0.54);
      const backFace = new THREE.Mesh(new THREE.PlaneGeometry(13.8, 5.4), screenMat);
      backFace.position.set(0, 0, -0.54);
      backFace.rotation.y = Math.PI;
      frame.add(face, backFace);
      this.ctx.root.add(frame);
    }
  }

  // ============================================================================
  // 3. 팔달구 매산동 (수원역 대형 캐노피 & 시계탑 · 로데오거리 네온 아치 · AK/타임빌라스 스카이브릿지)
  // ============================================================================
  private buildSuwonStationLandmarks(): void {
    const st = this.ctx.mapData.meta.station;
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.68, roughness: 0.28 });
    const lightSteelMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.55, roughness: 0.3 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.42,
      roughness: 0.14,
      metalness: 0.28,
    });
    const korailBlueMat = this.createGlowMat(0x0284c7, 0x0ea5e9, 0.55, 2.2);
    const line1NavyMat = this.createGlowMat(0x1d4ed8, 0x3b82f6, 0.45, 2.0);
    const bundangYellowMat = this.createGlowMat(0xf59e0b, 0xfbbf24, 0.5, 2.1);

    // 1) 🚉 수원역 정면 대형 유리 역사 캐노피 & 시계탑 파사드
    // Place the grand front facade right on the east/front edge of 수원역 facing 덕영대로 (x ≈ 108, z ≈ -15) + station landmark!
    const stationBldg = this.findBuilding('수원역');
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
          map: this.createRichBannerTexture(
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
      const clockFaceMat = new THREE.MeshBasicMaterial({ map: this.createClockFaceTexture() });
      for (const s of [-1, 1]) {
        const dial = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 0.28, 24), clockFaceMat);
        dial.rotation.z = Math.PI / 2;
        dial.position.set(-42 + s * 2.2, 13.6, 22);
        g.add(dial);
      }

      g.add(headerSign, barKtx, barL1, barSb, clockTower);
      this.ctx.root.add(g);
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
          map: this.createRichBannerTexture('🚉 수원역 광장', '1호선 · 수인분당선 · KTX', '#0c4a6e', '#38bdf8'),
        })
      );
      sign.position.set(0, 5.0, 0);
      cg.add(roof, fascia, sign);
      this.ctx.root.add(cg);
      this.registerLandmark('수원역 (KTX·1호선·분당선)', '수원역', '🚉', st.x, st.z, '#0284c7');
    }

    // 2) ✨ 수원역 로데오거리 대형 네온 아치 게이트 (2개소 — 스폰 바로 앞 매산로!)
    const neonMagenta = this.createGlowMat(0xf472b6, 0xec4899, 0.85, 3.0);
    const neonCyan = this.createGlowMat(0x22d3ee, 0x06b6d4, 0.85, 3.0);
    const neonGold = this.createGlowMat(0xfde047, 0xeab308, 0.85, 2.8);

    const rodeoBannerMat = new THREE.MeshBasicMaterial({
      map: this.createRichBannerTexture(
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
      this.ctx.root.add(g);
    }
    this.registerLandmark('수원역 로데오거리', '로데오거리', '✨', -42, 66, '#ec4899');

    // 3) 🏬 AK& 수원 · 타임빌라스 · 롯데백화점 시그니처 LED 스카이라인 & 유리 스카이브릿지
    const akBldg = this.findBuilding('AK&');
    if (akBldg) {
      const akCrown = new THREE.Mesh(
        new THREE.BoxGeometry(20, 4.2, 1.2),
        new THREE.MeshBasicMaterial({
          map: this.createRichBannerTexture('AK PLAZA & 수원', 'SHOPPING · FOOD HALL', '#7f1d1d', '#f97316'),
        })
      );
      akCrown.position.set(akBldg.cx, akBldg.height + 2.5, akBldg.cz);
      akCrown.rotation.y = Math.PI / 2;
      this.ctx.root.add(akCrown);
      this.registerLandmark('AK& 수원 플라자', 'AK수원', '🏬', akBldg.cx, akBldg.cz, '#ea580c');
    }

    const tvBldg = this.findBuilding('타임빌라스');
    if (tvBldg) {
      const tvCrown = new THREE.Mesh(
        new THREE.BoxGeometry(24, 4.8, 1.2),
        new THREE.MeshBasicMaterial({
          map: this.createRichBannerTexture('TIMEVILLAS 수원', '롯데 타임빌라스 · LOTTE MALL', '#0f172a', '#22d3ee'),
        })
      );
      tvCrown.position.set(tvBldg.cx, tvBldg.height + 3.0, tvBldg.cz);
      this.ctx.root.add(tvCrown);
      this.registerLandmark('타임빌라스 수원', '타임빌라스', '🛍️', tvBldg.cx, tvBldg.cz, '#0891b2');
    }

    // Elevated glass Skybridge connecting 수원역 <-> AK& 수원 and 수원역 <-> 환승센터 (y = 14.5m, well above streets!)
    if (stationBldg && akBldg) {
      this.buildElevatedSkybridge(
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
    const hubBldg = this.findBuilding('환승센터');
    if (stationBldg && hubBldg) {
      this.buildElevatedSkybridge(
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

  private buildElevatedSkybridge(
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
    this.ctx.root.add(g);
  }
}
