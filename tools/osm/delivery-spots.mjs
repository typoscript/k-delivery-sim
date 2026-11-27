// Generated delivery spots for the unified Suwon open world: real OSM food places become pickup shops and
// residential buildings become customer lobbies, so calls exist everywhere on the map (not only in the
// 4 hand-tuned districts). Used by build-suwon-map.mjs; pure functions here are unit tested.
//
// Spot convention (same as the hand-tuned district data): (x, z) is where the rider stands on the curb,
// half the road width + CURB_OFFSET_M from the road centre line, and facingHeading points from the
// building toward the road. The counter / lobby prop is drawn 1.1m behind the spot (toward the building).
// Data: © OpenStreetMap contributors, ODbL 1.0

/** Rider stands this far outside the road edge (legacy spots: 0.5~1.5m) */
export const CURB_OFFSET_M = 1.0;
/** The game draws the pickup counter / lobby portal this far behind the spot */
export const PROP_BACK_M = 1.1;
/** Food place or building must be this close to a drivable road to get a curbside spot */
export const MAX_ROAD_DIST_M = 45;
export const SHOP_SPACING_M = 45;
export const RESIDENCE_SPACING_M = 40;
/** Minimum distance between any two spots / to a bus stop shelter or service spot */
export const ANY_SPOT_SPACING_M = 9;
/** Keep spots away from junction centres (degree >= 3 nodes) so props never stand in a crossing */
export const JUNCTION_CLEARANCE_M = 11;
export const MAX_SHOPS_PER_CHUNK = 3;
/** Gap-filling local shops (no OSM food place nearby) need this much room from any other shop */
export const FILL_SHOP_SPACING_M = 150;
export const MAX_RESIDENCES_PER_CHUNK = 4;

