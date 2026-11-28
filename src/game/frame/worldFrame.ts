import { WIND_MIN_KMH, bridgeGust, windLevelFor, windRollFor } from '../bridgeWind';
/** Per-frame stage of the game loop (gameLoop.ts calls the stages in order each frame) */
import type { GameContext } from '../GameContext';
import type { FrameState, GameLoopHooks, LoopState } from '../gameLoop';
import { ALERT_MAX_DIST_M } from '../riderAlerts';
import { ACTIVE_MAP_DATA } from '../../data/suwonDistricts';
import { getSignalAxis, signalNodesNear } from '../../world/TrafficRules';
import { RED_LIGHT_TICKET_FINE, SIDEWALK_MIN_KMH, SIDEWALK_TICKET_FINE, isSidewalkOffset } from '../trafficViolations';
import { PedestrianCollisionEvent } from '../../world/PedestrianManager';
import { SCOOTER_SPECS } from '../../vehicle/ScooterPhysics';
import { PLAYER_RADIUS } from '../../player/PlayerController';
import { pushOutOfBodies } from '../../world/vehicleBodies';
import { getInstructionMeta } from '../../delivery/DeliveryManager';
import { NO_GROUND_WALK_BONUS } from '../../delivery/apartmentRules';
import { ICE_PASS_COUNTER } from '../../delivery/careerHistory';

/** Puddles slow the scooter (speed decay per second) above this speed (m/s) */
const PUDDLE_DRAG = 1.4;
const PUDDLE_MIN_SPEED = 3;
/** Faster than this (m/s, ~22 km/h) the splash reaches people on the sidewalk */
const PUDDLE_SPLASH_PEOPLE_SPEED = 6;

