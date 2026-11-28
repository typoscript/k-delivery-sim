import { StreamFlood } from '../game/streamFlood';
import { FloodOverlay } from './floodOverlay';
import { BenchCustomers } from './benchCustomers';
import { SIDEWALK_MIN_OFFSET_M } from '../game/trafficViolations';
import { WALKWAY_M } from './streamPaths';
import { EMBANKMENT_M } from './openworld/ChunkMeshBuilder';
import { IceSheen } from './iceSheen';
import { StreamWater } from './streamWater';
import { StreamStrollers } from './pedestrians/streamStrollers';
import { isWadingAt } from './streamPaths';
import type { WaterLineData } from './openworld/OpenWorldTypes';
import * as THREE from 'three';
import { planStreetProps, registerStreetProps } from './streetProps';
import { activeRoadProximity } from './roadProximity';
import { excludeFromMirrors, freezeStatic, makeStaticContainer } from './renderLayers';
import { NEARBY_INSTANCES, mergeStaticByMaterial } from './instancing';
import {
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
import { ApartmentGateEvent, DeliveryLocationProps, PropColliders } from './deliveryProps';
import { SNOW_COVER, stepSnowCover } from './snowCover';
import { setFoliageSeason } from './seasonFoliage';

/** Midday sun height per season (deg): high in summer (short shadows), low in winter (long shadows) */
export const SEASON_SUN_ELEVATION_DEG: Record<SeasonId, number> = { summer: 68, spring: 52, autumn: 44, winter: 30 };
import { BlackIceField, IcePatch } from './blackIce';
import { RoadStructureIndex } from './roadStructures';
import { PuddleField } from './puddles';

/** Most puddles drawn at once (the nearest ones) */
const PUDDLE_DRAW_MAX = 160;
import type { SeasonId } from '../game/seasons';
import type { MapDetail } from './openworld/ChunkMeshBuilder';
import { buildSuwonOsmRoads, SignalHazardZone } from './roadSurfaces';
import { buildSpeedBumps } from './speedBumps';
import { buildParksAndTrees } from './parksAndTrees';
import { buildSuwonOsmBuildings, buildSuwonStationLandmark } from './cityBuildings';
import { buildBusStops, buildStreetLamps } from './streetFurniture';
import { WorldSky } from './worldSky';

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
  constructionZones?: ConstructionZoneMarker[];
  rivalRiders?: RivalRiderMarker[];
  speedBumps?: SpeedBumpInfo[];
  /** Today's black ice spots (winter nights / mornings; empty otherwise) */
  icePatches?: readonly IcePatch[];
  landmarks?: LandmarkMarker[];
  upcomingCamera?: UpcomingCameraAlert | null;
  obstacles: ObstacleBox[];
  buildings: MapBuildingFootprint[];
  /** Unified open world: parks / water / pedestrian streets of the currently streamed chunks */
  areaParks?: OsmParkData[];
  areaWaters?: OsmParkData[];
  areaPlazas?: OsmPlazaData[];
}


