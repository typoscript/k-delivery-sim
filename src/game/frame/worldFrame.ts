/** Per-frame stage of the game loop (gameLoop.ts calls the stages in order each frame) */
import type { GameContext } from '../GameContext';
import type { FrameState, GameLoopHooks, LoopState } from '../gameLoop';
import { stepRoadConditions } from './roadConditionsFrame';
import { stepRiderWatch } from './riderWatchFrame';
import { stepCorridorFrame } from './corridorFrame';
import { RED_LIGHT_TICKET_FINE } from '../trafficViolations';
import { PedestrianCollisionEvent } from '../../world/PedestrianManager';
import { SCOOTER_SPECS } from '../../vehicle/ScooterPhysics';
import { PLAYER_RADIUS } from '../../player/PlayerController';
import { pushOutOfBodies } from '../../world/vehicleBodies';
import { NO_GROUND_WALK_BONUS } from '../../delivery/apartmentRules';

/**
 * Outdoors: streaming, road conditions (roadConditionsFrame), traffic, pedestrians and hazards, then the rider watch
 * (riderWatchFrame: sidewalk / red-light / pedestrian warnings). Indoors: the corridor and elevator (corridorFrame).
 */
export function stepWorldFrame(ctx: GameContext, hooks: GameLoopHooks, loop: LoopState, f: FrameState): void {
  const { world, traffic, pedestrians, roadHazards, delivery, scooterPhysics, playerCtrl, audio, hud } = ctx;
  const { issuePatrolTicket, perf } = loop;
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
    stepRoadConditions(ctx, loop, f);
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
      const startled = world.updateStreamStrollers(
        dt,
        isRiding ? scooterPhysics.state.x : playerCtrl.state.x,
        isRiding ? scooterPhysics.state.z : playerCtrl.state.z,
        isRiding && !scooterPhysics.state.crashed ? scooterPhysics.state : undefined,
      );
      if (startled > 0) audio.playPedestrianStartle();
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

    stepRiderWatch(ctx, loop, f);
  } else {
    stepCorridorFrame(ctx, hooks, f);
  }
}
