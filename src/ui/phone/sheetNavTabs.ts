import { DeliveryManager, NavigationPlan } from '../../delivery/DeliveryManager';

/** [내비] top-nav tabs: 완료 체크 & 추천 동선 */
export function renderChecklistTab(delivery: DeliveryManager): string {
  const activePicked = delivery.activeMissions.filter((m) => m.pickedUp).length;
  const totalPicked = activePicked + delivery.completedMissions.length;
  const totalDelivered = delivery.completedCount;

  const activeCards = delivery.activeMissions
    .map((m) => {
      const picked = m.pickedUp;
      const inBox = m.cargoSlot !== null;
      const delivered = m.phase === 'corridor_exit';
      return `
        <div class="check-card">
          <div class="order-top">
            <span>${m.order.shop.emoji} ${m.order.shop.name} <span class="ord-tag">#${m.order.orderNumber}</span></span>
            <span class="order-dest">${m.order.customer.name} ${m.order.unitNumber}</span>
          </div>
          <div class="check-steps">
            <span class="chk-chip ${picked ? 'checked' : ''}">${picked ? '☑' : '☐'} 픽업 완료</span>
            <span class="chk-chip ${inBox ? 'checked' : ''}">${inBox ? `☑ 슬롯 ${m.cargoSlot! + 1}` : picked ? '☐ 배달통/휴대' : '☐ 적재 대기'}</span>
            <span class="chk-chip ${delivered ? 'checked' : ''}">${delivered ? '☑' : '☐'} 배달 완료</span>
          </div>
        </div>
      `;
    })
    .join('');

  const doneCards = delivery.completedMissions
    .slice(0, 5)
    .map(
      (c) => `
        <div class="check-card done">
          <div class="order-top">
            <span>✅ ${c.order.shop.name} <span class="ord-tag">#${c.order.orderNumber}</span></span>
            <span class="order-fee">+₩${c.earned.toLocaleString()}</span>
          </div>
          <div class="check-steps">
            <span class="chk-chip checked">☑ 픽업 완료</span>
            <span class="chk-chip checked">☑ 배달 완료 (${c.order.customer.name} ${c.order.unitNumber})</span>
          </div>
        </div>
      `
    )
    .join('');

  return `
    <div class="check-summary">
      <span>☑ 픽업 완료 ${totalPicked}건</span>
      <span>🏁 배달 완료 ${totalDelivered}건</span>
    </div>
    <div class="order-list">
      ${activeCards}
      ${doneCards}
      ${
        !activeCards && !doneCards
          ? '<div class="empty-tab-msg">아직 진행 중이거나 완료된 배달 내역이 없습니다.</div>'
          : ''
      }
    </div>
  `;
}

export function renderRouteTab(delivery: DeliveryManager, navPlan: NavigationPlan): string {
  if (navPlan.recommendedStops.length === 0) {
    return `
      <div class="empty-tab-msg">
        추천 동선이 없습니다.<br/>[콜 대기]에서 주문을 수락하면 A* 최적 묶음 동선을 계산합니다.
      </div>
    `;
  }

  const isAuto = delivery.selectedMissionId === null;
  const stopCards = navPlan.recommendedStops
    .map(
      (st, idx) => `
      <button class="route-stop-card ${st.isCurrent ? 'current' : ''}" data-action="focus" data-id="${st.missionId}">
        <span class="route-step-num ${st.kind}">${idx + 1}</span>
        <div class="route-stop-info">
          <div class="route-stop-title">${st.emoji} ${st.label}</div>
          <div class="route-stop-sub">${st.sublabel}</div>
        </div>
        <span class="route-stop-dist">${idx === 0 ? `${st.legDistance}m` : `+${st.legDistance}m`}</span>
      </button>
    `
    )
    .join('');

  return `
    <div class="route-summary-bar">
      <span>🧭 최적 동선 · 총 ${navPlan.totalBundleDistance}m (${navPlan.recommendedStops.length}곳)</span>
      <button class="route-auto-btn ${isAuto ? '' : 'inactive'}" data-action="auto_route">
        ${isAuto ? '자동 추천 ON' : '자동 추천 복귀'}
      </button>
    </div>
    <div class="order-list">${stopCards}</div>
  `;
}
