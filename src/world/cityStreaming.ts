import { steppingStoneRows } from './streamPaths';
import { activeRoadProximity } from './roadProximity';
import { StreamWater } from './streamWater';
/** Open-world chunk streaming around the player, the sun that follows it, and nearby collision boxes */
import type { CityWorld } from './CityWorld';
import { createRoadEdgeMaterials, createRoadTextMaterial, createStorefrontMaterials } from './openworld/openWorldMaterials';
import * as THREE from 'three';
import { createBuildingMaterials } from './cityTextures';
import { ObstacleBox } from '../types';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import { SUWON_OPEN_WORLD } from '../data/suwonUnified';
import { OsmParkData, OsmPlazaData } from '../data/suwonTypes';
import { ChunkStreamer } from './openworld/ChunkStreamer';
import { applySnowCover } from './snowCover';

/** Sun direction (target -> sun) used by the stabilized follow-the-player shadow frustum */
const SUN_OFFSET = new THREE.Vector3(160, 240, 120);
const SUN_DISTANCE = SUN_OFFSET.length();
/** Default sun height above the horizon (deg) - the seasons move it (setSunElevation) */
export const DEFAULT_SUN_ELEVATION_DEG = (Math.atan2(240, Math.hypot(160, 120)) * 180) / Math.PI;
const SUN_OFFSET_DIR = SUN_OFFSET.clone().normalize();
const SUN_LIGHT_RIGHT = new THREE.Vector3(0, 1, 0).cross(SUN_OFFSET_DIR).normalize();
const SUN_LIGHT_UP = SUN_OFFSET_DIR.clone().cross(SUN_LIGHT_RIGHT).normalize();

/**
 * Sun height of the season (same compass direction): a high summer sun casts short shadows, a low winter sun long
 * ones. Recomputes the light-space basis the stabilized shadow uses.
 */
export function setSunElevation(deg: number): void {
  const az = Math.atan2(SUN_OFFSET.z, SUN_OFFSET.x);
  const el = (deg * Math.PI) / 180;
  SUN_OFFSET_DIR.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
  SUN_LIGHT_RIGHT.set(0, 1, 0).cross(SUN_OFFSET_DIR).normalize();
  SUN_LIGHT_UP.copy(SUN_OFFSET_DIR).cross(SUN_LIGHT_RIGHT).normalize();
}

/** Current direction from the ground toward the sun (tests / debugging) */
export function sunDirection(): THREE.Vector3 {
  return SUN_OFFSET_DIR.clone();
}

/** Unified open world: buildings, road surfaces, parks, water & pedestrian streets stream per 200m chunk */
export function initOpenWorldStreaming(host: CityWorld): void {
  if (!host.unified) return;
  const b = createBuildingMaterials();
  host.buildingNightMats.push(b.shopWallMat, b.aptWallMat, b.villaWallMat, b.publicWallMat);
  // chunk walls carry a per-building paint tint (vertex colours) on top of the facade texture
  for (const m of [b.shopWallMat, b.aptWallMat, b.villaWallMat, b.publicWallMat]) m.vertexColors = true;
  const shopfront = createStorefrontMaterials();
  // snow settles on roofs, parks, plazas and (as slush) the roads
  const park = new THREE.MeshStandardMaterial({ color: 0x4b9454, roughness: 0.92 });
  const plaza = host.plazaMat ?? new THREE.MeshStandardMaterial({ color: 0xc29e83, roughness: 0.84 });
  const farBuildings = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  for (const m of [b.roofMat, park, plaza, farBuildings]) applySnowCover(m);
  applySnowCover(host.asphaltMat, 0.3);
  host.nightGlowMats.push(shopfront.storefront);
  host.streamer = new ChunkStreamer(
    host.root,
    SUWON_OPEN_WORLD,
    {
      walls: { shop: b.shopWallMat, apt: b.aptWallMat, villa: b.villaWallMat, public: b.publicWallMat },
      roof: b.roofMat,
      road: host.asphaltMat,
      roadLine: new THREE.MeshBasicMaterial({ color: 0xfacc15 }),
      park,
      water: new THREE.MeshStandardMaterial({
        color: 0x0284c7,
        emissive: 0x0369a1,
        emissiveIntensity: 0.18,
        roughness: 0.14,
        metalness: 0.38,
      }),
      plaza,
      farBuildings,
      stream: (host.streamWater = new StreamWater()).material,
      ...shopfront,
      ...createRoadEdgeMaterials(),
      ...createRoadTextMaterial(),
    },
    { chunkBaseUrl: './map/suwon/chunks/' },
  );
  // Fog hides everything past ~400m: a tighter shadow frustum (±220m instead of ±310m) gives
  // sharper shadows for the same map size
  const sc = host.dirLight.shadow.camera;
  sc.left = -220;
  sc.right = 220;
  sc.top = 220;
  sc.bottom = -220;
  sc.updateProjectionMatrix();
  const spawn = ACTIVE_MAP_DATA.meta.playerSpawn;
  host.updateStreaming(spawn.x, spawn.z);
}