import {
  setSunElevation,
  initOpenWorldStreaming as initOpenWorldStreamingFn,
  updateStreaming as updateStreamingFn,
  placeSunStabilized as placeSunStabilizedFn,
  getCollisionObstacles as getCollisionObstaclesFn,
} from './cityStreaming';
import {
  buildBaseGround as buildBaseGroundFn,
  initDeliveryLocations as initDeliveryLocationsFn,
} from './cityGround';
import {
  setOutdoorVisible as setOutdoorVisibleFn,
  setWeather as setWeatherFn,
  updateWeatherVisuals as updateWeatherVisualsFn,
  applySkyTheme as applySkyThemeFn,
  setNightness as setNightnessFn,
} from './cityAtmosphere';

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
  /** @internal split modules */
  streamer?: ChunkStreamer;
  /** @internal world builders */
  readonly culler?: ProximityCuller;
  /** @internal split modules */
  streamerVersionSeen = -1;
  /** @internal split modules */
  collisionCache: ObstacleBox[] = [];
  /** @internal split modules */
  collisionStreamedRef: ObstacleBox[] | null = null;
  /** @internal colliders of lazily built props near the player (apartment cars / guard booths) */
  readonly propColliders = new PropColliders();
  /** @internal */
  collisionPropsVersion = -1;
  /** @internal world builders */
  plazaMat?: THREE.MeshStandardMaterial;
  /** @internal split modules */
  readonly tmpSunTarget = new THREE.Vector3();

  /** @internal split modules */
  readonly scene: THREE.Scene;
  /** @internal split modules */
  readonly dirLight: THREE.DirectionalLight;
  private readonly hemiLight: THREE.HemisphereLight;
  /** @internal world builders */
  readonly lampGlowMat: THREE.MeshStandardMaterial;
  private readonly windowGlowMat: THREE.MeshStandardMaterial;
  /** @internal world builders */
  readonly buildingNightMats: THREE.MeshStandardMaterial[] = [];
  /** @internal world builders */
  readonly streetLampPoolGroup = new THREE.Group();
  /** @internal shopfront materials whose signs / windows light up at night (setStorefrontNightGlow) */
  readonly nightGlowMats: THREE.Material[] = [];
  /** Roadside trees / poles / lamps and their light pools (rebuilt per map detail) */
  private readonly streetPropsGroup = new THREE.Group();
  private readonly streetPropPoolsGroup = new THREE.Group();
  private mapDetail: MapDetail = 'high';
  /** Additive night light-pool material of the street lamps (set by buildStreetLamps) */
  lampPoolMat?: THREE.Material;
  /** Pickup counters & lobby portals with their animated doors / food trays (deliveryProps.ts) */
  private deliveryProps!: DeliveryLocationProps;

  private readonly beaconGroup = new THREE.Group();
  private readonly beaconRingMat: THREE.MeshBasicMaterial;
  private readonly beaconRing: THREE.Mesh;

  public isNight = false;
  /** Sky, fog, sun / sky light and night glow for weather x time of day (worldSky.ts) */
  /** @internal split modules */
  sky!: WorldSky;
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
      icePatches: this.blackIce.patches,
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
    this.deliveryProps = new DeliveryLocationProps(
      this.propHost,
      this.root,
      this.culler,
      this.locations,
      this.culler ? (x, z) => this.isFreeGround(x, z) : undefined,
      this.propColliders
    );
    this.deliveryProps.build();
    buildStreetLamps(this);
    if (this.culler) {
      // Roadside trees / alley utility poles: planned from the road graph, built per chunk around the player
      const nodes = SUWON_OPEN_WORLD.nodes;
      const edges = SUWON_OPEN_WORLD.edges;
      const nodeMaxWidth = new Float32Array(nodes.length);
      for (const e of edges) {
        nodeMaxWidth[e.a] = Math.max(nodeMaxWidth[e.a], e.width);
        nodeMaxWidth[e.b] = Math.max(nodeMaxWidth[e.b], e.width);
      }
      const roads = activeRoadProximity();
      const props = planStreetProps(nodes, edges, nodeMaxWidth, (x, z) => roads.curbOffset(x, z));
      this.streetPropsGroup.name = 'street_props_root';
      this.root.add(this.streetPropsGroup);
      this.streetLampPoolGroup.add(this.streetPropPoolsGroup);
      registerStreetProps(
        this.culler,
        gridSpecOf(SUWON_OPEN_WORLD),
        this.streetPropsGroup,
        props,
        {
          headMaterial: this.lampGlowMat,
          poolMaterial: this.lampPoolMat!,
          poolParent: this.streetPropPoolsGroup,
        },
        () => this.mapDetail
      );
    }

    this.sky = new WorldSky({
      scene: this.scene,
      dirLight: this.dirLight,
      hemiLight: this.hemiLight,
      lampGlowMat: this.lampGlowMat,
      windowGlowMat: this.windowGlowMat,
      buildingNightMats: this.buildingNightMats,
      nightGlowMats: this.nightGlowMats,
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
  /** @internal split modules */
  sizedSidewalkTexture(): THREE.CanvasTexture {
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
    initOpenWorldStreamingFn(this);
  }

  /**
   * Per-frame open-world tick (no-op on legacy district maps): streams chunks & culls props around the
   * player, keeps the sun's shadow frustum centred on the player and refreshes the phone-map overlays.
   */
  public updateStreaming(px: number, pz: number): void {
    NEARBY_INSTANCES.update(px, pz);
    this.updatePuddleMeshes(px, pz);
    updateStreamingFn(this, px, pz);
  }

  /**
   * Sun + shadow frustum follow the player, snapped to whole shadow-map texels in light space so
   * shadow edges don't shimmer/crawl as the rider moves (standard shadow stabilization).
   */
  /** @internal split modules */
  placeSunStabilized(px: number, pz: number): void {
    placeSunStabilizedFn(this, px, pz);
  }

  /**
   * Map detail of the graphics quality: "보통" drops rooftop structures and alley poles / wires, "낮음" also
   * shopfronts, road words and every roadside tree / pole / lamp (not built at all). Rebuilds what is around now.
   */
  public setMapDetail(detail: MapDetail): void {
    if (detail === this.mapDetail) return;
    this.mapDetail = detail;
    this.streamer?.setDetail(detail);
    if (this.culler) {
      this.culler.rebuildLazy(this.streetPropsGroup);
      this.culler.rebuildLazy(this.streetPropPoolsGroup);
    }
  }

  private streamLines: WaterLineData[] = [];
  private streamLinesVersion = -1;

  /** Glassy sheen on frozen bridge decks (made the first time ice forms) */
  private iceSheen: IceSheen | null = null;

  /** Keeps the bridge-deck sheen in step with today's ice (cheap when nothing changed) */
  public syncIceSheen(): void {
    if (!this.iceSheen && !this.blackIce.isActive) return;
    if (!this.iceSheen) this.iceSheen = new IceSheen(this.root);
    this.iceSheen.sync(this.blackIce);
  }

  /** Flowing stream water material (open world only) */
  streamWater?: StreamWater;

  /** Metres from (x, z) to the nearest loaded stream's water edge (Infinity when none is loaded) */
  public distanceToStream(x: number, z: number): number {
    this.refreshStreamLines();
    let best = Infinity;
    for (const wl of this.streamLines) {
      for (let i = 1; i < wl.pts.length; i++) {
        const [px, pz] = wl.pts[i - 1];
        const [qx, qz] = wl.pts[i];
        const dx = qx - px;
        const dz = qz - pz;
        const l2 = dx * dx + dz * dz;
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - px) * dx + (z - pz) * dz) / l2)) : 0;
        best = Math.min(best, Math.hypot(x - (px + dx * t), z - (pz + dz * t)) - wl.width / 2);
      }
    }
    return best;
  }

  /** Streams rise in the rain; above the closing level the walkways are under water (see game/streamFlood) */
  public readonly streamFlood = new StreamFlood();
  private floodOverlay: FloodOverlay | null = null;

  /** Keeps the flooded-walkway water sheet in step with the flood (every frame, cheap when nothing changed) */
  public syncFloodOverlay(): void {
    if (!this.streamer || !this.streamWater) return;
    if (!this.floodOverlay) {
      if (!this.streamFlood.closed) return;
      this.floodOverlay = new FloodOverlay(this.root, this.streamWater.material);
    }
    this.refreshStreamLines();
    this.floodOverlay.sync(this.streamFlood.closed, this.streamLines, this.streamLinesVersion, this.curbOffsetFn);
  }

  /** People strolling on the stream walkways (open world only, made on first use) */
  private strollers: StreamStrollers | null = null;
  /** One stable function (the strollers cache stone rows per road grid function) */
  private readonly curbOffsetFn = (x: number, z: number) => activeRoadProximity().curbOffset(x, z);

  /** Steps the stream-walkway strollers around (px, pz); returns how many the scooter newly startled */
  public updateStreamStrollers(
    dt: number,
    px: number,
    pz: number,
    scooter?: { x: number; z: number; speed: number },
  ): number {
    if (!this.streamer) return 0;
    this.refreshStreamLines();
    if (!this.strollers) {
      if (this.streamLines.length === 0) return 0;
      this.strollers = new StreamStrollers(this.root);
    }
    this.strollers.setWeather(this.weatherMode);
    // flooded walkways: everybody has left them
    return this.strollers.update(dt, px, pz, this.streamFlood.closed ? [] : this.streamLines, this.curbOffsetFn, scooter);
  }

  /** The stream-walkway strollers (null until a stream was near) */
  public get streamStrollers(): StreamStrollers | null {
    return this.strollers;
  }

  private refreshStreamLines(): void {
    if (this.streamer && this.streamer.version !== this.streamLinesVersion) {
      this.streamLinesVersion = this.streamer.version;
      this.streamLines = this.streamer.getBuiltChunkData().flatMap((c) => c.waterLines);
    }
  }

  /**
   * On a stream walkway at (x, z): beside the water within the walkway and embankment strip, not on a road. Riding
   * there counts as sidewalk riding.
   */
  public isOnStreamWalkway(x: number, z: number): boolean {
    const d = this.distanceToStream(x, z);
    // same road clearance as the sidewalk rule: riding at a road's edge beside a stream is not walkway riding
    return d >= -0.3 && d <= WALKWAY_M + EMBANKMENT_M && activeRoadProximity().curbOffset(x, z) > SIDEWALK_MIN_OFFSET_M;
  }

  /** Standing in a stream's water at (x, z) - not on a stepping stone, bridge or road (open world only) */
  public isWadingAt(x: number, z: number): boolean {
    if (!this.streamer) return false;
    this.refreshStreamLines();
    if (this.streamLines.length === 0) return false;
    const grid = activeRoadProximity();
    // flooded: the walkways and the stepping stones are under water too
    if (this.streamFlood.closed && grid.curbOffset(x, z) >= 0.3 && this.distanceToStream(x, z) <= WALKWAY_M + 0.2) return true;
    return isWadingAt(this.streamLines, x, z, (px, pz) => grid.curbOffset(px, pz));
  }

  /**
   * Off the road (with a margin) and outside every building footprint of the chunk under (x, z): room for props
   * like parked cars. null while that chunk's buildings are not loaded yet (the caller retries later).
   */
  public isFreeGround(x: number, z: number): boolean | null {
    if (!(activeRoadProximity().curbOffset(x, z) > 0.6)) return false;
    const buildings = this.streamer?.buildingsAt(x, z);
    if (buildings === null) return null;
    for (const b of buildings ?? []) {
      if (x < b.minX - 0.3 || x > b.maxX + 0.3 || z < b.minZ - 0.3 || z > b.maxZ + 0.3) continue;
      if (pointInPolygon(x, z, b.pts)) return false;
    }
    return true;
  }

  /** Building / prop colliders relevant to the player (streamed 3x3 chunks in the unified city) */
  public getCollisionObstacles(): ObstacleBox[] {
    return getCollisionObstaclesFn(this);
  }

  /** Static containers (world root, streamed chunk root, lamp pools) skip per-frame forced matrix updates */
  public markStaticContainers(): void {
    makeStaticContainer(this.root);
    makeStaticContainer(this.streetLampPoolGroup);
    makeStaticContainer(this.streetPropsGroup);
    makeStaticContainer(this.streetPropPoolsGroup);
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
    buildBaseGroundFn(this);
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
    initDeliveryLocationsFn(this);
  }

  public setLobbyDoorOpen(locationId: string | null): void {
    this.deliveryProps.setLobbyDoorOpen(locationId);
  }

  /** Customers waiting on the stream walkway benches (made on first use) */
  private benchCustomers: BenchCustomers | null = null;

  /** Seats / stands / waves the riverside customers of the orders on their way (see benchCustomers.ts) */
  public syncBenchCustomers(
    dt: number,
    px: number,
    pz: number,
    waiting: readonly DeliveryLocation[],
    carryingTo: string | null,
  ): void {
    if (!this.benchCustomers) {
      if (waiting.length === 0) return;
      this.benchCustomers = new BenchCustomers(this.root);
    }
    this.benchCustomers.update(dt, px, pz, waiting, carryingTo);
  }

  public syncShopPickupTrays(cookingShopIds: Set<string>, readyShopIds: Set<string>, elapsedTime: number): void {
    this.deliveryProps.syncShopPickupTrays(cookingShopIds, readyShopIds, elapsedTime);
  }

  /** Apartment gate barriers / guards around the rider (see DeliveryLocationProps.updateApartmentGates) */
  public updateApartmentGates(
    dt: number,
    px: number,
    pz: number,
    riding: boolean,
    isDestination: (locationId: string) => boolean
  ): ApartmentGateEvent | null {
    return this.deliveryProps.updateApartmentGates(dt, px, pz, riding, isDestination);
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
    setOutdoorVisibleFn(this, visible);
  }

  public setWeather(mode: WeatherMode): void {
    setWeatherFn(this, mode);
  }

  /** Draws the puddles within 160 m of the player (one instanced draw call; re-picked every 30 m or on change) */
  private updatePuddleMeshes(px: number, pz: number): void {
    const key = `${this.puddles.version}|${Math.round(px / 30)}|${Math.round(pz / 30)}`;
    if (key === this.puddleDrawKey) return;
    this.puddleDrawKey = key;
    // built the first time it rains (a dry city builds exactly the same scene)
    if (!this.puddleMesh && this.puddles.puddles.length === 0) return;
    if (!this.puddleMesh) {
      const geo = new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x1f2a37,
        roughness: 0.04,
        metalness: 0.55,
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      });
      this.puddleMesh = new THREE.InstancedMesh(geo, mat, PUDDLE_DRAW_MAX);
      this.puddleMesh.name = 'rain_puddles';
      this.puddleMesh.frustumCulled = false;
      this.puddleMesh.receiveShadow = true;
      excludeFromMirrors(this.puddleMesh);
      this.root.add(this.puddleMesh);
    }
    const near = this.puddles.near(px, pz, 160).slice(0, PUDDLE_DRAW_MAX);
    const m = new THREE.Matrix4();
    near.forEach((p, i) => {
      m.makeScale(p.radius, 1, p.radius * 0.8).setPosition(p.x, 0.055, p.z);
      this.puddleMesh!.setMatrixAt(i, m);
    });
    this.puddleMesh.count = near.length;
    this.puddleMesh.instanceMatrix.needsUpdate = true;
  }

  /** Winter black ice on shaded side streets and ramps (see blackIce.ts) */
  public readonly blackIce = new BlackIceField(ACTIVE_MAP_DATA.nodes, ACTIVE_MAP_DATA.edges);
  /** Rain puddles by the curb (many more during 장마) - see puddles.ts */
  public readonly puddles = new PuddleField(ACTIVE_MAP_DATA.nodes, ACTIVE_MAP_DATA.edges);
  /** 장마 day (null until the game clock sets it) */
  public monsoon: boolean | null = null;
  private puddleMesh: THREE.InstancedMesh | null = null;
  private puddleDrawKey = '';

  /** Bridges / underpasses of the road graph (dry underpasses, icy bridges, phone map) */
  public readonly roadStructures = new RoadStructureIndex(ACTIVE_MAP_DATA.nodes, ACTIVE_MAP_DATA.edges);

  /** Season of the working day: tree crowns take its colours, the day sky its light */
  public setSeason(season: SeasonId): void {
    setFoliageSeason(season);
    setSunElevation(SEASON_SUN_ELEVATION_DEG[season]);
    this.sky.season = season;
    if (this.root.visible) this.applySkyTheme();
  }

  /** Snow settling on up-facing surfaces while it snows, melting after (see snowCover.ts) */
  public updateSnowCover(dt: number, snowing: boolean): void {
    SNOW_COVER.value = stepSnowCover(SNOW_COVER.value, snowing ? 1 : 0, dt);
  }

  public updateWeatherVisuals(rainIntensity: number, elapsedTime: number): void {
    updateWeatherVisualsFn(this, rainIntensity, elapsedTime);
  }

  /** Re-applies sky, fog, lights and night glow for the current weather and time of day */
  /** @internal split modules */
  applySkyTheme(): void {
    applySkyThemeFn(this);
  }

  /**
   * Time of day from the game clock: 0 = day, 1 = night (fractions during dusk / dawn).
   * Re-applies the sky only when it visibly changed. Returns isNight (the darker half).
   */
  public setNightness(nightness: number): boolean {
    return setNightnessFn(this, nightness);
  }
}

/** Even-odd point-in-polygon test (x/z footprint) */
function pointInPolygon(x: number, z: number, pts: ReadonlyArray<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
