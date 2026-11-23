import * as THREE from 'three';
import { HandheldFoodBag3D } from '../player/HandheldFoodBag3D';
import {
  BusStopPoint,
  CITY_BLOCK_CENTERS,
  CITY_ROAD_LINES,
  CITY_WORLD_LIMIT,
  CityZoneMarker,
  DeliveryLocation,
  ObstacleBox,
  ServiceStationInfo,
  SlipSurfaceType,
  SpeedCameraMarker,
  WeatherMode,
} from '../types';

export interface MapBuildingFootprint {
  x: number;
  z: number;
  w: number;
  d: number;
  label?: string;
  kind: 'shop' | 'residential' | 'public';
}

export interface CityMapInfo {
  roadLines: readonly number[];
  blockCenters: readonly number[];
  roadWidth: number;
  zones: CityZoneMarker[];
  busStops: BusStopPoint[];
  serviceStations: ServiceStationInfo[];
  speedCameras?: SpeedCameraMarker[];
  obstacles: ObstacleBox[];
  buildings: MapBuildingFootprint[];
}

export class CityWorld {
  public readonly root = new THREE.Group();
  public readonly obstacles: ObstacleBox[] = [];
  public readonly zones: CityZoneMarker[] = [];
  public readonly buildings: MapBuildingFootprint[] = [];
  public readonly locations: DeliveryLocation[] = [];
  public readonly busStops: BusStopPoint[] = [];
  public readonly serviceStations: ServiceStationInfo[] = [];
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
  private readonly shopTrays = new Map<
    string,
    { bag: THREE.Group; ledMat: THREE.MeshStandardMaterial }
  >();

  // Ground-only entrance ring marker for active pickup / dropoff (no tall sky beam so player navigates via phone!)
  private readonly beaconGroup = new THREE.Group();
  private readonly beaconRingMat: THREE.MeshBasicMaterial;
  private readonly beaconRing: THREE.Mesh;

  public isNight = false;
  public weatherMode: WeatherMode = 'clear';

  // Wet-road shader & slip-surface materials
  private asphaltHMat!: THREE.MeshStandardMaterial;
  private asphaltVMat!: THREE.MeshStandardMaterial;
  private crosswalkPaintMat!: THREE.MeshStandardMaterial;
  private manholeMat!: THREE.MeshStandardMaterial;
  private readonly roadShaderUniforms = {
    uRainWetness: { value: 0 },
    uTime: { value: 0 },
  };
  // Manhole local offsets relative to each 6x6 intersection center (rx, rz)
  private readonly manholeOffsets: ReadonlyArray<readonly [number, number]> = [
    [3.4, 3.4],
    [-3.4, -3.4],
    [3.2, -3.6],
  ];
  private readonly manholeRadius = 1.05; // visual 0.72m + scooter tire contact radius margin

  private readonly roadCoords = CITY_ROAD_LINES;
  private readonly roadWidth = 14;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    scene.add(this.root);

    scene.background = new THREE.Color(0x93c5fd);
    scene.fog = new THREE.FogExp2(0xa5d4fb, 0.0018);

