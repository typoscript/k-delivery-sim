/** Smartphone actions: accept / reject calls, route focus, daily report, clock-out, screen taps */
import type { PhoneCallbacks } from '../../ui/phone/types';
import { MAX_CONCURRENT_ORDERS } from '../../delivery/DeliveryManager';
import { applyGameClock } from '../clockSync';
import type { AppRefs } from './appRefs';

export function phoneCallbacks(r: AppRefs): PhoneCallbacks {
  return {
    onAcceptOrder: (orderId) => {
      r.audio.ensureStarted();
      const order = r.delivery.acceptOrder(orderId);
      if (order) {
        r.audio.playChime('accept');
        const rainNote = order.rainBonus > 0 ? ` · 🌧️ 우천할증 +₩${order.rainBonus.toLocaleString()}` : '';
        r.hud.showToast(
          `${order.shop.emoji} ${order.shop.name} [#${order.orderNumber}] 수락! (${r.delivery.activeMissions.length}/${MAX_CONCURRENT_ORDERS}건${rainNote})`,
          3400,
        );
      } else if (!r.delivery.canAcceptMoreOrders()) {
        r.hud.showToast(`최대 ${MAX_CONCURRENT_ORDERS}건까지 동시 묶음 배달이 가능합니다!`, 2600);
      }
    },
    onAcceptDispatchOffer: () => {
      r.audio.ensureStarted();
      r.flow.tryAcceptIncomingOffer();
    },
    onRejectDispatchOffer: () => r.flow.handleRejectIncomingOffer(),
    onRefreshOrders: () => {
      r.delivery.refreshAvailableOrders();
      r.hud.showToast(
        r.delivery.isWeatherRaining
          ? '🌧️ 우천 할증(+₩1,500) 신규 배달 콜을 새로고침했습니다'
          : '신규 배달 콜을 새로고침했습니다',
      );
    },
    onCancelMission: (orderId) => {
      const removed = r.delivery.cancelMission(orderId);
      if (removed) {
        r.world.setLobbyDoorOpen(null);
        r.hud.showToast(`[#${removed.order.orderNumber}] 배달 주문을 취소했습니다`);
      }
    },
    onSelectMission: (missionId) => {
      r.delivery.setSelectedMission(missionId);
      if (missionId === null) {
        r.hud.showToast('🧭 자동 최적 추천 동선 안내로 전환했습니다', 2400);
      } else {
        const m = r.delivery.getMissionById(missionId);
        if (m) {
          r.hud.showToast(`🧭 [#${m.order.orderNumber}] 경로를 우선 안내합니다`, 2400);
        }
      }
    },
    onOpenDailyReport: () => {
      r.hud.phoneMap.setZoomed(false);
      r.modalUi.openDailyReportModal(r.delivery.getDailyLedger());
    },
    onClockOut: () => {
      const res = r.delivery.clockOut();
      if (!res) {
        r.hud.showToast('📦 배달 중인 주문을 모두 마친 뒤 퇴근할 수 있어요', 3200);
        return;
      }
      // Next working day starts at the shift start time (just before the lunch rush)
      r.gameCtx.clock.jumpTo(r.delivery.shiftClockMinute);
      applyGameClock(r.gameCtx, false);
      r.hud.phoneMap.setZoomed(false);
      r.audio.playShiftEndCadence();
      r.modalUi.openDailyReportModal(res.ledger, res);
      const bonus = res.awardedAtClockOut.reduce((a, g) => a + g.bonus, 0);
      const weekly = res.recap.weeklyBonus;
      r.hud.showToast(
        `🏁 ${res.day}일차 퇴근 완료${bonus > 0 ? ` · 🎯 목표 보너스 +₩${bonus.toLocaleString()}` : ''}${
          weekly > 0 ? ` · 📅 주간 보너스 +₩${weekly.toLocaleString()}` : ''
        } · ${res.nextDay}일차 ${r.gameCtx.clock.label} 출근!`,
        5200,
      );
      r.voiceNav.speak(`${res.day}일차 근무를 마쳤습니다. 수고하셨습니다.`);
      res.recap.newAtClockOut.forEach((a, i) =>
        window.setTimeout(
          () => r.hud.showToast(`🏆 업적 달성! ${a.icon} ${a.title} · ${a.desc}`, 4600),
          5600 + i * 4800,
        ),
      );
    },
    onInteractMission: () => r.flow.handleContextInteract(),
    onTogglePhone: () => r.flow.handleTogglePhone(),
    onToggleZoom: () => r.flow.handleTogglePhoneZoom(),
    onScreenTap: () => {
      r.audio.ensureStarted();
      r.audio.playPhoneScreenTap();
    },
  };
}
