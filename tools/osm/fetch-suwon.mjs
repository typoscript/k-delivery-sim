#!/usr/bin/env node
// Downloads raw OpenStreetMap data for the whole Suwon play area (all 4 districts + the land between)
// from the public Overpass API and caches it in tools/osm/cache/suwon-raw.json.
//
// Usage:  node tools/osm/fetch-suwon.mjs [--force] [--crossings]   (OVERPASS_URL=... to use a single mirror)
//         --crossings: only the pedestrian crossings (highway=crossing nodes, footway=crossing ways) into
//         cache/suwon-crossings.json, so they can be added without re-downloading (and changing) the rest
// Data:   © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUWON_BBOX } from './suwon-config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CROSSINGS_ONLY = process.argv.includes('--crossings');
const OUT = join(HERE, 'cache', CROSSINGS_ONLY ? 'suwon-crossings.json' : 'suwon-raw.json');
/** OVERPASS_URL=<interpreter url> forces one mirror (useful when the others are down or timing out) */
const ENDPOINTS = process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
/** The area is split into TILES_X x TILES_Y sub-queries so busy public servers can answer each one */
const TILES_X = 3;
const TILES_Y = 2;

// Roads (drivable), signals, bus stops, buildings, parks/green, water, pedestrian areas & streets,
// food places (generated delivery shops), named residential areas (apartment complex names) and gas stations
const buildQuery = (bb) => `
[out:json][timeout:300];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"](${bb});
  node["highway"="traffic_signals"](${bb});
  node["highway"="bus_stop"](${bb});
  way["building"](${bb});
  relation["building"](${bb});
  way["leisure"~"^(park|garden|playground)$"](${bb});
  relation["leisure"="park"](${bb});
  way["landuse"~"^(grass|recreation_ground|village_green)$"](${bb});
  way["natural"="water"](${bb});
  relation["natural"="water"](${bb});
  way["waterway"~"^(river|stream|canal)$"](${bb});
  way["highway"="pedestrian"](${bb});
  way["area:highway"="pedestrian"](${bb});
  node["amenity"~"^(restaurant|fast_food|cafe|food_court|ice_cream|pub|bar)$"](${bb});
  way["amenity"~"^(restaurant|fast_food|cafe|food_court|ice_cream|pub|bar)$"](${bb});
  node["shop"~"^(bakery|pastry|confectionery|deli)$"](${bb});
  node["amenity"="fuel"](${bb});
  way["amenity"="fuel"](${bb});
  way["landuse"="residential"]["name"](${bb});
  relation["landuse"="residential"]["name"](${bb});
);
out body geom qt;
`;

/** Pedestrian crossings: crossing nodes on the roads and the crossing ways drawn over them */
const buildCrossingsQuery = (bb) => `
[out:json][timeout:180];
(
  node["highway"="crossing"](${bb});
  way["footway"="crossing"](${bb});
);
out body geom qt;
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchTile(bb, label) {
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const t0 = Date.now();
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'k-delivery-sim-map-builder/1.0 (https://github.com/typoscript/k-delivery-sim)',
        },
        body: 'data=' + encodeURIComponent((CROSSINGS_ONLY ? buildCrossingsQuery : buildQuery)(bb)),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.remark && /error|timed out/i.test(json.remark)) throw new Error(json.remark);
      console.log(`  ${label}: ${json.elements.length} elements from ${new URL(url).host} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return json;
    } catch (e) {
      lastErr = e;
      const wait = Math.min(60_000, 4000 * 2 ** attempt);
      console.warn(`  ${label}: ${new URL(url).host} failed (${e.message}), retry in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

async function main() {
  const force = process.argv.includes('--force');
  if (!force) {
    try {
      const s = await stat(OUT);
      console.log(`cache exists (${(s.size / 1e6).toFixed(1)} MB): ${OUT}  (use --force to re-download)`);
      return;
    } catch {
      // not cached yet
    }
  }
  await mkdir(dirname(OUT), { recursive: true });
  const { south, west, north, east } = SUWON_BBOX;
  const dLat = (north - south) / TILES_Y;
  const dLon = (east - west) / TILES_X;
  const byKey = new Map();
  let timestamp = '';
  for (let ty = 0; ty < TILES_Y; ty++) {
    for (let tx = 0; tx < TILES_X; tx++) {
      const bb = [south + ty * dLat, west + tx * dLon, south + (ty + 1) * dLat, west + (tx + 1) * dLon]
        .map((v) => v.toFixed(5))
        .join(',');
      const json = await fetchTile(bb, `tile ${tx},${ty}`);
      timestamp = json.osm3s?.timestamp_osm_base ?? timestamp;
      // Ways crossing tile borders appear in several tiles with identical full geometry -> dedupe
      for (const el of json.elements) byKey.set(`${el.type}/${el.id}`, el);
    }
  }
  const merged = {
    version: 0.6,
    generator: 'k-delivery-sim fetch-suwon (tiled Overpass)',
    osm3s: { timestamp_osm_base: timestamp, copyright: '© OpenStreetMap contributors, ODbL 1.0' },
    bbox: SUWON_BBOX,
    elements: [...byKey.values()],
  };
  const text = JSON.stringify(merged);
  await writeFile(OUT, text);
  console.log(`saved ${merged.elements.length} unique elements (${(text.length / 1e6).toFixed(1)} MB) -> ${OUT}`);
  console.log(`osm timestamp: ${timestamp}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
