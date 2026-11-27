import { InputActivity, targetFps } from './PowerSaver';
import { GraphicsRuntime } from './GraphicsRuntime';
import { makeStaticContainer, skipHiddenChildrenInMatrixUpdates } from '../world/renderLayers';
import { PerfMonitor } from './PerfMonitor';
import { applyGameClock } from './clockSync';
import { activeRoadProximity } from '../world/roadProximity';
import type { SpeedCameraTriggerEvent } from '../world/RoadHazardManager';
import {
  RED_LIGHT_TICKET_FINE,
  SIDEWALK_MIN_KMH,
  SIDEWALK_TICKET_FINE,
  SidewalkRidingMonitor,
  TICKET_RATING_PENALTY,
  isSidewalkOffset,
} from './trafficViolations';

/** Urgent deliveries start ticking with this many seconds left */
const URGENT_WARN_SEC = 30;
import { GAME_MINUTES_PER_SECOND } from './GameClock';
import { CORRIDOR_ORIGIN_Y } from '../world/CorridorRoom';
import { PedestrianCollisionEvent } from '../world/PedestrianManager';
import { SCOOTER_SPECS, ScooterInput } from '../vehicle/ScooterPhysics';
import { OnFootInput, PLAYER_RADIUS } from '../player/PlayerController';
import { pushOutOfBodies } from '../world/vehicleBodies';
import { validateDeliveryPhotoFrame } from '../camera/PhotoProofValidator';
import { getInstructionMeta } from '../delivery/DeliveryManager';
import { getUpgradeEffects } from '../delivery/RiderCareer';
import { GameContext } from './GameContext';

/** Game-flow hooks the per-frame loop needs from main.ts */
export interface GameLoopHooks {
  /** Live set of held key codes from installKeyboardInput */
  pressed: Set<string>;
  exitCorridorToStreet: () => void;
  isPlayerNearCargoBox: () => boolean;
  /** True once the MEET_FACE customer NPC has taken the food bag */
  isNpcHoldingFoodBag: () => boolean;
  /** Dynamic resolution + shadow scheduling */
  graphics: GraphicsRuntime;
}

/** Upper bound for simulated & rendered frames per second */
export const MAX_FPS = 60;

