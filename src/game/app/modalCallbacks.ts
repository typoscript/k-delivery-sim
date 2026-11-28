/** Modal results: POS / PIN success, cargo slots, fuel, repair & garage purchases, convenience store */
import type { ModalCallbacks } from '../../ui/ModalUi';
import { SCOOTER_MODELS, SCOOTER_PAINTS, saveBikeGarage } from '../../vehicle/ScooterModels';
import { RIDER_UPGRADES } from '../../delivery/RiderCareer';
import type { AppRefs } from './appRefs';

export function modalCallbacks(r: AppRefs): ModalCallbacks {
  return {
    onPosSuccess: (missionId) => {
      const res = r.delivery.completePosPickup(missionId);
      if (!res) return;
      const regularUnlockSuffix = res.justBecameRegular
        ? ` · 🎉 ${res.mission.order.shop.name} 단골 매장 등극! (다음 픽업부터 우선 조리 우대)`
        : '';
      if (res.status === 'cooking') {
        r.audio.playKeypadBeep(true);
        if (res.isRegularPerk && res.savedWaitSec > 0) {
          r.hud.showToast(
            `⭐ 단골 매장 우대! ${res.mission.order.shop.name} 사장님이 먼저 챙겨주셨어요 (대기 -${res.savedWaitSec}초 → ${res.waitSec}초 남음)`,
            4400,
          );
        } else {
          r.hud.showToast(
            `🍳 ${res.mission.order.shop.name} [#${res.mission.order.orderNumber}] 조리 중 (남은 시간: ${res.waitSec}초) — 대기 중 탑승·휴대폰 조작 가능!${regularUnlockSuffix}`,
            4400,
          );
        }
      } else {
        r.audio.playChime('pickup');
        if (res.isRegularPerk && res.savedWaitSec > 0) {
          r.hud.showToast(
            `⭐ 단골 매장 즉시 픽업! 사장님이 먼저 준비해 두셨어요 (-${res.savedWaitSec}초 단축) · 배달통 [E] 적재하세요`,
            4200,
          );
        } else if (res.isRegularPerk) {
          r.hud.showToast(
            `⭐ 단골 매장 [#${res.mission.order.orderNumber}] 픽업 완료! 오토바이 뒤편 배달통 [E]로 슬롯에 적재하세요`,
            3800,
          );
        } else {
          r.hud.showToast(
            `🛍️ [#${res.mission.order.orderNumber}] 픽업 완료! 오토바이 뒤편 배달통 [E]로 슬롯에 적재하세요${regularUnlockSuffix}`,
            4200,
          );
        }
      }
    },
    onPinSuccess: (missionId) => {
      const unlocked = r.delivery.unlockLobbyDoor(missionId);
      if (unlocked) {
        r.audio.playChime('accept');
        r.world.setLobbyDoorOpen(unlocked.order.customer.id);
        const isVilla = unlocked.order.customer.residenceKind === 'walkup_villa';
        r.hud.showToast(
          isVilla
            ? `🔓 ${unlocked.order.customer.name} 공동현관 개방! (원룸·빌라 계단) [E]로 진입해 계단을 올라가세요`
            : `🔓 ${unlocked.order.customer.name} 공동현관 개방! [E]를 눌러 1층 엘리베이터에 탑승하세요`,
          3600,
        );
      }
    },
    onCargoSlotAction: (slot: number) => r.flow.handleCargoSlotAction(slot),
    onFuelTick: () => r.audio.playFuelPumpTick(),
    onFuelComplete: (addedPercent, cost) => {
      r.scooterPhysics.addFuel(addedPercent);
      r.delivery.recordFuelExpense(cost);
      r.audio.playPaymentCompleteSound();
      r.hud.showToast(`💳 결제가 완료되었습니다! 주유 완료 (+${addedPercent}% · -₩${cost.toLocaleString()})`, 3800);
    },
    onRepairConfirm: (cost) => {
      if (r.rejectIfInsufficientFunds(cost)) return;
      r.scooterPhysics.repairVehicle();
      r.delivery.recordRepairExpense(cost);
      r.audio.playRepairSound();
      window.setTimeout(() => r.audio.playPaymentCompleteSound(), 420);
      r.hud.showToast(`🔧 정비 완료! 사이드미러·가속력 100% 복구 (수리비 -₩${cost.toLocaleString()})`, 3800);
    },
    onSelectBikeModel: (modelId, cost) => {
      if (r.bikeGarage.modelId === modelId) return;
      if (cost > 0 && r.rejectIfInsufficientFunds(cost)) return;
      if (cost > 0) {
        r.delivery.recordRepairExpense(cost);
      }
      if (!r.bikeGarage.ownedModels.includes(modelId)) {
        r.bikeGarage.ownedModels.push(modelId);
      }
      r.bikeGarage.modelId = modelId;
      saveBikeGarage(r.bikeGarage);
      r.scooterPhysics.setBikeCustomization(r.bikeGarage.modelId, r.bikeGarage.paintId);
      r.scooterMesh.applyCustomization(r.bikeGarage.modelId, r.bikeGarage.paintId);
      r.audio.playRepairSound();
      r.modalUi.renderRepairGarageContent(
        r.scooterPhysics.state.damageLevel,
        r.scooterPhysics.state.crashCount,
        r.bikeGarage,
        r.delivery.career,
      );
      const spec = SCOOTER_MODELS[modelId];
      r.hud.showToast(
        `${spec.icon} ${spec.name} 기종으로 변경했습니다!${cost > 0 ? ` (-₩${cost.toLocaleString()})` : ' (보유 기종 무료 교체)'}`,
        3600,
      );
    },
    onSelectBikePaint: (paintId, cost) => {
      if (r.bikeGarage.paintId === paintId) return;
      if (cost > 0 && r.rejectIfInsufficientFunds(cost)) return;
      if (cost > 0) {
        r.delivery.recordRepairExpense(cost);
      }
      if (!r.bikeGarage.ownedPaints.includes(paintId)) {
        r.bikeGarage.ownedPaints.push(paintId);
      }
      r.bikeGarage.paintId = paintId;
      saveBikeGarage(r.bikeGarage);
      r.scooterPhysics.setBikeCustomization(r.bikeGarage.modelId, r.bikeGarage.paintId);
      r.scooterMesh.applyCustomization(r.bikeGarage.modelId, r.bikeGarage.paintId);
      r.audio.playKeypadBeep(true);
      r.modalUi.renderRepairGarageContent(
        r.scooterPhysics.state.damageLevel,
        r.scooterPhysics.state.crashCount,
        r.bikeGarage,
        r.delivery.career,
      );
      const paint = SCOOTER_PAINTS[paintId];
      r.hud.showToast(
        `🎨 커스텀 도색 [${paint.name}] 적용 완료!${cost > 0 ? ` (-₩${cost.toLocaleString()})` : ''}`,
        2800,
      );
    },
    onBuyUpgrade: (upgradeId, cost) => {
      const spec = RIDER_UPGRADES[upgradeId];
      if (r.delivery.hasUpgrade(upgradeId)) {
        r.hud.showToast(`${spec.icon} ${spec.name} 장비는 이미 장착되어 있습니다!`, 2400);
        return;
      }
      if (r.rejectIfInsufficientFunds(cost)) return;
      if (r.delivery.buyUpgrade(upgradeId, cost)) {
        r.syncScooterUpgrades();
        r.audio.playRepairSound();
        window.setTimeout(() => r.audio.playPaymentCompleteSound(), 320);
        r.modalUi.renderRepairGarageContent(
          r.scooterPhysics.state.damageLevel,
          r.scooterPhysics.state.crashCount,
          r.bikeGarage,
          r.delivery.career,
        );
        r.hud.showToast(`⚙️ ${spec.icon} ${spec.name} 장착 완료! (${spec.statBadge} · 영구 저장됨)`, 4000);
      }
    },
    onConvenienceBuy: (item, cost) => {
      if (r.rejectIfInsufficientFunds(cost)) return;
      r.delivery.recordConvenienceExpense(cost);
      r.audio.playConvenienceChime();
      if (item === 'energy_drink') {
        r.playerCtrl.applyConvenienceDrink('energy_drink');
        r.hud.showToast(
          `⚡ 에너지드링크 구매 (-₩${cost.toLocaleString()})! 체력 100% + 60초 도보·계단 부스트 ON`,
          3800,
        );
      } else if (item === 'ion_drink') {
        r.playerCtrl.applyConvenienceDrink('ion_drink');
        r.hud.showToast(`❄️ 얼음 이온음료 구매 (-₩${cost.toLocaleString()})! 체력 +40% + 3분간 폭염 더위 무시`, 3800);
      } else if (item === 'iced_coffee') {
        r.playerCtrl.applyConvenienceDrink('iced_coffee');
        r.hud.showToast(`☕ 아이스 아메리카노 구매 (-₩${cost.toLocaleString()})! 체력 +60% + 45초 회복 2배`, 3800);
      } else {
        r.hud.phoneMap.rechargeBatteryFull();
        r.audio.playWirelessChargeStart();
        r.hud.showToast(`🔋 급속 보조배터리 충전 완료 (-₩${cost.toLocaleString()})! 스마트폰 배터리 100%`, 3800);
      }
    },
    onTakePhoto: () => r.flow.handleTakeDeliveryPhoto(),
    onSettlementClose: () => r.flow.handleSettlementClose(),
    onKeypadBeep: (ok) => r.audio.playKeypadBeep(ok),
  };
}
