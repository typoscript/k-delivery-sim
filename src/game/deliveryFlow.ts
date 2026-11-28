import * as THREE from 'three';
import { GameContext } from './GameContext';
import { setWeatherMode } from './clockSync';
import { REPUTATION_ORDER } from '../delivery/reputation';
import type { AchievementSpec } from '../delivery/careerHistory';
import { getInstructionMeta } from '../delivery/DeliveryManager';
import { validateDeliveryPhotoFrame } from '../camera/PhotoProofValidator';
import { BikeGarageSave } from '../vehicle/ScooterModels';
import { collidesWithWorld } from '../types';
import type { InteractEnv } from './interact/interactEnv';
import { interactServiceStations } from './interact/serviceStations';
import { interactInCorridor } from './interact/corridorInteract';
import { interactOutdoors } from './interact/outdoorInteract';

/** Mutable delivery-flow state shared with the game loop and modal callbacks */
export interface DeliveryFlowState {
  /** MEET_FACE: the customer NPC has taken the food bag from the rider's hand */
  npcTookFoodBag: boolean;
  /** Daily goal bonus popup shown once the settlement receipt is closed */
  pendingMissionBonusPopup: { title: string; bonus: number; totalWallet: number } | null;
}

export interface DeliveryFlowDeps {
  /** Saved scooter model / paint (shown at the repair shop) */
  bikeGarage: BikeGarageSave;
}

/**
 * Player-driven delivery flow handlers (moved out of main.ts): the context [E] interaction at shops,
 * lobbies, service stations and the cargo box, the corridor enter / exit transitions, proof photo and
 * settlement, cargo slots, call offers, phone placement / zoom and weather cycling.
 * Created once all systems in `ctx` exist; UI callbacks call these lazily.
 */
