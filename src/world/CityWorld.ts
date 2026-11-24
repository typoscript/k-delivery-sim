import * as THREE from 'three';
import { HandheldFoodBag3D } from '../player/HandheldFoodBag3D';
import {
  BusStopPoint,
  CITY_BLOCK_CENTERS,
  CITY_ROAD_LINES,
  CITY_WORLD_LIMIT,
  CityZoneMarker,
  ConstructionZoneMarker,
  DeliveryLocation,
  LandmarkMarker,
  ObstacleBox,
  PolicePatrolMarker,
  RivalRiderMarker,
  ServiceStationInfo,
  SlipSurfaceType,
  SpeedBumpInfo,
  SpeedCameraMarker,
  UpcomingCameraAlert,
  WeatherMode,
} from '../types';
import { ACTIVE_DISTRICT, ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import { SuwonLandmarksBuilder } from './SuwonLandmarks';

export interface MapBuildingFootprint {
  x: number;
  z: number;
  w: number;
  d: number;
  pts?: Array<[number, number]>;
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
  policePatrols?: PolicePatrolMarker[];
  constructionZones?: ConstructionZoneMarker[];
  rivalRiders?: RivalRiderMarker[];
  speedBumps?: SpeedBumpInfo[];
  landmarks?: LandmarkMarker[];
  upcomingCamera?: UpcomingCameraAlert | null;
  obstacles: ObstacleBox[];
  buildings: MapBuildingFootprint[];
}

interface SignalHazardZone {
  x: number;
  z: number;
  manholes: Array<[number, number]>;
  crosswalkRadius: number;
}

/**
 * Real OpenStreetMap 3D City World for Suwon-si Paldal-gu Ingye-dong (Suwon City Hall Station area).
 * Renders 218 real connected Suwon roads (효원로, 권광로, 경수대로, 권선로, 나혜석거리),
 * 322 extruded real buildings, 4 parks (효원공원), Suwon City Hall Station landmark,
 * 10 real local shops, 12 real residences (including 4 walk-up villas), 8 Suwon bus stops,
 * 14 rotated speed bumps, wet-road PBR puddle shader, and self-service gas/repair stations!
 */
export class CityWorld {
  public readonly root = new THREE.Group();
  public readonly obstacles: ObstacleBox[] = [];
  public readonly zones: CityZoneMarker[] = [];
  public readonly buildings: MapBuildingFootprint[] = [];
  public readonly locations: DeliveryLocation[] = [];
  public readonly busStops: BusStopPoint[] = [];
  public readonly serviceStations: ServiceStationInfo[] = [];
  public readonly speedBumps: SpeedBumpInfo[] = [];
  public readonly landmarks: LandmarkMarker[] = [];
  public readonly mapInfo: CityMapInfo;
  private landmarksBuilder?: SuwonLandmarksBuilder;

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

  private readonly beaconGroup = new THREE.Group();
  private readonly beaconRingMat: THREE.MeshBasicMaterial;
  private readonly beaconRing: THREE.Mesh;

  public isNight = false;
  public weatherMode: WeatherMode = 'clear';

  // Wet-road shader & slip-surface materials
  private asphaltMat!: THREE.MeshStandardMaterial;
  private crosswalkPaintMat!: THREE.MeshStandardMaterial;
  private manholeMat!: THREE.MeshStandardMaterial;
  private readonly roadShaderUniforms = {
    uRainWetness: { value: 0 },
    uTime: { value: 0 },
  };
  private readonly signalHazardZones: SignalHazardZone[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    scene.add(this.root);

    scene.background = new THREE.Color(0x93c5fd);
    scene.fog = new THREE.FogExp2(0xa5d4fb, 0.00145);

    this.hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0x475569, 0.92);
    this.root.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xfff7e6, 1.48);
    this.dirLight.position.set(160, 240, 120);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.set(2048, 2048);
    this.dirLight.shadow.camera.near = 20;
    this.dirLight.shadow.camera.far = 780;
    const d = 310;
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
      emissiveIntensity: 0.14,
      roughness: 0.3,
    });

    this.beaconRingMat = new THREE.MeshBasicMaterial({
      color: 0xf97316,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
    });
    this.beaconRing = new THREE.Mesh(new THREE.RingGeometry(2.1, 2.7, 28), this.beaconRingMat);
    this.beaconRing.rotation.x = -Math.PI / 2;
    this.beaconRing.position.y = 0.22;
    this.beaconGroup.add(this.beaconRing);
    this.beaconGroup.visible = false;
    this.root.add(this.beaconGroup);

    this.mapInfo = {
      roadLines: CITY_ROAD_LINES,
      blockCenters: CITY_BLOCK_CENTERS,
      roadWidth: 12,
      zones: this.zones,
      busStops: this.busStops,
      serviceStations: this.serviceStations,
      speedBumps: this.speedBumps,
      landmarks: this.landmarks,
      obstacles: this.obstacles,
      buildings: this.buildings,
    };

    this.buildBaseGround();
    this.buildSuwonOsmRoads();
    this.buildSpeedBumps();
    this.buildParksAndTrees();
    this.buildSuwonOsmBuildings();
    this.buildSuwonStationLandmark();
    this.buildServiceStations();
    this.buildBusStops();
    this.initDeliveryLocations();
    this.buildPickupWindowsAndLobbies();
    this.buildStreetLamps();
  }

  private createAsphaltTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#2d343e';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1600; i++) {
      const v = 36 + Math.floor(Math.random() * 22);
      ctx.fillStyle = `rgb(${v},${v + 3},${v + 6})`;
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 2);
    return tex;
  }

  private createSidewalkTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#b4b8bf';
    ctx.fillRect(0, 0, 128, 128);
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        ctx.fillStyle = (row + col) % 2 === 0 ? '#aeb3bc' : '#babdc3';
        ctx.fillRect(col * 32 + 1, row * 32 + 1, 30, 30);
      }
    }
    ctx.strokeStyle = 'rgba(71, 85, 105, 0.3)';
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
    tex.repeat.set(110, 110);
    return tex;
  }

  private createFacadeTexture(baseHex: string, winHex: string, cols = 4, rows = 6): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, 256, 256);

    const cw = 256 / cols;
    const rh = 256 / rows;
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        ctx.fillStyle = winHex;
        ctx.fillRect(col * cw + 7, r * rh + 6, cw - 14, rh - 14);
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.fillRect(col * cw + 9, r * rh + 8, (cw - 18) * 0.45, (rh - 18) * 0.4);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(0.08, 0.08);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private createSignTexture(title: string, bg: string, fg = '#ffffff'): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = 'rgba(255,255,255,0.38)';
    ctx.lineWidth = 6;
    ctx.strokeRect(6, 6, 500, 116);
    ctx.fillStyle = fg;
    ctx.font = 'bold 46px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, 256, 66);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  private createPuddleRoughnessTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#adadad';
    ctx.fillRect(0, 0, 256, 256);

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
    tex.repeat.set(2, 2);
    return tex;
  }

  private createManholeTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#3b424c';
    ctx.fillRect(0, 0, 128, 128);
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
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private createSpeedBumpTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#facc15';
    for (let x = -64; x < 320; x += 36) {
      ctx.beginPath();
      ctx.moveTo(x, 64);
      ctx.lineTo(x + 18, 64);
      ctx.lineTo(x + 36, 0);
      ctx.lineTo(x + 18, 0);
      ctx.closePath();
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 4);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private enhanceWetAsphaltMaterial(mat: THREE.MeshStandardMaterial): void {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uRainWetness = this.roadShaderUniforms.uRainWetness;
      shader.uniforms.uTime = this.roadShaderUniforms.uTime;

      shader.fragmentShader =
        'uniform float uRainWetness;\nuniform float uTime;\n' +
        shader.fragmentShader
          .replace(
            '#include <roughnessmap_fragment>',
            `#include <roughnessmap_fragment>
          float puddleMask = 1.0 - smoothstep(0.08, 0.55, roughnessFactor);
          roughnessFactor = mix(0.90, mix(0.32, 0.055, puddleMask), uRainWetness);`
          )
          .replace(
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

  private buildBaseGround(): void {
    // Outer Suwon suburban backdrop greenbelt
    const outerGround = new THREE.Mesh(
      new THREE.PlaneGeometry(1400, 1400),
      new THREE.MeshStandardMaterial({ color: 0x527358, roughness: 0.95 })
    );
    outerGround.rotation.x = -Math.PI / 2;
    outerGround.position.y = -0.02;
    this.root.add(outerGround);

    // Korean urban sidewalk interlocking brick base across playable Suwon Ingye-dong district
    const sidewalkBase = new THREE.Mesh(
      new THREE.PlaneGeometry(CITY_WORLD_LIMIT * 2, CITY_WORLD_LIMIT * 2),
      new THREE.MeshStandardMaterial({ map: this.createSidewalkTexture(), roughness: 0.88 })
    );
    sidewalkBase.rotation.x = -Math.PI / 2;
    sidewalkBase.position.y = 0;
    sidewalkBase.receiveShadow = true;
    this.root.add(sidewalkBase);

    // Subtle perimeter boundary walls at ±CITY_WORLD_LIMIT
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.8 });
    const lim = CITY_WORLD_LIMIT;
    const walls: Array<[number, number, number, number]> = [
      [0, lim, lim * 2, 1.4],
      [0, -lim, lim * 2, 1.4],
      [lim, 0, 1.4, lim * 2],
      [-lim, 0, 1.4, lim * 2],
    ];
    for (const [x, z, w, l] of walls) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.4, l), wallMat);
      m.position.set(x, 0.7, z);
      this.root.add(m);
    }
  }

  /** Renders all 218 real Suwon Ingye-dong OSM roads, 나혜석거리 pedestrian plaza, crosswalks & manholes */
  private buildSuwonOsmRoads(): void {
    this.asphaltMat = new THREE.MeshStandardMaterial({
      map: this.createAsphaltTexture(),
      roughnessMap: this.createPuddleRoughnessTexture(),
      roughness: 0.9,
      metalness: 0.04,
    });
    this.enhanceWetAsphaltMaterial(this.asphaltMat);

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

    const yellowLineMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
    const whiteEdgeMat = new THREE.MeshBasicMaterial({ color: 0xe2e8f0 });
    const plazaMat = new THREE.MeshStandardMaterial({ color: 0xc29e83, roughness: 0.84 });

    const nodes = ACTIVE_MAP_DATA.nodes;
    const edges = ACTIVE_MAP_DATA.edges;

    // Track max width incident to each node for smooth circular asphalt junction caps
    const nodeMaxW = new Float32Array(nodes.length);

    for (const e of edges) {
      const na = nodes[e.a];
      const nb = nodes[e.b];
      const dx = nb.x - na.x;
      const dz = nb.z - na.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.5) continue;

      nodeMaxW[e.a] = Math.max(nodeMaxW[e.a], e.width);
      nodeMaxW[e.b] = Math.max(nodeMaxW[e.b], e.width);

      const mx = (na.x + nb.x) * 0.5;
      const mz = (na.z + nb.z) * 0.5;
      const heading = Math.atan2(dx, dz); // 0 = +Z

      const yLevel = e.isMajor ? 0.042 : 0.032;
      const roadMesh = new THREE.Mesh(new THREE.PlaneGeometry(e.width, len), this.asphaltMat);
      roadMesh.rotation.order = 'YXZ';
      roadMesh.rotation.y = heading;
      roadMesh.rotation.x = -Math.PI / 2;
      roadMesh.position.set(mx, yLevel, mz);
      roadMesh.receiveShadow = true;
      this.root.add(roadMesh);

      // Center yellow dashed line on major Suwon boulevards (효원로, 권광로, 경수대로, 권선로)
      if (e.isMajor && len >= 10) {
        const dashStep = 9.0;
        const count = Math.floor((len - 4) / dashStep);
        for (let i = 0; i < count; i++) {
          const frac = (i + 0.5) / count;
          const px = na.x + dx * frac;
          const pz = na.z + dz * frac;
          const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 4.0), yellowLineMat);
          dash.rotation.order = 'YXZ';
          dash.rotation.y = heading;
          dash.rotation.x = -Math.PI / 2;
          dash.position.set(px, yLevel + 0.012, pz);
          this.root.add(dash);
        }
      } else if (!e.isMajor && len >= 14) {
        // Subtle white side shoulder lines on residential streets
        const edgeLine = new THREE.Mesh(new THREE.PlaneGeometry(0.14, len - 4), whiteEdgeMat);
        edgeLine.rotation.order = 'YXZ';
        edgeLine.rotation.y = heading;
        edgeLine.rotation.x = -Math.PI / 2;
        edgeLine.position.set(mx, yLevel + 0.01, mz);
        edgeLine.visible = false; // keep alleyways clean
      }
    }

    // Smooth circular asphalt discs at road nodes so arbitrary-angle junctions connect seamlessly!
    const discGeo = new THREE.CircleGeometry(1, 14);
    discGeo.rotateX(-Math.PI / 2);
    const activeNodes = nodes.filter((n) => nodeMaxW[n.id] > 0);
    const discInst = new THREE.InstancedMesh(discGeo, this.asphaltMat, activeNodes.length);
    discInst.receiveShadow = true;
    const dummy = new THREE.Object3D();
    activeNodes.forEach((n, idx) => {
      const r = nodeMaxW[n.id] * 0.51;
      dummy.position.set(n.x, nodeMaxW[n.id] >= 11 ? 0.043 : 0.033, n.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(r, 1, r);
      dummy.updateMatrix();
      discInst.setMatrixAt(idx, dummy.matrix);
    });
    this.root.add(discInst);

    // Pedestrian Plazas (나혜석거리 / 행리단길 / 수원역 로데오!)
    for (const pl of ACTIVE_MAP_DATA.pedestrianPlazas) {
      for (let i = 0; i < pl.pts.length - 1; i++) {
        const [ax, az] = pl.pts[i];
        const [bx, bz] = pl.pts[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 1) continue;
        const heading = Math.atan2(bx - ax, bz - az);
        const strip = new THREE.Mesh(new THREE.PlaneGeometry(pl.width, len + 1.5), plazaMat);
        strip.rotation.order = 'YXZ';
        strip.rotation.y = heading;
        strip.rotation.x = -Math.PI / 2;
        strip.position.set((ax + bx) * 0.5, 0.055, (az + bz) * 0.5);
        strip.receiveShadow = true;
        this.root.add(strip);
      }
    }

    // Crosswalks & Wet Metallic Manhole Covers at Signalized Suwon Intersections!
    const manholeGeo = new THREE.CylinderGeometry(0.74, 0.78, 0.032, 14);
    const manholePositions: Array<[number, number]> = [];
    const stripeGeo = new THREE.PlaneGeometry(0.65, 2.3);
    stripeGeo.rotateX(-Math.PI / 2);

    const signalNodes = nodes.filter((n) => n.isSignal);
    for (const sn of signalNodes) {
      const localManholes: Array<[number, number]> = [
        [sn.x + 2.8, sn.z + 2.8],
        [sn.x - 2.8, sn.z - 2.6],
      ];
      manholePositions.push(...localManholes);
      this.signalHazardZones.push({
        x: sn.x,
        z: sn.z,
        manholes: localManholes,
        crosswalkRadius: 11.0,
      });

      // Place crosswalk zebra bars on each incident road edge (~7.8m out from junction center)
      for (const e of edges) {
        if (e.a !== sn.id && e.b !== sn.id) continue;
        if (e.dist < 16) continue;
        const other = nodes[e.a === sn.id ? e.b : e.a];
        const dx = other.x - sn.x;
        const dz = other.z - sn.z;
        const len = Math.hypot(dx, dz) || 1;
        const ux = dx / len;
        const uz = dz / len;
        const rx = -uz;
        const rz = ux;
        const heading = Math.atan2(dx, dz);

        const cwCenterX = sn.x + ux * 7.8;
        const cwCenterZ = sn.z + uz * 7.8;
        const halfW = e.width * 0.42;
        for (let off = -halfW; off <= halfW; off += 1.65) {
          const bar = new THREE.Mesh(stripeGeo, this.crosswalkPaintMat);
          bar.position.set(cwCenterX + rx * off, 0.054, cwCenterZ + rz * off);
          bar.rotation.y = heading;
          this.root.add(bar);
        }
      }
    }

    if (manholePositions.length > 0) {
      const mInst = new THREE.InstancedMesh(manholeGeo, this.manholeMat, manholePositions.length);
      mInst.receiveShadow = true;
      manholePositions.forEach(([mx, mz], i) => {
        dummy.position.set(mx, 0.048, mz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        mInst.setMatrixAt(i, dummy.matrix);
      });
      this.root.add(mInst);
    }
  }

  /** Builds 14 Korean yellow/black striped rounded speed bumps on real Suwon residential/alley roads */
  private buildSpeedBumps(): void {
    const nodes = ACTIVE_MAP_DATA.nodes;
    const bumpMat = new THREE.MeshStandardMaterial({
      map: this.createSpeedBumpTexture(),
      roughness: 0.72,
      metalness: 0.08,
    });
    const signPoleMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.5, roughness: 0.5 });
    const signFaceMat = new THREE.MeshBasicMaterial({
      map: this.createSignTexture('⚠️ 과속방지턱', '#facc15', '#0f172a'),
    });

    // Pick up to 14 well-spaced residential / alley / secondary road segments!
    const candidates = ACTIVE_MAP_DATA.edges
      .filter((e) => !e.isMajor && e.dist >= 28 && e.width >= 7.0)
      .sort((a, b) => b.dist - a.dist);

    for (const e of candidates) {
      if (this.speedBumps.length >= 14) break;
      const na = nodes[e.a];
      const nb = nodes[e.b];
      const mx = (na.x + nb.x) * 0.5;
      const mz = (na.z + nb.z) * 0.5;
      if (this.speedBumps.some((b) => Math.hypot(b.x - mx, b.z - mz) < 62)) continue;

      const angle = Math.atan2(nb.x - na.x, nb.z - na.z); // travel direction heading (0 = +Z)
      const humpLength = e.width * 0.92;

      const humpGeo = new THREE.CylinderGeometry(0.15, 0.15, humpLength, 10, 1, false, 0, Math.PI);
      humpGeo.rotateZ(Math.PI / 2); // arch bulges +Y, length along X, travel depth along Z
      humpGeo.scale(1, 1, 6.8);

      const hump = new THREE.Mesh(humpGeo, bumpMat);
      hump.position.set(mx, 0.036, mz);
      hump.rotation.y = angle;
      hump.receiveShadow = true;
      hump.castShadow = true;
      this.root.add(hump);

      // Curbside warning signpost
      const rx = -Math.cos(angle);
      const rz = Math.sin(angle);
      const sx = mx + rx * (e.width * 0.5 + 0.9);
      const sz = mz + rz * (e.width * 0.5 + 0.9);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.0, 6), signPoleMat);
      pole.position.set(sx, 1.0, sz);
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.34, 0.05), signFaceMat);
      board.position.set(sx, 1.85, sz);
      board.rotation.y = angle;
      this.root.add(pole, board);

      this.speedBumps.push({
        id: `bump-${this.speedBumps.length + 1}`,
        x: mx,
        z: mz,
        axis: Math.abs(Math.sin(angle)) > 0.7 ? 'ew' : 'ns',
        angle,
        halfLength: humpLength * 0.5,
        halfWidth: 1.25,
        label: e.name ? `${e.name} 과속방지턱` : '인계동 이면도로 과속방지턱',
      });
    }
  }

  /** Checks if position (x, z) is currently crossing any rotated speed bump */
  public getSpeedBumpAt(x: number, z: number): SpeedBumpInfo | null {
    for (const b of this.speedBumps) {
      const dx = x - b.x;
      const dz = z - b.z;
      if (dx * dx + dz * dz > 64) continue;
      const a = b.angle ?? (b.axis === 'ew' ? Math.PI / 2 : 0);
      const fwdX = Math.sin(a);
      const fwdZ = Math.cos(a);
      const rightX = -fwdZ;
      const rightZ = fwdX;
      const along = Math.abs(dx * fwdX + dz * fwdZ);
      const across = Math.abs(dx * rightX + dz * rightZ);
      if (along <= b.halfWidth && across <= b.halfLength) {
        return b;
      }
    }
    return null;
  }

  /** Checks metallic manhole covers & crosswalk paint near the 24 real signalized Suwon intersections */
  public getSlipSurfaceAt(x: number, z: number): SlipSurfaceType {
    for (const hz of this.signalHazardZones) {
      const dx = x - hz.x;
      const dz = z - hz.z;
      const dSq = dx * dx + dz * dz;
      if (dSq > 144) continue;

      for (const [mx, mz] of hz.manholes) {
        const mdx = x - mx;
        const mdz = z - mz;
        if (mdx * mdx + mdz * mdz <= 1.15 * 1.15) {
          return 'manhole';
        }
      }

      const d = Math.sqrt(dSq);
      if (d >= 6.4 && d <= 9.2) {
        return 'crosswalk_paint';
      }
    }
    return 'none';
  }

  /** Builds real Suwon Ingye-dong parks (효원공원 etc.) and InstancedMesh urban street trees */
  private buildParksAndTrees(): void {
    const parkMat = new THREE.MeshStandardMaterial({ color: 0x4b9454, roughness: 0.92 });
    const treeCoords: Array<[number, number, number]> = [];

    for (const park of ACTIVE_MAP_DATA.parks) {
      if (park.pts.length < 3) continue;
      const shape = new THREE.Shape();
      shape.moveTo(park.pts[0][0], -park.pts[0][1]);
      for (let i = 1; i < park.pts.length; i++) {
        shape.lineTo(park.pts[i][0], -park.pts[i][1]);
      }
      shape.closePath();

      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, parkMat);
      mesh.position.y = 0.06;
      mesh.receiveShadow = true;
      this.root.add(mesh);

      // Scatter park trees neatly around park interior
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      let cx = 0, cz = 0;
      for (const [px, pz] of park.pts) {
        cx += px;
        cz += pz;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (pz < minZ) minZ = pz;
        if (pz > maxZ) maxZ = pz;
      }
      cx /= park.pts.length;
      cz /= park.pts.length;

      // Put trees along inset perimeter + center cluster
      for (let i = 0; i < park.pts.length; i++) {
        const [px, pz] = park.pts[i];
        const tx = cx + (px - cx) * 0.72;
        const tz = cz + (pz - cz) * 0.72;
        if (treeCoords.length < 180) {
          treeCoords.push([tx, tz, 0.9 + (i % 3) * 0.14]);
        }
      }
      if (park.name.includes('효원공원')) {
        // Landmark park sign for 효원공원!
        const sign = new THREE.Mesh(
          new THREE.BoxGeometry(6.8, 1.8, 0.3),
          new THREE.MeshBasicMaterial({ map: this.createSignTexture('🌳 효원공원 (인계동)', '#14532d', '#dcfce7') })
        );
        sign.position.set(cx, 3.2, cz);
        this.root.add(sign);
        this.zones.push({ name: '효원공원', x: cx, z: cz, type: 'residential' });
      }
    }

    // Perimeter greenbelt trees
    for (let p = -380; p <= 380; p += 38) {
      treeCoords.push([p, -402, 1.15], [p, 402, 1.15], [-402, p, 1.15], [402, p, 1.15]);
    }

    if (treeCoords.length > 0) {
      const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 2.5, 6);
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4f35, roughness: 0.9 });
      const crownGeo = new THREE.SphereGeometry(1.95, 8, 6);
      const crownMat = new THREE.MeshStandardMaterial({ color: 0x2f7a42, roughness: 0.85 });

      const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCoords.length);
      const crowns = new THREE.InstancedMesh(crownGeo, crownMat, treeCoords.length);
      const dummy = new THREE.Object3D();
      treeCoords.forEach(([x, z, s], i) => {
        dummy.position.set(x, 1.25 * s, z);
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        trunks.setMatrixAt(i, dummy.matrix);

        dummy.position.set(x, 3.7 * s, z);
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        crowns.setMatrixAt(i, dummy.matrix);
      });
      this.root.add(trunks, crowns);
    }
  }

  /** Extrudes all 322 real OpenStreetMap Suwon Ingye-dong building polygons with Korean facades */
  private buildSuwonOsmBuildings(): void {
    const shopWallMat = new THREE.MeshStandardMaterial({
      map: this.createFacadeTexture('#d8e1ec', '#1e3a5f', 4, 5),
      roughness: 0.45,
      metalness: 0.2,
    });
    const aptWallMat = new THREE.MeshStandardMaterial({
      map: this.createFacadeTexture('#e6e2d8', '#334155', 5, 8),
      roughness: 0.72,
    });
    const villaWallMat = new THREE.MeshStandardMaterial({
      map: this.createFacadeTexture('#c89c82', '#263242', 3, 4),
      roughness: 0.84,
    });
    const publicWallMat = new THREE.MeshStandardMaterial({
      map: this.createFacadeTexture('#cbd5e1', '#0f2942', 4, 6),
      roughness: 0.4,
      metalness: 0.25,
    });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.88 });

    for (const b of ACTIVE_MAP_DATA.buildings) {
      if (b.pts.length < 3) continue;

      const shape = new THREE.Shape();
      shape.moveTo(b.pts[0][0], -b.pts[0][1]);
      for (let i = 1; i < b.pts.length; i++) {
        shape.lineTo(b.pts[i][0], -b.pts[i][1]);
      }
      shape.closePath();

      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: b.height,
        bevelEnabled: false,
      });
      // Rotate so extruded +Z becomes +Y upward, and shape -Z becomes world +Z!
      geo.rotateX(-Math.PI / 2);

      const sideMat =
        b.kind === 'shop'
          ? shopWallMat
          : b.kind === 'residential'
            ? b.height <= 16
              ? villaWallMat
              : aptWallMat
            : publicWallMat;

      const mesh = new THREE.Mesh(geo, [roofMat, sideMat]);
      mesh.castShadow = b.height >= 18;
      mesh.receiveShadow = true;
      this.root.add(mesh);

      // Exact rotated/L-shaped 2D polygon collider (with AABB broadphase!) so diagonal Suwon roads stay 100% clear!
      this.obstacles.push({
        minX: b.minX,
        maxX: b.maxX,
        minZ: b.minZ,
        maxZ: b.maxZ,
        pts: b.pts,
      });

      this.buildings.push({
        x: b.cx,
        z: b.cz,
        w: b.w,
        d: b.d,
        pts: b.pts,
        label: b.name ? b.name.slice(0, 12) : undefined,
        kind: b.kind,
      });

      // Add high-visibility Korean rooftop/landmark billboard on famous named Suwon buildings!
      if (
        b.name &&
        (b.name.includes('롯데시네마') ||
          b.name.includes('뉴코아') ||
          b.name.includes('CGV') ||
          b.name.includes('Homeplus') ||
          b.name.includes('한화꿈에그린') ||
          b.name.includes('한라비발디') ||
          b.name.includes('수원프라자') ||
          b.name.includes('삼성화재') ||
          b.name.includes('국민연금') ||
          b.name.includes('신풍루') ||
          b.name.includes('봉수당') ||
          b.name.includes('수원화성박물관') ||
          b.name.includes('아이파크미술관') ||
          b.name.includes('팔달구청') ||
          b.name.includes('타임빌라스') ||
          b.name.includes('롯데백화점') ||
          b.name.includes('AK') ||
          b.name.includes('노보텔') ||
          b.name.includes('수원역'))
      ) {
        const bgHex =
          b.kind === 'residential' ? '#1e3a8a' : b.name.includes('CGV') ? '#b91c1c' : '#0f172a';
        const sign = new THREE.Mesh(
          new THREE.BoxGeometry(Math.min(12, Math.max(5.5, b.w * 0.6)), 2.2, 0.35),
          new THREE.MeshBasicMaterial({ map: this.createSignTexture(b.name.slice(0, 14), bgHex, '#f8fafc') })
        );
        sign.position.set(b.cx, b.height + 1.3, b.cz);
        this.root.add(sign);
        this.zones.push({
          name: b.name.slice(0, 14),
          x: b.cx,
          z: b.cz,
          type: b.kind === 'residential' ? 'residential' : 'shop',
        });
      }
    }
  }

  /** Builds the iconic district 3D signature landmarks (팔달문·화성행궁·통닭거리 / 수원시청역·나혜석거리·효원공원 / 수원역·로데오거리) */
  private buildSuwonStationLandmark(): void {
    this.landmarksBuilder = new SuwonLandmarksBuilder({
      root: this.root,
      districtId: ACTIVE_DISTRICT.id,
      mapData: ACTIVE_MAP_DATA,
      zones: this.zones,
      landmarks: this.landmarks,
      createSignTexture: (title, bg, fg) => this.createSignTexture(title, bg, fg),
    });
  }

  /** Builds K-Oil Self-Service Gas Station & Lightning Motorcycle Repair Center in open roadside bays */
  private buildServiceStations(): void {
    const gas = ACTIVE_MAP_DATA.serviceSpots.gas;
    const rep = ACTIVE_MAP_DATA.serviceSpots.repair;

    // 1. 인계 K-오일 셀프주유소
    const gasGroup = new THREE.Group();
    gasGroup.position.set(gas.x, 0, gas.z);
    gasGroup.rotation.y = gas.facingHeading;

    const padMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.7 });
    const gasPad = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.06, 4.4), padMat);
    gasPad.position.set(0, 0.04, 1.4);
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.45 });
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.5, 4.8), canopyMat);
    canopy.position.set(0, 3.85, 0.6);
    const gasSign = new THREE.Mesh(
      new THREE.BoxGeometry(6.2, 0.85, 0.18),
      new THREE.MeshBasicMaterial({ map: this.createSignTexture('⛽ 인계 K-오일 셀프주유소', '#eab308', '#0f172a') })
    );
    gasSign.position.set(0, 4.45, 2.95);

    const pillarMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.4, roughness: 0.4 });
    for (const px of [-2.8, 2.8]) {
      const pil = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.8, 0.35), pillarMat);
      pil.position.set(px, 1.9, -1.2);
      gasGroup.add(pil);
    }
    const pump = new THREE.Mesh(
      new THREE.BoxGeometry(0.85, 1.65, 0.65),
      new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.35 })
    );
    pump.position.set(0, 0.84, -0.7);
    gasGroup.add(gasPad, canopy, gasSign, pump);
    this.root.add(gasGroup);

    this.serviceStations.push({
      name: '인계 K-오일 셀프주유소',
      kind: 'gas',
      padMinX: gas.x - 5.2,
      padMaxX: gas.x + 5.2,
      padMinZ: gas.z - 5.2,
      padMaxZ: gas.z + 5.2,
      interactX: gas.x,
      interactZ: gas.z,
      interactRadius: 5.5,
    });

    // 2. 인계 번개 오토바이 센터
    const repGroup = new THREE.Group();
    repGroup.position.set(rep.x, 0, rep.z);
    repGroup.rotation.y = rep.facingHeading;

    const repPad = new THREE.Mesh(
      new THREE.BoxGeometry(5.6, 0.06, 4.4),
      new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.72 })
    );
    repPad.position.set(0, 0.04, 1.4);
    const garage = new THREE.Mesh(
      new THREE.BoxGeometry(6.2, 3.6, 2.4),
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.65 })
    );
    garage.position.set(0, 1.8, -1.5);
    const repSign = new THREE.Mesh(
      new THREE.BoxGeometry(6.0, 0.9, 0.2),
      new THREE.MeshBasicMaterial({ map: this.createSignTexture('🔧 인계 번개 오토바이 센터', '#ea580c', '#ffffff') })
    );
    repSign.position.set(0, 3.9, -0.25);
    repGroup.add(repPad, garage, repSign);
    this.root.add(repGroup);

    this.serviceStations.push({
      name: '번개 오토바이 센터',
      kind: 'repair',
      padMinX: rep.x - 5.2,
      padMaxX: rep.x + 5.2,
      padMinZ: rep.z - 5.2,
      padMaxZ: rep.z + 5.2,
      interactX: rep.x,
      interactZ: rep.z,
      interactRadius: 5.5,
    });

    // 3. 24시 한국 편의점 (K-24 편의점 — 스태미나 음료 & 보조배터리 급속 충전!)
    const spawn = ACTIVE_MAP_DATA.meta.scooterSpawn;
    const nodes = ACTIVE_MAP_DATA.nodes;
    let cvsX = spawn.x + 32;
    let cvsZ = spawn.z + 18;
    let cvsHeading = 0;
    let bestScore = Infinity;

    for (const e of ACTIVE_MAP_DATA.edges) {
      if (e.dist < 16) continue;
      const na = nodes[e.a];
      const nb = nodes[e.b];
      const mx = (na.x + nb.x) * 0.5;
      const mz = (na.z + nb.z) * 0.5;
      const dx = nb.x - na.x;
      const dz = nb.z - na.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len;
      const nz = dx / len;
      for (const side of [1, -1]) {
        const px = mx + nx * side * (e.width * 0.5 + 2.4);
        const pz = mz + nz * side * (e.width * 0.5 + 2.4);
        if (Math.abs(px) > CITY_WORLD_LIMIT - 35 || Math.abs(pz) > CITY_WORLD_LIMIT - 35) continue;
        const dSpawn = Math.hypot(px - spawn.x, pz - spawn.z);
        if (dSpawn < 24 || dSpawn > 135) continue;
        if (Math.hypot(px - gas.x, pz - gas.z) < 28) continue;
        if (Math.hypot(px - rep.x, pz - rep.z) < 28) continue;
        const hitsBldg = this.obstacles.some(
          (o) => px + 2.2 > o.minX && px - 2.2 < o.maxX && pz + 2.2 > o.minZ && pz - 2.2 < o.maxZ
        );
        if (hitsBldg) continue;
        const sc = Math.abs(dSpawn - 52);
        if (sc < bestScore) {
          bestScore = sc;
          cvsX = px;
          cvsZ = pz;
          cvsHeading = Math.atan2(mx - px, mz - pz);
        }
      }
    }

    const cvsGroup = new THREE.Group();
    cvsGroup.position.set(cvsX, 0, cvsZ);
    cvsGroup.rotation.y = cvsHeading;

    const cvsPad = new THREE.Mesh(
      new THREE.BoxGeometry(5.2, 0.06, 3.6),
      new THREE.MeshStandardMaterial({ color: 0x10b981, roughness: 0.72 })
    );
    cvsPad.position.set(0, 0.04, 1.3);

    const cvsBody = new THREE.Mesh(
      new THREE.BoxGeometry(5.6, 3.3, 2.5),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 })
    );
    cvsBody.position.set(0, 1.65, -1.4);

    // Brightly lit Korean convenience store showcase window
    const cvsWindow = new THREE.Mesh(
      new THREE.BoxGeometry(4.4, 2.0, 0.08),
      new THREE.MeshStandardMaterial({
        color: 0xe0f2fe,
        emissive: 0xfffbeb,
        emissiveIntensity: 0.95,
        roughness: 0.2,
      })
    );
    cvsWindow.position.set(0, 1.22, -0.14);

    // Signature 3-color Korean convenience store neon fascia stripes (emerald / sky / orange)
    const stripe1 = new THREE.Mesh(
      new THREE.BoxGeometry(5.75, 0.22, 0.24),
      new THREE.MeshStandardMaterial({ color: 0x10b981, emissive: 0x10b981, emissiveIntensity: 1.4 })
    );
    stripe1.position.set(0, 3.36, -0.15);
    const stripe2 = new THREE.Mesh(
      new THREE.BoxGeometry(5.75, 0.14, 0.24),
      new THREE.MeshStandardMaterial({ color: 0x0ea5e9, emissive: 0x0ea5e9, emissiveIntensity: 1.4 })
    );
    stripe2.position.set(0, 3.16, -0.15);
    const stripe3 = new THREE.Mesh(
      new THREE.BoxGeometry(5.75, 0.12, 0.24),
      new THREE.MeshStandardMaterial({ color: 0xf97316, emissive: 0xf97316, emissiveIntensity: 1.4 })
    );
    stripe3.position.set(0, 3.01, -0.15);

    const cvsSign = new THREE.Mesh(
      new THREE.BoxGeometry(5.4, 0.85, 0.2),
      new THREE.MeshBasicMaterial({
        map: this.createSignTexture('🏪 K-24 편의점 · 24시간', '#047857', '#ecfdf5'),
      })
    );
    cvsSign.position.set(0, 3.92, -0.15);

    // Outdoor plastic table + blue umbrella parasol (classic Korean CVS!)
    const tblPole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6),
      new THREE.MeshStandardMaterial({ color: 0x64748b })
    );
    tblPole.position.set(2.1, 1.1, 0.75);
    const tblTop = new THREE.Mesh(
      new THREE.CylinderGeometry(0.58, 0.58, 0.07, 10),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc })
    );
    tblTop.position.set(2.1, 0.76, 0.75);
    const parasol = new THREE.Mesh(
      new THREE.ConeGeometry(1.15, 0.45, 8),
      new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.7 })
    );
    parasol.position.set(2.1, 2.25, 0.75);

    cvsGroup.add(cvsPad, cvsBody, cvsWindow, stripe1, stripe2, stripe3, cvsSign, tblPole, tblTop, parasol);
    this.root.add(cvsGroup);

    this.serviceStations.push({
      name: 'K-24 편의점 (24시)',
      kind: 'convenience',
      padMinX: cvsX - 4.8,
      padMaxX: cvsX + 4.8,
      padMinZ: cvsZ - 4.8,
      padMaxZ: cvsZ + 4.8,
      interactX: cvsX,
      interactZ: cvsZ,
      interactRadius: 5.4,
    });
  }

  public isPlayerNearConvenienceStore(px: number, pz: number): boolean {
    const st = this.serviceStations.find((s) => s.kind === 'convenience');
    if (!st) return false;
    return Math.hypot(px - st.interactX, pz - st.interactZ) <= st.interactRadius;
  }

  public isScooterOnGasPad(sx: number, sz: number): boolean {
    const st = this.serviceStations.find((s) => s.kind === 'gas');
    if (!st) return false;
    return sx >= st.padMinX && sx <= st.padMaxX && sz >= st.padMinZ && sz <= st.padMaxZ;
  }

  public isPlayerNearGasPump(px: number, pz: number): boolean {
    const st = this.serviceStations.find((s) => s.kind === 'gas');
    if (!st) return false;
    return Math.hypot(px - st.interactX, pz - st.interactZ) <= st.interactRadius;
  }

  public isScooterOnRepairPad(sx: number, sz: number): boolean {
    const st = this.serviceStations.find((s) => s.kind === 'repair');
    if (!st) return false;
    return sx >= st.padMinX && sx <= st.padMaxX && sz >= st.padMinZ && sz <= st.padMaxZ;
  }

  public isPlayerNearRepairShop(px: number, pz: number): boolean {
    const st = this.serviceStations.find((s) => s.kind === 'repair');
    if (!st) return false;
    return Math.hypot(px - st.interactX, pz - st.interactZ) <= st.interactRadius;
  }

  /** Builds 8 real Suwon City Hall Station / NewCore / Ingye bus stops from OSM */
  private buildBusStops(): void {
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.65, roughness: 0.35 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xbae6fd,
      transparent: true,
      opacity: 0.42,
      roughness: 0.15,
    });
    const benchMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.65 });

    for (const bs of ACTIVE_MAP_DATA.busStops) {
      this.busStops.push({
        name: bs.name,
        x: bs.x,
        z: bs.z,
        shelterX: bs.shelterX,
        shelterZ: bs.shelterZ,
        facingHeading: bs.facingHeading,
        edgeIndex: bs.edgeIndex,
      });

      const g = new THREE.Group();
      g.position.set(bs.shelterX, 0.05, bs.shelterZ);
      g.rotation.y = bs.facingHeading;

      const roof = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.14, 1.6), steelMat);
      roof.position.set(0, 2.55, 0);
      const backGlass = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.0, 0.08), glassMat);
      backGlass.position.set(0, 1.35, -0.65);
      const bench = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.12, 0.48), benchMat);
      bench.position.set(0, 0.5, -0.3);

      const signMat = new THREE.MeshBasicMaterial({
        map: this.createSignTexture(`🚌 ${bs.name.slice(0, 12)}`, '#1d4ed8', '#ffffff'),
      });
      const signBoard = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.55, 0.12), signMat);
      signBoard.position.set(0, 2.95, 0.65);
      g.add(roof, backGlass, bench, signBoard);
      this.root.add(g);
    }
  }

  private initDeliveryLocations(): void {
    for (const s of ACTIVE_MAP_DATA.shops) {
      this.locations.push({
        id: s.id,
        name: s.name,
        x: s.x,
        z: s.z,
        type: 'shop',
        emoji: s.emoji,
        facingHeading: s.facingHeading,
        menus: s.menus,
      });
    }
    for (const r of ACTIVE_MAP_DATA.residences) {
      this.locations.push({
        id: r.id,
        name: r.name,
        x: r.x,
        z: r.z,
        type: 'residential',
        residenceKind: r.residenceKind,
        emoji: r.emoji,
        facingHeading: r.facingHeading,
      });
    }
  }

  /** Builds outdoor pickup counters & residential glass lobby portals oriented cleanly toward each Suwon road */
  private buildPickupWindowsAndLobbies(): void {
    const counterMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.35, metalness: 0.45 });
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
      opacity: 0.48,
    });
    const pinPadMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      emissive: 0x22c55e,
      emissiveIntensity: 0.6,
    });

    for (const loc of this.locations) {
      const heading = loc.facingHeading ?? 0;
      const g = new THREE.Group();
      // Place slightly back from the interaction point so player stands cleanly on sidewalk facing counter/lobby
      const backX = -Math.sin(heading) * 1.1;
      const backZ = -Math.cos(heading) * 1.1;
      g.position.set(loc.x + backX, 0.05, loc.z + backZ);
      g.rotation.y = heading;

      if (loc.type === 'shop') {
        const counter = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.05, 0.72), counterMat);
        counter.position.set(0, 0.52, 0);
        const awning = new THREE.Mesh(
          new THREE.BoxGeometry(3.0, 0.65, 0.25),
          new THREE.MeshBasicMaterial({
            map: this.createSignTexture(`${loc.emoji} ${loc.name}`, '#c2410c', '#fff7ed'),
          })
        );
        awning.position.set(0, 2.35, 0.15);

        const posStand = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.34, 0.24), darkMat);
        posStand.position.set(0.82, 1.18, 0.08);
        posStand.rotation.x = -0.35;
        const posScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.22), screenMat);
        posScreen.position.set(0.82, 1.21, 0.21);
        posScreen.rotation.x = -0.35;

        const tray = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.032, 0.42), darkMat);
        tray.position.set(-0.35, 1.06, 0.04);
        const trayLedMat = new THREE.MeshStandardMaterial({
          color: 0x1e293b,
          emissive: 0xfacc15,
          emissiveIntensity: 0.08,
        });
        const trayLed = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.035, 0.03), trayLedMat);
        trayLed.position.set(-0.35, 1.07, 0.25);

        const trayBag = HandheldFoodBag3D.createFoodBagMesh();
        trayBag.position.set(-0.35, 1.21, 0.04);
        trayBag.scale.set(1.12, 1.12, 1.12);
        trayBag.visible = false;

        this.shopTrays.set(loc.id, { bag: trayBag, ledMat: trayLedMat });
        g.add(counter, awning, posStand, posScreen, tray, trayLed, trayBag);
        this.root.add(g);
      } else {
        const isVilla = loc.residenceKind === 'walkup_villa';
        const archFrame = new THREE.Mesh(new THREE.BoxGeometry(3.0, 2.7, 0.42), darkMat);
        archFrame.position.set(0, 1.35, 0);
        const innerCut = new THREE.Mesh(
          new THREE.BoxGeometry(2.35, 2.4, 0.45),
          new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 })
        );
        innerCut.position.set(0, 1.2, -0.02);

        const leftDoor = new THREE.Mesh(new THREE.BoxGeometry(1.12, 2.34, 0.08), glassDoorMat);
        leftDoor.position.set(-0.56, 1.18, 0.22);
        const rightDoor = new THREE.Mesh(new THREE.BoxGeometry(1.12, 2.34, 0.08), glassDoorMat);
        rightDoor.position.set(0.56, 1.18, 0.22);

        const pad = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.36, 0.08), pinPadMat);
        pad.position.set(1.32, 1.3, 0.22);

        const signBg = isVilla ? '#065f46' : '#1e3a8a';
        const lobbySign = new THREE.Mesh(
          new THREE.BoxGeometry(3.2, 0.62, 0.2),
          new THREE.MeshBasicMaterial({
            map: this.createSignTexture(`${loc.emoji} ${loc.name}`, signBg, '#f8fafc'),
          })
        );
        lobbySign.position.set(0, 3.0, 0.16);

        this.lobbyDoors.set(loc.id, { leftDoor, rightDoor, open: false });
        g.add(archFrame, innerCut, leftDoor, rightDoor, pad, lobbySign);
        this.root.add(g);
      }
    }
  }

  private buildStreetLamps(): void {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.6, roughness: 0.4 });
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.11, 6.2, 6);
    const lampGeo = new THREE.BoxGeometry(0.52, 0.14, 0.26);

    const lampPositions: Array<[number, number]> = [];
    for (const n of ACTIVE_MAP_DATA.nodes) {
      if (!n.isSignal) continue;
      lampPositions.push([n.x + 8.0, n.z + 8.0], [n.x - 8.0, n.z - 8.0]);
    }
    for (const [lx, lz] of lampPositions) {
      const g = new THREE.Group();
      g.position.set(lx, 0.05, lz);
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.y = 3.1;
      const lamp = new THREE.Mesh(lampGeo, this.lampGlowMat);
      lamp.position.y = 6.2;
      g.add(pole, lamp);
      this.root.add(g);
    }
  }

  public setLobbyDoorOpen(locationId: string | null): void {
    for (const [id, entry] of this.lobbyDoors.entries()) {
      entry.open = locationId === id;
    }
  }

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
        entry.ledMat.emissiveIntensity = 0.08;
      }
    }
  }

  public updateLobbyDoors(dt: number): void {
    const step = Math.min(1, dt * 6);
    for (const entry of this.lobbyDoors.values()) {
      const targetL = entry.open ? -1.42 : -0.56;
      const targetR = entry.open ? 1.42 : 0.56;
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

  public updateWeatherVisuals(rainIntensity: number, elapsedTime: number): void {
    this.roadShaderUniforms.uRainWetness.value = rainIntensity;
    this.roadShaderUniforms.uTime.value = elapsedTime;

    const wetMetal = 0.04 + rainIntensity * 0.34;
    const wetTint = 1.0 - rainIntensity * 0.32;
    this.asphaltMat.metalness = wetMetal;
    this.asphaltMat.color.setRGB(wetTint * 0.95, wetTint * 0.98, wetTint * 1.05);

    this.crosswalkPaintMat.roughness = 0.78 - rainIntensity * 0.62;
    this.crosswalkPaintMat.metalness = 0.05 + rainIntensity * 0.25;

    this.manholeMat.roughness = 0.55 - rainIntensity * 0.43;
    this.manholeMat.metalness = 0.78 + rainIntensity * 0.16;
  }

  private applySkyTheme(): void {
    const isRain = this.weatherMode === 'rain';
    const isCloudy = this.weatherMode === 'cloudy';
    this.landmarksBuilder?.setNightMode(this.isNight);

    if (this.isNight) {
      const bgHex = isRain ? 0x060b14 : isCloudy ? 0x09101d : 0x0b1220;
      const fogDensity = isRain ? 0.0046 : isCloudy ? 0.0036 : 0.003;
      this.scene.background = new THREE.Color(bgHex);
      this.scene.fog = new THREE.FogExp2(bgHex, fogDensity);
      this.dirLight.intensity = isRain ? 0.16 : isCloudy ? 0.2 : 0.25;
      this.dirLight.color.setHex(isRain ? 0x6b88b0 : 0x8aa8d6);
      this.hemiLight.intensity = isRain ? 0.22 : 0.28;
      this.lampGlowMat.emissiveIntensity = isRain ? 3.8 : 3.2;
      this.windowGlowMat.emissiveIntensity = isRain ? 1.3 : 1.1;
    } else if (isRain) {
      this.scene.background = new THREE.Color(0x5b6d80);
      this.scene.fog = new THREE.FogExp2(0x5b6d80, 0.0042);
      this.dirLight.intensity = 0.54;
      this.dirLight.color.setHex(0xb8cde0);
      this.hemiLight.intensity = 0.58;
      this.lampGlowMat.emissiveIntensity = 1.45;
      this.windowGlowMat.emissiveIntensity = 0.42;
    } else if (isCloudy) {
      this.scene.background = new THREE.Color(0x889cb0);
      this.scene.fog = new THREE.FogExp2(0x889cb0, 0.0024);
      this.dirLight.intensity = 0.94;
      this.dirLight.color.setHex(0xdce6f2);
      this.hemiLight.intensity = 0.74;
      this.lampGlowMat.emissiveIntensity = 0.45;
      this.windowGlowMat.emissiveIntensity = 0.2;
    } else {
      this.scene.background = new THREE.Color(0x93c5fd);
      this.scene.fog = new THREE.FogExp2(0xa5d4fb, 0.00145);
      this.dirLight.intensity = 1.48;
      this.dirLight.color.setHex(0xfff7e6);
      this.hemiLight.intensity = 0.92;
      this.lampGlowMat.emissiveIntensity = 0.2;
      this.windowGlowMat.emissiveIntensity = 0.14;
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
