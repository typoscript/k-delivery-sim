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