export function createDeliveryFlow(ctx: GameContext, deps: DeliveryFlowDeps) {
  const { renderer, scene, camera, world, traffic, corridorRoom, weather, voiceNav, delivery, dispatch, scooterPhysics, scooterMesh, playerCtrl, camController, audio, hud, modalUi, handheldPhone3D } = ctx;
  const { bikeGarage } = deps;
  const state: DeliveryFlowState = { npcTookFoodBag: false, pendingMissionBonusPopup: null };

  const tmpCargoPos = new THREE.Vector3();

  const isPlayerNearCargoBox = (): boolean => {
    if (playerCtrl.state.inCorridor || playerCtrl.state.mode !== 'on_foot') return false;
    scooterMesh.getCargoBoxWorldPosition(tmpCargoPos);
    return Math.hypot(playerCtrl.state.x - tmpCargoPos.x, playerCtrl.state.z - tmpCargoPos.z) <= 2.4;
  };

  const playerHasPhonePhysically = (): boolean => {
    return hud.phoneMap.placement !== 'mounted' || playerCtrl.state.mode === 'riding';
  };

  const enterElevatorToCorridor = (missionId: string) => {
    const m = delivery.getMissionById(missionId);
    if (!m) return;
    // Physical phone possession check: cannot take proof photo upstairs if phone was left on scooter!
    if (hud.phoneMap.placement === 'mounted') {
      hud.showToast(
        '🚫 휴대폰이 오토바이 거치대에 있습니다! 배달 인증 사진을 찍으려면 먼저 오토바이에서 [Tab]으로 챙겨오세요',
        3800
      );
      return;
    }
    const isVilla = m.order.customer.residenceKind === 'walkup_villa';
    if (!isVilla) {
      audio.playElevatorDoorSlide();
    }
    hud.stowPhoneToPocket();
    modalUi.playQuickDoorTransition(
      isVilla
        ? `🪜 [#${m.order.orderNumber}] ${m.order.customer.name} 원룸·빌라 1층 계단실 진입 중...`
        : `🛗 [#${m.order.orderNumber}] ${m.order.customer.name} 1층 엘리베이터 탑승 중...`,
      () => {
        // Midpoint while screen is black: occlude entire outdoor world + nav line + rain & audio!
        world.setOutdoorVisible(false);
        traffic.root.visible = false;
        scooterMesh.root.visible = false;
        weather.update(0, 0, 0, 0, true, world.isNight);
        audio.updateWeatherAudio(0, true);

        corridorRoom.configureForUnit(m.order.unitNumber, m.order.customer.residenceKind ?? 'apartment', {
          id: m.order.customer.id,
          name: m.order.customer.name,
        });
        corridorRoom.root.visible = true;

        delivery.enterCorridor(missionId);
        const sp = corridorRoom.getSpawnPoint();
        playerCtrl.teleportTo(sp.x, sp.y, sp.z, sp.heading, true);
        camController.onFootYaw = sp.heading;
        camController.resetLook();
      },
      () => {
        if (isVilla) {
          const inst = getInstructionMeta(m.order.deliveryInstruction);
          hud.showToast(
            `🪜 원룸·빌라 계단실 진입! (엘리베이터 없음) 계단을 걸어 올라가 ${m.order.unitNumber}로 배달하세요 (${inst.badge})`,
            4600
          );
        } else {
          hud.showToast(
            `🛗 아파트 1층 엘리베이터 탑승 완료! [E]를 눌러 ${corridorRoom.elevatorTargetFloor}층 버튼을 누르세요`,
            4400
          );
        }
      }
    );
  };

  const exitCorridorToStreet = () => {
    const wasVilla = corridorRoom.isVillaMode;
    audio.setElevatorHum(false);
    if (!wasVilla) audio.playElevatorDoorSlide();
    hud.stowPhoneToPocket();
    modalUi.playQuickDoorTransition(
      wasVilla ? '🚪 원룸·빌라 1층 현관 출구로 나가는 중...' : '🛗 1층 로비 도착 · 밖으로 나가는 중...',
      () => {
        corridorRoom.root.visible = false;

        // Restore outdoor city & traffic visibility!
        world.setOutdoorVisible(true);
        world.setLobbyDoorOpen(null);
        traffic.root.visible = true;
        scooterMesh.root.visible = true;

        // Return player neatly beside their parked scooter outside
        const s = scooterPhysics.state;
        const leftX = Math.cos(s.heading);
        const leftZ = -Math.sin(s.heading);
        let rx = s.x + leftX * 1.45;
        let rz = s.z + leftZ * 1.45;
        if (collidesWithWorld(rx, rz, 0.5, world.getCollisionObstacles())) {
          rx = s.x - leftX * 1.45;
          rz = s.z - leftZ * 1.45;
        }

        playerCtrl.teleportTo(rx, 0, rz, s.heading, false);
        camController.onFootYaw = s.heading;
        camController.resetLook();
        delivery.finishAfterCorridorExit();
      },
      () => {
        const rem = delivery.activeMissions.length;
        hud.showToast(
          rem > 0
            ? `1층 복귀 완료! 남은 묶음 배달 ${rem}건의 다음 경로를 휴대폰 내비에서 확인하세요`
            : '1층 복귀 완료! [Tab]으로 휴대폰을 꺼내 다음 묶음 콜을 확인하세요',
          3800
        );
      }
    );
  };


  /** Toasts newly unlocked achievements one after another */
  const announceAchievements = (fresh: AchievementSpec[], delayMs: number) => {
    fresh.forEach((a, i) =>
      window.setTimeout(() => {
        audio.playChime('accept');
        hud.showToast(`🏆 업적 달성! ${a.icon} ${a.title} · ${a.desc}`, 4600);
      }, delayMs + i * 4800)
    );
  };

  /** "주간 목표 달성" toast for week goals the last delivery completed (after the achievement toasts) */
  const announceWeekGoals = (delayMs: number) => {
    const last = delivery.getWeekSummary().lastDay;
    delivery.collectNewlyMetWeekGoals().forEach((g, i) =>
      window.setTimeout(() => {
        audio.playGoalSparkle();
        hud.showToast(`📆 주간 목표 달성! ${g.icon} ${g.title} · ${last}일차 퇴근 때 +₩${g.bonus.toLocaleString()}`, 4600);
      }, delayMs + i * 4800)
    );
  };

  const finalizeCorridorSettlement = () => {
    renderer.render(scene, camera);
    const photoDataUrl = renderer.domElement.toDataURL('image/jpeg', 0.85);
    const repBefore = delivery.getReputation();
    const result = delivery.completePhotoSettlement();
    const repAfter = delivery.getReputation();
    if (result && repAfter.tier !== repBefore.tier) {
      const up = REPUTATION_ORDER.indexOf(repAfter.tier) > REPUTATION_ORDER.indexOf(repBefore.tier);
      window.setTimeout(
        () =>
          hud.showToast(
            `${repAfter.icon} ${up ? '평판이 올랐어요' : '평판이 내려갔어요'}: ${repAfter.label} · ${repAfter.description}`,
            5200
          ),
        1200
      );
    }
    if (result) {
      audio.playChime('complete');
      if (result.tierPromotedTo) {
        audio.playMissionBonusFanfare();
        voiceNav.speak(`축하합니다! ${result.tierPromotedTo.name} 등급으로 승급했습니다!`);
        hud.showToast(
          `🎉 승급 축하! ${result.tierPromotedTo.icon} ${result.tierPromotedTo.name} 달성! (건당 배달 보너스 +₩${result.tierPromotedTo.bonusPerDelivery.toLocaleString()})`,
          5200
        );
      }
      if (result.missionJustCompleted) {
        state.pendingMissionBonusPopup = {
          title: result.goalsCompleted.map((g) => `${g.icon} ${g.title}`).join(' · '),
          bonus: result.missionBonusAwarded,
          totalWallet: result.totalEarnings,
        };
      }
      window.setTimeout(() => {
        modalUi.showSettlement(result, photoDataUrl);
      }, 200);
      const fresh = delivery.collectNewAchievements();
      announceAchievements(fresh, 2600);
      announceWeekGoals(2600 + fresh.length * 4800);
    }
  };

  const handleTakeDeliveryPhoto = () => {
    const m = delivery.getCorridorMission();
    if (!m || m.phase !== 'photo_mode') return;

    // Validate that BOTH the floor food bag AND door unit plaque are framed in central 60% viewfinder!
    const { foodBagMesh, doorPlateMesh } = corridorRoom.getProofTargets();
    const check = validateDeliveryPhotoFrame(camera, foodBagMesh, doorPlateMesh);

    if (!check.valid) {
      audio.playKeypadBeep(false);
      modalUi.showCameraValidationWarning(check);
      hud.showToast('⚠️ 현관문 호수와 음식 봉투가 모두 보이도록 찍어주세요!', 3400);
      return;
    }

    audio.playCameraShutter();
    modalUi.triggerCameraFlash();
    hud.showToast('✅ 인증 사진 확인 완료 — 배달 완료 승인!', 2600);
    finalizeCorridorSettlement();
  };

  const handleCargoSlotAction = (slotIndex: number) => {
    const carrying = delivery.getCarryingMission();
    const slotMission = delivery.getCargoSlotMission(slotIndex);

    if (slotMission === null) {
      if (!carrying) {
        hud.showToast(`슬롯 ${slotIndex + 1}은 비어 있습니다`);
        return;
      }
      const loaded = delivery.loadFoodIntoCargoSlot(slotIndex);
      if (loaded) {
        scooterMesh.triggerCargoBoxOpen();
        audio.playCargoBoxSound();
        modalUi.closeAll();
        hud.showToast(
          `📦 슬롯 ${slotIndex + 1}에 [#${loaded.order.orderNumber}] 적재 완료! (${loaded.order.customer.name} ${loaded.order.unitNumber})`,
          3600
        );
      }
      return;
    }

    // Slot is occupied -> unload if hands are free
    if (carrying) {
      hud.showToast(
        `🚫 이미 [#${carrying.order.orderNumber}] 음식을 들고 있습니다! 빈 슬롯에 먼저 적재하세요`,
        3000
      );
      return;
    }

    const unloaded = delivery.unloadFoodFromCargoSlot(slotIndex);
    if (unloaded) {
      scooterMesh.triggerCargoBoxOpen();
      audio.playCargoBoxSound();
      modalUi.closeAll();
      hud.showToast(
        `🛍️ 슬롯 ${slotIndex + 1}에서 [#${unloaded.order.orderNumber}] 꺼냄 → ${unloaded.order.customer.name} ${unloaded.order.unitNumber} (PIN ${unloaded.order.doorPin})`,
        3800
      );
    }
  };

  const env: InteractEnv = {
    ctx,
    state,
    bikeGarage,
    isPlayerNearCargoBox,
    playerHasPhonePhysically,
    enterElevatorToCorridor,
    exitCorridorToStreet,
    finalizeCorridorSettlement,
    handleTakeDeliveryPhoto,
  };

  /** The context [E] key: service stations, then (with deliveries) the corridor or the outdoor spots */
  const handleContextInteract = () => {
    if (interactServiceStations(env)) return;
    if (delivery.activeMissions.length === 0) {
      hud.showToast('진행 중인 배달이 없습니다 ([Tab] → [V]로 최대 3건 콜 수락)');
      return;
    }
    if (playerCtrl.state.inCorridor) interactInCorridor(env);
    else interactOutdoors(env);
  };

  const tryAcceptIncomingOffer = (fromDirect3DTouch = false): boolean => {
    if (!dispatch.activeOffer) return false;
    // Touch-only smartphone interaction: accept ONLY via zoomed screen click OR direct 3D phone screen UV touch!
    if (!hud.phoneMap.isZoomed && !fromDirect3DTouch) return false;

    const accepted = dispatch.acceptCurrentOffer(delivery);
    if (!accepted) return false;

    audio.playChime('accept');
    if (accepted.type === 'SINGLE') {
      const o = accepted.orders[0];
      hud.showToast(
        `🚀 한집배달 수락! ${o.shop.emoji} ${o.shop.name} [#${o.orderNumber}] · ₩${accepted.totalFee.toLocaleString()} (제한 300초)`,
        4200
      );
    } else {
      const codes = accepted.orders.map((o) => `#${o.orderNumber}`).join(', ');
      hud.showToast(
        `🛵 알뜰배달 2건 수락! [${codes}] · ₩${accepted.totalFee.toLocaleString()} (탑박스 2슬롯 분할 · 500초)`,
        4400
      );
    }
    return true;
  };

  const handleRejectIncomingOffer = () => {
    const rejected = dispatch.rejectCurrentOffer();
    if (rejected) {
      audio.playDispatchExpiredSound();
      hud.showToast('신규 콜을 거절했습니다 (10초 쿨다운 후 새 콜 배정)', 3000);
    }
  };

  const handleTogglePhone = () => {
    if (playerCtrl.state.mode === 'knockdown' || modalUi.activeModal !== 'none') return;

    const isRiding = playerCtrl.state.mode === 'riding';
    const nearScooter = !playerCtrl.state.inCorridor && playerCtrl.state.canMountScooter;
    const res = hud.togglePhonePlacement(isRiding, nearScooter);

    if (res.anim === 'mount') {
      handheldPhone3D.startMountAnimation();
    } else if (res.anim === 'unmount') {
      scooterMesh.setPhoneMounted(false);
      handheldPhone3D.startUnmountAnimation();
    }
    hud.showToast(res.message, 2600);
  };

  const handleTogglePhoneZoom = () => {
    if (playerCtrl.state.mode === 'knockdown' || modalUi.activeModal !== 'none') return;

    const res = hud.togglePhoneZoom(playerCtrl.state.mode === 'riding');
    hud.showToast(res.message, 2400);
  };

  const handleCycleWeather = () => {
    const order = ['clear', 'cloudy', 'rain', 'snow'] as const;
    setWeatherMode(ctx, order[(order.indexOf(weather.mode) + 1) % order.length], 'manual');
  };


  const handleSettlementClose = () => {
    if (state.pendingMissionBonusPopup) {
      const info = state.pendingMissionBonusPopup;
      state.pendingMissionBonusPopup = null;
      audio.playMissionBonusFanfare();
      window.setTimeout(() => audio.playGoalSparkle(), 420);
      modalUi.showMissionBonusPopup(info.title, info.bonus, info.totalWallet);
      hud.showToast(`🏆 오늘의 목표 달성! ${info.title} +₩${info.bonus.toLocaleString()} 보너스 지급!`, 4600);
      return;
    }
    hud.showToast(
      corridorRoom.isVillaMode
        ? '배달 완료! 원룸·빌라 계단을 내려와 1층 현관 출구 앞에서 [E]로 나가세요'
        : '배달 완료! 복도 엘리베이터로 돌아가 [E] 호출 후 탑승해 1층으로 내려가세요',
      3800
    );
  };

  return {
    state,
    isPlayerNearCargoBox,
    playerHasPhonePhysically,
    enterElevatorToCorridor,
    exitCorridorToStreet,
    finalizeCorridorSettlement,
    handleTakeDeliveryPhoto,
    handleCargoSlotAction,
    handleContextInteract,
    tryAcceptIncomingOffer,
    handleRejectIncomingOffer,
    handleTogglePhone,
    handleTogglePhoneZoom,
    handleCycleWeather,
    handleSettlementClose,
  };
}

export type DeliveryFlow = ReturnType<typeof createDeliveryFlow>;
