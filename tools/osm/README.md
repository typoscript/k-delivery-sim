# 수원 통합 오픈월드 맵 데이터 파이프라인

4개 구역(인계동·행궁동·수원역·광교)과 그 사이 지역 전체(약 6.2km × 4.25km)를 OpenStreetMap에서 받아
청크 스트리밍용 정적 JSON으로 변환합니다. 데이터 출처: © OpenStreetMap contributors (ODbL 1.0).

```bash
npm run map:fetch   # Overpass API에서 원본 다운로드 → tools/osm/cache/suwon-raw.json (git 제외, --force로 재다운로드)
npm run map:build   # 원본 → public/map/suwon/ (world.json + chunks/c_<ix>_<iz>.json)
```

## 출력
| 파일 | 내용 | 로딩 |
|---|---|---|
| `public/map/suwon/world.json` | 메타(원점·범위·청크 격자), 도로 그래프(nodes/edges/신호), 버스정류장, 기존 4개 구역의 가게·배달지·주유소·정비소·스폰 위치(월드 좌표로 이동), 청크 목록 | 항상 |
| `public/map/suwon/chunks/c_<ix>_<iz>.json` | 200m 청크별 건물·공원·수면·하천선·보행광장 | 플레이어 주변만 |

## 규칙 (기존 구역 데이터와 호환)
- 좌표: 미터, `+Z` = 북, `+X` = **서** (`x = -(lon - lon0) * mPerDegLon`, `z = (lat - lat0) * 111320`), 원점은 전체 범위 중심
- 도로 폭: trunk 16 · primary 14.5 · secondary 13 · tertiary 12 · 링크 9.5~11 · residential/unclassified 8.6 · living_street 7.2 (primary~tertiary = 간선)
- 신호등: OSM `traffic_signals` + 간선 3개 이상 교차 또는 간선이 있는 4지 교차로
- 건물 높이: `building:levels × 3.2m`, 없으면 용도·면적별 기본값 (ID 해시로 결정적)
- 도로는 가장 큰 연결 요소만 유지(AI·내비가 모든 도로에 도달 가능), 3m 미만 구간은 병합
- 같은 원본이면 출력이 항상 동일(결정적)

생성 파일(`public/map/`)은 직접 수정하지 말고 스크립트를 고친 뒤 `npm run map:build`로 다시 만듭니다.