// ---------------------------------------------------------------- shop categories
// Menu names carry the keywords DeliveryManager.classifyMenuFood() uses for hot/cold & spill physics.
export const SHOP_CATEGORIES = [
  { id: 'mara', emoji: '🌶️', keys: ['마라'], menus: ['마라탕 2단계 + 꿔바로우', '마라샹궈 小 + 공깃밥', '마라탕 + 계란볶음밥'] },
  { id: 'chicken', emoji: '🍗', keys: ['치킨', '통닭', '닭강정', 'bbq', 'bhc', '교촌', '굽네', '네네', '처갓집', '호식이', '페리카나', '푸라닭', '노랑통닭', '자담'], cuisine: ['chicken', 'fried_chicken'], menus: ['후라이드 치킨 + 콜라', '양념반 후라이드반 + 치즈볼', '간장 마늘 치킨 + 감자튀김'] },
  { id: 'jjimdak', emoji: '🍗', keys: ['찜닭', '닭갈비'], menus: ['안동찜닭 中 + 당면 추가', '춘천 닭갈비 2인 + 볶음밥', '치즈 닭갈비 + 주먹밥'] },
  { id: 'pizza', emoji: '🍕', keys: ['피자', 'pizza'], cuisine: ['pizza'], menus: ['페퍼로니 피자 L + 콜라', '불고기 피자 + 치즈 오븐 스파게티', '고구마 피자 L + 치킨윙'] },
  { id: 'burger', emoji: '🍔', keys: ['버거', 'burger', '맥도날드', '롯데리아', 'kfc', '맘스터치', '프랭크'], cuisine: ['burger'], menus: ['불고기 버거 세트', '더블 치즈버거 + 콜라', '치킨 버거 세트 + 너겟'] },
  { id: 'chinese', emoji: '🥟', keys: ['반점', '짬뽕', '짜장', '중화', '중국', '차이나', '홍콩', '마라샹', '딤섬', '만두'], cuisine: ['chinese'], menus: ['짜장면 + 탕수육 小', '차돌 짬뽕 + 군만두', '짬뽕밥 + 깐풍기'] },
  { id: 'gukbap', emoji: '🍲', keys: ['국밥', '해장', '순대', '곰탕', '설렁탕', '감자탕', '뼈', '육개장', '닭개장'], menus: ['진한 돼지국밥 특', '얼큰 순대국밥 + 수육', '선지 해장국 + 공깃밥'] },
  { id: 'jjigae', emoji: '🍲', keys: ['찌개', '부대', '전골'], menus: ['부대찌개 2인 + 라면사리', '김치찌개 정식 + 계란말이', '된장찌개 + 제육볶음'] },
  { id: 'bunsik', emoji: '🍢', keys: ['분식', '떡볶이', '김밥', '엽기', '신전', '오뎅', '어묵'], menus: ['떡볶이 + 순대 + 튀김', '참치김밥 2줄 + 라볶이', '로제 떡볶이 + 오뎅탕'] },
  { id: 'jokbal', emoji: '🥩', keys: ['족발', '보쌈'], menus: ['앞다리 족발 中 + 막국수', '보쌈 정식 + 김치', '반반 족발·보쌈 2인'] },
  { id: 'meat', emoji: '🥩', keys: ['고기', '갈비', '삼겹', '정육', '숯불', '곱창', '막창', '돼지', '한우'], cuisine: ['barbecue', 'korean_barbecue'], menus: ['숯불 돼지갈비 2인 + 공깃밥', '삼겹살 도시락 + 된장찌개', '곱창 볶음 + 볶음밥'] },
  { id: 'japanese', emoji: '🍣', keys: ['초밥', '스시', '돈까스', '돈카츠', '카츠', '라멘', '일식', '이자카야', '덮밥', '텐동'], cuisine: ['japanese', 'sushi', 'ramen'], menus: ['모둠 초밥 12p + 우동', '로스 돈까스 정식 + 모밀', '돈코츠 라멘 + 교자'] },
  { id: 'pho', emoji: '🍜', keys: ['쌀국수', '베트남', '포메인', '분짜', '태국', '팟타이'], cuisine: ['vietnamese', 'thai'], menus: ['소고기 쌀국수 + 짜조', '분짜 세트 + 쌀국수 小', '팟타이 + 똠얌 쌀국수'] },
  { id: 'naengmyeon', emoji: '🍜', keys: ['냉면', '막국수', '칼국수', '국수', '우동'], cuisine: ['noodle'], menus: ['물냉면 + 숯불고기', '바지락 칼국수 + 만두', '비빔막국수 + 수육'] },
  { id: 'western', emoji: '🍝', keys: ['파스타', '스파게티', '양식', '스테이크', '브런치', '샐러드'], cuisine: ['italian', 'western', 'steak_house'], menus: ['토마토 파스타 + 리조또', '크림 파스타 + 시저 샐러드', '스테이크 덮밥 세트'] },
  { id: 'icecream', emoji: '🍨', keys: ['아이스크림', '배스킨', '설빙', '빙수', '요거트', '젤라또'], cuisine: ['ice_cream', 'frozen_yogurt'], amenity: ['ice_cream'], menus: ['아이스크림 파인트 + 콘', '인절미 빙수 + 아이스 아메리카노', '딸기 스무디 2잔'] },
  { id: 'bakery', emoji: '🥐', keys: ['베이커리', '빵', '파리바게', '뚜레쥬르', '제과', '케이크', '도넛', '던킨'], cuisine: ['bakery', 'donut', 'cake'], shop: ['bakery', 'pastry', 'confectionery', 'deli'], menus: ['생크림 케이크 1호', '소금빵 3개 + 아이스 아메리카노', '샌드위치 + 우유 세트'] },
  { id: 'cafe', emoji: '☕', keys: ['카페', '커피', 'cafe', 'coffee', '스타벅스', '이디야', '투썸', '빽다방', '메가', '컴포즈', '할리스', '폴바셋', '탐앤탐스', '공차'], cuisine: ['coffee_shop', 'coffee', 'bubble_tea', 'tea'], amenity: ['cafe'], menus: ['아이스 아메리카노 2잔', '카페 라떼 + 크루아상', '딸기 스무디 + 생크림 케이크 조각'] },
  { id: 'pub', emoji: '🍺', keys: ['포차', '호프', '주점', '맥주', '술집', '이자카'], amenity: ['pub', 'bar'], menus: ['모둠 전 + 오뎅탕', '국물 닭발 + 주먹밥', '치킨 가라아게 + 감자튀김'] },
  { id: 'fastfood', emoji: '🍟', keys: [], amenity: ['fast_food', 'food_court'], menus: ['치킨 버거 세트', '핫도그 + 감자튀김', '타코 2개 + 나초'] },
  { id: 'korean', emoji: '🍚', keys: [], menus: ['제육볶음 정식', '김치찌개 + 계란말이', '불고기 덮밥 세트'] },
];

