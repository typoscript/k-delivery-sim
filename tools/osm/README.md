# 수원 통합 오픈월드 맵 데이터 파이프라인

4개 구역(인계동·행궁동·수원역·광교)과 그 사이 지역 전체(약 6.2km × 4.25km)를 OpenStreetMap에서 받아
청크 스트리밍용 정적 JSON으로 변환합니다. 데이터 출처: © OpenStreetMap contributors (ODbL 1.0).

```bash
npm run map:fetch   # Overpass API에서 원본 다운로드 → tools/osm/cache/suwon-raw.json (git 제외, --force로 재다운로드)
npm run map:build   # 원본 → src/data/openworld/suwonWorld.json + public/map/suwon/chunks/c_<ix>_<iz>.json
```

## 출력
| 파일 | 내용 | 로딩 |
|---|---|---|
| `src/data/openworld/suwonWorld.json` | 메타(원점·범위·청크 격자), 도로 그래프(nodes/edges/신호), 버스정류장, 기존 4개 구역의 가게·배달지·주유소·정비소·스폰 위치(월드 좌표로 이동)와 오픈월드가 쓰는 구역 지도 일부(구역 좌표의 역·이름 있는 건물·건물 외곽 박스 — 게임이 구역별 지도 전체를 내려받지 않도록), 맵 전체에서 생성한 가게·배달지(`generatedShops`/`generatedResidences`), 청크 목록 — 게임 번들에 포함 | 항상 |
| `public/map/suwon/chunks/c_<ix>_<iz>.json` | 200m 청크별 건물·공원·수면·하천선·보행광장 | 플레이어 주변만 |

## 규칙 (기존 구역 데이터와 호환)
- 좌표: 미터, `+Z` = 북, `+X` = **서** (`x = -(lon - lon0) * mPerDegLon`, `z = (lat - lat0) * 111320`), 원점은 전체 범위 중심
- 도로 폭: trunk 16 · primary 14.5 · secondary 13 · tertiary 12 · 링크 9.5~11 · residential/unclassified 8.6 · living_street 7.2 (primary~tertiary = 간선)
- 신호등: OSM `traffic_signals` + 간선 3개 이상 교차 또는 간선이 있는 4지 교차로
- 건물 높이: `building:levels × 3.2m`, 없으면 용도·면적별 기본값 (ID 해시로 결정적)
- 도로는 가장 큰 연결 요소만 유지(AI·내비가 모든 도로에 도달 가능), 3m 미만 구간은 병합
- 같은 원본이면 출력이 항상 동일(결정적)

## 생성 배달지 ([delivery-spots.mjs](./delivery-spots.mjs))
기존 4개 구역 밖의 맵 전체에도 콜이 생기도록, 손으로 다듬은 구역 데이터와 같은 규약으로 배달지를 만듭니다(구역 사각형 안은 기존 데이터만 사용).
- **가게:** 이름이 있는 OSM 음식점(`amenity=restaurant|fast_food|cafe|food_court|ice_cream|pub|bar`, `shop=bakery|pastry|confectionery|deli`). 이름 키워드 → `cuisine` → 태그 순으로 업종(치킨·피자·중식·국밥·카페 등 21종)을 정해 이모지와 메뉴 3개를 붙입니다. 메뉴 이름에는 음식 물리(보냉·국물 쏟음) 판정 키워드가 들어갑니다.
- **동네 가게 채우기:** OSM에 이름 있는 음식점이 수백 곳뿐이라, 150m 안에 가게가 없는 곳은 상업 건물 → 간선도로변 저층 건물(1층 상가) 순으로 일반 가게(예: `소문난 치킨`, `옛날 반점`)를 둡니다. 실제 브랜드 이름은 쓰지 않습니다.
- **배달지:** 주거 건물에서 아파트(큰 `apartments`)·빌라(저층 주택, 계단)·오피스텔(이름)로 나누고, `101동`처럼 동 번호만 있으면 이름 있는 주거단지(`landuse=residential`) 이름을 붙입니다. 이름 없는 건물은 OSM id 해시로 결정적인 이름(예: `햇살하이츠 B동`)을 만듭니다.
- **위치:** 가장 가까운 차도(간선 trunk·연결로 제외, 45m 이내) 가장자리에서 1m 바깥 인도에 서고, `facingHeading`은 건물 → 도로 방향(카운터·로비는 1.1m 뒤 건물 쪽). 다른 도로 위·교차로 중심 11m 안·건물 안이면 버리고, 가게 45m·배달지 40m·모든 지점 9m 간격, 200m 청크당 가게 3곳·배달지 4곳까지 둡니다.
- **주유소:** OSM `amenity=fuel`(250m 안 중복 제외)을 같은 방식으로 도로 가장자리 2.5m 바깥에 두고(캐노피 폭만큼 다른 도로·건물과 겹치지 않게), 1.1km 안에 주유소가 없는 간선도로변에는 동네 셀프주유소를 채웁니다(`generatedFuelStations`).
- 게임은 이 지점의 카운터·로비 소품을 플레이어 주변 청크에서만 만들고 멀어지면 해제합니다(`ProximityCuller.registerLazy`).

생성 파일(`src/data/openworld/`, `public/map/`)은 직접 수정하지 말고 스크립트를 고친 뒤 `npm run map:build`로 다시 만듭니다.
