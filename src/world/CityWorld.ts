import * as THREE from 'three';
import { CityZoneMarker, DeliveryLocation, ObstacleBox } from '../types';

export interface MapBuildingFootprint {
  x: number;
  z: number;
  w: number;
  d: number;
  label?: string;
  kind: 'shop' | 'residential' | 'public';
}

export interface CityMapInfo {
  roadLines: number[]; // [-120, -40, 40, 120]
  roadWidth: number;
  zones: CityZoneMarker[];
  obstacles: ObstacleBox[];
  buildings: MapBuildingFootprint[];
}

export class CityWorld {
  public readonly root = new THREE.Group();
  public readonly obstacles: ObstacleBox[] = [];
  public readonly zones: CityZoneMarker[] = [];
  public readonly buildings: MapBuildingFootprint[] = [];
  public readonly locations: DeliveryLocation[] = [];
  public readonly mapInfo: CityMapInfo;

  private readonly scene: THREE.Scene;
  private readonly dirLight: THREE.DirectionalLight;
  private readonly hemiLight: THREE.HemisphereLight;
  private readonly lampGlowMat: THREE.MeshStandardMaterial;
  private readonly windowGlowMat: THREE.MeshStandardMaterial;
  private readonly lobbyDoors = new Map<
    string,
    { leftDoor: THREE.Mesh; rightDoor: THREE.Mesh; open: boolean }
  >();

  // 3D glowing waypoint beacon for active pickup / dropoff
  private readonly beaconGroup = new THREE.Group();
  private readonly beaconRingMat: THREE.MeshBasicMaterial;
  private readonly beaconBeamMat: THREE.MeshBasicMaterial;
  private readonly beaconRing: THREE.Mesh;

  public isNight = false;

  private readonly roadCoords = [-120, -40, 40, 120];
  private readonly roadWidth = 14;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    scene.add(this.root);

    scene.background = new THREE.Color(0x93c5fd);
    scene.fog = new THREE.FogExp2(0xa5d4fb, 0.0024);