/** Outdoors: streaming, traffic, pedestrians, hazards, sidewalk / red-light / pedestrian warnings. Indoors: the corridor and elevator */
export function stepWorldFrame(ctx: GameContext, hooks: GameLoopHooks, loop: LoopState, f: FrameState): void {
  const {
    world,
    traffic,
    corridorRoom,
    pedestrians,
    roadHazards,
    voiceNav,
    delivery,
    scooterPhysics,
    playerCtrl,
    audio,
    hud,
  } = ctx;
  const { exitCorridorToStreet } = hooks;
  const { roadProximity, sidewalkMonitor, riderAlerts, safeStops, nearSignalIds, issuePatrolTicket, perf } = loop;
  const { dt, elapsed, inCorridor, isRiding } = f;
  if (!inCorridor) {
    // Open-world chunk streaming & prop culling around whoever is moving (rider follows the scooter)
    world.updateStreaming(
      isRiding ? scooterPhysics.state.x : playerCtrl.state.x,
      isRiding ? scooterPhysics.state.z : playerCtrl.state.z,
    );
    delivery.setReferencePosition(playerCtrl.state.x, playerCtrl.state.z);
    world.updateLobbyDoors(dt);
    const gateEvent = world.updateApartmentGates(
      dt,
      isRiding ? scooterPhysics.state.x : playerCtrl.state.x,
      isRiding ? scooterPhysics.state.z : playerCtrl.state.z,
      isRiding,
      (id) => delivery.activeMissions.some((m) => m.order.customer.id === id && m.pickedUp),
    );
    // Rain puddles: riding through one at speed drags the scooter and splashes the visor (once per puddle)
    if (isRiding && world.puddles.puddles.length > 0) {
      const sp = scooterPhysics.state;
      const puddle = world.puddles.puddleAt(sp.x, sp.z);
      if (puddle && Math.abs(sp.speed) > PUDDLE_MIN_SPEED) {
        sp.speed *= Math.exp(-PUDDLE_DRAG * dt);
        if (puddle.id !== world.puddles.splashedId) {
          world.puddles.splashedId = puddle.id;
          ctx.visorRain.splash(Math.min(34, 10 + Math.abs(sp.speed) * 1.6));
          audio.playCargoBoxSound();
          // fast through a puddle by the sidewalk: people nearby get soaked
          const soaked =
            Math.abs(sp.speed) > PUDDLE_SPLASH_PEOPLE_SPEED ? pedestrians.splashNear(puddle.x, puddle.z, 4.5) : 0;
          if (soaked > 0) {
            const lost = delivery.penalizePuddleSplash();
            delivery.messenger.post(
              'notice',
              { kind: 'notice', title: '민원 · 알림', icon: '📢' },
              {
                from: 'them',
                text: `🙍 행인 민원 접수: "흙탕물 튀기고 그냥 가면 어떡해요!" (행인 ${soaked}명 · 신뢰 평점 -${lost.toFixed(1)})`,
                time: ctx.clock.label,
              },
            );
            audio.playPedestrianStartle();
            hud.showToast(
              `💢 행인 ${soaked}명에게 흙탕물을 튀겼어요! 웅덩이 근처에선 천천히 (신뢰 평점 -${lost.toFixed(1)})`,
              3400,
            );
          } else {
            hud.showToast('💦 첨벙! 물웅덩이 — 속도가 줄고 바이저에 물이 튀었어요 ([G]로 닦기)', 2400);
          }
        }
      }
    }
    // Crosswind on bridges: gusts push the scooter sideways (more in rain / snow); told once per session
    if (isRiding) {
      const sp = scooterPhysics.state;
      const onBridge = world.roadStructures.structureAt(sp.x, sp.z, sp.heading) === 'bridge';
      const gust = onBridge ? bridgeGust(elapsed, world.weatherMode, Math.abs(sp.speed) * 3.6) : 0;
      // the rider leans into the wind and hears it rush past (fades out off the bridge)
      ctx.camController.windRoll = windRollFor(gust);
      audio.setWind(onBridge && Math.abs(sp.speed) * 3.6 >= WIND_MIN_KMH ? windLevelFor(gust) : 0);
      if (gust !== 0) {
        // rider's right = forward x up = (-fz, 0, fx) with forward (sin h, cos h)
        const fx = Math.sin(sp.heading);
        const fz = Math.cos(sp.heading);
        sp.x += -fz * gust * dt;
        sp.z += fx * gust * dt;
        if (!loop.windHintShown) {
          loop.windHintShown = true;
          hud.showToast('🌬️ 다리 위 옆바람! 핸들이 살짝 밀려요 — 비·눈 오는 날엔 더 세요', 3000);
        }
      }
    }
    else {
      ctx.camController.windRoll = 0;
      audio.setWind(0);
    }
    // Streams on foot: wading through the water is slow (stepping stones and bridges are the way across)
    const wading = !isRiding && playerCtrl.state.mode === 'on_foot' && world.isWadingAt(playerCtrl.state.x, playerCtrl.state.z);
    if (wading && !playerCtrl.wading) {
      audio.playCargoBoxSound();
      if (!loop.wadingHintShown) {
        loop.wadingHintShown = true;
        hud.showToast('🌊 하천에 들어갔어요 — 물속에선 걸음이 느려요 · 징검다리나 다리로 건너세요', 3200);
      }
    }
    playerCtrl.wading = wading;
    // Crossing black ice without going down counts toward the 빙판 마스터 achievement
    if (isRiding && world.blackIce.isActive) {
      const sp = scooterPhysics.state;
      const on = world.blackIce.patchAt(sp.x, sp.z, sp.heading);
      const bi = world.blackIce;
      if (on && bi.crossingId !== on.id) {
        bi.crossingId = on.id;
        bi.crashedOnCrossing = false;
      }
      if (bi.crossingId >= 0 && sp.crashed && !bi.crashedOnCrossing) {
        bi.crashedOnCrossing = true;
        // the first fall on ice this session: how to ride it
        if (!loop.iceTipShown) {
          loop.iceTipShown = true;
          window.setTimeout(
            () =>
              hud.showToast(
                '🧊 빙판 요령: 얼음 위에선 브레이크·급회전 대신 스로틀을 살짝 풀고 곧게 지나가세요 · 다리 위가 반짝이면 얼어 있어요',
                5200,
              ),
            1600,
          );
        }
      }
      if (!on && bi.crossingId >= 0) {
        if (!bi.crashedOnCrossing) {
          delivery.progress.bump(ICE_PASS_COUNTER);
          hud.showToast('⛸️ 빙판 무사 통과! (빙판 마스터 업적)', 1800);
        }
        bi.crossingId = -1;
      }
    }
    // Black ice ahead (winter nights): warn once per patch while riding toward it
    if (isRiding && world.blackIce.isActive) {
      const ice = world.blackIce.nearest(
        scooterPhysics.state.x,
        scooterPhysics.state.z,
        32,
        false,
        scooterPhysics.state.heading,
      );
      if (ice && ice.id !== world.blackIce.warnedId) {
        world.blackIce.warnedId = ice.id;
        audio.playCameraApproachBeep(false);
        hud.showToast(
          ice.onBridge
            ? '🧊 다리 위 결빙 주의! 다리는 가장 먼저 얼어요 — 미리 속도를 줄이고 브레이크·급회전 금지'
            : '🧊 결빙 주의! 앞 그늘진 노면 블랙아이스 — 미리 속도를 줄이고 브레이크·급회전 금지',
          3400,
        );
      }
    }
    if (gateEvent) {
      hud.showToast(
        gateEvent.kind === 'blocked'
          ? `👮 경비원: "지상 차량 출입 금지 단지예요! 오토바이는 여기 밖에 세우고 걸어가세요" (도보 수당 +₩${NO_GROUND_WALK_BONUS.toLocaleString()})`
          : '👮 경비원: "배달 오셨어요? 들어가세요~" (차단기 올라감)',
        3800,
      );
      if (gateEvent.kind === 'blocked') audio.playKeypadBeep(false);
    }
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
          Math.abs(scooterPhysics.state.speed) * 3.6,
        );
        if (ticket) {
          issuePatrolTicket(ticket, '빨간불 교차로 진입');
          return;
        }
        const fine = delivery.applyFine(1000, 'signal');
        hud.showToast(
          fine > 0
            ? `🚨 신호 위반! 빨간불 교차로 통과 (-₩${fine.toLocaleString()}) · 순찰차에 걸리면 ₩${RED_LIGHT_TICKET_FINE.toLocaleString()}`
            : '🚨 신호 위반! 교차로 빨간불에 정지하세요!',
          3600,
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
      isRiding ? null : { x: scooterPhysics.state.x, z: scooterPhysics.state.z },
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
      carBodies,
    );

    if (!inCorridor) {
      world.updateStreamStrollers(
        dt,
        isRiding ? scooterPhysics.state.x : playerCtrl.state.x,
        isRiding ? scooterPhysics.state.z : playerCtrl.state.z,
      );
    }
    perf.lap('pedestrians');
    roadHazards.step(
      dt,
      elapsed,
      inCorridor,
      scooterProx,
      traffic.signalState,
      (camEv) => {
        delivery.applyFine(camEv.fine, camEv.kind === 'red_light' ? 'signal' : 'speeding');
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
        delivery.applyFine(patrolEv.fine, 'speeding');
        audio.playPoliceSiren();
        hud.triggerSpeedCameraFlash();
        hud.showFineTicketPopup(patrolEv);
        hud.showToast(
          `🚓 ${patrolEv.label} 현장 단속! (${patrolEv.measuredKmh}km/h 과속) 과태료 -₩${patrolEv.fine.toLocaleString()}`,
          4600,
        );
      },
      { x: playerCtrl.state.x, z: playerCtrl.state.z },
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
        hud.showToast(
          `🚸 인도 주행 중! 보행자 위험 · 순찰차에 걸리면 과태료 ₩${SIDEWALK_TICKET_FINE.toLocaleString()}`,
          3600,
        );
      }
    }

    // Red light / pedestrian in the path within stopping distance: warn before it is too late
    const fx = Math.sin(scooterPhysics.state.heading);
    const fz = Math.cos(scooterPhysics.state.heading);
    nearSignalIds.length = 0;
    const signalsNear = isRiding
      ? signalNodesNear(sx, sz, ALERT_MAX_DIST_M, nearSignalIds).map((id) => {
          const n = ACTIVE_MAP_DATA.nodes[id];
          const axis = getSignalAxis(id, fx, fz);
          return { id, x: n.x, z: n.z, color: axis === 'ns' ? traffic.signalState.ns : traffic.signalState.ew };
        })
      : [];
    const riderPose = { x: sx, z: sz, heading: scooterPhysics.state.heading, speed: scooterPhysics.state.speed };
    const alert = riderAlerts.step(
      dt,
      isRiding && !scooterPhysics.state.crashed,
      riderPose,
      signalsNear,
      isRiding ? pedestrians.agents : [],
    );
    // Stopped / slowed in time after a warning: rating back + the safe-stop goal
    const safe = isRiding ? safeStops.step(dt, riderPose, scooterPhysics.state.crashed) : null;
    if (safe) {
      const res = delivery.recordSafeStop();
      audio.playGoalSparkle();
      const what = safe === 'safe_stop' ? '👍 안전 정지!' : '👍 보행자 양보!';
      hud.showToast(
        res.ratingGain > 0
          ? `${what} 신뢰 평점 +${res.ratingGain.toFixed(1)} (★ ${res.newRating.toFixed(1)}) · 오늘 ${res.count}회`
          : `${what} 오늘 ${res.count}회`,
        2600,
      );
      for (const g of res.goals) {
        window.setTimeout(() => hud.showToast(`🎯 오늘의 목표 달성! ${g.icon} ${g.title} +₩${g.bonus.toLocaleString()}`, 3600), 2800);
        hud.phoneMap.notify('🎯', '뱅크', `오늘의 목표 달성 · ${g.title} +₩${g.bonus.toLocaleString()}`);
      }
    }
    if (alert) {
      safeStops.onAlert(alert, riderPose);
      audio.playCameraApproachBeep(true);
      hud.showToast(
        alert.kind === 'pedestrian'
          ? `🚸 전방 ${Math.round(alert.distance)}m 보행자 · 감속하세요`
          : `🚦 전방 ${Math.round(alert.distance)}m 빨간불 · 정지하세요`,
        2200,
      );
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
          4600,
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
}
