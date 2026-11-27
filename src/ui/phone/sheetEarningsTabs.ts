import { DeliveryManager } from '../../delivery/DeliveryManager';

/** [수익] top-nav tabs (일일 미션 위젯 · 수익 정산 명세서 · 고객 리뷰) */
export function renderDailyMissionWidget(delivery: DeliveryManager): string {
  const ms = delivery.getDailyMissionStatus();
  return `
    <div class="bc-mission-card ${ms.completed ? 'done' : ''}">
      <div class="bc-mission-top">
        <span>🏆 ${ms.title} (현재 ${ms.current}/${ms.target})</span>
        <span class="bc-mission-reward">${ms.completed ? '✓ 지급완료' : `+₩${ms.bonus.toLocaleString()}`}</span>
      </div>
      <div class="bc-mission-track">
        <div class="bc-mission-fill" style="width:${ms.progressPct}%"></div>
      </div>
      <div class="bc-mission-sub">
        <span>${ms.completed ? '🎉 일일 보너스 +₩5,000 지갑 반영 완료!' : `앞으로 ${ms.target - ms.current}건 더 완료 시 보너스 지급`}</span>
        <span>${ms.progressPct}%</span>
      </div>
    </div>
  `;
}

export function renderFinanceTab(delivery: DeliveryManager): string {
  const l = delivery.getDailyLedger();
  const fmt = (n: number) => `₩${Math.abs(n).toLocaleString()}`;
  const walletSign = l.walletBalance < 0 ? '-' : '';
  const today = new Date();
  const dateStr = `${today.getMonth() + 1}월 ${today.getDate()}일 · ${l.completedCount}건`;

  return `
    ${renderDailyMissionWidget(delivery)}
    <div class="bc-receipt">
      <div class="bc-receipt-hdr">
        <span class="bc-receipt-brand">🧾 배민커넥트 일일 정산 명세서</span>
        <span class="bc-receipt-date">${dateStr} · ★ ${l.riderRating.toFixed(1)}</span>
      </div>
      <div class="bc-rcpt-row inc"><span>기본 배달료 합계</span><span>+${fmt(l.baseFeeTotal)}</span></div>
      <div class="bc-rcpt-row inc"><span>거리 할증 합계</span><span>+${fmt(l.distanceBonusTotal)}</span></div>
      <div class="bc-rcpt-row inc"><span>🌧️ 우천/기상 할증</span><span>+${fmt(l.rainBonusTotal)}</span></div>
      <div class="bc-rcpt-row inc"><span>🌙 심야 할증</span><span>+${fmt(l.nightBonusTotal)}</span></div>
      <div class="bc-rcpt-row inc"><span>${l.riderTier.icon} ${l.riderTier.name} 보너스</span><span>+${fmt(l.tierBonusTotal)}</span></div>
      <div class="bc-rcpt-row inc"><span>안전 배달 팁 / 미션 보너스</span><span>+${fmt(l.tipTotal + l.missionBonusTotal)}</span></div>
      <div class="bc-rcpt-divider"></div>
      <div class="bc-rcpt-row ded"><span>🚨 신호위반/인도사고 과태료 차감</span><span>-${fmt(l.fineExpense)}</span></div>
      <div class="bc-rcpt-row ded"><span>📦 음식 파손 페널티 차감</span><span>-${fmt(l.damageDeductionTotal)}</span></div>
      <div class="bc-rcpt-row ded"><span>⛽ 유류 · 🔧 정비 · ⚙️ 업그레이드</span><span>-${fmt(l.fuelExpense + l.repairExpense + l.upgradeExpense + l.convenienceExpense)}</span></div>
      <div class="bc-rcpt-total">
        <span>누적 지갑 잔고 (${l.riderTier.icon} ${l.lifetimeCompleted}건)</span>
        <span class="bc-rcpt-net ${l.walletBalance < 0 ? 'neg' : ''}">${walletSign}${fmt(l.walletBalance)}</span>
      </div>
    </div>
    <button class="fin-open-btn" data-action="open_report">📊 전체 화면 정산 명세서 크게 보기</button>
  `;
}

export function renderReviewsTab(delivery: DeliveryManager): string {
  const reviews = delivery.getRecentReviews();
  const avg = delivery.getAverageReviewStars();
  const regularShops = delivery.getRegularShops();

  const regularChipsHtml =
    regularShops.length > 0
      ? regularShops
          .slice(0, 6)
          .map(
            (rs) =>
              `<span class="regular-shop-chip">${rs.name} <b>${rs.count}회</b></span>`
          )
          .join('')
      : '<span class="regular-shop-empty">같은 매장 2회 이상 픽업 시 ⭐ 단골 매장 등극 (조리 대기 대폭 단축·우선 수령!)</span>';

  const reviewCardsHtml =
    reviews.length > 0
      ? reviews
          .map((r) => {
            const starStr = '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars);
            const tagsHtml = r.tags.map((t) => `<span class="review-tag">${t}</span>`).join('');
            return `
              <div class="review-card ${r.stars <= 2 ? 'low' : r.stars === 5 ? 'perfect' : ''}">
                <div class="review-top">
                  <span class="review-stars">${starStr} <b>${r.stars}.0</b></span>
                  <span class="review-meta">${r.customerName} ${r.unitNumber} · ${r.createdAt}</span>
                </div>
                <div class="review-shop">${r.shopEmoji} ${r.shopName} · ${r.menuName} <span class="ord-tag">#${r.orderNumber}</span></div>
                <div class="review-comment">"${r.comment}"</div>
                <div class="review-tags">${tagsHtml}</div>
              </div>
            `;
          })
          .join('')
      : '<div class="empty-tab-msg">아직 도착한 고객 리뷰가 없습니다.<br/>배달을 완료하면 음식 상태·온도·속도에 따라 생생한 한국형 고객 별점 리뷰가 쌓입니다!</div>';

  return `
    <div class="review-summary-card">
      <div class="rev-sum-left">
        <div class="rev-sum-label">평균 고객 별점</div>
        <div class="rev-sum-score">${avg !== null ? `★ ${avg.toFixed(1)}` : '★ -.-'} <span>/ 5.0</span></div>
      </div>
      <div class="rev-sum-right">
        <div class="rev-sum-stat">리뷰 <b>${reviews.length}건</b></div>
        <div class="rev-sum-stat">⭐ 단골 매장 <b>${regularShops.length}곳</b></div>
      </div>
    </div>
    <div class="regular-shops-strip">
      <div class="reg-strip-title">⭐ 나의 단골 매장 우대 <span class="reg-perk-note">조리 대기 단축 · 즉시 수령</span></div>
      <div class="reg-strip-chips">${regularChipsHtml}</div>
    </div>
    <div class="order-list">${reviewCardsHtml}</div>
  `;
}
