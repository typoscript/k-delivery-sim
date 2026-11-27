import * as THREE from 'three';
import { excludeFromMirrors, freezeStatic, makeStaticContainer } from './renderLayers';
import { buildInstanced, mergeStaticByMaterial, placeMatrix } from './instancing';
import {
  createAsphaltTexture,
  createBuildingMaterials,
  createPuddleRoughnessTexture,
  createSidewalkTexture,
} from './cityTextures';
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
import { SUWON_OPEN_WORLD } from '../data/suwonUnified';
import { OsmParkData, OsmPlazaData, SuwonDistrictId } from '../data/suwonTypes';
import { ChunkStreamer, ChunkStreamerStats } from './openworld/ChunkStreamer';
import { ProximityCuller } from './openworld/ProximityCuller';
import { gridSpecOf } from './openworld/OpenWorldTypes';
import { SuwonLandmarksBuilder } from './SuwonLandmarks';
import { ServiceStations, WorldPropHost } from './serviceStations';
import { DeliveryLocationProps } from './deliveryProps';
import { WorldSky } from './worldSky';


/** Sun direction (target -> sun) used by the stabilized follow-the-player shadow frustum */
const SUN_OFFSET = new THREE.Vector3(160, 240, 120);
const SUN_DISTANCE = SUN_OFFSET.length();
const SUN_OFFSET_DIR = SUN_OFFSET.clone().normalize();
const SUN_LIGHT_RIGHT = new THREE.Vector3(0, 1, 0).cross(SUN_OFFSET_DIR).normalize();
const SUN_LIGHT_UP = SUN_OFFSET_DIR.clone().cross(SUN_LIGHT_RIGHT).normalize();
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
  /** Unified open world: parks / water / pedestrian streets of the currently streamed chunks */
  areaParks?: OsmParkData[];
  areaWaters?: OsmParkData[];
  areaPlazas?: OsmPlazaData[];
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
  private readonly landmarkBuilders: SuwonLandmarksBuilder[] = [];

  // Unified open world: chunk streaming for buildings/roads/parks + distance culling for static props
  private readonly unified = ACTIVE_MAP_DATA.meta.unified === true;
  /** addProp / sign textures for the world sub-builders (service stations, delivery props) */
  private readonly propHost: WorldPropHost = {
    addProp: (obj, x, z, radiusChunks, keep) => this.addProp(obj, x, z, radiusChunks, keep),
    createSignTexture: (title, bg, fg) => this.createSignTexture(title, bg, fg),
  };
  /** Gas station / repair shop / convenience store sets (serviceStations.ts) */
  private readonly stations: ServiceStations;
  private streamer?: ChunkStreamer;
  private readonly culler?: ProximityCuller;
  private streamerVersionSeen = -1;
  private collisionCache: ObstacleBox[] = [];
  private collisionStreamedRef: ObstacleBox[] | null = null;
  private plazaMat?: THREE.MeshStandardMaterial;
  private readonly tmpSunTarget = new THREE.Vector3();

  private readonly scene: THREE.Scene;
  private readonly dirLight: THREE.DirectionalLight;
  private readonly hemiLight: THREE.HemisphereLight;
  private readonly lampGlowMat: THREE.MeshStandardMaterial;
  private readonly windowGlowMat: THREE.MeshStandardMaterial;
  private readonly buildingNightMats: THREE.MeshStandardMaterial[] = [];
  private readonly streetLampPoolGroup = new THREE.Group();
  /** Pickup counters & lobby portals with their animated doors / food trays (deliveryProps.ts) */
  private deliveryProps!: DeliveryLocationProps;

  private readonly beaconGroup = new THREE.Group();
  private readonly beaconRingMat: THREE.MeshBasicMaterial;
  private readonly beaconRing: THREE.Mesh;

  public isNight = false;
  /** Sky, fog, sun / sky light and night glow for weather x time of day (worldSky.ts) */
  private sky!: WorldSky;
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
    scene.fog = new THREE.FogExp2(0xa5d4fb, this.fogDensity(0.00145));
    if (this.unified) this.culler = new ProximityCuller(gridSpecOf(SUWON_OPEN_WORLD), 2);

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
    this.root.add(this.dirLight.target);

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
    this.initOpenWorldStreaming();
    this.buildSuwonStationLandmark();
    this.stations = new ServiceStations(this.propHost, this.serviceStations, this.obstacles, this.unified);
    this.stations.build();
    this.buildBusStops();
    this.initDeliveryLocations();
    this.deliveryProps = new DeliveryLocationProps(this.propHost, this.root, this.culler, this.locations);
    this.deliveryProps.build();
    this.buildStreetLamps();

    this.sky = new WorldSky({
      scene: this.scene,
      dirLight: this.dirLight,
      hemiLight: this.hemiLight,
      lampGlowMat: this.lampGlowMat,
      windowGlowMat: this.windowGlowMat,
      buildingNightMats: this.buildingNightMats,
      streetLampPools: this.streetLampPoolGroup,
      landmarkBuilders: this.landmarkBuilders,
      fogDensity: (d) => this.fogDensity(d),
    });
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

  /** Unified city uses denser fog so chunks streaming in ~400-500m away fade in instead of popping */
  private fogDensity(legacyDensity: number): number {
    return this.unified ? Math.max(legacyDensity * 2, 0.0028) : legacyDensity;
  }

  /** Sidewalk paving keeps the legacy tile size (110 repeats per 820m) on any world size */
  private sizedSidewalkTexture(): THREE.CanvasTexture {
    const tex = createSidewalkTexture();
    const r = (110 * CITY_WORLD_LIMIT * 2) / 820;
    tex.repeat.set(r, r);
    return tex;
  }

  /** Adds a static prop; in the unified city it is distance-culled with the chunk streaming window */
  private addProp(
    obj: THREE.Object3D,
    x: number,
    z: number,
    radiusChunks?: number,
    keep?: (o: THREE.Object3D) => boolean
  ): void {
    // One mesh per material inside the prop (moving / toggled parts listed in `keep` stay separate)
    mergeStaticByMaterial(obj, keep);
    // Small street props are not worth re-drawing in the 256px side mirrors
    excludeFromMirrors(obj);
    this.root.add(obj);
    // Props never move (lobby doors are refreshed manually in updateLobbyDoors)
    freezeStatic(obj);
    this.culler?.register(obj, x, z, radiusChunks);
  }

  /** Unified open world: buildings, road surfaces, parks, water & pedestrian streets stream per 200m chunk */
  private initOpenWorldStreaming(): void {
    if (!this.unified) return;
    const b = createBuildingMaterials();
    this.buildingNightMats.push(b.shopWallMat, b.aptWallMat, b.villaWallMat, b.publicWallMat);
    this.streamer = new ChunkStreamer(
      this.root,
      SUWON_OPEN_WORLD,
      {
        walls: { shop: b.shopWallMat, apt: b.aptWallMat, villa: b.villaWallMat, public: b.publicWallMat },
        roof: b.roofMat,
        road: this.asphaltMat,
        roadLine: new THREE.MeshBasicMaterial({ color: 0xfacc15 }),
        park: new THREE.MeshStandardMaterial({ color: 0x4b9454, roughness: 0.92 }),
        water: new THREE.MeshStandardMaterial({
          color: 0x0284c7,
          emissive: 0x0369a1,
          emissiveIntensity: 0.18,
          roughness: 0.14,
          metalness: 0.38,
        }),
        plaza: this.plazaMat ?? new THREE.MeshStandardMaterial({ color: 0xc29e83, roughness: 0.84 }),
        farBuildings: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }),
      },
      { chunkBaseUrl: './map/suwon/chunks/' }
    );
    // Fog hides everything past ~400m: a tighter shadow frustum (±220m instead of ±310m) gives
    // sharper shadows for the same map size
    const sc = this.dirLight.shadow.camera;
    sc.left = -220;
    sc.right = 220;
    sc.top = 220;
    sc.bottom = -220;
    sc.updateProjectionMatrix();
    const spawn = ACTIVE_MAP_DATA.meta.playerSpawn;
    this.updateStreaming(spawn.x, spawn.z);
  }

  /**
   * Per-frame open-world tick (no-op on legacy district maps): streams chunks & culls props around the
   * player, keeps the sun's shadow frustum centred on the player and refreshes the phone-map overlays.
   */
  public updateStreaming(px: number, pz: number): void {
    if (!this.streamer) return;
    this.streamer.update(px, pz);
    this.culler?.update(px, pz);
    this.placeSunStabilized(px, pz);
    if (this.streamer.version !== this.streamerVersionSeen) {
      this.streamerVersionSeen = this.streamer.version;
      const chunks = this.streamer.getBuiltChunkData();
      this.buildings.length = 0;
      const parks: OsmParkData[] = [];
      const waters: OsmParkData[] = [];
      const plazas: OsmPlazaData[] = [];
      for (const c of chunks) {
        for (const bd of c.buildings) {
          this.buildings.push({ x: bd.cx, z: bd.cz, w: bd.w, d: bd.d, pts: bd.pts, label: bd.name ? bd.name.slice(0, 12) : undefined, kind: bd.kind });
        }
        parks.push(...c.parks);
        waters.push(...c.waters);
        plazas.push(...c.pedestrianPlazas);
      }
      this.mapInfo.areaParks = parks;
      this.mapInfo.areaWaters = waters;
      this.mapInfo.areaPlazas = plazas;
    }
  }

  /**
   * Sun + shadow frustum follow the player, snapped to whole shadow-map texels in light space so
   * shadow edges don't shimmer/crawl as the rider moves (standard shadow stabilization).
   */
  private placeSunStabilized(px: number, pz: number): void {
    const cam = this.dirLight.shadow.camera;
    const texel = (cam.right - cam.left) / Math.max(1, this.dirLight.shadow.mapSize.x);
    // Light-space basis of the shadow camera (it looks from the sun toward the target, up = +Y)
    const z = SUN_OFFSET_DIR;
    const x = SUN_LIGHT_RIGHT;
    const y = SUN_LIGHT_UP;
    const t = this.tmpSunTarget.set(px, 0, pz);
    const tx = t.dot(x);
    const ty = t.dot(y);
    t.addScaledVector(x, Math.round(tx / texel) * texel - tx).addScaledVector(y, Math.round(ty / texel) * texel - ty);
    this.dirLight.target.position.copy(t);
    this.dirLight.position.copy(t).addScaledVector(z, SUN_DISTANCE);
  }

  /** Building / prop colliders relevant to the player (streamed 3x3 chunks in the unified city) */
  public getCollisionObstacles(): ObstacleBox[] {
    if (!this.streamer) return this.obstacles;
    const streamed = this.streamer.collisionObstacles;
    if (streamed !== this.collisionStreamedRef) {
      this.collisionStreamedRef = streamed;
      this.collisionCache = this.obstacles.length > 0 ? [...this.obstacles, ...streamed] : streamed;
    }
    return this.collisionCache;
  }

  /** Static containers (world root, streamed chunk root, lamp pools) skip per-frame forced matrix updates */
  public markStaticContainers(): void {
    makeStaticContainer(this.root);
    makeStaticContainer(this.streetLampPoolGroup);
    if (this.streamer) makeStaticContainer(this.streamer.root);
  }

  /** The shadow-casting sun (profiler A/B benchmark toggles its shadows) */
  public get sunLight(): THREE.DirectionalLight {
    return this.dirLight;
  }

  /** Streaming diagnostics (unified city only) */
  public get streamingStats(): ChunkStreamerStats | null {
    return this.streamer ? this.streamer.stats : null;
  }

  private buildBaseGround(): void {
    // Outer Suwon suburban backdrop greenbelt
    const outerGround = new THREE.Mesh(
      new THREE.PlaneGeometry(CITY_WORLD_LIMIT * 2 + 600, CITY_WORLD_LIMIT * 2 + 600),
      new THREE.MeshStandardMaterial({ color: 0x527358, roughness: 0.95 })
    );
    outerGround.rotation.x = -Math.PI / 2;
    outerGround.position.y = -0.02;
    this.root.add(outerGround);

    // Korean urban sidewalk interlocking brick base across playable Suwon Ingye-dong district
    const sidewalkBase = new THREE.Mesh(
      new THREE.PlaneGeometry(CITY_WORLD_LIMIT * 2, CITY_WORLD_LIMIT * 2),
      new THREE.MeshStandardMaterial({ map: this.sizedSidewalkTexture(), roughness: 0.88 })
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
      map: createAsphaltTexture(),
      roughnessMap: createPuddleRoughnessTexture(),
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
    this.plazaMat = plazaMat;

    // Track max width incident to each node for smooth circular asphalt junction caps
    const nodeMaxW = new Float32Array(nodes.length);

    // Unified open world: road surfaces stream in per chunk (merged meshes); only junction props are built here
    for (const e of this.unified ? [] : edges) {
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
    const activeNodes = this.unified ? [] : nodes.filter((n) => nodeMaxW[n.id] > 0);
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
    // Incident edges per node (avoids scanning every edge for every signal on the 8,000-edge city graph)
    const incident = new Map<number, typeof edges>();
    for (const e of edges) {
      for (const id of [e.a, e.b]) {
        const list = incident.get(id);
        if (list) list.push(e);
        else incident.set(id, [e]);
      }
    }
    const crosswalkMatrices: THREE.Matrix4[] = [];
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
      for (const e of incident.get(sn.id) ?? []) {
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
          crosswalkMatrices.push(placeMatrix(cwCenterX + rx * off, 0.054, cwCenterZ + rz * off, heading));
        }
      }
    }
    // Every zebra stripe in the city is one instance of a single InstancedMesh (1 draw call)
    if (crosswalkMatrices.length > 0) {
      const stripes = buildInstanced(stripeGeo, this.crosswalkPaintMat, crosswalkMatrices);
      stripes.receiveShadow = true;
      excludeFromMirrors(stripes);
      this.root.add(stripes);
      freezeStatic(stripes);
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

    // Legacy district: 14 bumps; unified city: same density (~1 per 0.05 km^2 of road network) up to 160
    const maxBumps = this.unified ? 160 : 14;
    for (const e of candidates) {
      if (this.speedBumps.length >= maxBumps) break;
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
      this.addProp(hump, mx, mz);

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
      this.addProp(pole, sx, sz);
      this.addProp(board, sx, sz);

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

    // Real OSM Water Bodies (광교 호수공원 원천호수 등)
    if (ACTIVE_MAP_DATA.waters && ACTIVE_MAP_DATA.waters.length > 0) {
      const lakeMat = new THREE.MeshStandardMaterial({
        color: 0x0284c7,
        emissive: 0x0369a1,
        emissiveIntensity: 0.18,
        roughness: 0.14,
        metalness: 0.38,
      });
      for (const water of ACTIVE_MAP_DATA.waters) {
        if (water.pts.length < 3) continue;
        const wShape = new THREE.Shape();
        wShape.moveTo(water.pts[0][0], -water.pts[0][1]);
        for (let i = 1; i < water.pts.length; i++) {
          wShape.lineTo(water.pts[i][0], -water.pts[i][1]);
        }
        wShape.closePath();
        const wGeo = new THREE.ShapeGeometry(wShape);
        wGeo.rotateX(-Math.PI / 2);
        const wMesh = new THREE.Mesh(wGeo, lakeMat);
        wMesh.position.y = 0.068;
        wMesh.receiveShadow = true;
        this.root.add(wMesh);
      }
    }

    // Perimeter greenbelt trees
    const lim = CITY_WORLD_LIMIT;
    for (let p = -(lim - 30); p <= lim - 30; p += 38) {
      treeCoords.push([p, -(lim - 8), 1.15], [p, lim - 8, 1.15], [-(lim - 8), p, 1.15], [lim - 8, p, 1.15]);
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

  /** Generates a realistic Korean night lit-window emissive texture (warm amber + cool white office/apt lights) */

  private createLampPoolTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255, 224, 150, 0.42)');
    grad.addColorStop(0.45, 'rgba(251, 191, 36, 0.16)');
    grad.addColorStop(1, 'rgba(251, 191, 36, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** Extrudes all 322 real OpenStreetMap Suwon Ingye-dong building polygons with Korean facades */
  private buildSuwonOsmBuildings(): void {
    const { shopWallMat, aptWallMat, villaWallMat, publicWallMat, roofMat } = createBuildingMaterials();
    this.buildingNightMats.push(shopWallMat, aptWallMat, villaWallMat, publicWallMat);

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
          b.name.includes('수원역') ||
          b.name.includes('갤러리아') ||
          b.name.includes('코트야드') ||
          b.name.includes('경기도서관') ||
          b.name.includes('광교엘포트'))
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
    if (!this.unified) {
      this.landmarkBuilders.push(
        new SuwonLandmarksBuilder({
          root: this.root,
          districtId: ACTIVE_DISTRICT.id,
          mapData: ACTIVE_MAP_DATA,
          zones: this.zones,
          landmarks: this.landmarks,
          createSignTexture: (title, bg, fg) => this.createSignTexture(title, bg, fg),
        })
      );
      return;
    }
    // Unified city: every district's hand-built landmarks, authored in that district's local coordinates,
    // placed under a group offset to the district origin (and culled when the player is far away)
    for (const d of SUWON_OPEN_WORLD.legacyDistricts) {
      const group = new THREE.Group();
      group.position.set(d.origin.x, 0, d.origin.z);
      const zones: CityZoneMarker[] = [];
      const landmarks: LandmarkMarker[] = [];
      this.landmarkBuilders.push(
        new SuwonLandmarksBuilder({
          root: group,
          districtId: d.id as SuwonDistrictId,
          mapData: { meta: { station: d.localStation }, buildings: d.namedBuildings },
          zones,
          landmarks,
          createSignTexture: (title, bg, fg) => this.createSignTexture(title, bg, fg),
        })
      );
      for (const z of zones) this.zones.push({ ...z, x: z.x + d.origin.x, z: z.z + d.origin.z });
      for (const l of landmarks) this.landmarks.push({ ...l, x: l.x + d.origin.x, z: l.z + d.origin.z });
      // Landmarks span the whole 820m district: keep them visible within ~5 chunks (1km) of its centre
      this.addProp(group, d.origin.x, d.origin.z, 5);
    }
  }

  public isPlayerNearConvenienceStore(px: number, pz: number): boolean {
    return this.stations.isPlayerNearConvenienceStore(px, pz);
  }

  public isScooterOnGasPad(sx: number, sz: number): boolean {
    return this.stations.isScooterOnGasPad(sx, sz);
  }

  public isPlayerNearGasPump(px: number, pz: number): boolean {
    return this.stations.isPlayerNearGasPump(px, pz);
  }

  public isScooterOnRepairPad(sx: number, sz: number): boolean {
    return this.stations.isScooterOnRepairPad(sx, sz);
  }

  /** Nearest gas station (name, straight-line distance) for low-fuel hints */
  public nearestGasStation(x: number, z: number): { name: string; dist: number } | null {
    return this.stations.nearestGas(x, z);
  }

  public isPlayerNearRepairShop(px: number, pz: number): boolean {
    return this.stations.isPlayerNearRepairShop(px, pz);
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

      const buildShelter = () => {
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
      const dispose = () => {
        for (const m of [roof, backGlass, bench, signBoard]) m.geometry.dispose();
        // geometries created by the per-material merge
        g.traverse((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.dispose());
        signMat.map?.dispose();
        signMat.dispose();
      };
      return { object: g, dispose };
      };
      if (this.culler) {
        // 228 city-wide stops: build (and texture) each shelter only when the player gets close
        this.culler.registerLazy(this.root, bs.shelterX, bs.shelterZ, () => {
          const built = buildShelter();
          mergeStaticByMaterial(built.object);
          excludeFromMirrors(built.object);
          freezeStatic(built.object);
          return built;
        });
      } else {
        this.root.add(buildShelter().object);
      }
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

  private buildStreetLamps(): void {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.6, roughness: 0.4 });
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.11, 6.2, 6);
    const lampGeo = new THREE.BoxGeometry(0.52, 0.14, 0.26);

    const lampPositions: Array<[number, number]> = [];
    for (const n of ACTIVE_MAP_DATA.nodes) {
      if (!n.isSignal) continue;
      lampPositions.push([n.x + 8.0, n.z + 8.0], [n.x - 8.0, n.z - 8.0]);
    }
    const poolMat = new THREE.MeshBasicMaterial({
      map: this.createLampPoolTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const poolGeo = new THREE.PlaneGeometry(14, 14);
    poolGeo.rotateX(-Math.PI / 2);

    // All lamp poles / heads / night light pools city-wide: 3 InstancedMeshes (was 3 meshes per lamp)
    const poles = buildInstanced(poleGeo, poleMat, lampPositions.map(([lx, lz]) => placeMatrix(lx, 3.15, lz)));
    const heads = buildInstanced(lampGeo, this.lampGlowMat, lampPositions.map(([lx, lz]) => placeMatrix(lx, 6.25, lz)));
    // Warm golden streetlamp light pools projected onto asphalt at night (zero PointLight cost!)
    const pools = buildInstanced(poolGeo, poolMat, lampPositions.map(([lx, lz]) => placeMatrix(lx, 0.072, lz)));
    poles.castShadow = true;
    for (const m of [poles, heads]) {
      excludeFromMirrors(m);
      this.root.add(m);
      freezeStatic(m);
    }
    excludeFromMirrors(pools);
    this.streetLampPoolGroup.add(pools);
    freezeStatic(pools);
    this.streetLampPoolGroup.visible = false;
    this.root.add(this.streetLampPoolGroup);
  }

  public setLobbyDoorOpen(locationId: string | null): void {
    this.deliveryProps.setLobbyDoorOpen(locationId);
  }

  public syncShopPickupTrays(cookingShopIds: Set<string>, readyShopIds: Set<string>, elapsedTime: number): void {
    this.deliveryProps.syncShopPickupTrays(cookingShopIds, readyShopIds, elapsedTime);
  }

  public updateLobbyDoors(dt: number): void {
    this.deliveryProps.updateLobbyDoors(dt);
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

  /** Re-applies sky, fog, lights and night glow for the current weather and time of day */
  private applySkyTheme(): void {
    this.sky.apply(this.weatherMode, this.isNight);
  }

  /**
   * Time of day from the game clock: 0 = day, 1 = night (fractions during dusk / dawn).
   * Re-applies the sky only when it visibly changed. Returns isNight (the darker half).
   */
  public setNightness(nightness: number): boolean {
    const n = Math.max(0, Math.min(1, nightness));
    const wasNight = this.isNight;
    this.isNight = n >= 0.5;
    if (!this.sky.setNightness(n, wasNight !== this.isNight)) return this.isNight;
    if (this.root.visible) this.applySkyTheme();
    return this.isNight;
  }
}