    this.hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0x475569, 0.9);
    this.root.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xfff7e6, 1.5);
    this.dirLight.position.set(140, 210, 110);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.set(2048, 2048);
    this.dirLight.shadow.camera.near = 20;
    this.dirLight.shadow.camera.far = 650;
    const d = 240;
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
    this.beaconRing = new THREE.Mesh(
      new THREE.RingGeometry(2.1, 2.7, 28),
      this.beaconRingMat
    );
    this.beaconRing.rotation.x = -Math.PI / 2;
    this.beaconRing.position.y = 0.22;
    this.beaconGroup.add(this.beaconRing);
    this.beaconGroup.visible = false;
    this.root.add(this.beaconGroup);

    this.mapInfo = {
      roadLines: this.roadCoords,
      blockCenters: CITY_BLOCK_CENTERS,
      roadWidth: this.roadWidth,
      zones: this.zones,
      busStops: this.busStops,
      serviceStations: this.serviceStations,
      obstacles: this.obstacles,
      buildings: this.buildings,
    };

    this.buildBaseGround();
    this.buildRoadGrid();
    this.buildSidewalksAndBlocks();
    this.buildServiceStations();
    this.buildBusStops();
    this.buildStreetFurniture();
    this.initDeliveryLocations();
    this.buildPickupWindowsAndLobbies();
  }

  private createAsphaltTexture(rx: number, ry: number): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#2c333c';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1500; i++) {
      const v = 36 + Math.floor(Math.random() * 22);
      ctx.fillStyle = `rgb(${v},${v + 3},${v + 6})`;
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(rx, ry);
    return tex;
  }

  /** Korean pedestrian sidewalk block pattern (보도블록 텍스처) */
  private createSidewalkTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#b4b8bf';
    ctx.fillRect(0, 0, 128, 128);

    // Subtle warm/cool Korean interlocking brick pavers
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        ctx.fillStyle = (row + col) % 2 === 0 ? '#aeb3bc' : '#babdc3';
        ctx.fillRect(col * 32 + 1, row * 32 + 1, 30, 30);
      }
    }
    ctx.strokeStyle = 'rgba(71, 85, 105, 0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 128; i += 32) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 128);
      ctx.moveTo(0, i);
      ctx.lineTo(128, i);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(16, 16);
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
    ctx.font = 'bold 52px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, 256, 68);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  private buildBaseGround(): void {
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(720, 720),
      new THREE.MeshStandardMaterial({ color: 0x4d7c4f, roughness: 0.95 })
    );
    grass.rotation.x = -Math.PI / 2;
    grass.receiveShadow = true;
    this.root.add(grass);

    // City perimeter boundary wall at ±CITY_WORLD_LIMIT
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.8 });
    const lim = CITY_WORLD_LIMIT;
    const walls: Array<[number, number, number, number]> = [
      [0, lim, lim * 2, 1.4],
      [0, -lim, lim * 2, 1.4],
      [lim, 0, 1.4, lim * 2],
      [-lim, 0, 1.4, lim * 2],
    ];
    for (const [x, z, w, l] of walls) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.6, l), wallMat);
      m.position.set(x, 0.8, z);
      this.root.add(m);
    }
  }

  private createPuddleRoughnessTexture(rx: number, ry: number): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    // Base damp asphalt roughness (~0.68 in texture channel)
    ctx.fillStyle = '#adadad';
    ctx.fillRect(0, 0, 256, 256);

    // Organic dark puddle patches (very low roughness = mirror-like wet reflections!)
    const puddles: Array<[number, number, number, number]> = [
      [56, 64, 42, 26],
      [184, 72, 36, 24],
      [124, 152, 54, 32],
      [48, 206, 38, 22],
      [208, 198, 44, 28],
    ];
    for (const [px, py, radX, radY] of puddles) {
      const grad = ctx.createRadialGradient(px, py, 3, px, py, Math.max(radX, radY));
      grad.addColorStop(0, '#0e0e0e');
      grad.addColorStop(0.6, '#222222');
      grad.addColorStop(1, 'rgba(173,173,173,0)');
      ctx.save();
      ctx.translate(px, py);
      ctx.scale(1, radY / radX);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, radX, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(rx, ry);
    return tex;
  }

  private createManholeTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#3b424c';
    ctx.fillRect(0, 0, 128, 128);

    // Cast-iron rim & concentric ribs + waffle grid
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(64, 64, 58, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 3;
    for (const r of [46, 30, 14]) {
      ctx.beginPath();
      ctx.arc(64, 64, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let a = 0; a < Math.PI; a += Math.PI / 6) {
      ctx.beginPath();
      ctx.moveTo(64 - Math.cos(a) * 52, 64 - Math.sin(a) * 52);
      ctx.lineTo(64 + Math.cos(a) * 52, 64 + Math.sin(a) * 52);
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private enhanceWetAsphaltMaterial(mat: THREE.MeshStandardMaterial): void {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uRainWetness = this.roadShaderUniforms.uRainWetness;
      shader.uniforms.uTime = this.roadShaderUniforms.uTime;

      shader.fragmentShader =
        'uniform float uRainWetness;\nuniform float uTime;\n' +
        shader.fragmentShader.replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          // Smoothly blend dry uniform asphalt into reflective wet puddle surface!
          float puddleMask = 1.0 - smoothstep(0.08, 0.55, roughnessFactor);
          roughnessFactor = mix(0.90, mix(0.32, 0.055, puddleMask), uRainWetness);`
        ).replace(
          '#include <dithering_fragment>',
          `if (uRainWetness > 0.02) {
            float pMask = 1.0 - smoothstep(0.10, 0.55, roughnessFactor);
            #ifdef USE_ROUGHNESSMAP
            float ripple = sin((vRoughnessMapUv.x * 90.0 + vRoughnessMapUv.y * 90.0) + uTime * 8.5) * 0.5 + 0.5;
            #else
            float ripple = 0.5;
            #endif
            float fresnelSheen = (0.055 + 0.14 * pMask) * uRainWetness;
            vec3 skyReflect = vec3(0.56, 0.72, 0.88) * fresnelSheen * (0.85 + 0.15 * ripple);
            gl_FragColor.rgb += skyReflect;
          }
          #include <dithering_fragment>`
        );
    };
  }

  private buildRoadGrid(): void {
    const span = 468; // covers -234 to +234
    this.asphaltHMat = new THREE.MeshStandardMaterial({
      map: this.createAsphaltTexture(32, 2),
      roughnessMap: this.createPuddleRoughnessTexture(26, 2),
      roughness: 0.9,
      metalness: 0.04,
    });
    this.enhanceWetAsphaltMaterial(this.asphaltHMat);

    this.asphaltVMat = new THREE.MeshStandardMaterial({
      map: this.createAsphaltTexture(2, 32),
      roughnessMap: this.createPuddleRoughnessTexture(2, 26),
      roughness: 0.9,
      metalness: 0.04,
    });
    this.enhanceWetAsphaltMaterial(this.asphaltVMat);

    const yellowMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
    this.crosswalkPaintMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      roughness: 0.78,
      metalness: 0.05,
    });
    this.manholeMat = new THREE.MeshStandardMaterial({
      map: this.createManholeTexture(),
      color: 0x6b7280,
      roughness: 0.55,
      metalness: 0.78,
    });

    for (const coord of this.roadCoords) {
      const hRoad = new THREE.Mesh(new THREE.PlaneGeometry(span, this.roadWidth), this.asphaltHMat);
      hRoad.rotation.x = -Math.PI / 2;
      hRoad.position.set(0, 0.025, coord);
      hRoad.receiveShadow = true;
      this.root.add(hRoad);

      const vRoad = new THREE.Mesh(new THREE.PlaneGeometry(this.roadWidth, span), this.asphaltVMat);
      vRoad.rotation.x = -Math.PI / 2;
      vRoad.position.set(coord, 0.028, 0);
      vRoad.receiveShadow = true;
      this.root.add(vRoad);

      // Center yellow dashed markings between intersections
      for (let p = -222; p <= 222; p += 10) {
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

    // Crosswalks at all 36 intersections (InstancedMesh for super fast rendering!)
    const stripeGeoH = new THREE.PlaneGeometry(2.4, 0.7);
    stripeGeoH.rotateX(-Math.PI / 2);
    const stripeGeoV = new THREE.PlaneGeometry(0.7, 2.4);
    stripeGeoV.rotateX(-Math.PI / 2);

    const totalCross = this.roadCoords.length * this.roadCoords.length * 2 * 6;
    const instH = new THREE.InstancedMesh(stripeGeoH, this.crosswalkPaintMat, totalCross);
    const instV = new THREE.InstancedMesh(stripeGeoV, this.crosswalkPaintMat, totalCross);
    instH.receiveShadow = true;
    instV.receiveShadow = true;
    const dummy = new THREE.Object3D();
    let idx = 0;

    for (const rx of this.roadCoords) {
      for (const rz of this.roadCoords) {
        for (const side of [-1, 1]) {
          for (let s = -4.5; s <= 4.51; s += 1.8) {
            dummy.position.set(rx + side * 8.8, 0.042, rz + s);
            dummy.updateMatrix();
            instH.setMatrixAt(idx, dummy.matrix);

            dummy.position.set(rx + s, 0.042, rz + side * 8.8);
            dummy.updateMatrix();
            instV.setMatrixAt(idx, dummy.matrix);
            idx++;
          }
        }
      }
    }
    this.root.add(instH, instV);

    // Metallic Manhole Covers at all 36 intersections (1 single InstancedMesh = 1 DrawCall!)
    const manholeGeo = new THREE.CylinderGeometry(0.74, 0.78, 0.032, 16);
    const totalManholes = this.roadCoords.length * this.roadCoords.length * this.manholeOffsets.length;
    const manholeInst = new THREE.InstancedMesh(manholeGeo, this.manholeMat, totalManholes);
    manholeInst.receiveShadow = true;
    let mIdx = 0;
    for (const rx of this.roadCoords) {
      for (const rz of this.roadCoords) {
        for (const [ox, oz] of this.manholeOffsets) {
          dummy.position.set(rx + ox, 0.036, rz + oz);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          manholeInst.setMatrixAt(mIdx++, dummy.matrix);
        }
      }
    }
    this.root.add(manholeInst);
  }

  /**
   * Fast O(1) slip-surface collision query against metallic manhole covers and crosswalk white paint.
   * Snaps directly to the nearest 6x6 intersection so there is zero per-frame iteration overhead.
   */
  public getSlipSurfaceAt(x: number, z: number): SlipSurfaceType {
    // Find nearest intersection coordinate on X and Z (grid step = 80, lines at -200..200)
    const ix = Math.max(0, Math.min(this.roadCoords.length - 1, Math.round((x + 200) / 80)));
    const iz = Math.max(0, Math.min(this.roadCoords.length - 1, Math.round((z + 200) / 80)));
    const rx = this.roadCoords[ix];
    const rz = this.roadCoords[iz];

    const dx = x - rx;
    const dz = z - rz;
    if (Math.abs(dx) > 12 || Math.abs(dz) > 12) return 'none';

    // 1. Check metallic manhole covers inside the intersection
    const rSq = this.manholeRadius * this.manholeRadius;
    for (const [ox, oz] of this.manholeOffsets) {
      const mdx = dx - ox;
      const mdz = dz - oz;
      if (mdx * mdx + mdz * mdz <= rSq) {
        return 'manhole';
      }
    }

    // 2. Check crosswalk white paint strips surrounding the intersection (±8.8m)
    const onHCrosswalk = Math.abs(Math.abs(dx) - 8.8) <= 1.45 && Math.abs(dz) <= 5.2;
    const onVCrosswalk = Math.abs(Math.abs(dz) - 8.8) <= 1.45 && Math.abs(dx) <= 5.2;
    if (onHCrosswalk || onVCrosswalk) {
      return 'crosswalk_paint';
    }

    return 'none';
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
    group.position.set(x, 0.16, z); // sit cleanly on top of the 0.16m raised sidewalk!

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

    // Stylized windows (capped rows/cols for crisp performance across 45+ buildings)
    const floors = Math.min(8, Math.max(1, Math.floor((h - 1.5) / 3.4)));
    const cols = Math.min(7, Math.max(1, Math.floor((w - 2) / 3.8)));
    for (let f = 0; f < floors; f++) {
      const wy = 2.6 + f * 3.3;
      for (let c = 0; c < cols; c++) {
        const wx = -((cols - 1) * 3.5) / 2 + c * 3.5;
        for (const side of [-1, 1]) {
          const win = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.3), this.windowGlowMat);
          win.position.set(wx, wy, side * (d / 2 + 0.03));
          if (side === -1) win.rotation.y = Math.PI;
          group.add(win);
        }
      }
    }

    if (opts?.signText) {
      const signTex = this.createSignTexture(opts.signText, opts.signColor ?? '#0ea5e9');
      const signMat = new THREE.MeshStandardMaterial({
        map: signTex,
        emissive: new THREE.Color(opts.signColor ?? '#0ea5e9'),
        emissiveIntensity: 0.35,
        roughness: 0.4,
      });
      const signW = Math.min(w - 1.4, 9.8);
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

  private buildSidewalksAndBlocks(): void {
    const sidewalkMat = new THREE.MeshStandardMaterial({
      map: this.createSidewalkTexture(),
      roughness: 0.86,
    });
    const curbMat = new THREE.MeshStandardMaterial({
      color: 0xd1d5db, // Bright Korean granite curb stone (화강암 연석)
      roughness: 0.72,
    });
    const tactileMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15, // Yellow tactile paving strip (점자블록) at crosswalk corners
      roughness: 0.8,
    });
    const bollardMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.55,
      roughness: 0.45,
    });

    // Raised 0.16m Korean sidewalks + granite curbs + yellow tactile blocks + corner bollards for all 25 city blocks!
    const bollardGeo = new THREE.CylinderGeometry(0.08, 0.09, 0.72, 8);
    const bollardMatrices: THREE.Matrix4[] = [];
    const dummy = new THREE.Object3D();

    for (const bx of CITY_BLOCK_CENTERS) {
      for (const bz of CITY_BLOCK_CENTERS) {
        // Sidewalk platform (65.6m x 65.6m)
        const pad = new THREE.Mesh(new THREE.BoxGeometry(65.6, 0.16, 65.6), sidewalkMat);
        pad.position.set(bx, 0.08, bz);
        pad.receiveShadow = true;
        this.root.add(pad);

        // Raised granite curb edging on all 4 sides of each block
        const curbLen = 65.9;
        const curbH = 0.2;
        const curbT = 0.35;
        for (const side of [-1, 1]) {
          const cNS = new THREE.Mesh(new THREE.BoxGeometry(curbLen, curbH, curbT), curbMat);
          cNS.position.set(bx, curbH / 2, bz + side * 32.8);
          const cEW = new THREE.Mesh(new THREE.BoxGeometry(curbT, curbH, curbLen), curbMat);
          cEW.position.set(bx + side * 32.8, curbH / 2, bz);
          this.root.add(cNS, cEW);
        }

        // Yellow tactile corner pads & protective sidewalk bollards
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            const tac = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.02, 2.6), tactileMat);
            tac.position.set(bx + sx * 30.8, 0.17, bz + sz * 30.8);
            this.root.add(tac);

            dummy.position.set(bx + sx * 31.8, 0.52, bz + sz * 31.8);
            dummy.updateMatrix();
            bollardMatrices.push(dummy.matrix.clone());
          }
        }
      }
    }

    const bollards = new THREE.InstancedMesh(bollardGeo, bollardMat, bollardMatrices.length);
    bollardMatrices.forEach((m, i) => bollards.setMatrixAt(i, m));
    this.root.add(bollards);

    // ======================== CENTRAL 9 BLOCKS (Original Core) ========================
    // 1. Central Park Plaza (0, 0)
    const parkGrass = new THREE.Mesh(
      new THREE.PlaneGeometry(52, 52),
      new THREE.MeshStandardMaterial({ color: 0x568b52, roughness: 0.92 })
    );
    parkGrass.rotation.x = -Math.PI / 2;
    parkGrass.position.set(0, 0.17, 0);
    parkGrass.receiveShadow = true;
    this.root.add(parkGrass);

    const fountainBase = new THREE.Mesh(
      new THREE.CylinderGeometry(5.5, 6.0, 0.7, 20),
      new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.6 })
    );
    fountainBase.position.set(0, 0.5, 0);
    const water = new THREE.Mesh(
      new THREE.CylinderGeometry(4.8, 4.8, 0.75, 20),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.15, metalness: 0.2 })
    );
    water.position.set(0, 0.53, 0);
    this.root.add(fountainBase, water);
    this.obstacles.push({ minX: -5.8, maxX: 5.8, minZ: -5.8, maxZ: 5.8 });

    // 2. Main Restaurant / Cafe Strip — Block (-80, 0) right next to player spawn!
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
    this.addBuilding(-80, 14, 42, 12, 16, 0xdbeafe, {
      signText: '24시 마트',
      signColor: '#2563eb',
      signFace: 'N',
    });
    this.zones.push({ name: '상가 거리', x: -78, z: -26, type: 'shop' });

    // 3. South Food Alley — Block (0, -80)
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
    this.addBuilding(0, -96, 38, 14, 14, 0xcbd5e1);
    this.zones.push({ name: '남부 식당가', x: 0, z: -56, type: 'shop' });

    // 4. Haetsal Apartments — Block (+80, +80)
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

    // 5. Green Villa Complex — Block (+80, 0)
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

    // 6. Riverview Apartments — Block (0, +80)
    this.addBuilding(-14, 80, 20, 24, 16, 0xe0f2fe, {
      signText: '리버뷰 201동',
      signColor: '#0284c7',
      signFace: 'S',
      isResidential: true,
    });
    this.addBuilding(15, 80, 20, 26, 16, 0xe2e8f0, {
      signText: '리버뷰 202동',
      signColor: '#0284c7',
      signFace: 'S',
      isResidential: true,
    });
    this.zones.push({ name: '리버뷰 아파트', x: 0, z: 56, type: 'residential' });

    // 7-9. Inner corner blocks
    this.addBuilding(-80, 80, 32, 22, 22, 0xcbd5e1, {
      signText: '타워 오피스',
      signColor: '#334155',
      signFace: 'S',
    });
    this.addBuilding(80, -80, 34, 16, 22, 0xf1f5f9, {
      signText: '스포츠 센터',
      signColor: '#4f46e5',
      signFace: 'N',
    });
    this.addBuilding(-80, -80, 28, 12, 22, 0xe7e5e4, {
      signText: '동네 주민센터',
      signColor: '#0d9488',
      signFace: 'N',
    });

    // ======================== 16 NEW EXPANDED OUTER CITY BLOCKS! ========================
    // West Commercial Strip (-160, 0) -> New Pickup Shops!
    this.addBuilding(-172, -14, 18, 9.5, 15, 0xfef3c7, {
      signText: '돈까스 하우스',
      signColor: '#d97706',
      signFace: 'S',
    });
    this.addBuilding(-148, -14, 18, 9, 15, 0xfee2e2, {
      signText: '마라탕 천국',
      signColor: '#b91c1c',
      signFace: 'S',
    });
    this.addBuilding(-160, 14, 38, 18, 16, 0x94a3b8);
    this.zones.push({ name: '서부 먹자골목', x: -160, z: -26, type: 'shop' });

    // East Commercial Strip (+160, 0) -> New Pickup Shops!
    this.addBuilding(148, -14, 18, 9, 15, 0xffedd5, {
      signText: '국밥 명가',
      signColor: '#9a3412',
      signFace: 'S',
    });
    this.addBuilding(172, -14, 18, 9.5, 15, 0xfce7f3, {
      signText: '베이커리 카페',
      signColor: '#db2777',
      signFace: 'S',
    });
    this.addBuilding(160, 14, 38, 20, 16, 0xdbeafe);
    this.zones.push({ name: '동부 카페거리', x: 160, z: -26, type: 'shop' });

    // North High-Rise Residential — Central Parkview Apartments (0, +160) & (-80, +160)
    this.addBuilding(-14, 150, 20, 30, 15, 0xf1f5f9, {
      signText: '파크뷰 301동',
      signColor: '#0f766e',
      signFace: 'S',
      isResidential: true,
    });
    this.addBuilding(14, 150, 20, 32, 15, 0xe2e8f0, {
      signText: '파크뷰 302동',
      signColor: '#0f766e',
      signFace: 'S',
      isResidential: true,
    });
    this.zones.push({ name: '센트럴 파크뷰', x: 0, z: 136, type: 'residential' });

    // NW Officetel & Skyline (-80, +160) & (-160, +160) & (-160, +80)
    this.addBuilding(-80, 150, 24, 24, 16, 0xe0e7ff, {
      signText: '하늘 오피스텔',
      signColor: '#4338ca',
      signFace: 'S',
      isResidential: true,
    });
    this.addBuilding(-160, 160, 34, 34, 24, 0x94a3b8, {
      signText: '서부 비즈니스 타워',
      signColor: '#1e293b',
      signFace: 'S',
    });
    this.addBuilding(-160, 80, 36, 18, 24, 0xf8fafc, {
      signText: '서울 중앙병원',
      signColor: '#dc2626',
      signFace: 'S',
    });

    // NE Bluehill Apartments & Skyline (+80, +160), (+160, +160), (+160, +80)
    this.addBuilding(80, 150, 24, 29, 15, 0xdbeafe, {
      signText: '블루힐 401동',
      signColor: '#1d4ed8',
      signFace: 'S',
      isResidential: true,
    });
    this.addBuilding(160, 160, 34, 36, 24, 0xcbd5e1, {
      signText: '메트로 스카이타워',
      signColor: '#0369a1',
      signFace: 'S',
    });
    this.addBuilding(160, 80, 36, 22, 24, 0xfef3c7, {
      signText: '스타 백화점',
      signColor: '#b45309',
      signFace: 'S',
    });
    this.zones.push({ name: '블루힐 단지', x: 80, z: 136, type: 'residential' });

    // South Expanded District: (-160, -80), (-160, -160), (-80, -160), (0, -160), (+80, -160), (+160, -160), (+160, -80)
    this.addBuilding(-160, -80, 32, 16, 22, 0xe2e8f0, {
      signText: '시립 도서관',
      signColor: '#0284c7',
      signFace: 'N',
    });
    this.addBuilding(-160, -160, 36, 26, 24, 0x94a3b8);
    this.addBuilding(-80, -160, 32, 22, 22, 0xcbd5e1);
    this.addBuilding(0, -150, 26, 14, 15, 0xf5d0a9, {
      signText: '소나무 빌라',
      signColor: '#15803d',
      signFace: 'N',
      isResidential: true,
    });
    this.zones.push({ name: '소나무 빌라', x: 0, z: -136, type: 'residential' });

    this.addBuilding(80, -160, 34, 24, 22, 0xdbeafe, {
      signText: '남부 테크노파크',
      signColor: '#1e40af',
      signFace: 'N',
    });
    this.addBuilding(160, -160, 34, 30, 24, 0x94a3b8);
    this.addBuilding(160, -80, 34, 20, 24, 0xe7e5e4, {
      signText: '그랜드 마트',
      signColor: '#059669',
      signFace: 'N',
    });
  }

  /**
   * Builds Phase 3 road-facing Service Stations along main boulevard z = -40:
   * 1. K-Oil Self Gas Station (주유소) at Block (-80, -80) north frontage (x=-80, z=-56)
   * 2. Neighborhood Motorcycle Repair Center (동네 오토바이 센터) at Block (+80, -80) north frontage (x=78, z=-57)
   */
  private buildServiceStations(): void {
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.65 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.45 });
    const yellowMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      emissive: 0xeab308,
      emissiveIntensity: 0.4,
    });
    const redMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.4 });
    const tealMat = new THREE.MeshStandardMaterial({ color: 0x0d9488, roughness: 0.4 });
    const orangeMat = new THREE.MeshStandardMaterial({ color: 0xea580c, roughness: 0.45 });
    const screenMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.85,
    });

    // ================= 1. ⛽ K-OIL SELF GAS STATION (x = -80, z = -56) =================
    const gas = new THREE.Group();
    gas.position.set(-80, 0.16, -56);

    // Concrete forecourt pad + yellow safety border marking (주유 패드 구역!)
    const gasPad = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 12),
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.78 })
    );
    gasPad.rotation.x = -Math.PI / 2;
    gasPad.position.y = 0.025;
    gasPad.receiveShadow = true;
    gas.add(gasPad);

    const padEdgeH = new THREE.BoxGeometry(18, 0.04, 0.28);
    const padEdgeV = new THREE.BoxGeometry(0.28, 0.04, 12);
    for (const s of [-1, 1]) {
      const eh = new THREE.Mesh(padEdgeH, yellowMat);
      eh.position.set(0, 0.03, s * 5.86);
      const ev = new THREE.Mesh(padEdgeV, yellowMat);
      ev.position.set(s * 8.86, 0.03, 0);
      gas.add(eh, ev);
    }

    // Overhead illuminated canopy & 4 columns
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(17.5, 0.9, 9.2), whiteMat);
    canopy.position.set(0, 4.7, -0.4);
    canopy.castShadow = true;
    const fascia = new THREE.Mesh(new THREE.BoxGeometry(17.7, 0.55, 9.4), tealMat);
    fascia.position.set(0, 4.95, -0.4);
    gas.add(canopy, fascia);

    const gasSignTex = this.createSignTexture('⛽ K-오일 셀프주유소', '#0f766e', '#fef08a');
    const gasSignMat = new THREE.MeshStandardMaterial({
      map: gasSignTex,
      emissive: 0x14b8a6,
      emissiveIntensity: 0.45,
    });
    const gasSignN = new THREE.Mesh(new THREE.PlaneGeometry(11.5, 1.3), gasSignMat);
    gasSignN.position.set(0, 4.95, 4.35);
    const gasSignS = new THREE.Mesh(new THREE.PlaneGeometry(11.5, 1.3), gasSignMat);
    gasSignS.position.set(0, 4.95, -5.15);
    gasSignS.rotation.y = Math.PI;
    gas.add(gasSignN, gasSignS);

    for (const px of [-6.5, 6.5]) {
      for (const pz of [-3.2, 2.4]) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.55, 4.5, 0.55), whiteMat);
        pillar.position.set(px, 2.25, pz);
        pillar.castShadow = true;
        gas.add(pillar);
        this.obstacles.push({
          minX: -80 + px - 0.35,
          maxX: -80 + px + 0.35,
          minZ: -56 + pz - 0.35,
          maxZ: -56 + pz + 0.35,
        });
      }
    }

    // Central Self-Service Fuel Pump Island (x = -80, z = -56)
    const island = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.22, 1.4), whiteMat);
    island.position.set(0, 0.11, 0);
    gas.add(island);
    for (const dx of [-1.2, 1.2]) {
      const pumpBody = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.75, 0.65), redMat);
      pumpBody.position.set(dx, 1.0, 0);
      pumpBody.castShadow = true;
      const pumpTop = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.28, 0.72), yellowMat);
      pumpTop.position.set(dx, 1.98, 0);
      const pumpScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.44), screenMat);
      pumpScreen.position.set(dx, 1.38, 0.34);
      const pumpScreenBack = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.44), screenMat);
      pumpScreenBack.position.set(dx, 1.38, -0.34);
      pumpScreenBack.rotation.y = Math.PI;
      gas.add(pumpBody, pumpTop, pumpScreen, pumpScreenBack);
    }
    this.obstacles.push({ minX: -82.2, maxX: -77.8, minZ: -56.7, maxZ: -55.3 });

    // Price Totem Sign at roadside corner
    const totem = new THREE.Mesh(new THREE.BoxGeometry(1.5, 4.6, 0.55), darkMat);
    totem.position.set(-8.6, 2.3, 4.4);
    const priceTex = this.createSignTexture('휘발유 ₩40/1%', '#1e293b', '#4ade80');
    const priceFace = new THREE.Mesh(
      new THREE.PlaneGeometry(1.38, 1.2),
      new THREE.MeshBasicMaterial({ map: priceTex })
    );
    priceFace.position.set(-8.6, 3.4, 4.7);
    gas.add(totem, priceFace);
    this.obstacles.push({ minX: -89.4, maxX: -87.8, minZ: -52.0, maxZ: -51.1 });

    this.root.add(gas);
    this.serviceStations.push({
      name: 'K-오일 셀프주유소',
      kind: 'gas',
      padMinX: -89,
      padMaxX: -71,
      padMinZ: -62.5,
      padMaxZ: -48.5,
      interactX: -80,
      interactZ: -56,
      interactRadius: 4.0,
    });
    this.zones.push({ name: 'K-오일 주유소', x: -80, z: -50, type: 'shop' });

    // ================= 2. 🔧 NEIGHBORHOOD MOTORCYCLE REPAIR CENTER (x = 78, z = -57) =================
    const rep = new THREE.Group();
    rep.position.set(78, 0.16, -57);

    // Orange-bordered service bay pad in front of garage (z = -57..-49)
    const repPad = new THREE.Mesh(
      new THREE.PlaneGeometry(15, 9),
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.8 })
    );
    repPad.rotation.x = -Math.PI / 2;
    repPad.position.set(0, 0.025, 2.2);
    repPad.receiveShadow = true;
    rep.add(repPad);

    const rEdgeH = new THREE.BoxGeometry(15, 0.04, 0.25);
    const rEdgeV = new THREE.BoxGeometry(0.25, 0.04, 9);
    for (const s of [-1, 1]) {
      const eh = new THREE.Mesh(rEdgeH, orangeMat);
      eh.position.set(0, 0.03, 2.2 + s * 4.38);
      const ev = new THREE.Mesh(rEdgeV, orangeMat);
      ev.position.set(s * 7.38, 0.03, 2.2);
      rep.add(eh, ev);
    }

    // Garage Structure (back half of lot, leaving spacious pad facing road z = -40!)
    const garageBody = new THREE.Mesh(new THREE.BoxGeometry(14, 4.6, 5.2), darkMat);
    garageBody.position.set(0, 2.3, -4.8);
    garageBody.castShadow = true;
    garageBody.receiveShadow = true;
    const garageTrim = new THREE.Mesh(new THREE.BoxGeometry(14.3, 0.45, 5.5), orangeMat);
    garageTrim.position.set(0, 4.65, -4.8);
    const garageAwning = new THREE.Mesh(new THREE.BoxGeometry(13.6, 0.24, 3.2), orangeMat);
    garageAwning.position.set(0, 3.4, -1.1);

    const repSignTex = this.createSignTexture('🔧 번개 오토바이 센터', '#ea580c', '#ffffff');
    const repSign = new THREE.Mesh(
      new THREE.PlaneGeometry(11.2, 1.35),
      new THREE.MeshStandardMaterial({
        map: repSignTex,
        emissive: 0xf97316,
        emissiveIntensity: 0.4,
      })
    );
    repSign.position.set(0, 4.15, -2.14);

    // Open service bay interior & red tool chest
    const bayDoor = new THREE.Mesh(
      new THREE.PlaneGeometry(7.2, 2.9),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 })
    );
    bayDoor.position.set(-1.5, 1.48, -2.18);
    const toolChest = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.15, 0.7), redMat);
    toolChest.position.set(4.5, 0.58, -1.7);
    const counterDesk = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.05, 0.8), whiteMat);
    counterDesk.position.set(2.4, 0.52, -1.7);

    rep.add(garageBody, garageTrim, garageAwning, repSign, bayDoor, toolChest, counterDesk);
    this.obstacles.push({ minX: 71, maxX: 85, minZ: -64.6, maxZ: -59.0 });

    this.root.add(rep);
    this.serviceStations.push({
      name: '번개 오토바이 센터',
      kind: 'repair',
      padMinX: 70,
      padMaxX: 86,
      padMinZ: -60.5,
      padMaxZ: -49.5,
      interactX: 79.5,
      interactZ: -57.2,
      interactRadius: 4.4,
    });
    this.zones.push({ name: '오토바이 정비센터', x: 78, z: -50, type: 'shop' });
  }

  public isScooterOnGasPad(x: number, z: number): boolean {
    const s = this.serviceStations.find((st) => st.kind === 'gas');
    if (!s) return false;
    return x >= s.padMinX && x <= s.padMaxX && z >= s.padMinZ && z <= s.padMaxZ;
  }

  public isPlayerNearGasPump(x: number, z: number): boolean {
    const s = this.serviceStations.find((st) => st.kind === 'gas');
    if (!s) return false;
    return Math.hypot(x - s.interactX, z - s.interactZ) <= s.interactRadius;
  }

  public isScooterOnRepairPad(x: number, z: number): boolean {
    const s = this.serviceStations.find((st) => st.kind === 'repair');
    if (!s) return false;
    return x >= s.padMinX && x <= s.padMaxX && z >= s.padMinZ && z <= s.padMaxZ;
  }

  public isPlayerNearRepairShop(x: number, z: number): boolean {
    const s = this.serviceStations.find((st) => st.kind === 'repair');
    if (!s) return false;
    return Math.hypot(x - s.interactX, z - s.interactZ) <= s.interactRadius;
  }

  /**
   * Builds 8 realistic Korean Bus Stops (버스정류장) along main boulevards
   * with shelters, benches, BIT LED signs, and yellow road bus bays!
   */
  private buildBusStops(): void {
    // roadIndex in [-200(0), -120(1), -40(2), 40(3), 120(4), 200(5)]
    const defs: BusStopPoint[] = [
      // Along z = -40 (roadIndex 2): Eastbound (+X, dir=1, lane z=-36.5, sidewalk z=-31)
      { name: '중앙공원 남문', x: -12, z: -36.5, shelterX: -12, shelterZ: -31.2, dir: 1, roadIndex: 2 },
      { name: '동부 카페거리', x: 148, z: -36.5, shelterX: 148, shelterZ: -31.2, dir: 1, roadIndex: 2 },
      // Along z = -40 (roadIndex 2): Westbound (-X, dir=3, lane z=-43.5, sidewalk z=-49)
      { name: '남부 식당가', x: 14, z: -43.5, shelterX: 14, shelterZ: -48.8, dir: 3, roadIndex: 2 },
      { name: '서부 도서관 앞', x: -146, z: -43.5, shelterX: -146, shelterZ: -48.8, dir: 3, roadIndex: 2 },
      // Along z = +40 (roadIndex 3): Eastbound (+X, dir=1, lane z=43.5, sidewalk z=49)
      { name: '리버뷰 아파트', x: -14, z: 43.5, shelterX: -14, shelterZ: 48.8, dir: 1, roadIndex: 3 },
      { name: '햇살 아파트', x: 78, z: 43.5, shelterX: 78, shelterZ: 48.8, dir: 1, roadIndex: 3 },
      // Along z = +40 (roadIndex 3): Westbound (-X, dir=3, lane z=36.5, sidewalk z=31)
      { name: '중앙공원 북문', x: 14, z: 36.5, shelterX: 14, shelterZ: 31.2, dir: 3, roadIndex: 3 },
      { name: '상가거리 북문', x: -82, z: 36.5, shelterX: -82, shelterZ: 31.2, dir: 3, roadIndex: 3 },
    ];

    const steelMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.65, roughness: 0.35 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.36,
      roughness: 0.15,
    });
    const benchMat = new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.8 });
    const bayMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
    const signBoardTex = this.createSignTexture('🚌 BUS 101 · 402', '#1d4ed8', '#ffffff');
    const signBoardMat = new THREE.MeshStandardMaterial({
      map: signBoardTex,
      emissive: 0x1e40af,
      emissiveIntensity: 0.5,
    });

    for (const stop of defs) {
      this.busStops.push(stop);

      const g = new THREE.Group();
      g.position.set(stop.shelterX, 0.16, stop.shelterZ);
      // dir 1 (+X Eastbound) shelter is on north sidewalk (+Z) facing South (-Z, rotY = PI)
      // dir 3 (-X Westbound) shelter is on south sidewalk (-Z) facing North (+Z, rotY = 0)
      if (stop.dir === 1) {
        g.rotation.y = Math.PI;
      }

      // Canopy roof & 2 rear pillars
      const roof = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.16, 2.0), steelMat);
      roof.position.set(0, 2.65, 0);
      roof.castShadow = true;
      g.add(roof);

      for (const sx of [-2.4, 2.4]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.65, 8), steelMat);
        post.position.set(sx, 1.32, -0.75);
        g.add(post);
      }

      // Back wind-shield glass panel
      const backGlass = new THREE.Mesh(new THREE.BoxGeometry(4.8, 2.1, 0.08), glassMat);
      backGlass.position.set(0, 1.35, -0.75);
      g.add(backGlass);

      // Waiting bench
      const bench = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.12, 0.55), benchMat);
      bench.position.set(0, 0.52, -0.35);
      g.add(bench);

      // Tall Korean Blue Bus Stop Signpost + BIT LED arrival board
      const signPole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.3, 8), steelMat);
      signPole.position.set(3.2, 1.65, 0.25);
      const signPanel = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.55, 0.14), signBoardMat);
      signPanel.position.set(3.2, 2.95, 0.25);
      g.add(signPole, signPanel);

      this.root.add(g);

      // Painted Yellow Bus Bay box on the asphalt in front of the shelter!
      const bayL = 12.5;
      const bayW = 3.8;
      for (const zOff of [-bayW / 2, bayW / 2]) {
        const line = new THREE.Mesh(new THREE.PlaneGeometry(bayL, 0.22), bayMat);
        line.rotation.x = -Math.PI / 2;
        line.position.set(stop.x, 0.044, stop.z + zOff);
        this.root.add(line);
      }
      for (const xOff of [-bayL / 2, bayL / 2]) {
        const line = new THREE.Mesh(new THREE.PlaneGeometry(0.22, bayW), bayMat);
        line.rotation.x = -Math.PI / 2;
        line.position.set(stop.x + xOff, 0.044, stop.z);
        this.root.add(line);
      }
    }
  }

  private buildStreetFurniture(): void {
    // Streetlamps at key block corners
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.6, roughness: 0.4 });
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 6.2, 6);
    const lampGeo = new THREE.BoxGeometry(0.55, 0.14, 0.28);

    const lampOffsets = [-191, -111, -31, 31, 111, 191];
    for (const cx of lampOffsets) {
      for (const cz of lampOffsets) {
        const g = new THREE.Group();
        g.position.set(cx, 0.16, cz);
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.y = 3.1;
        const lamp = new THREE.Mesh(lampGeo, this.lampGlowMat);
        lamp.position.y = 6.2;
        g.add(pole, lamp);
        this.root.add(g);
      }
    }

    // Street trees in Central Park, along wide sidewalks, and outer greenbelt (InstancedMesh!)
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
    for (let p = -235; p <= 235; p += 24) {
      treeCoords.push([p, -248, 1.2]);
      treeCoords.push([p, 248, 1.2]);
      treeCoords.push([-248, p, 1.2]);
      treeCoords.push([248, p, 1.2]);
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

  private initDeliveryLocations(): void {
    this.locations.push(
      // 9 Pickup Shops (5 core + 4 new outer commercial strips!)
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
        facesNorth: true,
        menus: ['더블치즈 버거 세트', '베이컨 BBQ 버거 + 감튀', '크리스피 치킨버거 세트'],
      },
      {
        id: 'shop-pizza',
        name: '화덕 피자',
        x: 14,
        z: -58.5,
        type: 'shop',
        emoji: '🍕',
        facesNorth: true,
        menus: ['페퍼로니 라지 피자', '콤비네이션 피자 + 스파게티', '고르곤졸라 + 갈릭디핑'],
      },
      {
        id: 'shop-katsu',
        name: '돈까스 하우스',
        x: -172,
        z: -25.5,
        type: 'shop',
        emoji: '🍛',
        menus: ['등심 돈까스 정식', '치즈 돈까스 + 우동 세트', '안심 카츠 + 카레'],
      },
      {
        id: 'shop-mara',
        name: '마라탕 천국',
        x: -148,
        z: -25.5,
        type: 'shop',
        emoji: '🍲',
        menus: ['마라탕 2단계 + 꿔바로우', '마라샹궈 2인 세트', '계란볶음밥 + 마라탕'],
      },
      {
        id: 'shop-gukbap',
        name: '국밥 명가',
        x: 148,
        z: -25.5,
        type: 'shop',
        emoji: '🍚',
        menus: ['돼지국밥 특 + 수육', '순대국밥 2인 세트', '얼큰 육개장 정식'],
      },
      {
        id: 'shop-bakery',
        name: '베이커리 카페',
        x: 172,
        z: -25.5,
        type: 'shop',
        emoji: '🥐',
        menus: ['소금빵 4개 + 아메리카노', '생크림 케이크 박스', '샌드위치 + 라떼 세트'],
      },

      // 12 Residential Delivery Buildings (7 core + 5 new outer complexes!)
      { id: 'res-sun-101', name: '햇살 아파트 101동', x: 68, z: 55, type: 'residential', emoji: '🏢' },
      { id: 'res-sun-102', name: '햇살 아파트 102동', x: 94, z: 81, type: 'residential', emoji: '🏢' },
      { id: 'res-villa-a', name: '그린빌라 A동', x: 66, z: -23.5, type: 'residential', emoji: '🏠' },
      { id: 'res-villa-b', name: '그린빌라 B동', x: 92, z: -23.5, type: 'residential', emoji: '🏠' },
      { id: 'res-villa-c', name: '그린빌라 C동', x: 79, z: 25, type: 'residential', emoji: '🏠', facesNorth: true },
      { id: 'res-river-201', name: '리버뷰 201동', x: -14, z: 68, type: 'residential', emoji: '🏢' },
      { id: 'res-river-202', name: '리버뷰 202동', x: 15, z: 68, type: 'residential', emoji: '🏢' },
      { id: 'res-park-301', name: '파크뷰 301동', x: -14, z: 138.5, type: 'residential', emoji: '🏢' },
      { id: 'res-park-302', name: '파크뷰 302동', x: 14, z: 138.5, type: 'residential', emoji: '🏢' },
      { id: 'res-sky-off', name: '하늘 오피스텔', x: -80, z: 138, type: 'residential', emoji: '🏬' },
      { id: 'res-blue-401', name: '블루힐 401동', x: 80, z: 138.5, type: 'residential', emoji: '🏢' },
      { id: 'res-pine-villa', name: '소나무 빌라', x: 0, z: -138.5, type: 'residential', emoji: '🏠', facesNorth: true }
    );
  }

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
      const facesNorth = Boolean(loc.facesNorth);
      const wallOffsetZ = facesNorth ? -2.9 : 2.9;

      if (loc.type === 'shop') {
        const g = new THREE.Group();
        g.position.set(loc.x, 0.16, loc.z + wallOffsetZ);
        if (!facesNorth) g.rotation.y = Math.PI;

        const counter = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.05, 0.72), counterMat);
        counter.position.set(0, 0.52, 0.36);
        counter.castShadow = true;
        g.add(counter);

        const windowFrame = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.2, 0.18), darkMat);
        windowFrame.position.set(0, 1.65, 0.1);
        g.add(windowFrame);

        const posStand = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.34, 0.24), darkMat);
        posStand.position.set(0.85, 1.18, 0.45);
        posStand.rotation.x = -0.35;
        const posScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.22), screenMat);
        posScreen.position.set(0.85, 1.21, 0.58);
        posScreen.rotation.x = -0.35;

        // Outdoor Pickup Counter Tray + Spawnable 3D Food Bag + Cooking/Ready Status Lamp!
        const tray = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.032, 0.42), darkMat);
        tray.position.set(-0.35, 1.06, 0.36);
        const trayLedMat = new THREE.MeshStandardMaterial({
          color: 0x1e293b,
          emissive: 0xfacc15,
          emissiveIntensity: 0.05,
        });
        const trayLed = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.035, 0.03), trayLedMat);
        trayLed.position.set(-0.35, 1.07, 0.57);

        const trayBag = HandheldFoodBag3D.createFoodBagMesh();
        trayBag.position.set(-0.35, 1.21, 0.36);
        trayBag.scale.set(1.12, 1.12, 1.12);
        trayBag.visible = false;

        this.shopTrays.set(loc.id, { bag: trayBag, ledMat: trayLedMat });
        g.add(posStand, posScreen, tray, trayLed, trayBag);

        this.root.add(g);
      } else {
        const g = new THREE.Group();
        g.position.set(loc.x, 0.16, loc.z + wallOffsetZ);
        if (!facesNorth) g.rotation.y = Math.PI;

        const archFrame = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.75, 0.45), darkMat);
        archFrame.position.set(0, 1.38, 0.2);
        const innerCut = new THREE.Mesh(
          new THREE.BoxGeometry(2.5, 2.45, 0.48),
          new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 })
        );
        innerCut.position.set(0, 1.24, 0.18);
        g.add(archFrame, innerCut);

        const leftDoor = new THREE.Mesh(new THREE.BoxGeometry(1.18, 2.38, 0.08), glassDoorMat);
        leftDoor.position.set(-0.6, 1.2, 0.46);
        const rightDoor = new THREE.Mesh(new THREE.BoxGeometry(1.18, 2.38, 0.08), glassDoorMat);
        rightDoor.position.set(0.6, 1.2, 0.46);
        g.add(leftDoor, rightDoor);

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

  /** Spawns 3D takeout bags on shop pickup trays when ready, and pulses amber/emerald status LEDs */
  public syncShopPickupTrays(
    cookingShopIds: Set<string>,
    readyShopIds: Set<string>,
    elapsedTime: number
  ): void {
    const pulse = 0.5 + 0.5 * Math.sin(elapsedTime * 5.5);
    for (const [shopId, entry] of this.shopTrays.entries()) {
      const isReady = readyShopIds.has(shopId);
      const isCooking = cookingShopIds.has(shopId);
      entry.bag.visible = isReady;
      if (isReady) {
        entry.ledMat.emissive.setHex(0x22c55e);
        entry.ledMat.emissiveIntensity = 1.6 + pulse * 1.4;
      } else if (isCooking) {
        entry.ledMat.emissive.setHex(0xfacc15);
        entry.ledMat.emissiveIntensity = 1.0 + pulse * 1.6;
      } else {
        entry.ledMat.emissiveIntensity = 0.05;
      }
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

    const pulse = 1 + Math.sin(elapsedTime * 4.2) * 0.1;
    this.beaconRing.scale.set(pulse, pulse, 1);
  }

  public setOutdoorVisible(visible: boolean): void {
    this.root.visible = visible;
    if (!visible) {
      this.scene.background = new THREE.Color(0x11151c);
      this.scene.fog = null;
    } else {
      this.applySkyTheme();
    }
  }

  public setWeather(mode: WeatherMode): void {
    this.weatherMode = mode;
    if (this.root.visible) {
      this.applySkyTheme();
    }
  }

  /** Smoothly updates wet asphalt shader parameters, roughness, and puddle sheen */
  public updateWeatherVisuals(rainIntensity: number, elapsedTime: number): void {
    this.roadShaderUniforms.uRainWetness.value = rainIntensity;
    this.roadShaderUniforms.uTime.value = elapsedTime;

    const wetMetal = 0.04 + rainIntensity * 0.34;
    const wetTint = 1.0 - rainIntensity * 0.32;
    this.asphaltHMat.metalness = wetMetal;
    this.asphaltVMat.metalness = wetMetal;
    this.asphaltHMat.color.setRGB(wetTint * 0.95, wetTint * 0.98, wetTint * 1.05);
    this.asphaltVMat.color.setRGB(wetTint * 0.95, wetTint * 0.98, wetTint * 1.05);

    this.crosswalkPaintMat.roughness = 0.78 - rainIntensity * 0.62;
    this.crosswalkPaintMat.metalness = 0.05 + rainIntensity * 0.25;

    this.manholeMat.roughness = 0.55 - rainIntensity * 0.43;
    this.manholeMat.metalness = 0.78 + rainIntensity * 0.16;
  }

  private applySkyTheme(): void {
    const isRain = this.weatherMode === 'rain';
    const isCloudy = this.weatherMode === 'cloudy';

    if (this.isNight) {
      const bgHex = isRain ? 0x060b14 : isCloudy ? 0x09101d : 0x0b1220;
      const fogDensity = isRain ? 0.0052 : isCloudy ? 0.004 : 0.0034;
      this.scene.background = new THREE.Color(bgHex);
      this.scene.fog = new THREE.FogExp2(bgHex, fogDensity);
      this.dirLight.intensity = isRain ? 0.15 : isCloudy ? 0.2 : 0.25;
      this.dirLight.color.setHex(isRain ? 0x6b88b0 : 0x8aa8d6);
      this.hemiLight.intensity = isRain ? 0.22 : 0.28;
      this.lampGlowMat.emissiveIntensity = isRain ? 3.8 : 3.2;
      this.windowGlowMat.emissiveIntensity = isRain ? 1.3 : 1.1;
    } else if (isRain) {
      // Rainy daytime: overcast stormy slate sky, toned-down lighting & thick mist fog!
      this.scene.background = new THREE.Color(0x5b6d80);
      this.scene.fog = new THREE.FogExp2(0x5b6d80, 0.0048);
      this.dirLight.intensity = 0.52;
      this.dirLight.color.setHex(0xb8cde0);
      this.hemiLight.intensity = 0.58;
      this.lampGlowMat.emissiveIntensity = 1.45;
      this.windowGlowMat.emissiveIntensity = 0.42;
    } else if (isCloudy) {
      this.scene.background = new THREE.Color(0x889cb0);
      this.scene.fog = new THREE.FogExp2(0x889cb0, 0.0028);
      this.dirLight.intensity = 0.92;
      this.dirLight.color.setHex(0xdce6f2);
      this.hemiLight.intensity = 0.74;
      this.lampGlowMat.emissiveIntensity = 0.45;
      this.windowGlowMat.emissiveIntensity = 0.2;
    } else {
      this.scene.background = new THREE.Color(0x93c5fd);
      this.scene.fog = new THREE.FogExp2(0xa5d4fb, 0.0018);
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