/** Starts the requestAnimationFrame loop: simulation step for every system, then rendering */
export function startGameLoop(ctx: GameContext, hooks: GameLoopHooks): void {
  const { renderer, scene, camera, world, traffic, corridorRoom, roadNavigator, pedestrians, roadHazards, weather, visorRain, voiceNav, delivery, dispatch, scooterPhysics, scooterMesh, playerCtrl, playerMesh, camController, audio, hud, modalUi, districtUi, onboardingSettings, handheldPhone3D, handheldFoodBag3D } = ctx;
  const { pressed, exitCorridorToStreet, isPlayerNearCargoBox } = hooks;

  const NEUTRAL_SCOOTER_INPUT: ScooterInput = {
    throttle: false,
    brake: false,
    steerLeft: false,
    steerRight: false,
    handbrake: false,
  };

  const roadProximity = activeRoadProximity();
  const sidewalkMonitor = new SidewalkRidingMonitor();
  /** Red-light / sidewalk ticket written by a patrol car: fine, rider rating, siren and the ticket card */
  const issuePatrolTicket = (ticket: SpeedCameraTriggerEvent, what: string) => {
    const res = delivery.applyTrafficTicket(ticket.fine, TICKET_RATING_PENALTY);
    audio.playPoliceSiren();
    hud.triggerSpeedCameraFlash();
    hud.showFineTicketPopup(ticket);
    hud.showToast(
      `🚓 ${ticket.label} 현장 단속! (${what}) 과태료 -₩${res.fine.toLocaleString()} · 신뢰 평점 ${res.newRating.toFixed(1)}`,
      4600
    );
  };

  let lastTime = performance.now();
  let elapsed = 0;

  scene.matrixWorldAutoUpdate = false;
  // Containers that never move: keep them from force-updating every descendant each frame
  for (const c of [scene, traffic.root, pedestrians.root, roadHazards.root]) makeStaticContainer(c);
  world.markStaticContainers();
  skipHiddenChildrenInMatrixUpdates(pedestrians.root);
  skipHiddenChildrenInMatrixUpdates(roadHazards.root);

  // F9 / ?perf=1 profiler overlay, `window.__perf.benchmark()` for A/B measurements
  const perf = new PerfMonitor(renderer);
  perf.setSun(world.sunLight);
  perf.setSceneInfo((): Record<string, string | number> => {
    const st = world.streamingStats;
    const p = playerCtrl.state;
    const g = hooks.graphics;
    const gfx = {
      해상도: `${g.pixelRatio.toFixed(2)}x${g.autoResolution ? ' (자동)' : ''}`,
      목표fps: currentTargetFps < MAX_FPS ? `${currentTargetFps} (절전)` : `${currentTargetFps}`,
      그림자: g.profile.shadows ? `${g.profile.shadowMapSize}px/${g.profile.shadowInterval}f` : '끔',
    };
    return st
      ? { ...gfx, 청크: st.built, 건물: st.buildings, 위치: `${Math.round(p.x)},${Math.round(p.z)}` }
      : { ...gfx, 위치: `${Math.round(p.x)},${Math.round(p.z)}` };
  });
  (window as unknown as { __perf: PerfMonitor }).__perf = perf;
  // 60fps cap: on 120Hz (ProMotion) / 144Hz displays rAF fires 2x+ as often; skipping the extra
  // callbacks roughly halves GPU/CPU load (and laptop heat) with no visible difference.
  // 1.5ms of slack so a 60Hz display's slightly early callbacks are never dropped.
  let lastFrameAt = -Infinity;
  // Idle / menu power saving: 30fps while nothing needs 60 (decided at the end of each frame)
  const activity = new InputActivity();
  let currentTargetFps = MAX_FPS;
  (window as unknown as { __power: () => number }).__power = () => currentTargetFps;

  function animate(now: number): void {
    requestAnimationFrame(animate);
    // Fresh input while power-saving -> render at the 60fps pace right away (no 33ms wait)
    const pace = activity.secondsSince(now) < 0.1 ? MAX_FPS : currentTargetFps;
    if (now - lastFrameAt < 1000 / pace - 1.5) return;
    const frameIntervalMs = lastFrameAt > 0 ? now - lastFrameAt : 16.7;
    lastFrameAt = now;
    perf.beginFrame(now);

    const dt = Math.max(0, Math.min((now - lastTime) / 1000, 0.05));
    lastTime = now;
    elapsed += dt;

    // Game time of day: dusk / dawn lighting, night surcharge, rush-hour demand (1 real s = 1 game min)
    ctx.clock.advance(dt);
    applyGameClock(ctx, true, dt * GAME_MINUTES_PER_SECOND);

    const inCorridor = playerCtrl.state.inCorridor;
    const isRiding = playerCtrl.state.mode === 'riding';
    const movementBlocked =
      modalUi.isBlockingMovement() || onboardingSettings.isSettingsOpen || districtUi.isOpen;

    if (!inCorridor) {
      // Open-world chunk streaming & prop culling around whoever is moving (rider follows the scooter)
      world.updateStreaming(
        isRiding ? scooterPhysics.state.x : playerCtrl.state.x,
        isRiding ? scooterPhysics.state.z : playerCtrl.state.z
      );
      delivery.setReferencePosition(playerCtrl.state.x, playerCtrl.state.z);
      world.updateLobbyDoors(dt);
      perf.lap('streaming');
      traffic.step(
        dt,
        elapsed,
        world.isNight,
        playerCtrl.state.x,
        playerCtrl.state.z,
        scooterPhysics.state.speed,
        isRiding,
        () => {
          const ticket = roadHazards.witnessTicket(
            'patrol_red_light',
            scooterPhysics.state.x,
            scooterPhysics.state.z,
            Math.abs(scooterPhysics.state.speed) * 3.6
          );
          if (ticket) {
            issuePatrolTicket(ticket, '빨간불 교차로 진입');
            return;
          }
          const fine = delivery.applyFine(1000);
          hud.showToast(
            fine > 0
              ? `🚨 신호 위반! 빨간불 교차로 통과 (-₩${fine.toLocaleString()}) · 순찰차에 걸리면 ₩${RED_LIGHT_TICKET_FINE.toLocaleString()}`
              : '🚨 신호 위반! 교차로 빨간불에 정지하세요!',
            3600
          );
        },
        (carX, carZ) => {
          const relX = carX - scooterPhysics.state.x;
          const relZ = carZ - scooterPhysics.state.z;
          const leftX = Math.cos(scooterPhysics.state.heading);
          const leftZ = -Math.sin(scooterPhysics.state.heading);
          const hitSide = relX * leftX + relZ * leftZ >= 0 ? 1 : -1;
          scooterPhysics.triggerExternalCrash(hitSide);
        },
        () => {
          audio.playAiCarHorn();
          hud.showToast('📢 빵빵! 차량 차선 끼어들기 주의!', 1800);
        },
        pedestrians.agents,
        isRiding ? null : { x: scooterPhysics.state.x, z: scooterPhysics.state.z }
      );
      // Cars never end up inside the scooter or the walking player: anything a car moved into is pushed out
      const carBodies = traffic.getCarBodies();
      const scooterOut = pushOutOfBodies(scooterPhysics.state.x, scooterPhysics.state.z, SCOOTER_SPECS.radius, carBodies);
      if (scooterOut) {
        scooterPhysics.state.x = scooterOut.x;
        scooterPhysics.state.z = scooterOut.z;
      }
      if (playerCtrl.state.mode === 'on_foot') {
        const footOut = pushOutOfBodies(playerCtrl.state.x, playerCtrl.state.z, PLAYER_RADIUS, carBodies);
        if (footOut) {
          playerCtrl.state.x = footOut.x;
          playerCtrl.state.z = footOut.z;
        }
      }
      const handlePedestrianHit = (hitEvent: PedestrianCollisionEvent) => {
        // 1. Immediate scooter slip crash (triggers heavy food damage '-55%' + rider ejection!)
        scooterPhysics.triggerExternalCrash(hitEvent.hitSide, 'pedestrian_hit');
        // 2. Immediate -₩50,000 fine/settlement & -1.0 Rider Trust Rating deduction
        const penalty = delivery.applyPedestrianAccidentPenalty();
        // 3. Emergency audio + prominent top banner ("보행자 접촉 사고 발생!")
        audio.playPedestrianAccidentAlert();
        hud.showAccidentBanner(penalty.fine, penalty.ratingLoss, penalty.newRating);
      };

      const scooterProx = {
        x: scooterPhysics.state.x,
        z: scooterPhysics.state.z,
        heading: scooterPhysics.state.heading,
        speedMps: scooterPhysics.state.speed,
        isRiding,
        crashed: scooterPhysics.state.crashed,
      };

      perf.lap('traffic');
      pedestrians.update(
        dt,
        traffic.signalState,
        playerCtrl.state.x,
        playerCtrl.state.z,
        scooterPhysics.state.x,
        scooterPhysics.state.z,
        inCorridor,
        scooterProx,
        handlePedestrianHit,
        () => {
          audio.playPedestrianStartle();
        },
        carBodies
      );

      perf.lap('pedestrians');
      roadHazards.step(
        dt,
        elapsed,
        inCorridor,
        scooterProx,
        traffic.signalState,
        (camEv) => {
          delivery.applyFine(camEv.fine);
          audio.playSpeedCameraFlash();
          hud.triggerSpeedCameraFlash();
          hud.showFineTicketPopup(camEv);
          const reason =
            camEv.kind === 'speeding'
              ? `📸 무인 과속 단속! (${camEv.measuredKmh}km/h / 제한 ${camEv.limitKmh}km/h · ${camEv.label})`
              : `📸 무인 신호위반 단속 카메라 적발! (${camEv.label})`;
          hud.showToast(`${reason} 과태료 -₩${camEv.fine.toLocaleString()}`, 4400);
        },
        (popEv) => {
          audio.playPedestrianStartle();
          hud.showToast(`⚠️ 사각지대 돌발 주의! ${popEv.hazardName} 뒤에서 보행자 갑툭튀!`, 3200);
        },
        handlePedestrianHit,
        (overSpeed) => {
          audio.playCameraApproachBeep(overSpeed);
        },
        (patrolEv) => {
          delivery.applyFine(patrolEv.fine);
          audio.playPoliceSiren();
          hud.triggerSpeedCameraFlash();
          hud.showFineTicketPopup(patrolEv);
          hud.showToast(
            `🚓 ${patrolEv.label} 현장 단속! (${patrolEv.measuredKmh}km/h 과속) 과태료 -₩${patrolEv.fine.toLocaleString()}`,
            4600
          );
        },
        { x: playerCtrl.state.x, z: playerCtrl.state.z }
      );
      world.mapInfo.upcomingCamera = roadHazards.upcomingCamera;

      // Sidewalk riding: warning, or a full ticket when a patrol car sees it
      const sx = scooterPhysics.state.x;
      const sz = scooterPhysics.state.z;
      const speedKmh = Math.abs(scooterPhysics.state.speed) * 3.6;
      const curbOffset = isRiding && speedKmh >= SIDEWALK_MIN_KMH ? roadProximity.curbOffset(sx, sz) : -1;
      if (
        sidewalkMonitor.step(dt, {
          isRiding,
          crashed: scooterPhysics.state.crashed,
          speedKmh,
          curbOffset,
          exempt: isSidewalkOffset(curbOffset) && (world.nearestGasStation(sx, sz)?.dist ?? Infinity) < 30,
        })
      ) {
        const ticket = roadHazards.witnessTicket('patrol_sidewalk', sx, sz, speedKmh);
        if (ticket) issuePatrolTicket(ticket, '인도 주행');
        else {
          audio.playPedestrianStartle();
          hud.showToast(`🚸 인도 주행 중! 보행자 위험 · 순찰차에 걸리면 과태료 ₩${SIDEWALK_TICKET_FINE.toLocaleString()}`, 3600);
        }
      }
    } else {
      world.mapInfo.upcomingCamera = null;
      corridorRoom.updateVisual(elapsed, dt, playerCtrl.state.z, {
        onFloorTick: () => {
          audio.playElevatorFloorTick();
        },
        onDoorSlide: () => {
          audio.playElevatorDoorSlide();
        },
        onArrivedTargetFloor: (floor) => {
          audio.setElevatorHum(false);
          audio.playElevatorDing();
          voiceNav.speak(`${floor}층입니다. 문이 열립니다.`);
          const cm = delivery.getCorridorMission();
          const inst = cm ? getInstructionMeta(cm.order.deliveryInstruction) : null;
          const unit = cm?.order.unitNumber ?? `${floor}층`;
          hud.showToast(
            `🔔 띵동! ${floor}층 도착! 엘리베이터에서 내려 ${unit}로 이동하세요${inst ? ` (${inst.badge})` : ''}`,
            4600
          );
        },
        onArrivedGroundFloor: () => {
          audio.setElevatorHum(false);
          audio.playElevatorDing();
          voiceNav.speak('1층 로비에 도착했습니다.');
          exitCorridorToStreet();
        },
      });
    }

    perf.lap('hazards');
    const allObstacles = inCorridor
      ? []
      : [...world.getCollisionObstacles(), ...traffic.getCarObstacleBoxes(), ...roadHazards.getAllObstacleBoxes()];

    const activeBump = inCorridor ? null : world.getSpeedBumpAt(scooterPhysics.state.x, scooterPhysics.state.z);
    const roadCondition = inCorridor
      ? { isRaining: false, surface: 'none' as const, onSpeedBump: false }
      : {
          isRaining: weather.isRaining,
          surface: world.getSlipSurfaceAt(scooterPhysics.state.x, scooterPhysics.state.z),
          onSpeedBump: activeBump !== null,
          speedBumpLabel: activeBump?.label,
        };

    if (isRiding && !movementBlocked) {
      const scooterInput: ScooterInput = {
        throttle: pressed.has('KeyW') || pressed.has('ArrowUp'),
        brake: pressed.has('KeyS') || pressed.has('ArrowDown'),
        steerLeft: pressed.has('KeyA') || pressed.has('ArrowLeft'),
        steerRight: pressed.has('KeyD') || pressed.has('ArrowRight'),
        handbrake: pressed.has('Space'),
      };
      scooterPhysics.step(dt, scooterInput, allObstacles, roadCondition);
      playerCtrl.step(
        dt,
        { forward: 0, strafe: 0, sprint: false, jump: false },
        camController.onFootYaw,
        scooterPhysics.state,
        allObstacles
      );
    } else {
      if (!inCorridor) {
        // Rider still mounted behind a modal -> coast with neutral controls instead of the parked/kickstand branch
        scooterPhysics.step(dt, isRiding ? NEUTRAL_SCOOTER_INPUT : null, allObstacles, roadCondition);
      }

      if (playerCtrl.state.mode === 'on_foot' && !movementBlocked) {
        const turnDir =
          (pressed.has('ArrowLeft') ? 1 : 0) - (pressed.has('ArrowRight') ? 1 : 0);
        if (turnDir !== 0) {
          camController.rotateOnFootYaw(turnDir * 2.1 * dt);
        }
      }

      const footInput: OnFootInput = movementBlocked
        ? { forward: 0, strafe: 0, sprint: false, jump: false }
        : {
            forward:
              (pressed.has('KeyW') || pressed.has('ArrowUp') ? 1 : 0) -
              (pressed.has('KeyS') || pressed.has('ArrowDown') ? 1 : 0),
            strafe: (pressed.has('KeyA') ? 1 : 0) - (pressed.has('KeyD') ? 1 : 0),
            sprint: pressed.has('ShiftLeft') || pressed.has('ShiftRight'),
            jump: pressed.has('Space') && modalUi.activeModal !== 'camera',
          };
      playerCtrl.step(
        dt,
        footInput,
        camController.onFootYaw,
        scooterPhysics.state,
        allObstacles,
        (x, z) => corridorRoom.clampPlayerInside(x, z),
        (x, z) => corridorRoom.getFloorYAt(x, z),
        () => audio.playStairFootstep()
      );
    }

    perf.lap('physics');
    // Urgent deliveries: warn at 30s left, then tick every second until the time is up
    for (const m of delivery.activeMissions) {
      if (m.order.special !== 'urgent' || m.phase === 'corridor_exit' || m.remainingTimeSec <= 0) continue;
      const before = Math.ceil(m.remainingTimeSec);
      const after = Math.ceil(m.remainingTimeSec - dt);
      if (before === after || after > URGENT_WARN_SEC) continue;
      if (after === URGENT_WARN_SEC) {
        hud.showToast(`⏱️ [#${m.order.orderNumber}] 급한 배달 ${URGENT_WARN_SEC}초 남음! 늦으면 급송 할증이 없어요`, 3000);
        voiceNav.speak('급한 배달, 30초 남았습니다.');
      }
      audio.playUrgentTick(after <= 5);
    }
    // Step active mission delivery countdowns, peak-time cooking timers, cargo physics & live customer chat!
    delivery.stepTimers(dt, (readyMission) => {
      audio.playFoodReadyDingDong();
      voiceNav.speak(`${readyMission.order.shop.name} 음식이 준비되었습니다. 픽업대에서 수령하세요.`);
      hud.showToast(
        `🔔 ${readyMission.order.shop.emoji} ${readyMission.order.shop.name} [#${readyMission.order.orderNumber}]: "음식이 준비되었습니다!" 픽업대 트레이에서 [E]로 수령하세요`,
        4600
      );
    });
    delivery.stepCargoPhysics(dt, scooterPhysics.state, isRiding, (ordNo, menuName) => {
      audio.playLiquidSlosh();
      hud.showToast(
        `🍲 [#${ordNo}] ${menuName} 국물/음료 출렁임! 급코너·급브레이크 시 음식 상태가 감소합니다`,
        2600
      );
    });
    delivery.stepCustomerChatEvents(dt, inCorridor, isRiding, (chatEv) => {
      audio.playCustomerChatPing();
      voiceNav.speak('고객님께 새 메시지가 도착했습니다.');
      hud.showCustomerChatPopup(chatEv);
    });
    dispatch.step(dt, delivery, inCorridor, movementBlocked);

    // Compute bundled multi-stop A* Navigation Plan (internally cached & throttled)
    const navPlan = delivery.getNavigationPlan(
      playerCtrl.state.x,
      playerCtrl.state.z,
      playerCtrl.state.heading,
      scooterPhysics.state.x,
      scooterPhysics.state.z,
      inCorridor,
      elapsed,
      roadNavigator
    );

    perf.lap('delivery/nav');
    // Outdoor Entrance Ground Marker + Shop Pickup Trays + 3-Slot Scooter Visuals
    // (Navigation path is shown ONLY on the smartphone GPS screen, never on the 3D road!)
    if (!inCorridor) {
      world.updateBeacon(navPlan.target, navPlan.isPickupTarget, elapsed);

      const cookingShopIds = new Set<string>();
      const readyShopIds = new Set<string>();
      for (const m of delivery.activeMissions) {
        if (m.phase === 'cooking_wait') cookingShopIds.add(m.order.shop.id);
        else if (m.phase === 'pickup_ready') readyShopIds.add(m.order.shop.id);
      }
      world.syncShopPickupTrays(cookingShopIds, readyShopIds, elapsed);

      scooterMesh.sync(scooterPhysics.state, elapsed, dt, world.isNight, weather.rainIntensity);
      scooterMesh.setCargoSlotsVisual(delivery.getCargoSlotOccupiedFlags());
      scooterMesh.setPhoneMounted(
        hud.phoneMap.placement === 'mounted' &&
          !hud.phoneMap.isZoomed &&
          !handheldPhone3D.isHoldingPhoneDuringMountAnim()
      );
    }

    // 1st-person 3D Right Hand Smartphone & 3D Left Hand Food Bag!
    handheldPhone3D.update(
      hud.phoneMap.placement === 'in_hand' &&
        !hud.phoneMap.isZoomed &&
        modalUi.activeModal === 'none',
      playerCtrl.state,
      dt,
      elapsed
    );
    const showHandBag =
      (delivery.isCarryingFood() ||
        (delivery.getCorridorMission()?.phase === 'meet_waiting' && !hooks.isNpcHoldingFoodBag())) &&
      !isRiding &&
      modalUi.activeModal !== 'transition';
    handheldFoodBag3D.update(showHandBag, playerCtrl.state, dt, elapsed);

    playerMesh.sync(
      playerCtrl.state,
      scooterMesh.riderMountPoint,
      scooterPhysics.state.steerAngle,
      true
    );

    camController.update(camera, playerCtrl.state, scooterPhysics.state, scooterMesh, dt);

    // Live viewfinder framing validation (Bounding Box + vector.project(camera)) when in PHOTO_DOOR camera mode!
    if (inCorridor && modalUi.activeModal === 'camera') {
      const { foodBagMesh, doorPlateMesh } = corridorRoom.getProofTargets();
      const proofStatus = validateDeliveryPhotoFrame(camera, foodBagMesh, doorPlateMesh);
      modalUi.updateCameraProofStatus(proofStatus);
    }

    perf.lap('visuals');
    // Weather local rain particles (InstancedMesh), 1st-person helmet visor droplets, wet asphalt & audio!
    weather.update(dt, camera.position.x, camera.position.y, camera.position.z, inCorridor, world.isNight);
    visorRain.update(dt, weather.rainIntensity, inCorridor, scooterPhysics.state.speed, isRiding);
    if (!inCorridor) {
      world.updateWeatherVisuals(weather.rainIntensity, elapsed);
    }
    audio.updateWeatherAudio(weather.rainIntensity, inCorridor);
    audio.update(scooterPhysics.state, elapsed);

    // Korean Web Speech API Voice Navigation (Turn-by-Turn + 80m Speed Camera Enforcement Alert)
    const navFocusKey = navPlan.focusMission
      ? `${navPlan.focusMission.order.id}:${navPlan.isPickupTarget ? 'p' : 'd'}`
      : null;
    voiceNav.updateSpeedCameraAlert(roadHazards.upcomingCamera, isRiding, inCorridor);
    voiceNav.updateTurnGuidance(navPlan.guidance, navFocusKey, isRiding, inCorridor);

    perf.lap('weather/audio');
    // Step smartphone battery drain & handlebar-mount wireless charging (2x faster with fast_charger upgrade!)
    const chargeSpeedMul = getUpgradeEffects(delivery.career.upgrades).chargeSpeedMul;
    hud.phoneMap.stepBattery(
      dt,
      scooterPhysics.state.engineOn,
      () => {
        audio.playWirelessChargeStart();
        hud.showToast(
          chargeSpeedMul > 1.5
            ? '⚡ 고속 무선충전 거치대 작동! (2배 속도로 초고속 충전 중)'
            : '⚡ 오토바이 거치대 무선충전 시작! (주행 중 배터리 자동 충전)',
          2600
        );
      },
      () => {
        audio.playLowBatteryBeep();
        voiceNav.speak('휴대폰 배터리가 부족합니다. 거치대에 장착해 충전하세요.');
        hud.showToast(
          '🪫 휴대폰 배터리 15% 이하! 오토바이 거치대 [Tab] 무선충전 또는 🏪 편의점 충전 필요',
          4200
        );
      },
      () => {
        audio.playLowBatteryBeep();
        hud.showToast(
          '🪫 휴대폰 배터리 방전! 오토바이 거치대 [Tab] 시동 무선충전 또는 🏪 K-24 편의점에서 충전하세요',
          4600
        );
      },
      chargeSpeedMul
    );

    // Update 1-Minute First-Shift Interactive Onboarding Guide progress
    onboardingSettings.updateOnboarding(playerCtrl.state, delivery, {
      financeTabOpen: hud.phoneMap.isZoomed && hud.phoneMap.activeTab === 'finance',
      isPeakTime: delivery.demandPhase.isPeak,
    });

    hud.update(
      playerCtrl.state,
      scooterPhysics.state,
      delivery,
      dispatch.activeOffer,
      navPlan,
      traffic.signalState,
      world.isNight,
      weather.mode,
      audio.muted,
      elapsed,
      world.mapInfo,
      {
        nearestGas:
          !inCorridor && scooterPhysics.state.fuel <= 30
            ? world.nearestGasStation(scooterPhysics.state.x, scooterPhysics.state.z)
            : null,
        nearCargoBox: isPlayerNearCargoBox(),
        nearGasPump: !inCorridor && world.isPlayerNearGasPump(playerCtrl.state.x, playerCtrl.state.z),
        scooterOnGasPad:
          !inCorridor && world.isScooterOnGasPad(scooterPhysics.state.x, scooterPhysics.state.z),
        nearRepairShop:
          !inCorridor && world.isPlayerNearRepairShop(playerCtrl.state.x, playerCtrl.state.z),
        scooterOnRepairPad:
          !inCorridor && world.isScooterOnRepairPad(scooterPhysics.state.x, scooterPhysics.state.z),
        nearConvenienceStore:
          !inCorridor && world.isPlayerNearConvenienceStore(playerCtrl.state.x, playerCtrl.state.z),
        nearCorridorTargetDoor:
          inCorridor && corridorRoom.isNearTargetDoor(playerCtrl.state.x, playerCtrl.state.z, playerCtrl.state.y),
        nearCorridorElevator:
          inCorridor && corridorRoom.isNearElevator(playerCtrl.state.x, playerCtrl.state.z, playerCtrl.state.y),
        insideElevatorCabin:
          inCorridor && corridorRoom.isInsideElevatorCabin(playerCtrl.state.x, playerCtrl.state.z),
        elevatorPhase: corridorRoom.elevatorPhase,
        elevatorCurrentFloor: corridorRoom.elevatorCurrentFloor,
        elevatorTargetFloor: corridorRoom.elevatorTargetFloor,
        elevatorDoorsOpen: corridorRoom.isElevatorDoorsOpen(),
        isVillaCorridor: inCorridor && corridorRoom.isVillaMode,
        villaCurrentFloor:
          inCorridor && corridorRoom.isVillaMode
            ? corridorRoom.getCurrentVillaFloor(playerCtrl.state.y)
            : 1,
        visorWetHint: !inCorridor && weather.isRaining && visorRain.dropletDensity >= 0.35,
        modalOpen: modalUi.activeModal !== 'none' || onboardingSettings.isSettingsOpen || districtUi.isOpen,
      }
    );

    perf.lap('hud/phone');
    // Update all world matrices ONCE per frame; the mirror passes and the main pass reuse them
    // (renderer.render() would otherwise traverse the whole scene again for every pass)
    scene.updateMatrixWorld();
    perf.lap('matrices');
    // Only render scooter mirrors when outdoors & riding
    // Shadow refresh schedule + dynamic resolution (driven by the measured GPU frame time)
    // Fallback (no GPU timer) uses the frame interval: discount the deliberate 30fps power-save gap
    const pacedInterval = currentTargetFps < MAX_FPS ? frameIntervalMs - (1000 / currentTargetFps - 1000 / MAX_FPS) : frameIntervalMs;
    hooks.graphics.frame(dt, perf.gpuFrameMs, pacedInterval, perf.isBenchmarking);
    if (!inCorridor && isRiding && !perf.flags.skipMirrors) {
      perf.gpuBegin('mirrors');
      scooterMesh.renderMirrors(renderer, scene, scooterPhysics.state);
      perf.gpuEnd();
    } else {
      perf.clearGpuLatest('mirrors');
    }
    perf.lap('mirrors');

    void CORRIDOR_ORIGIN_Y;
    perf.gpuBegin('main');
    renderer.render(scene, camera);
    perf.gpuEnd();
    perf.lap('render');
    perf.endFrame();

    currentTargetFps = targetFps({
      enabled: onboardingSettings.settings.powerSaving && !perf.isMeasuring,
      photoMode: modalUi.activeModal === 'camera',
      menuOpen: movementBlocked,
      phoneZoomed: hud.phoneMap.isZoomed,
      moving:
        Math.abs(scooterPhysics.state.speed) > 0.3 ||
        playerCtrl.state.moveSpeed > 0.1 ||
        playerCtrl.state.mode === 'knockdown',
      secondsSinceInput: activity.secondsSince(now),
    });
  }

  requestAnimationFrame(animate);
}
