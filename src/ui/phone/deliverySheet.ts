import { PlayerState } from '../../player/PlayerController';
import { DeliveryManager, MAX_CONCURRENT_ORDERS, NavigationPlan } from '../../delivery/DeliveryManager';
import type { PhoneTab, PhoneTopNav } from './types';
import { renderAcceptedTab, renderCallsTab } from './sheetCallsTabs';
import { renderChecklistTab, renderRouteTab } from './sheetNavTabs';
import { renderDailyMissionWidget, renderFinanceTab, renderReviewsTab } from './sheetEarningsTabs';

/** Cheap change-detection key so the zoomed bottom sheet HTML is only rebuilt when content changes */
export function computeDeliverySheetFingerprint(
  activeTab: PhoneTab,
  player: PlayerState,
  delivery: DeliveryManager,
  navPlan: NavigationPlan
): string {
  const activeFp = delivery.activeMissions
    .map(
      (m) =>
        `${m.order.id}:${m.phase}:${m.cargoSlot}:${Math.round(m.foodIntegrity)}:${Math.round(m.foodTemp)}:${m.order.unitNumber}:${m.order.deliveryInstruction}:${m.chatNote ?? ''}:${Math.ceil(m.cookingRemainingSec)}:${activeTab === 'accepted' ? Math.ceil(m.remainingTimeSec) : 0}`
    )
    .join(',');
  const availFp = delivery.availableOrders.map((o) => `${o.id}:${o.rainBonus}:${o.nightBonus}:${o.peakBonus ?? 0}`).join(',');
  const distFp = navPlan.guidance ? Math.round(navPlan.guidance.totalDistance / 5) : -1;
  const finFp = `${delivery.totalEarnings}:${delivery.fuelExpense}:${delivery.repairExpense}:${delivery.fineExpense}`;
  const revFp = `${delivery.getRecentReviews().length}:${delivery.getRegularShops().length}`;
  const fingerprint = `${activeTab}|${delivery.selectedMissionId ?? 'auto'}|r:${delivery.isWeatherRaining}|n:${delivery.isNightMode}|${activeFp}|${availFp}|c:${delivery.completedMissions.length}|d:${distFp}|f:${finFp}|rv:${revFp}|${player.inCorridor}`;
  return fingerprint;
}

/** Builds the sub-nav pills + active tab body HTML of the zoomed smartphone bottom sheet */
export function renderDeliverySheetHtml(
  topNav: PhoneTopNav,
  activeTab: PhoneTab,
  player: PlayerState,
  delivery: DeliveryManager,
  navPlan: NavigationPlan
): string {
  const activeCnt = delivery.activeMissions.length;
  const doneCnt = delivery.completedMissions.length;
  const stopsCnt = navPlan.recommendedStops.length;
  const revCnt = delivery.getRecentReviews().length;

  // Context sub-pills matching the Baemin Connect top 3-tab structure ([콜 목록] / [내비] / [수익])
  let subNavHtml = '';
  if (topNav === 'calls') {
    subNavHtml = `
      <div class="bc-sub-pills">
        <button class="bc-sub-btn ${activeTab === 'calls' ? 'active' : ''}" data-action="tab" data-tab="calls">
          🔔 신규 콜 (${delivery.availableOrders.length})
        </button>
        <button class="bc-sub-btn ${activeTab === 'accepted' ? 'active' : ''}" data-action="tab" data-tab="accepted">
          📋 수락 주문 (${activeCnt}/${MAX_CONCURRENT_ORDERS})
        </button>
      </div>
    `;
  } else if (topNav === 'nav') {
    subNavHtml = `
      <div class="bc-sub-pills">
        <button class="bc-sub-btn ${activeTab === 'route' ? 'active' : ''}" data-action="tab" data-tab="route">
          🧭 추천 동선 (${stopsCnt})
        </button>
        <button class="bc-sub-btn ${activeTab === 'checklist' ? 'active' : ''}" data-action="tab" data-tab="checklist">
          ☑ 완료 체크 (${doneCnt})
        </button>
      </div>
    `;
  } else if (topNav === 'earnings') {
    subNavHtml = `
      <div class="bc-sub-pills">
        <button class="bc-sub-btn ${activeTab === 'finance' ? 'active' : ''}" data-action="tab" data-tab="finance">
          🧾 수익 정산
        </button>
        <button class="bc-sub-btn ${activeTab === 'reviews' ? 'active' : ''}" data-action="tab" data-tab="reviews">
          ⭐ 고객 리뷰 (${revCnt})
        </button>
      </div>
    `;
  }

  let bodyHtml = '';
  if (activeTab === 'calls') {
    bodyHtml = renderDailyMissionWidget(delivery) + renderCallsTab(player, delivery);
  } else if (activeTab === 'accepted') {
    bodyHtml = renderAcceptedTab(player, delivery, navPlan);
  } else if (activeTab === 'checklist') {
    bodyHtml = renderChecklistTab(delivery);
  } else if (activeTab === 'route') {
    bodyHtml = renderRouteTab(delivery, navPlan);
  } else if (activeTab === 'reviews') {
    bodyHtml = renderReviewsTab(delivery);
  } else {
    bodyHtml = renderFinanceTab(delivery);
  }

  return subNavHtml + bodyHtml;
}
