// Shared OpenStreetMap dataset interfaces for Suwon-si Multi-District Delivery Map Engine
// Attribution: © OpenStreetMap contributors (ODbL)

export type SuwonDistrictId = 'ingye' | 'haenggung' | 'suwon_station' | 'gwanggyo';

export interface OsmGraphNode {
  id: number;
  x: number;
  z: number;
  isSignal: boolean;
}

export interface OsmGraphEdge {
  a: number;
  b: number;
  dist: number;
  width: number;
  highway: string;
  name: string;
  isMajor: boolean;
}

export interface OsmBuildingData {
  name: string;
  kind: 'shop' | 'residential' | 'public';
  height: number;
  area: number;
  cx: number;
  cz: number;
  w: number;
  d: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  pts: Array<[number, number]>;
}

export interface OsmParkData {
  name: string;
  pts: Array<[number, number]>;
}

export interface OsmPlazaData {
  name: string;
  width: number;
  pts: Array<[number, number]>;
}

export interface OsmBusStopData {
  name: string;
  x: number;
  z: number;
  shelterX: number;
  shelterZ: number;
  facingHeading: number;
  edgeIndex: number;
}

export interface OsmServiceSpot {
  x: number;
  z: number;
  roadX: number;
  roadZ: number;
  facingHeading: number;
}

export interface OsmDeliverySpot {
  id: string;
  name: string;
  x: number;
  z: number;
  type: 'shop' | 'residential';
  residenceKind?: 'apartment' | 'walkup_villa' | 'officetel';
  emoji: string;
  facingHeading: number;
  menus?: string[];
}

export interface SuwonMapDataset {
  meta: {
    id?: SuwonDistrictId;
    name: string;
    shortName?: string;
    badgeLabel?: string;
    originLat: number;
    originLon: number;
    worldLimit: number;
    station: { name: string; x: number; z: number; badgeChar?: string };
    scooterSpawn: { x: number; z: number; heading: number };
    playerSpawn: { x: number; z: number; heading: number };
    /** True for the unified Suwon open world (buildings/parks/waters stream in per chunk instead) */
    unified?: boolean;
  };
  nodes: OsmGraphNode[];
  edges: OsmGraphEdge[];
  pedestrianPlazas: OsmPlazaData[];
  buildings: OsmBuildingData[];
  parks: OsmParkData[];
  waters?: OsmParkData[];
  shops: OsmDeliverySpot[];
  residences: OsmDeliverySpot[];
  busStops: OsmBusStopData[];
  serviceSpots: { gas: OsmServiceSpot; repair: OsmServiceSpot };
  /** Unified open world only: every district's gas station & repair shop (serviceSpots = spawn district's) */
  serviceSpotList?: Array<{ districtId: SuwonDistrictId; gas: OsmServiceSpot; repair: OsmServiceSpot }>;
  /** Unified open world only: extra gas stations across the city (OSM + generic) */
  fuelStations?: Array<OsmServiceSpot & { id: string; name: string }>;
}
