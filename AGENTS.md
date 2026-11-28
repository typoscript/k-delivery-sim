# K-Delivery Sim — AI 에이전트 개발 규칙 (AGENTS.md / CLAUDE.md 공통)

> **동기화 필수 규칙 (CRITICAL):**
> 이 프로젝트는 **Antigravity(AGY)**와 **Claude Code** 환경 모두에서 개발됩니다.
> **`AGENTS.md` 또는 `CLAUDE.md` 중 한 파일의 개발 룰을 추가·수정·삭제할 때는 반드시 두 파일(`AGENTS.md`, `CLAUDE.md`)을 동일한 내용으로 함께 업데이트해야 합니다.**

---

## 1. 문서화 및 README 동기화 규칙 (CRITICAL)

- **기능 업데이트 시 `README.md` 자동 반영:** 새로운 게임 기능을 추가하거나 조작키·시스템·맵·UI를 변경할 때는 **반드시 `README.md`에도 최신 기능과 조작법을 함께 업데이트**합니다.
- `README.md` 상단의 라이브 플레이 링크(`https://typoscript.github.io/k-delivery-sim/`)는 항상 유지합니다.

---

## 2. 프로젝트 개요 & 기술 스택

- **프로젝트명:** `k-delivery-sim` (한국형 1인칭 오토바이 배달 시뮬레이션)
- **배포 주소 (GitHub Pages):** https://typoscript.github.io/k-delivery-sim/
- **저장소:** https://github.com/typoscript/k-delivery-sim
- **기술 스택:** TypeScript, Three.js, Vite, Web Audio API (별도 백엔드 없음 — 정적 웹 배포)

