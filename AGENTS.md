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

### 핵심 아키텍처
- `src/main.ts` — 게임 루프, 키 입력, 시스템 통합
- `src/world/CityWorld.ts` — 3×3 도시 블록(상가 거리, 주거지 아파트/빌라, 중앙 공원), 3D 픽업/배달 비콘
- `src/world/TrafficSystem.ts` — 교차로 3색 신호등 주기, AI 교통 차량 주행·정지·회전·충돌 및 신호 위반 판정
- `src/player/PlayerController.ts` & `PlayerMesh.ts` — 1인칭 도보 이동, 점프, GTA식 `[F]` 승하차, 전도 기상 회복
- `src/vehicle/ScooterPhysics.ts` & `ScooterMesh.ts` — 배달 스쿠터 물리, 코너링 2차 기울기(Lean) & 타이어 접지 한계 슬립 전도
- `src/camera/CameraController.ts` — 항상 1인칭 시점 (도보 눈높이, 라이딩 핸들바 시점 + 코너 호라이즌 롤, 전도 연출)
- `src/delivery/DeliveryManager.ts` — 배달 콜 생성, 픽업/배달 상태 머신, 음식 상태(%) 및 수익 정산
- `src/ui/PhoneMap.ts` & `Hud.ts` — 거치대 스마트폰 풀스크린 GPS 지도, 배달앱 UI, 속도·기울기 계기판
- `src/audio/GameAudio.ts` — Web Audio API 프로시저럴 사운드 (엔진, 타이어 스키드, 충돌, 경적, 효과음)

---

## 3. 개발 및 검증 규칙

1. **항상 1인칭 시점 유지:** 별도 요청이 없는 한 도보 및 오토바이 주행 모두 1인칭 시점을 기본으로 유지합니다.
2. **좌표계 규약 (Three.js 오른손 좌표계):**
   - `heading = 0`은 `+Z`(북쪽) 방향이며, 진행 방향 기준 `+X`가 왼쪽, `-X`가 오른쪽입니다.
   - 우측 통행 차선 오프셋: `right = (-sin(heading), 0, cos(heading))`이 아니라 `forward × up = (-fz, 0, fx)` 기준 `+3.5m` 적용.
   - 스쿠터 기울기(`leanAngle`)는 음수(`-`)가 좌측(`+X`) 기울기, 양수(`+`)가 우측(`-X`) 기울기입니다.
3. **WSL 개발 환경 주의:** `vite.config.ts`의 `server.watch.usePolling: true` 설정을 유지하여 `/mnt/c` 경로에서도 HMR이 정상 작동하도록 합니다.
4. **빌드 검증 필수:** 코드 변경 후 반드시 `npm run build` (`tsc && vite build`)가 오류 없이 통과하는지 확인합니다.
5. **GitHub Pages 호환성:** `vite.config.ts`의 `base: './'` 상대 경로를 유지하고, 외부 CDN 의존성 없이 정적 빌드(`dist/`)만으로 완전히 동작해야 합니다.