/**
 * Per-frame open-world tick (no-op on legacy district maps): streams chunks & culls props around the
 * player, keeps the sun's shadow frustum centred on the player and refreshes the phone-map overlays.
 */
export function updateStreaming(host: CityWorld, px: number, pz: number): void {
  if (!host.streamer) return;
  host.streamer.update(px, pz);
  host.culler?.update(px, pz);
  host.placeSunStabilized(px, pz);
  if (host.streamer.version !== host.streamerVersionSeen) {
    host.streamerVersionSeen = host.streamer.version;
    const chunks = host.streamer.getBuiltChunkData();
    host.buildings.length = 0;
    const parks: OsmParkData[] = [];
    const waters: OsmParkData[] = [];
    const plazas: OsmPlazaData[] = [];
    for (const c of chunks) {
      for (const bd of c.buildings) {
        host.buildings.push({
          x: bd.cx,
          z: bd.cz,
          w: bd.w,
          d: bd.d,
          pts: bd.pts,
          label: bd.name ? bd.name.slice(0, 12) : undefined,
          kind: bd.kind,
        });
      }
      parks.push(...c.parks);
      waters.push(...c.waters);
      plazas.push(...c.pedestrianPlazas);
    }
    // streams for the phone map: water, walkways, stepping stones, benches
    const streams = chunks.flatMap((c) => c.waterLines);
    const grid = activeRoadProximity();
    host.mapInfo.areaStreams = streams;
    host.mapInfo.streamStoneRows = streams.flatMap((wl) =>
      steppingStoneRows(wl, (x, z) => grid.curbOffset(x, z)).map((r) => {
        const a = r.stones[0];
        const b = r.stones[r.stones.length - 1];
        return [a[0], a[1], b[0], b[1]] as [number, number, number, number];
      }),
    );
    host.mapInfo.streamBenches ??= host.locations.filter((l) => l.residenceKind === 'riverside').map((l) => ({ x: l.x, z: l.z }));
    host.mapInfo.areaParks = parks;
    host.mapInfo.areaWaters = waters;
    host.mapInfo.areaPlazas = plazas;
  }
}

/**
 * Sun + shadow frustum follow the player, snapped to whole shadow-map texels in light space so
 * shadow edges don't shimmer/crawl as the rider moves (standard shadow stabilization).
 */
export function placeSunStabilized(host: CityWorld, px: number, pz: number): void {
  const cam = host.dirLight.shadow.camera;
  const texel = (cam.right - cam.left) / Math.max(1, host.dirLight.shadow.mapSize.x);
  // Light-space basis of the shadow camera (it looks from the sun toward the target, up = +Y)
  const z = SUN_OFFSET_DIR;
  const x = SUN_LIGHT_RIGHT;
  const y = SUN_LIGHT_UP;
  const t = host.tmpSunTarget.set(px, 0, pz);
  const tx = t.dot(x);
  const ty = t.dot(y);
  t.addScaledVector(x, Math.round(tx / texel) * texel - tx).addScaledVector(y, Math.round(ty / texel) * texel - ty);
  host.dirLight.target.position.copy(t);
  host.dirLight.position.copy(t).addScaledVector(z, SUN_DISTANCE);
}

/** Building / prop colliders relevant to the player (streamed 3x3 chunks in the unified city) */
export function getCollisionObstacles(host: CityWorld): ObstacleBox[] {
  if (!host.streamer) return host.obstacles;
  const streamed = host.streamer.collisionObstacles;
  const props = host.propColliders;
  if (streamed !== host.collisionStreamedRef || props.version !== host.collisionPropsVersion) {
    host.collisionStreamedRef = streamed;
    host.collisionPropsVersion = props.version;
    const extra = props.all;
    host.collisionCache =
      host.obstacles.length > 0 || extra.length > 0 ? [...host.obstacles, ...extra, ...streamed] : streamed;
  }
  return host.collisionCache;
}