/** Category of a food place from its name (keywords win), then cuisine / amenity / shop tags */
export function classifyShop(tags) {
  const name = String(tags.name ?? tags['name:ko'] ?? '').toLowerCase();
  const cuisines = String(tags.cuisine ?? '')
    .toLowerCase()
    .split(/[;,]/)
    .map((s) => s.trim());
  for (const c of SHOP_CATEGORIES) if (c.keys.some((k) => name.includes(k))) return c;
  for (const c of SHOP_CATEGORIES) if (c.cuisine?.some((k) => cuisines.includes(k))) return c;
  for (const c of SHOP_CATEGORIES) if (c.amenity?.includes(tags.amenity) || c.shop?.includes(tags.shop)) return c;
  return SHOP_CATEGORIES.at(-1);
}

export const FOOD_AMENITIES = new Set(['restaurant', 'fast_food', 'cafe', 'food_court', 'ice_cream', 'pub', 'bar']);
export const FOOD_SHOPS = new Set(['bakery', 'pastry', 'confectionery', 'deli']);
export const isFoodPlace = (t) => !!t && (FOOD_AMENITIES.has(t.amenity) || FOOD_SHOPS.has(t.shop));

// Gap-filling neighbourhood shops: OSM lists only a few hundred named food places in the area, so commercial
// buildings and arterial-side low-rise buildings (Korean ground-floor shops) get generic local shop names.
// Neutral prefixes and category nouns only: never a real brand.
const FILL_PREFIX = ['소문난', '원조', '옛날', '장수', '명가', '황금', '24시', '본가', '우리동네', '맛있는', '할매', '시골', '대박', '진', '새벽'];
export const FILL_CATEGORIES = [
  ['chicken', '치킨', 3],
  ['korean', '한식당', 2],
  ['chinese', '반점', 2],
  ['bunsik', '분식', 2],
  ['cafe', '커피', 2],
  ['pizza', '피자', 1],
  ['gukbap', '국밥', 1],
  ['jokbal', '족발', 1],
  ['meat', '숯불갈비', 1],
  ['japanese', '돈까스', 1],
  ['jjimdak', '찜닭', 1],
  ['burger', '수제버거', 1],
  ['pho', '쌀국수', 1],
  ['bakery', '베이커리', 1],
  ['mara', '마라탕', 1],
];
const FILL_TOTAL = FILL_CATEGORIES.reduce((s, c) => s + c[2], 0);

/** Deterministic generic shop (category + name) for a gap-filling building from two 0..1 hashes */
export function fillShop(h1, h2) {
  let acc = 0;
  let entry = FILL_CATEGORIES[0];
  for (const c of FILL_CATEGORIES) {
    acc += c[2] / FILL_TOTAL;
    if (h1 < acc) {
      entry = c;
      break;
    }
  }
  const cat = SHOP_CATEGORIES.find((c) => c.id === entry[0]);
  return { cat, name: `${pick(FILL_PREFIX, h2)} ${entry[1]}` };
}

// ---------------------------------------------------------------- residence kinds & names
const VILLA_PREFIX = ['그린', '한빛', '햇살', '소나무', '은하', '미래', '행복', '해오름', '대명', '삼정', '우정', '청솔', '목련', '장미', '세종', '정원', '동아', '한솔', '새봄', '하늘'];
const VILLA_SUFFIX = ['빌라', '하이츠', '맨션', '빌', '캐슬', '파크빌', '하우스'];
const APT_PREFIX = ['푸른', '신원', '현대', '삼익', '동신', '벽산', '한양', '우성', '주공', '두산'];
const VILLA_TYPES = new Set(['apartments', 'residential', 'house', 'detached', 'terrace', 'semidetached_house', 'dormitory', 'yes']);

/** Deterministic pick from a list using a 0..1 hash */
const pick = (list, h) => list[Math.min(list.length - 1, Math.floor(h * list.length))];

/**
 * Residence kind for a building, or null if it should not be a delivery customer.
 * apartment = big/tall apartment block, walkup_villa = low-rise housing (stairs), officetel by name.
 */