### 핵심 아키텍처 (파일 안내 — 기능 상세는 README.md 참고)
- `src/main.ts` — 진입점: 로딩 화면 → (`?map=legacy`면 구역별 지도 내려받기) → 게임(`app.ts`) 동적 import. 게임 코드·three.js·지도 데이터(`map-suwon`)는 `vite.config.ts`의 `manualChunks`로 나뉘어 동시에 내려받습니다
- `src/app.ts` — 시스템 초기화·통합. 배차·모달·휴대폰 콜백은 `src/game/app/`(`dispatchCallbacks`·`modalCallbacks`·`phoneCallbacks`)에 있고, 시스템은 `AppRefs` 게터(`refs`)로 콜백이 실행될 때 읽음 (초기화 순서 주의: `const` 선언 전 참조 시 TDZ 오류. 콜백에서 시스템을 쓸 때는 생성 시점이 아니라 `r.hud`처럼 실행 시점에 읽기)
- `src/game/` — 공유 시스템 묶음(`GameContext`), 배달 흐름 핸들러(`deliveryFlow`: 복도 출입·사진·정산·콜 수락, [E] 상호작용은 `interact/`: 서비스 시설·건물 안·바깥), 3D 휴대폰 터치(`phoneTouchInput`), 전도·방지턱 피드백(`crashFeedback`), 게임 시계(`GameClock`, `clockSync`: 낮밤·피크타임, `WeatherSchedule`: 시간에 따른 날씨, `seasons`: 근무일 7일마다 바뀌는 계절 — 날씨 확률·계절 이벤트 콜), 신호위반·인도 주행 단속(`trafficViolations`), 전방 빨간불·보행자 경고(`riderAlerts`), 키보드 입력(`keyboardInput`), 프레임 루프(`gameLoop`, 60fps 상한, 프레임 단계는 `frame/`: 월드·물리·배달·화면·안내), 성능 프로파일러(`PerfMonitor`: F9 오버레이·F10 A/B 벤치마크, `perf/`: 롤링 통계·GPU 타이머·오버레이·벤치마크), 그래픽 품질 런타임(`GraphicsRuntime`: 품질별 해상도 범위·그림자 크기/갱신 주기, `AdaptiveResolution` 자동 해상도). 대기·메뉴 중 30fps 절전(`PowerSaver`). 성능 개선 작업은 프로파일러와 최악 조건 벤치마크(`BenchmarkSuite`, `?bench=suite`)로 전후를 측정해 확인합니다
- `src/data/` — 맵 데이터. 기본은 수원 통합 오픈월드(`suwonUnified.ts` + 생성 데이터 `openworld/suwonWorld.json`), `?map=legacy`면 기존 4개 구역별 데이터(`mapSources.ts`로 그때만 내려받음 — 오픈월드 모드에서 `SUWON_DISTRICTS[].data`를 읽지 말고 `SUWON_OPEN_WORLD.legacyDistricts`의 `localStation`·`namedBuildings`·`buildingBoxes`를 사용). 게임은 항상 `ACTIVE_MAP_DATA`(`IS_UNIFIED_MAP`로 모드 구분)를 사용
- `src/world/` — 도시(`CityWorld`: 도로·건물·소품 조립, 하위 모듈 `cityStreaming`(청크 스트리밍·태양 추적·충돌체)·`cityGround`(바닥·배달 장소)·`cityAtmosphere`(실외 표시·날씨·하늘 테마)·`snowCover`(눈 쌓임: 공용 uniform 하나로 위를 향한 면을 하얗게, 재질에 `applySnowCover`)·`serviceStations`(주유소·정비소·편의점)·`deliveryProps`(픽업대·공동현관, 아파트 공동현관 옆 주차 차량·경비실·차단기는 `apartmentGrounds`: 도로·건물과 겹치지 않는 자리에만, 경비원·차단기 동작은 `stepGate`, 청크가 아직 안 내려왔으면 `ProximityCuller`가 다음 갱신에 다시 시도, 지금 생성된 차·경비실 충돌체는 `PropColliders`로 `getCollisionObstacles()`에 합쳐짐)·`worldSky`(날씨×시간대 하늘·조명)·`roadSurfaces`(도로·횡단보도·맨홀·젖은 노면)·`speedBumps`·`parksAndTrees`·`cityBuildings`(건물·랜드마크 배치, 구역별 랜드마크 모델은 `landmarks/`)·`streetFurniture`(정류장·가로등)·`streetProps`(가로수·가로등·전봇대·전선: 청크별 지연 생성·병합, 가로등 빛 웅덩이는 밤에만 보이는 그룹)), 실내 복도(`CorridorRoom`, `y = -500`: 엘리베이터·문·고객 NPC 동작, 구조물 생성은 `corridor/`: 아파트 복도·빌라 계단실·공용 부품, 배달지 설정 `unitSetup`, 엘리베이터 `elevator`, 문 앞·고객 NPC `doorNpc`, 프레임 애니메이션 `corridorFrame`), 교통 AI(`TrafficSystem` + `traffic/`: 신호 주기·신호등·플레이어 신호위반, 차량 배치·재배치, 차량 주행, 날씨별 속도·차간 거리 `DRIVING_WEATHER`), 교통 공통 규칙(`TrafficRules`), 도로 경로 안내(`RoadNavigator` + `navigation/`: 도로 투영·A* 경로 탐색·공사 구간 우회 `routeSearch`, 회전 안내 `turnGuidance`, 경로 지문 테스트는 `RoadNavigator.test.ts`), 도로 가장자리 거리 격자(`roadProximity`), 단속·순찰·경쟁 라이더(`RoadHazardManager`, 종류별 생성·프레임 처리는 `hazards/`: 과속 카메라·이중 주차·순찰차·공사 구간·경쟁 라이더, 이동 유닛 배치·재배치 `hazardSpawning`, 프레임 처리 `hazardFrame`, 동작 지문 `RoadHazardManager.behavior.test.ts`), 보행자(`PedestrianManager` + `pedestrians/`: 스쿠터 반응·충돌, 보행·횡단, 튜닝 값, 비·눈 오는 날 우산·걸음 속도 `setWeather` — 우산 메시는 처음 필요할 때 만들어 맑은 날 동작 지문이 그대로), 날씨
- `src/player/`, `src/vehicle/`, `src/camera/` — 1인칭 도보·승하차, 스쿠터 물리(`ScooterPhysics` + `vehicle/physics/`: 조작·연료, 기울기·접지·미끄러짐, 이동·충돌·과속방지턱, 넘어짐·주차)·메시(`ScooterMesh` + `vehicle/scooter/`: 바퀴·기종별 트림·배달통, 차체 조립 `scooterBody`(후면·전면 조명·조향부), 매 프레임 자세·조명 `scooterSync`, 사이드미러, 계기판), 1인칭 카메라
- `src/delivery/` — 배달 상태 머신(`DeliveryManager`: 장부·저장, 배달 단계 전환은 `missionSteps`, 주문 찾기는 `missionQueries`, 콜 목록·수락은 `orderBoard`, 사진 정산은 `photoSettlement`, 퇴근·목표 보너스는 `shiftClose`, 과태료·지출은 `finesAndExpenses`), 도메인 타입·요금 상수(`deliveryTypes`), 주문 생성(`orderFactory`, 콜 목록·배차 공용), 날씨·시간대 이벤트 콜(`demandEvents`: 비 오는 날 국물·눈 오는 날 따끈한 국물·점심 한 끼·오후 카페·야식 타임 메뉴 가중치와 조건부 할증), 정산 금액(`settlementPay`), 일일 장부 합계(`dailyLedger`), 오늘 목표 카운터·근무일 기록·업적(`shiftProgress`, 순수 로직 `careerHistory`), 단골·리뷰·평판(`riderRecords`), 지상 차량 출입 금지 단지·도보 수당(`apartmentRules`), 음식 상태·채팅 이벤트(`cargoCare`), 추천 경로(`missionRoute`), 배차(`OrderDispatchManager`), 근무일·목표(`ShiftDay` — 그날의 바뀌는 목표 2개와 그 주의 주간 목표는 저장에 고정되므로, 목표 후보를 추가·삭제해도 진행 중인 날·주는 그대로), 커리어 저장(`RiderCareer`, localStorage — 업그레이드·등급 목록은 `riderCatalog`, 고객 리뷰 생성은 `customerReviews`, 둘 다 `RiderCareer`에서 다시 내보냄)
- `src/ui/`, `src/audio/` — HUD(`Hud` 조율 + `ui/hud/`: 상태 표시줄·계기판 `hudStatus`, 상호작용 안내 `hudPrompt`, 토스트·단속 딱지·채팅 팝업 `hudPopups`)·모달(`ModalUi` 조율 + `ui/modals/`: POS·PIN 키패드, 주유기, 배달통·정비소·명세서·정산 화면 HTML, 버튼 연결 `modalClicks`, 키 입력 `modalKeys`, 시설 모달 `serviceModals`, 사진·정산 `cameraModal`, 문·엘리베이터 전환 `transitions`)(정산서·일일 명세서·휴대폰 영수증의 항목은 `receiptLines` 한 곳에서 만듦 — 새 할증·지출은 여기에만 추가), 스마트폰(`PhoneMap` 조율 + `ui/phone/` 지도·화면·탭 모듈, 지도 그리기 `mapRenderer`(레이어 `mapBaseLayers`·`mapMarkerLayers`·`mapRouteLayers`(지상 차량 출입 금지 단지 반경 표시 포함), 캔버스 호출 지문 테스트 `mapRenderer.test.ts`), 꺼내기·거치·확대 `phonePlacement`, 배터리 `phoneBattery`, 3D 화면 터치 `phoneTouch3D`, 프레임 갱신 `phoneFrame`), Web Audio 프로시저럴 사운드(`GameAudio` 조율: 오디오 노드 생성 `audioGraph`, 매 프레임 엔진음·타이어 스키드 `engineSound`, 빗소리·엘리베이터 험 `ambience`, 효과음은 `audio/sfx/`, 합성 기본 단위는 `soundSynth`)·음성 안내
- `tools/osm/` → `src/data/openworld/` + `public/map/suwon/chunks/` — 수원 통합 오픈월드 맵 생성 파이프라인(OSM 다운로드·변환·200m 청크 분할), 상세는 `tools/osm/README.md`
- `src/world/openworld/` — 오픈월드 청크 스트리밍(`ChunkStreamer`: 주변 청크 로드·해제, 그래픽 품질별 맵 디테일(`MapDetail`)이 바뀌면 `setDetail`로 지어진 청크를 그 자리에서 다시 지음 — 가로 소품은 `ProximityCuller.rebuildLazy`로 다시 생성, `ChunkMeshBuilder`: 청크별 메시 병합·충돌체·도로 쪽 1층 상가 유리·간판(`addStorefronts`, 밤 발광은 `setStorefrontNightGlow`)·건물별 외벽 색조(`wallTintOf`)·옥상 난간·구조물(`addRooftop`)·흰색 차선·연석·버스전용차로(`addRoadEdges`)·노면 글씨(`addRoadWords`, 글자 아틀라스 1장), `ChunkGrid`: 청크 범위 계산), 미리보기 `openworld.html`
- `src/world/cityTextures.ts` — 건물 외벽·도로·인도 텍스처와 건물 재질(기존 맵·오픈월드 공용)