    this.hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0x475569, 0.9);
    this.root.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xfff7e6, 1.5);
    this.dirLight.position.set(95, 150, 75);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.set(2048, 2048);
    this.dirLight.shadow.camera.near = 20;
    this.dirLight.shadow.camera.far = 420;
    const d = 155;
    this.dirLight.shadow.camera.left = -d;
    this.dirLight.shadow.camera.right = d;
    this.dirLight.shadow.camera.top = d;
    this.dirLight.shadow.camera.bottom = -d;
    this.dirLight.shadow.bias = -0.0005;
    this.root.add(this.dirLight);

    this.lampGlowMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      emissive: 0xffd27d,
      emissiveIntensity: 0.2,
    });
    this.windowGlowMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      emissive: 0xfef3c7,
      emissiveIntensity: 0.12,
      roughness: 0.3,
    });

    this.beaconRingMat = new THREE.MeshBasicMaterial({
      color: 0xf97316,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
    });
    this.beaconBeamMat = new THREE.MeshBasicMaterial({
      color: 0xf97316,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.beaconRing = new THREE.Mesh(
      new THREE.RingGeometry(2.1, 2.7, 28),
      this.beaconRingMat
    );
    this.beaconRing.rotation.x = -Math.PI / 2;
    this.beaconRing.position.y = 0.2;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.15, 2.2, 18, 18, 1, true),
      this.beaconBeamMat
    );
    beam.position.y = 9.1;
    this.beaconGroup.add(this.beaconRing, beam);
    this.beaconGroup.visible = false;
    this.root.add(this.beaconGroup);

    this.mapInfo = {
      roadLines: this.roadCoords,
      roadWidth: this.roadWidth,
      zones: this.zones,
      obstacles: this.obstacles,
      buildings: this.buildings,
    };

    this.buildBaseGround();
    this.buildRoadGrid();
    this.buildCityBlocks();
    this.buildStreetFurniture();
    this.initDeliveryLocations();
    this.buildPickupWindowsAndLobbies();
  }

  private initDeliveryLocations(): void {
    this.locations.push(
      // Shops (Pickup spots cleanly on storefront sidewalk)
      {
        id: 'shop-chicken',
        name: '황금 치킨',
        x: -96,
        z: -25.5,
        type: 'shop',
        emoji: '🍗',
        menus: ['후라이드 치킨 + 콜라', '양념반 후라이드반 세트', '순살 간장치킨 + 치즈볼'],
      },
      {
        id: 'shop-coffee',
        name: '모닝 커피',
        x: -78,
        z: -25.5,
        type: 'shop',
        emoji: '☕',
        menus: ['아이스 아메리카노 2잔', '바닐라 라떼 + 크루아상', '딸기 스무디 + 케이크'],
      },
      {
        id: 'shop-bunsik',
        name: '명동 분식',
        x: -61,
        z: -25.5,
        type: 'shop',
        emoji: '🍢',
        menus: ['로제 떡볶이 + 모둠튀김', '김밥 2줄 + 라볶이 세트', '순대 + 오뎅탕 세트'],
      },
      {
        id: 'shop-burger',
        name: '수제 버거',
        x: -14,
        z: -58.5,
        type: 'shop',
        emoji: '🍔',
        menus: ['더블치즈 버거 세트', '베이컨 BBQ 버거 + 감튀', '크리스피 치킨버거 세트'],
      },
      {
        id: 'shop-pizza',
        name: '화덕 피자',
        x: 14,
        z: -58.5,
        type: 'shop',
        emoji: '🍕',
        menus: ['페퍼로니 라지 피자', '콤비네이션 피자 + 스파게티', '고르곤졸라 + 갈릭디핑'],
      },

      // Residences (Dropoff spots cleanly at entrance sidewalk)
      { id: 'res-sun-101', name: '햇살 아파트 101동', x: 68, z: 55, type: 'residential', emoji: '🏢' },
      { id: 'res-sun-102', name: '햇살 아파트 102동', x: 94, z: 81, type: 'residential', emoji: '🏢' },
      { id: 'res-villa-a', name: '그린빌라 A동', x: 66, z: -23.5, type: 'residential', emoji: '🏠' },
      { id: 'res-villa-b', name: '그린빌라 B동', x: 92, z: -23.5, type: 'residential', emoji: '🏠' },
      { id: 'res-villa-c', name: '그린빌라 C동', x: 79, z: 25, type: 'residential', emoji: '🏠' },
      { id: 'res-river-201', name: '리버뷰 201동', x: -14, z: 68, type: 'residential', emoji: '🏢' },
      { id: 'res-river-202', name: '리버뷰 202동', x: 15, z: 68, type: 'residential', emoji: '🏢' }
    );
  }

  public updateBeacon(
    target: DeliveryLocation | null,
    isPickup: boolean,
    elapsedTime: number
  ): void {
    if (!target) {
      this.beaconGroup.visible = false;
      return;
    }
    this.beaconGroup.visible = true;
    this.beaconGroup.position.set(target.x, 0, target.z);
    const hex = isPickup ? 0xf97316 : 0x10b981;
    this.beaconRingMat.color.setHex(hex);
    this.beaconBeamMat.color.setHex(hex);

    const pulse = 1 + Math.sin(elapsedTime * 4.2) * 0.1;
    this.beaconRing.scale.set(pulse, pulse, 1);
    this.beaconBeamMat.opacity = 0.18 + Math.sin(elapsedTime * 3.0) * 0.06;
  }

  private createAsphaltTexture(rx: number, ry: number): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#2d343d';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1400; i++) {
      const v = 38 + Math.floor(Math.random() * 22);
      ctx.fillStyle = `rgb(${v},${v + 3},${v + 6})`;
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(rx, ry);
    return tex;
  }

  private createSidewalkTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#9ca3af';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = 'rgba(75,85,99,0.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, 64, 64);
    ctx.strokeRect(64, 0, 64, 64);
    ctx.strokeRect(0, 64, 64, 64);
    ctx.strokeRect(64, 64, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(14, 14);
    return tex;
  }

  private createSignTexture(title: string, bg: string, fg = '#ffffff'): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 6;
    ctx.strokeRect(6, 6, 500, 116);
    ctx.fillStyle = fg;
    ctx.font = 'bold 54px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, 256, 68);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  private buildBaseGround(): void {
    // Outer grass terrain
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(460, 460),
      new THREE.MeshStandardMaterial({ color: 0x4d7c4f, roughness: 0.95 })
    );
    grass.rotation.x = -Math.PI / 2;
    grass.receiveShadow = true;
    this.root.add(grass);

    // Subtle city boundary wall at ±192
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.8 });
    const lim = 192;
    const walls: Array<[number, number, number, number]> = [
      [0, lim, lim * 2, 1.2],
      [0, -lim, lim * 2, 1.2],
      [lim, 0, 1.2, lim * 2],
      [-lim, 0, 1.2, lim * 2],
    ];
    for (const [x, z, w, l] of walls) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.4, l), wallMat);
      m.position.set(x, 0.7, z);
      this.root.add(m);
    }
  }

  private buildRoadGrid(): void {
    const span = 300; // covers -150 to +150
    const asphaltH = new THREE.MeshStandardMaterial({
      map: this.createAsphaltTexture(20, 2),
      roughness: 0.9,
    });
    const asphaltV = new THREE.MeshStandardMaterial({
      map: this.createAsphaltTexture(2, 20),
      roughness: 0.9,
    });
    const yellowMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
    const whiteMat = new THREE.MeshBasicMaterial({ color: 0xf1f5f9 });

    // Horizontal & Vertical roads
    for (const coord of this.roadCoords) {
      const hRoad = new THREE.Mesh(new THREE.PlaneGeometry(span, this.roadWidth), asphaltH);
      hRoad.rotation.x = -Math.PI / 2;
      hRoad.position.set(0, 0.025, coord);
      hRoad.receiveShadow = true;
      this.root.add(hRoad);

      const vRoad = new THREE.Mesh(new THREE.PlaneGeometry(this.roadWidth, span), asphaltV);
      vRoad.rotation.x = -Math.PI / 2;
      vRoad.position.set(coord, 0.028, 0);
      vRoad.receiveShadow = true;
      this.root.add(vRoad);

      // Center yellow dashed markings between intersections
      for (let p = -140; p <= 140; p += 10) {
        if (this.roadCoords.some((rc) => Math.abs(p - rc) < 11)) continue;
        const dh = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.18), yellowMat);
        dh.rotation.x = -Math.PI / 2;
        dh.position.set(p, 0.04, coord);
        this.root.add(dh);

        const dv = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 4.2), yellowMat);
        dv.rotation.x = -Math.PI / 2;
        dv.position.set(coord, 0.04, p);
        this.root.add(dv);
      }
    }

    // Crosswalks at every intersection
    for (const rx of this.roadCoords) {
      for (const rz of this.roadCoords) {
        for (const side of [-1, 1]) {
          for (let s = -4.5; s <= 4.5; s += 1.8) {
            const stripeH = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.7), whiteMat);
            stripeH.rotation.x = -Math.PI / 2;
            stripeH.position.set(rx + side * 8.8, 0.042, rz + s);
            this.root.add(stripeH);

            const stripeV = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 2.4), whiteMat);
            stripeV.rotation.x = -Math.PI / 2;
            stripeV.position.set(rx + s, 0.042, rz + side * 8.8);
            this.root.add(stripeV);
          }
        }
      }
    }
  }

  private addBuilding(
    x: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: number,
    opts?: { signText?: string; signColor?: string; signFace?: 'S' | 'N' | 'E' | 'W'; isResidential?: boolean }
  ): void {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.72 })
    );
    body.position.y = h / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.3, 0.4, d + 0.3),
      new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.85 })
    );
    roof.position.y = h + 0.2;
    group.add(roof);

    // Simple stylized windows on front & back
    const floors = Math.max(1, Math.floor((h - 1.5) / 3.2));
    const cols = Math.max(1, Math.floor((w - 2) / 3.4));
    for (let f = 0; f < floors; f++) {
      const wy = 2.6 + f * 3.1;
      for (let c = 0; c < cols; c++) {
        const wx = -((cols - 1) * 3.1) / 2 + c * 3.1;
        for (const side of [-1, 1]) {
          const win = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.3), this.windowGlowMat);
          win.position.set(wx, wy, side * (d / 2 + 0.03));
          if (side === -1) win.rotation.y = Math.PI;
          group.add(win);
        }
      }
    }

    // Storefront awning & signboard
    if (opts?.signText) {
      const signTex = this.createSignTexture(opts.signText, opts.signColor ?? '#0ea5e9');
      const signMat = new THREE.MeshStandardMaterial({
        map: signTex,
        emissive: new THREE.Color(opts.signColor ?? '#0ea5e9'),
        emissiveIntensity: 0.35,
        roughness: 0.4,
      });
      const signW = Math.min(w - 1.4, 9.5);
      const sign = new THREE.Mesh(new THREE.BoxGeometry(signW, 1.7, 0.24), signMat);
      const awning = new THREE.Mesh(
        new THREE.BoxGeometry(signW + 0.6, 0.25, 1.6),
        new THREE.MeshStandardMaterial({ color: opts.signColor ?? '#0ea5e9', roughness: 0.6 })
      );

      const face = opts.signFace ?? 'S';
      if (face === 'S') {
        sign.position.set(0, 4.1, -d / 2 - 0.14);
        sign.rotation.y = Math.PI;
        awning.position.set(0, 2.9, -d / 2 - 0.8);
      } else if (face === 'N') {
        sign.position.set(0, 4.1, d / 2 + 0.14);
        awning.position.set(0, 2.9, d / 2 + 0.8);
      } else if (face === 'E') {
        sign.position.set(w / 2 + 0.14, 4.1, 0);
        sign.rotation.y = Math.PI / 2;
        awning.position.set(w / 2 + 0.8, 2.9, 0);
        awning.rotation.y = Math.PI / 2;
      } else {
        sign.position.set(-w / 2 - 0.14, 4.1, 0);
        sign.rotation.y = -Math.PI / 2;
        awning.position.set(-w / 2 - 0.8, 2.9, 0);
        awning.rotation.y = -Math.PI / 2;
      }
      group.add(sign, awning);
    }

    this.root.add(group);
    this.obstacles.push({
      minX: x - w / 2,
      maxX: x + w / 2,
      minZ: z - d / 2,
      maxZ: z + d / 2,
    });
    this.buildings.push({
      x,
      z,
      w,
      d,
      label: opts?.signText,
      kind: opts?.isResidential ? 'residential' : opts?.signText ? 'shop' : 'public',
    });
  }

  private buildCityBlocks(): void {
    const sidewalkMat = new THREE.MeshStandardMaterial({
      map: this.createSidewalkTexture(),
      roughness: 0.88,
    });

    const blockCenters = [-80, 0, 80];
    for (const bx of blockCenters) {
      for (const bz of blockCenters) {
        // Raised sidewalk platform for each 66x66 city block
        const pad = new THREE.Mesh(new THREE.BoxGeometry(65.5, 0.14, 65.5), sidewalkMat);
        pad.position.set(bx, 0.07, bz);
        pad.receiveShadow = true;
        this.root.add(pad);
      }
    }

    // 1. Central Park Plaza (0, 0)
    const parkGrass = new THREE.Mesh(
      new THREE.PlaneGeometry(54, 54),
      new THREE.MeshStandardMaterial({ color: 0x568b52, roughness: 0.92 })
    );
    parkGrass.rotation.x = -Math.PI / 2;
    parkGrass.position.set(0, 0.15, 0);
    parkGrass.receiveShadow = true;
    this.root.add(parkGrass);

    const fountainBase = new THREE.Mesh(
      new THREE.CylinderGeometry(5.5, 6.0, 0.7, 20),
      new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.6 })
    );
    fountainBase.position.set(0, 0.45, 0);
    const water = new THREE.Mesh(
      new THREE.CylinderGeometry(4.8, 4.8, 0.75, 20),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.15, metalness: 0.2 })
    );
    water.position.set(0, 0.48, 0);
    this.root.add(fountainBase, water);
    this.obstacles.push({ minX: -5.8, maxX: 5.8, minZ: -5.8, maxZ: 5.8 });

    // 2. Main Restaurant / Cafe Strip — Block (-80, 0) RIGHT NEXT TO PLAYER SPAWN!
    // Facing south toward z = -40 street (player spawns at -64.5, -31.2; scooter at -62, -34.2)
    this.addBuilding(-96, -15, 16, 8.5, 14, 0xfef3c7, {
      signText: '황금 치킨',
      signColor: '#dc2626',
      signFace: 'S',
    });
    this.addBuilding(-78, -15, 15, 7.5, 14, 0xe2e8f0, {
      signText: '모닝 커피',
      signColor: '#0f766e',
      signFace: 'S',
    });
    this.addBuilding(-61, -15, 15, 8.0, 14, 0xffedd5, {
      signText: '명동 분식',
      signColor: '#ea580c',
      signFace: 'S',
    });
    this.addBuilding(-80, 14, 42, 11, 16, 0xdbeafe, {
      signText: '24시 마트',
      signColor: '#2563eb',
      signFace: 'N',
    });
    this.zones.push({ name: '상가 거리 (픽업존)', x: -78, z: -26, type: 'shop' });

    // 3. Secondary Food Alley — Block (0, -80)
    this.addBuilding(-14, -70, 18, 9, 15, 0xfde68a, {
      signText: '수제 버거',
      signColor: '#b45309',
      signFace: 'N',
    });
    this.addBuilding(14, -70, 18, 8.5, 15, 0xfecdd3, {
      signText: '화덕 피자',
      signColor: '#be123c',
      signFace: 'N',
    });
    this.addBuilding(0, -96, 36, 12, 14, 0xcbd5e1);
    this.zones.push({ name: '남부 식당가', x: 0, z: -56, type: 'shop' });

    // 4. Residential Apartments — Block (+80, +80)
    this.addBuilding(68, 66, 20, 26, 14, 0xe2e8f0, {
      signText: '햇살 101동',
      signColor: '#16a34a',
      signFace: 'S',
      isResidential: true,
    });
    this.addBuilding(94, 92, 20, 28, 14, 0xf1f5f9, {
      signText: '햇살 102동',
      signColor: '#15803d',
      signFace: 'S',
      isResidential: true,
    });
    this.zones.push({ name: '햇살 아파트', x: 80, z: 54, type: 'residential' });

    // 5. Residential Villa Complex — Block (+80, 0)
    this.addBuilding(66, -12, 16, 12, 15, 0xf5d0a9, {
      signText: '그린빌라 A',
      signColor: '#059669',
      signFace: 'S',
      isResidential: true,
    });
    this.addBuilding(92, -12, 16, 12, 15, 0xfde2c4, {
      signText: '그린빌라 B',
      signColor: '#059669',
      signFace: 'S',
      isResidential: true,
    });
    this.addBuilding(79, 14, 34, 14, 14, 0xe7e5e4, {
      signText: '그린빌라 C',
      signColor: '#047857',
      signFace: 'N',
      isResidential: true,
    });
    this.zones.push({ name: '그린 빌라 단지', x: 80, z: -26, type: 'residential' });

    // 6. North Apartments — Block (0, +80)
    this.addBuilding(-14, 80, 20, 22, 16, 0xe0f2fe, {
      signText: '리버뷰 201동',
      signColor: '#0284c7',
      signFace: 'S',
      isResidential: true,
    });
    this.addBuilding(15, 80, 20, 24, 16, 0xe2e8f0, {
      signText: '리버뷰 202동',
      signColor: '#0284c7',
      signFace: 'S',
      isResidential: true,
    });
    this.zones.push({ name: '리버뷰 아파트', x: 0, z: 56, type: 'residential' });

    // 7. Outer Corner Blocks for skyline & driving routes
    // NW (-80, +80)
    this.addBuilding(-80, 80, 32, 18, 22, 0xcbd5e1, {
      signText: '타워 오피스',
      signColor: '#334155',
      signFace: 'S',
    });
    // SE (+80, -80)
    this.addBuilding(80, -80, 34, 15, 22, 0xf1f5f9, {
      signText: '스포츠 센터',
      signColor: '#4f46e5',
      signFace: 'N',
    });
    // SW (-80, -80)
    this.addBuilding(-80, -80, 28, 12, 22, 0xe7e5e4, {
      signText: '동네 주민센터',
      signColor: '#0d9488',
      signFace: 'N',
    });
  }

  private buildStreetFurniture(): void {
    // Streetlamps at block corners
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.6, roughness: 0.4 });
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 6.2, 6);
    const lampGeo = new THREE.BoxGeometry(0.55, 0.14, 0.28);

    const cornerOffsets = [-111, -49, -31, 31, 49, 111];
    for (const cx of cornerOffsets) {
      for (const cz of cornerOffsets) {
        const g = new THREE.Group();
        g.position.set(cx, 0.14, cz);
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.y = 3.1;
        const lamp = new THREE.Mesh(lampGeo, this.lampGlowMat);
        lamp.position.y = 6.2;
        g.add(pole, lamp);
        this.root.add(g);
      }
    }

    // Trees in Central Park & outer perimeter (InstancedMesh)
    const treeCoords: Array<[number, number, number]> = [
      [-18, -18, 1.0],
      [18, -18, 1.1],
      [-18, 18, 1.05],
      [18, 18, 0.95],
      [-20, 0, 0.9],
      [20, 0, 1.0],
      [0, -20, 0.95],
      [0, 20, 1.05],
    ];
    for (let p = -140; p <= 140; p += 22) {
      treeCoords.push([p, -158, 1.15]);
      treeCoords.push([p, 158, 1.15]);
      treeCoords.push([-158, p, 1.15]);
      treeCoords.push([158, p, 1.15]);
    }

    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 2.4, 7);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4f35, roughness: 0.9 });
    const crownGeo = new THREE.SphereGeometry(1.9, 8, 7);
    const crownMat = new THREE.MeshStandardMaterial({ color: 0x2f7a42, roughness: 0.85 });

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCoords.length);
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, treeCoords.length);
    trunks.castShadow = true;
    crowns.castShadow = true;

    const dummy = new THREE.Object3D();
    treeCoords.forEach(([x, z, s], i) => {
      dummy.position.set(x, 1.2 * s, z);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);

      dummy.position.set(x, 3.6 * s, z);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      crowns.setMatrixAt(i, dummy.matrix);
    });
    this.root.add(trunks, crowns);
  }

  /**
   * Builds visible 3D Outdoor Pick-up Windows (for shops) and 1st-Floor Glass Lobby Entrances (for residences).
   */
  private buildPickupWindowsAndLobbies(): void {
    const counterMat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      roughness: 0.35,
      metalness: 0.45,
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.65 });
    const screenMat = new THREE.MeshStandardMaterial({
      color: 0x0ea5e9,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.9,
    });
    const glassDoorMat = new THREE.MeshStandardMaterial({
      color: 0x7dd3fc,
      roughness: 0.12,
      metalness: 0.3,
      transparent: true,
      opacity: 0.46,
    });
    const pinPadMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      emissive: 0x22c55e,
      emissiveIntensity: 0.55,
    });

    for (const loc of this.locations) {
      // Determine which direction the entrance faces (+Z for N-facing shops/villas, -Z for S-facing)
      const facesNorth =
        loc.id === 'shop-burger' || loc.id === 'shop-pizza' || loc.id === 'res-villa-c';
      const wallOffsetZ = facesNorth ? -2.9 : 2.9;

      if (loc.type === 'shop') {
        const g = new THREE.Group();
        g.position.set(loc.x, 0.14, loc.z + wallOffsetZ);
        if (!facesNorth) g.rotation.y = Math.PI;

        // Outdoor pickup counter ledge right at storefront
        const counter = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.05, 0.72), counterMat);
        counter.position.set(0, 0.52, 0.36);
        counter.castShadow = true;
        g.add(counter);

        // Warm lit pickup window frame above counter
        const windowFrame = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.2, 0.18), darkMat);
        windowFrame.position.set(0, 1.65, 0.1);
        g.add(windowFrame);

        // POS Keypad terminal sitting on the outdoor pickup counter!
        const posStand = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.34, 0.24), darkMat);
        posStand.position.set(0.85, 1.18, 0.45);
        posStand.rotation.x = -0.35;
        const posScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.22), screenMat);
        posScreen.position.set(0.85, 1.21, 0.58);
        posScreen.rotation.x = -0.35;
        g.add(posStand, posScreen);

        this.root.add(g);
      } else {
        // 1st-Floor Apartment Glass Entrance Door + PIN Intercom + Lobby Elevator preview
        const g = new THREE.Group();
        g.position.set(loc.x, 0.14, loc.z + wallOffsetZ);
        if (!facesNorth) g.rotation.y = Math.PI;

        const archFrame = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.75, 0.45), darkMat);
        archFrame.position.set(0, 1.38, 0.2);
        const innerCut = new THREE.Mesh(
          new THREE.BoxGeometry(2.5, 2.45, 0.48),
          new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 })
        );
        innerCut.position.set(0, 1.24, 0.18);
        g.add(archFrame, innerCut);

        // Left & right sliding glass doors
        const leftDoor = new THREE.Mesh(new THREE.BoxGeometry(1.18, 2.38, 0.08), glassDoorMat);
        leftDoor.position.set(-0.6, 1.2, 0.46);
        const rightDoor = new THREE.Mesh(new THREE.BoxGeometry(1.18, 2.38, 0.08), glassDoorMat);
        rightDoor.position.set(0.6, 1.2, 0.46);
        g.add(leftDoor, rightDoor);

        // 4-Digit PIN Intercom Keypad beside the glass door
        const pad = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.38, 0.08), pinPadMat);
        pad.position.set(1.42, 1.32, 0.46);
        g.add(pad);

        this.lobbyDoors.set(loc.id, { leftDoor, rightDoor, open: false });
        this.root.add(g);
      }
    }
  }

  public setLobbyDoorOpen(locationId: string | null): void {
    for (const [id, entry] of this.lobbyDoors.entries()) {
      entry.open = locationId === id;
    }
  }

  public updateLobbyDoors(dt: number): void {
    const step = Math.min(1, dt * 6);
    for (const entry of this.lobbyDoors.values()) {
      const targetL = entry.open ? -1.45 : -0.6;
      const targetR = entry.open ? 1.45 : 0.6;
      entry.leftDoor.position.x += (targetL - entry.leftDoor.position.x) * step;
      entry.rightDoor.position.x += (targetR - entry.rightDoor.position.x) * step;
    }
  }

  /** Occlusion toggle: hides entire outdoor city + fog when inside the underground corridor! */
  public setOutdoorVisible(visible: boolean): void {
    this.root.visible = visible;
    if (!visible) {
      this.scene.background = new THREE.Color(0x11151c);
      this.scene.fog = null;
    } else {
      this.applySkyTheme();
    }
  }

  private applySkyTheme(): void {
    if (this.isNight) {
      this.scene.background = new THREE.Color(0x0b1220);
      this.scene.fog = new THREE.FogExp2(0x0b1220, 0.004);
      this.dirLight.intensity = 0.25;
      this.dirLight.color.setHex(0x8aa8d6);
      this.hemiLight.intensity = 0.28;
      this.lampGlowMat.emissiveIntensity = 3.2;
      this.windowGlowMat.emissiveIntensity = 1.1;
    } else {
      this.scene.background = new THREE.Color(0x93c5fd);
      this.scene.fog = new THREE.FogExp2(0xa5d4fb, 0.0024);
      this.dirLight.intensity = 1.5;
      this.dirLight.color.setHex(0xfff7e6);
      this.hemiLight.intensity = 0.9;
      this.lampGlowMat.emissiveIntensity = 0.2;
      this.windowGlowMat.emissiveIntensity = 0.12;
    }
  }

  public toggleDayNight(): boolean {
    this.isNight = !this.isNight;
    if (this.root.visible) {
      this.applySkyTheme();
    }
    return this.isNight;
  }
}
