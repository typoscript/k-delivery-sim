import {
  OsmBuildingData,
  OsmBusStopData,
  OsmDeliverySpot,
  OsmGraphEdge,
  OsmGraphNode,
  OsmParkData,
  OsmPlazaData,
  OsmServiceSpot,
} from '../../data/suwonTypes';

/** Spec of the streaming chunk grid (world metres, +X = west, +Z = north) */
export interface ChunkGridSpec {
  originX: number;
  originZ: number;
  cols: number;
  rows: number;
  size: number;
}

export interface ChunkIndexEntry {
  key: string;
  ix: number;
  iz: number;
  buildings: number;
  bytes: number;
}

export interface WaterLineData {
  name: string;
  width: number;
  pts: Array<[number, number]>;
}

/** Heavy per-chunk geometry (public/map/suwon/chunks/c_<ix>_<iz>.json) */
export interface ChunkData {
  ix: number;
  iz: number;
  buildings: OsmBuildingData[];
  parks: OsmParkData[];
  waters: OsmParkData[];
  waterLines: WaterLineData[];
  pedestrianPlazas: OsmPlazaData[];
  /** Storefront signs with real names (OSM shops / services): name, centre on the wall, facing heading, width */
  signs?: StoreSignData[];
}

export interface StoreSignData {
  n: string;
  x: number;
  z: number;
  h: number;
  w: number;
}

export interface LegacyDistrictData {
  id: string;
  name: string;
  shortName: string;
  badgeLabel: string;
  origin: { x: number; z: number; lat: number; lon: number };
  halfSize: number;
  station: { name: string; x: number; z: number; badgeChar?: string };
  /** Station in district-local coordinates (landmarks are authored around it) */
  localStation: { name: string; x: number; z: number; badgeChar?: string };
  /** Named buildings of the hand-tuned district map (district-local), for landmark placement */
  namedBuildings: OsmBuildingData[];
  /** All building footprints of the hand-tuned district map as [minX, maxX, minZ, maxZ] (district-local) */
  buildingBoxes: Array<[number, number, number, number]>;
  scooterSpawn: { x: number; z: number; heading: number };
  playerSpawn: { x: number; z: number; heading: number };
  shops: OsmDeliverySpot[];
  residences: OsmDeliverySpot[];
  serviceSpots: { gas: OsmServiceSpot; repair: OsmServiceSpot };
}

/** Always-loaded open-world data (public/map/suwon/world.json) */
export interface OpenWorldData {
  meta: {
    name: string;
    attribution: string;
    osmTimestamp: string;
    origin: { lat: number; lon: number };
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
    chunkSize: number;
    chunkGrid: { originX: number; originZ: number; cols: number; rows: number };
  };
  nodes: OsmGraphNode[];
  edges: OsmGraphEdge[];
  busStops: OsmBusStopData[];
  /** Marked pedestrian crossings away from the signalized junctions (OSM), snapped onto their road */
  crossings?: CrossingData[];
  legacyDistricts: LegacyDistrictData[];
  /** Curbside shops generated from OSM food places across the whole map (outside the legacy districts) */
  generatedShops?: OsmDeliverySpot[];
  /** Customer lobbies generated from OSM residential buildings across the whole map */
  generatedResidences?: OsmDeliverySpot[];
  /** Gas stations from OSM (amenity=fuel) plus generic ones on arterials, outside the legacy districts */
  generatedFuelStations?: Array<OsmServiceSpot & { id: string; name: string }>;
  chunks: ChunkIndexEntry[];
}

export function gridSpecOf(world: OpenWorldData): ChunkGridSpec {
  return { ...world.meta.chunkGrid, size: world.meta.chunkSize };
}

/** A painted crosswalk across a road: centre, the road's heading and width, signalized (mid-block lights) or not */
export interface CrossingData {
  x: number;
  z: number;
  h: number;
  w: number;
  sig?: boolean;
}
