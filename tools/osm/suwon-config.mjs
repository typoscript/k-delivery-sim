// Shared configuration for the unified Suwon open-world map pipeline.
//
// Coordinate system (matches the game, see CLAUDE.md): metres from WORLD_ORIGIN,
//   +Z = north, +X = WEST (heading 0 faces +Z, +X is the left of travel).
//   x = -(lon - originLon) * M_PER_DEG_LON,  z = (lat - originLat) * M_PER_DEG_LAT

/** The 4 hand-tuned legacy districts (their data files use these local origins) */
export const LEGACY_DISTRICTS = [
  { id: 'ingye', file: 'suwonIngyeData.ts', originLat: 37.262, originLon: 127.031 },
  { id: 'haenggung', file: 'suwonHaenggungData.ts', originLat: 37.281, originLon: 127.0157 },
  { id: 'suwon_station', file: 'suwonStationData.ts', originLat: 37.2665, originLon: 127.0019 },
  { id: 'gwanggyo', file: 'suwonGwanggyoData.ts', originLat: 37.2874, originLon: 127.0558 },
];

/** Legacy districts span +-410m around their origin; keep a 300m margin around the union */
const LEGACY_HALF_SIZE_M = 410;
const MARGIN_M = 300;

export const M_PER_DEG_LAT = 111_320;
/** Uses the latitude of the play-area centre (cos(37.2747 deg)) like a local equirectangular projection */
export const M_PER_DEG_LON = 111_320 * Math.cos((37.2747 * Math.PI) / 180);

const lats = LEGACY_DISTRICTS.map((d) => d.originLat);
const lons = LEGACY_DISTRICTS.map((d) => d.originLon);
const padLat = (LEGACY_HALF_SIZE_M + MARGIN_M) / M_PER_DEG_LAT;
const padLon = (LEGACY_HALF_SIZE_M + MARGIN_M) / M_PER_DEG_LON;

export const SUWON_BBOX = {
  south: +(Math.min(...lats) - padLat).toFixed(5),
  north: +(Math.max(...lats) + padLat).toFixed(5),
  west: +(Math.min(...lons) - padLon).toFixed(5),
  east: +(Math.max(...lons) + padLon).toFixed(5),
};

/** Single world origin for the merged map: centre of the bounding box */
export const WORLD_ORIGIN = {
  lat: +((SUWON_BBOX.south + SUWON_BBOX.north) / 2).toFixed(5),
  lon: +((SUWON_BBOX.west + SUWON_BBOX.east) / 2).toFixed(5),
};

/** Streaming chunk edge length in metres */
export const CHUNK_SIZE_M = 200;

export function project(lat, lon, origin = WORLD_ORIGIN) {
  return {
    x: -(lon - origin.lon) * M_PER_DEG_LON,
    z: (lat - origin.lat) * M_PER_DEG_LAT,
  };
}