export function residenceKindOf(tags, area, height) {
  const name = String(tags.name ?? '');
  if (name.includes('오피스텔')) return 'officetel';
  if (tags.building === 'apartments' && (area > 300 || height >= 20)) return 'apartment';
  if (VILLA_TYPES.has(tags.building) && height <= 16 && area >= 80 && area <= 650) return 'walkup_villa';
  return null;
}

/**
 * Customer-facing name. Uses the OSM building name, prefixed by the apartment complex name for bare
 * "101동" style names; unnamed buildings get a deterministic plausible Korean name from the OSM id hash.
 */
export function residenceName(kind, tags, complexName, h1, h2) {
  let raw = String(tags.name ?? '').trim();
  // "1002" / "제101동" / "A동" are block numbers inside a complex, not a building name
  if (/^\d+$/.test(raw)) raw = `${raw}동`;
  const bareDong = /^(제\s*)?\d+\s*동$/.test(raw) || /^[A-Z가-하]\s*동$/.test(raw);
  if (raw && !bareDong) return raw;
  if (kind === 'apartment') {
    const dong = raw || `${101 + Math.floor(h2 * 12)}동`;
    return `${complexName || `${pick(APT_PREFIX, h1)}아파트`} ${dong}`;
  }
  if (kind === 'officetel') return raw ? `${complexName ?? ''} ${raw}`.trim() : `${pick(VILLA_PREFIX, h1)} 오피스텔`;
  const base = complexName && !/아파트|단지/.test(complexName) ? complexName : `${pick(VILLA_PREFIX, h1)}${pick(VILLA_SUFFIX, h2)}`;
  return raw ? `${base} ${raw}` : h2 < 0.45 ? base : `${base} ${'ABC'[Math.floor(h2 * 3) % 3]}동`;
}

export const RESIDENCE_EMOJI = { apartment: '🏢', walkup_villa: '🏠', officetel: '🏬' };

// ---------------------------------------------------------------- geometry
export function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Closest point on segment a-b to p */
export function projectOnSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  const x = ax + dx * t;
  const z = az + dz * t;
  return { x, z, t, d: Math.hypot(px - x, pz - z) };
}

/**
 * Curbside spot for a target point beside a road edge: stands CURB_OFFSET_M outside the road edge on the
 * target's side, facing the road. Returns the spot and the prop centre (PROP_BACK_M behind, toward the target).
 */
export function curbSpot(tx, tz, ax, az, bx, bz, roadWidth) {
  const p = projectOnSegment(tx, tz, ax, az, bx, bz);
  const len = Math.hypot(bx - ax, bz - az) || 1;
  const fx = (bx - ax) / len;
  const fz = (bz - az) / len;
  // edge normal (forward x up = (-fz, fx)); flip toward the target side
  let nx = -fz;
  let nz = fx;
  if ((tx - p.x) * nx + (tz - p.z) * nz < 0) {
    nx = -nx;
    nz = -nz;
  }
  const off = roadWidth / 2 + CURB_OFFSET_M;
  const x = p.x + nx * off;
  const z = p.z + nz * off;
  return {
    x,
    z,
    // heading = direction (sin h, cos h) the spot faces: from the building (+n side) toward the road (-n)
    facingHeading: Math.atan2(-nx, -nz),
    propX: x + nx * PROP_BACK_M,
    propZ: z + nz * PROP_BACK_M,
    t: p.t,
    roadDist: p.d,
    nx,
    nz,
  };
}

