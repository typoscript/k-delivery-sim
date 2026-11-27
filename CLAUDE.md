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
- `src/main.ts` — 시스템 초기화·통합, 배달 흐름 핸들러, 모달 콜백 (초기화 순서 주의: `const` 선언 전 참조 시 TDZ 오류)
- `src/game/` — 공유 시스템 묶음(`GameContext`), 키보드 입력(`keyboardInput`), 프레임 루프(`gameLoop`)
- `src/data/` — 수원 4개 구역 실측 OSM 도로 그래프·건물 데이터, 활성 구역 선택(`ACTIVE_MAP_DATA`)
- `src/world/` — 도시(`CityWorld`), 실내 복도(`CorridorRoom`, `y = -500`), 교통 AI(`TrafficSystem`), 교통 공통 규칙(`TrafficRules`), 단속·순찰·경쟁 라이더(`RoadHazardManager`), 보행자, 날씨
- `src/player/`, `src/vehicle/`, `src/camera/` — 1인칭 도보·승하차, 스쿠터 물리·메시, 1인칭 카메라
- `src/delivery/` — 배달 상태 머신(`DeliveryManager`), 배차, 커리어 저장(`RiderCareer`, localStorage)
- `src/ui/`, `src/audio/` — HUD·모달, 스마트폰(`PhoneMap` 조율 + `ui/phone/` 지도·화면·탭 모듈), Web Audio 프로시저럴 사운드·음성 안내

---

## 3. 개발 및 검증 규칙

1. **항상 1인칭 시점 유지:** 별도 요청이 없는 한 도보 및 오토바이 주행 모두 1인칭 시점을 기본으로 유지합니다.
2. **좌표계 규약 (Three.js 오른손 좌표계):**
   - `heading = 0`은 `+Z`(북쪽) 방향이며, 진행 방향 기준 `+X`가 왼쪽, `-X`가 오른쪽입니다.
   - 우측 통행 차선 오프셋: `right = (-sin(heading), 0, cos(heading))`이 아니라 `forward × up = (-fz, 0, fx)` 기준 `+3.5m` 적용.
   - 스쿠터 기울기(`leanAngle`)는 음수(`-`)가 좌측(`+X`) 기울기, 양수(`+`)가 우측(`-X`) 기울기입니다.
3. **WSL 개발 환경 주의:** `vite.config.ts`의 `server.watch.usePolling: true` 설정을 유지하여 `/mnt/c` 경로에서도 HMR이 정상 작동하도록 합니다.
4. **빌드·테스트 검증 필수:** 코드 변경 후 반드시 `npm run build` (`tsc && vite build`)와 `npm test` (Vitest)가 모두 통과하는지 확인합니다. 순수 로직(교통 규칙, 좌표계, 저장 데이터 검증)을 바꾸면 `*.test.ts`에 테스트를 추가합니다.
5. **GitHub Pages 호환성:** `vite.config.ts`의 `base: './'` 상대 경로를 유지하고, 외부 CDN 의존성 없이 정적 빌드(`dist/`)만으로 완전히 동작해야 합니다.
6. **교통 신호 규칙 단일화:** 신호 판정은 반드시 `TrafficRules`의 `getSignalAxis(nodeId, dirX, dirZ)`와 `signalSpeedCap()`을 사용합니다. 월드 축 기준(`Math.abs(fz) >= Math.abs(fx)`)으로 NS/EW를 직접 판정하지 않습니다(비스듬한 실측 교차로에서 동시 녹색 발생). 과속 단속 카메라는 도로 중간에 있으므로 과속만 단속합니다.
7. **구매 시 잔액 확인:** 정비소·차고 등 유료 구매 콜백은 결제 전에 `rejectIfInsufficientFunds(cost)`(`main.ts`)로 지갑 잔액을 확인합니다.
8. **모달 입력 규칙:** `ModalUi.handleKeyDown`은 키 자동 반복(`e.repeat`)을 무시합니다. 구역 선택(`P`)·설정(`O`) 메뉴가 열려 있을 때는 `O`/`P`/`Esc`/`M` 외 게임 키를 막고, 모달 뒤에서 주행 중이면 `null` 대신 중립 입력으로 물리를 진행합니다.