---

## 3. 개발 및 검증 규칙

1. **항상 1인칭 시점 유지:** 별도 요청이 없는 한 도보 및 오토바이 주행 모두 1인칭 시점을 기본으로 유지합니다.
2. **좌표계 규약 (Three.js 오른손 좌표계):**
   - `heading = 0`은 `+Z`(북쪽) 방향이며, 진행 방향 기준 `+X`가 왼쪽, `-X`가 오른쪽입니다.
   - 우측 통행 차선 오프셋: `right = (-sin(heading), 0, cos(heading))`이 아니라 `forward × up = (-fz, 0, fx)` 기준 `+3.5m` 적용.
   - 스쿠터 기울기(`leanAngle`)는 음수(`-`)가 좌측(`+X`) 기울기, 양수(`+`)가 우측(`-X`) 기울기입니다.
3. **WSL 개발 환경 주의:** `vite.config.ts`의 `server.watch.usePolling: true` 설정을 유지하여 `/mnt/c` 경로에서도 HMR이 정상 작동하도록 합니다.
4. **빌드·테스트 검증 필수:** 코드 변경 후 반드시 `npm run build` (`tsc && vite build`)와 `npm test` (Vitest)가 모두 통과하는지 확인합니다. 순수 로직(교통 규칙, 좌표계, 저장 데이터 검증)을 바꾸면 `*.test.ts`에 테스트를 추가합니다. 도시 생성 결과는 `CityWorld.test.ts`·`CityWorld.legacy.test.ts`·`SuwonLandmarks.test.ts`·`ScooterMesh.test.ts`의 장면 지문 스냅샷과 교통 AI·보행자·스쿠터 물리 동작 지문(`TrafficSystem.behavior.test.ts`·`PedestrianManager.behavior.test.ts`·`ScooterPhysics.behavior.test.ts`, 시뮬레이션에는 벽시계 시간(`performance.now`)을 쓰지 않음)으로 확인합니다(리팩토링은 그대로 통과해야 하고, 의도한 변경이면 `npx vitest -u`로 갱신). 생성 콘텐츠(텍스처·배치)에는 `Math.random` 대신 `seededRandom`(`src/seededRandom.ts`)을 써서 매번 같은 도시가 만들어지게 합니다.
5. **GitHub Pages 호환성:** `vite.config.ts`의 `base: './'` 상대 경로를 유지하고, 외부 CDN 의존성 없이 정적 빌드(`dist/`)만으로 완전히 동작해야 합니다.
6. **교통 신호 규칙 단일화:** 신호 판정은 반드시 `TrafficRules`의 `getSignalAxis(nodeId, dirX, dirZ)`와 `signalSpeedCap()`을 사용합니다. 월드 축 기준(`Math.abs(fz) >= Math.abs(fx)`)으로 NS/EW를 직접 판정하지 않습니다(비스듬한 실측 교차로에서 동시 녹색 발생). 과속 단속 카메라는 도로 중간에 있으므로 과속만 단속합니다.
7. **구매 시 잔액 확인:** 정비소·차고 등 유료 구매 콜백은 결제 전에 `rejectIfInsufficientFunds(cost)`(`app.ts`)로 지갑 잔액을 확인합니다.
8. **모달 입력 규칙:** `ModalUi.handleKeyDown`은 키 자동 반복(`e.repeat`)을 무시합니다. 구역 선택(`P`)·설정(`O`) 메뉴가 열려 있을 때는 `O`/`P`/`Esc`/`M` 외 게임 키를 막고, 모달 뒤에서 주행 중이면 `null` 대신 중립 입력으로 물리를 진행합니다.
9. **생성 맵 데이터는 직접 수정 금지:** `src/data/openworld/`와 `public/map/`은 `npm run map:build` 출력물입니다. 변환 규칙은 `tools/osm/build-suwon-map.mjs`를 고친 뒤 다시 생성하고, 좌표 규약(`+X` = 서쪽)과 OSM 출처 표기(© OpenStreetMap contributors)를 유지합니다.
10. **청크 리소스 관리:** 청크 단위로 만든 지오메트리는 청크 해제 시 반드시 `dispose()`하고, 재질·텍스처는 공용으로 만들어 청크마다 새로 만들지 않습니다. 청크 하나를 그리는 드로우콜은 재질별 병합으로 10개 안팎을 유지합니다.
11. **오픈월드 크기 가정 금지:** 맵은 수 km 크기이고 플레이어가 어디에나 있을 수 있습니다. 맵 전체를 순회하며 메시를 만들지 말고(청크 스트리밍·`ProximityCuller`로 주변만 표시), AI·소품은 플레이어 주변에 배치·재활용합니다. 충돌 판정은 `world.getCollisionObstacles()`(주변 청크 건물)를 사용합니다.
12. **렌더링 비용 규칙:** 움직이지 않는 소품·청크는 `freezeStatic()`으로 행렬을 고정하고(움직이는 하위 요소는 `updateMatrix()` 후 `updateMatrixWorld(true)`로 직접 갱신), 사이드미러에 필요 없는 작은 소품은 `excludeFromMirrors()`로 미러 패스에서 제외합니다(`src/world/renderLayers.ts`). 씬 행렬은 게임 루프에서 프레임당 한 번만 갱신합니다. 도시 전체에 반복되는 소품은 `src/world/instancing.ts`의 `buildInstanced()`(InstancedMesh)나 `mergeColoredParts()`(정점 색상 병합)로, 고정 소품 그룹은 `mergeStaticByMaterial()`(재질별 병합, 움직이는 부분은 keep으로 제외)로, 차량은 `VehicleFleetRenderer`(부품별 InstancedMesh)로 그리고, 멀리서 보이는 물체는 LOD(건물: 청크 `THREE.LOD` 300m, 보행자: 32m)를 둡니다.