/** Uniform grid of items by bounding box for radius queries */
export class GridIndex {
  constructor(cell = 50) {
    this.cell = cell;
    this.map = new Map();
  }
  add(item, minX, minZ, maxX, maxZ) {
    const c = this.cell;
    for (let ix = Math.floor(minX / c); ix <= Math.floor(maxX / c); ix++) {
      for (let iz = Math.floor(minZ / c); iz <= Math.floor(maxZ / c); iz++) {
        const k = `${ix},${iz}`;
        (this.map.get(k) ?? this.map.set(k, []).get(k)).push(item);
      }
    }
  }
  query(x, z, r) {
    const c = this.cell;
    const out = new Set();
    for (let ix = Math.floor((x - r) / c); ix <= Math.floor((x + r) / c); ix++) {
      for (let iz = Math.floor((z - r) / c); iz <= Math.floor((z + r) / c); iz++) {
        for (const it of this.map.get(`${ix},${iz}`) ?? []) out.add(it);
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------- generator
/** Deterministic 0..1 hash of an integer (+ salt) */
export function hash01(n, salt = 0) {
  let h = ((n ^ (salt * 0x9e3779b9)) * 2654435761) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function ringDist(x, z, ring) {
  let d = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    d = Math.min(d, projectOnSegment(x, z, ring[j][0], ring[j][1], ring[i][0], ring[i][1]).d);
  }
  return d;
}

const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * Builds curbside shop & residence spots for the whole open world (outside the hand-tuned districts).
 * Deterministic for the same input. Every spot is beside a drivable non-trunk road of the main graph,
 * off every road surface, away from junction centres, outside all buildings and spaced from other spots.
 */
export function generateDeliverySpots({ elements, buildings, nodes, edges, busStops, legacyDistricts, chunkOf, project, outerRing }) {
  const stats = { shopCandidates: 0, residenceCandidates: 0, rejected: {} };
  const reject = (why) => {
    stats.rejected[why] = (stats.rejected[why] ?? 0) + 1;
    return null;
  };

  // ---- spatial indices
  const edgeIdx = new GridIndex(50);
  edges.forEach((e, i) => {
    const a = nodes[e.a];
    const b = nodes[e.b];
    const h = e.width / 2;
    edgeIdx.add(i, Math.min(a.x, b.x) - h, Math.min(a.z, b.z) - h, Math.max(a.x, b.x) + h, Math.max(a.z, b.z) + h);
  });
  const deg = new Array(nodes.length).fill(0);
  for (const e of edges) deg[e.a]++, deg[e.b]++;
  const junctionIdx = new GridIndex(50);
  for (const n of nodes) if (deg[n.id] >= 3) junctionIdx.add(n, n.x, n.z, n.x, n.z);
  const bIdx = new GridIndex(50);
  for (const b of buildings) bIdx.add(b, b.minX, b.minZ, b.maxX, b.maxZ);

  // named residential areas = apartment complex names ("OO아파트", "OO마을 O단지")
  const complexIdx = new GridIndex(100);
  for (const el of elements) {
    if (el.tags?.landuse !== 'residential' || !el.tags.name) continue;
    const ring = outerRing(el);
    if (!ring || ring.length < 3) continue;
    const pts = ring.map((p) => [p.x, p.z]);
    const xs = pts.map((p) => p[0]);
    const zs = pts.map((p) => p[1]);
    const box = [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
    complexIdx.add({ name: el.tags.name, ring: pts, size: (box[2] - box[0]) * (box[3] - box[1]) }, ...box);
  }
  const complexAt = (x, z) => {
    let best = null;
    for (const c of complexIdx.query(x, z, 0)) if (pointInRing(x, z, c.ring) && (!best || c.size < best.size)) best = c;
    return best?.name ?? null;
  };

  const inLegacy = (x, z) =>
    legacyDistricts.some((d) => Math.abs(x - d.origin.x) <= d.halfSize && Math.abs(z - d.origin.z) <= d.halfSize);

  // ---- occupied points: every spot, bus shelters and the hand-tuned service spots
  const anyIdx = new GridIndex(50);
  const occupy = (x, z) => anyIdx.add({ x, z }, x, z, x, z);
  for (const s of busStops) occupy(s.shelterX, s.shelterZ), occupy(s.x, s.z);
  for (const d of legacyDistricts) {
    for (const s of [d.serviceSpots.gas, d.serviceSpots.repair, ...d.shops, ...d.residences]) occupy(s.x, s.z);
  }
  const near = (idx, x, z, r) => [...idx.query(x, z, r)].some((p) => Math.hypot(p.x - x, p.z - z) < r);

  const onOtherRoad = (x, z, ownEdge, margin) => {
    for (const j of edgeIdx.query(x, z, 12)) {
      if (j === ownEdge) continue;
      const e = edges[j];
      const a = nodes[e.a];
      const b = nodes[e.b];
      if (projectOnSegment(x, z, a.x, a.z, b.x, b.z).d < e.width / 2 + margin) return true;
    }
    return false;
  };

  /** Curbside spot for target points (a POI or a building outline), or null with a counted reason */
  const place = (targets, own, majorOnly = false) => {
    let best = null;
    const probe = targets[0];
    for (const i of edgeIdx.query(probe[0], probe[1], MAX_ROAD_DIST_M + 60)) {
      const e = edges[i];
      if (e.highway === 'trunk' || e.highway.endsWith('_link')) continue;
      if (majorOnly && !e.isMajor) continue;
      const a = nodes[e.a];
      const b = nodes[e.b];
      for (const [tx, tz] of targets) {
        const gap = projectOnSegment(tx, tz, a.x, a.z, b.x, b.z).d - e.width / 2;
        if (gap < 0.5 || gap > MAX_ROAD_DIST_M) continue;
        if (!best || gap < best.gap) best = { i, gap, tx, tz };
      }
    }
    if (!best) return reject('noRoad');
    const e = edges[best.i];
    const a = nodes[e.a];
    const b = nodes[e.b];
    const s = curbSpot(best.tx, best.tz, a.x, a.z, b.x, b.z, e.width);
    if (inLegacy(s.x, s.z)) return reject('legacyArea');
    // the 3m-wide counter / lobby must stay off every other road surface (no props inside crossings)
    const tx = -s.nz;
    const tz = s.nx;
    for (const [px, pz] of [[s.x, s.z], [s.propX, s.propZ], [s.propX + tx * 1.5, s.propZ + tz * 1.5], [s.propX - tx * 1.5, s.propZ - tz * 1.5]]) {
      if (onOtherRoad(px, pz, best.i, 0.4)) return reject('otherRoad');
    }
    if (near(junctionIdx, s.x, s.z, JUNCTION_CLEARANCE_M)) return reject('junction');
    for (const bd of bIdx.query(s.x, s.z, 4)) {
      if (pointInRing(s.x, s.z, bd.ring) || ringDist(s.x, s.z, bd.ring) < 0.6) return reject('blockedByBuilding');
      if (bd !== own && pointInRing(s.propX, s.propZ, bd.ring)) return reject('blockedByBuilding');
    }
    if (near(anyIdx, s.x, s.z, ANY_SPOT_SPACING_M)) return reject('crowded');
    return s;
  };

  const chunkCount = new Map();
  const takeChunkSlot = (key, max) => {
    const n = chunkCount.get(key) ?? 0;
    if (n >= max) return false;
    chunkCount.set(key, n + 1);
    return true;
  };
  const buildingAt = (x, z) => {
    for (const bd of bIdx.query(x, z, 0)) if (pointInRing(x, z, bd.ring)) return bd;
    return null;
  };

  // ---- shops: named OSM food places
  const shopIdx = new GridIndex(50);
  const shops = [];
  const categories = {};
  const foodEls = elements
    .filter((el) => isFoodPlace(el.tags) && (el.tags.name || el.tags['name:ko']) && !el.tags.building)
    .concat(buildings.filter((b) => isFoodPlace(b.tags) && b.tags.name).map((b) => ({ ...b, _building: b })));
  const shopCands = foodEls
    .map((el) => {
      let p;
      if (el._building) p = { x: el._building.cx, z: el._building.cz };
      else if (el.type === 'node') p = project(el.lat, el.lon);
      else {
        const ring = outerRing(el);
        if (!ring?.length) return null;
        p = { x: ring.reduce((s, q) => s + q.x, 0) / ring.length, z: ring.reduce((s, q) => s + q.z, 0) / ring.length };
      }
      return { el, p, h: hash01(el.id, 1) };
    })
    .filter(Boolean)
    .sort((a, b) => a.h - b.h || a.el.id - b.el.id);
  stats.shopCandidates = shopCands.length;
  for (const { el, p } of shopCands) {
    if (inLegacy(p.x, p.z)) {
      reject('legacyArea');
      continue;
    }
    const own = el._building ?? buildingAt(p.x, p.z);
    const s = place(own ? own.ring : [[p.x, p.z]], own);
    if (!s) continue;
    if (near(shopIdx, s.x, s.z, SHOP_SPACING_M)) {
      reject('shopSpacing');
      continue;
    }
    if (!takeChunkSlot(`s${chunkOf(s.x, s.z)}`, MAX_SHOPS_PER_CHUNK)) {
      reject('shopChunkCap');
      continue;
    }
    const cat = classifyShop(el.tags);
    categories[cat.id] = (categories[cat.id] ?? 0) + 1;
    const name = String(el.tags.name ?? el.tags['name:ko']).trim();
    shops.push({
      id: `gen-shop-${el.type[0]}${el.id}`,
      name: el.tags.branch && !name.includes(el.tags.branch) ? `${name} ${el.tags.branch}` : name,
      x: r1(s.x),
      z: r1(s.z),
      type: 'shop',
      emoji: cat.emoji,
      facingHeading: r3(s.facingHeading),
      menus: cat.menus,
    });
    shopIdx.add({ x: s.x, z: s.z }, s.x, s.z, s.x, s.z);
    occupy(s.x, s.z);
  }

  // ---- gap-filling local shops: commercial buildings, then low-rise buildings along arterials
  const fillCands = buildings
    .filter((b) => !isFoodPlace(b.tags) && b.area >= 60 && b.area <= 2500)
    .map((b) => {
      const commercial = b.kind === 'shop';
      if (!commercial && !(b.kind === 'residential' && b.height <= 16)) return null;
      return { b, commercial, h: hash01(b.id, 5) };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.commercial) - Number(a.commercial) || a.h - b.h || a.b.id - b.b.id);
  let filled = 0;
  for (const { b, commercial } of fillCands) {
    if (inLegacy(b.cx, b.cz) || near(shopIdx, b.cx, b.cz, FILL_SHOP_SPACING_M - MAX_ROAD_DIST_M)) continue;
    const s = place(b.ring, b, !commercial);
    if (!s || near(shopIdx, s.x, s.z, FILL_SHOP_SPACING_M)) continue;
    if (!takeChunkSlot(`s${chunkOf(s.x, s.z)}`, MAX_SHOPS_PER_CHUNK)) continue;
    const { cat, name } = fillShop(hash01(b.id, 6), hash01(b.id, 7));
    categories[cat.id] = (categories[cat.id] ?? 0) + 1;
    shops.push({
      id: `gen-shop-b${b.id}`,
      name,
      x: r1(s.x),
      z: r1(s.z),
      type: 'shop',
      emoji: cat.emoji,
      facingHeading: r3(s.facingHeading),
      menus: cat.menus,
    });
    shopIdx.add({ x: s.x, z: s.z }, s.x, s.z, s.x, s.z);
    occupy(s.x, s.z);
    filled++;
  }
  stats.osmShops = shops.length - filled;
  stats.fillShops = filled;

  // ---- residences: apartment blocks, low-rise villas, officetels
  const resIdx = new GridIndex(50);
  const residences = [];
  const kinds = {};
  const resCands = buildings
    .map((b) => {
      const named = String(b.tags.name ?? '');
      if (b.kind !== 'residential' && !named.includes('오피스텔')) return null;
      const kind = residenceKindOf(b.tags, b.area, b.height);
      return kind ? { b, kind, named: named ? 0 : 1, h: hash01(b.id, 2) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.named - b.named || a.h - b.h || a.b.id - b.b.id);
  stats.residenceCandidates = resCands.length;
  for (const { b, kind } of resCands) {
    if (inLegacy(b.cx, b.cz)) {
      reject('legacyArea');
      continue;
    }
    const s = place(b.ring, b);
    if (!s) continue;
    if (near(resIdx, s.x, s.z, RESIDENCE_SPACING_M)) {
      reject('residenceSpacing');
      continue;
    }
    if (!takeChunkSlot(`r${chunkOf(s.x, s.z)}`, MAX_RESIDENCES_PER_CHUNK)) {
      reject('residenceChunkCap');
      continue;
    }
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    residences.push({
      id: `gen-res-${b.type[0]}${b.id}`,
      name: residenceName(kind, b.tags, complexAt(b.cx, b.cz), hash01(b.id, 3), hash01(b.id, 4)),
      x: r1(s.x),
      z: r1(s.z),
      type: 'residential',
      residenceKind: kind,
      emoji: RESIDENCE_EMOJI[kind],
      facingHeading: r3(s.facingHeading),
    });
    resIdx.add({ x: s.x, z: s.z }, s.x, s.z, s.x, s.z);
    occupy(s.x, s.z);
  }

  stats.shops = shops.length;
  stats.residences = residences.length;
  stats.shopCategories = categories;
  stats.residenceKinds = kinds;
  return { shops, residences, stats };
}
