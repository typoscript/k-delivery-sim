import * as THREE from 'three';
import { excludeFromMirrors, freezeStatic, makeStaticContainer } from './renderLayers';
import { mergeStaticByMaterial } from './instancing';
import {
  createBuildingMaterials,
  createSidewalkTexture,
  createSignTexture,
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
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import { SUWON_OPEN_WORLD } from '../data/suwonUnified';
import { OsmParkData, OsmPlazaData } from '../data/suwonTypes';
import { ChunkStreamer, ChunkStreamerStats } from './openworld/ChunkStreamer';
import { ProximityCuller } from './openworld/ProximityCuller';
import { gridSpecOf } from './openworld/OpenWorldTypes';
import { SuwonLandmarksBuilder } from './SuwonLandmarks';
import { ServiceStations, WorldPropHost } from './serviceStations';
import { DeliveryLocationProps } from './deliveryProps';
import { buildSuwonOsmRoads, SignalHazardZone } from './roadSurfaces';
import { buildSpeedBumps } from './speedBumps';
import { buildParksAndTrees } from './parksAndTrees';
import { buildSuwonOsmBuildings, buildSuwonStationLandmark } from './cityBuildings';
import { buildBusStops, buildStreetLamps } from './streetFurniture';
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
  /** @internal world builders */
  readonly landmarkBuilders: SuwonLandmarksBuilder[] = [];

  // Unified open world: chunk streaming for buildings/roads/parks + distance culling for static props
  /** @internal world builders */
  readonly unified = ACTIVE_MAP_DATA.meta.unified === true;
  /** addProp / sign textures for the world sub-builders (service stations, delivery props) */
  private readonly propHost: WorldPropHost = {
    addProp: (obj, x, z, radiusChunks, keep) => this.addProp(obj, x, z, radiusChunks, keep),
    createSignTexture: (title, bg, fg) => createSignTexture(title, bg, fg),
  };
  /** Gas station / repair shop / convenience store sets (serviceStations.ts) */
  private readonly stations: ServiceStations;
  private streamer?: ChunkStreamer;
  /** @internal world builders */
  readonly culler?: ProximityCuller;
  private streamerVersionSeen = -1;
  private collisionCache: ObstacleBox[] = [];
  private collisionStreamedRef: ObstacleBox[] | null = null;
  /** @internal world builders */
  plazaMat?: THREE.MeshStandardMaterial;
  private readonly tmpSunTarget = new THREE.Vector3();

  private readonly scene: THREE.Scene;
  private readonly dirLight: THREE.DirectionalLight;
  private readonly hemiLight: THREE.HemisphereLight;
  /** @internal world builders */
  readonly lampGlowMat: THREE.MeshStandardMaterial;
  private readonly windowGlowMat: THREE.MeshStandardMaterial;
  /** @internal world builders */
  readonly buildingNightMats: THREE.MeshStandardMaterial[] = [];
  /** @internal world builders */
  readonly streetLampPoolGroup = new THREE.Group();
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
  /** @internal world builders */
  asphaltMat!: THREE.MeshStandardMaterial;
  /** @internal world builders */
  crosswalkPaintMat!: THREE.MeshStandardMaterial;
  /** @internal world builders */
  manholeMat!: THREE.MeshStandardMaterial;
  /** @internal world builders */
  readonly roadShaderUniforms = {
    uRainWetness: { value: 0 },
    uTime: { value: 0 },
  };
  /** @internal world builders */
  readonly signalHazardZones: SignalHazardZone[] = [];

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
    buildSuwonOsmRoads(this);
    buildSpeedBumps(this);
    buildParksAndTrees(this);
    buildSuwonOsmBuildings(this);
    this.initOpenWorldStreaming();
    buildSuwonStationLandmark(this);
    this.stations = new ServiceStations(this.propHost, this.serviceStations, this.obstacles, this.unified);
    this.stations.build();
    buildBusStops(this);
    this.initDeliveryLocations();
    this.deliveryProps = new DeliveryLocationProps(this.propHost, this.root, this.culler, this.locations);
    this.deliveryProps.build();
    buildStreetLamps(this);

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
  /** @internal world builders */
  addProp(
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

  /** Generates a realistic Korean night lit-window emissive texture (warm amber + cool white office/apt lights) */

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
