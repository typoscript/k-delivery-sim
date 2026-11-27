import { DeliveryManager } from '../../delivery/DeliveryManager';
import { bestDay, safeDayStreak } from '../../delivery/careerHistory';
import { PHONE_RECEIPT_GROUPS, compactLines, ledgerExpenseLines, ledgerIncomeLines, lineValue } from '../receiptLines';

/** [수익] top-nav tabs (일일 미션 위젯 · 수익 정산 명세서 · 고객 리뷰) */
export function renderDailyMissionWidget(delivery: DeliveryManager): string {
  const goals = delivery.getShiftGoals();
  const done = goals.filter((g) => g.claimed).length;
  const rows = goals
    .map((g) => {
      const reward = g.claimed
        ? '✓ 지급완료'
        : g.awardAt === 'clock_out'
          ? `퇴근 시 +₩${g.bonus.toLocaleString()}`
          : `+₩${g.bonus.toLocaleString()}`;
      const sub =
        g.id === 'safe'
          ? delivery.pedestrianAccidentCount > 0
            ? '오늘 보행자 사고가 있어 무사고 보너스는 지급되지 않아요'
            : g.met
              ? '지금 퇴근하면 무사고 보너스가 지급돼요'
              : `${g.target - g.current}건 더 배달하고 사고 없이 퇴근하기`
          : g.claimed
            ? '보너스 지갑 반영 완료'
            : `앞으로 ${g.target - g.current}건`;
      return `
      <div class="bc-mission-card ${g.claimed ? 'done' : ''}">
        <div class="bc-mission-top">
          <span>${g.icon} ${g.title} (${g.current}/${g.target})</span>
          <span class="bc-mission-reward">${reward}</span>
        </div>
        <div class="bc-mission-track">
          <div class="bc-mission-fill" style="width:${g.progressPct}%"></div>
        </div>
        <div class="bc-mission-sub"><span>${sub}</span><span>${g.progressPct}%</span></div>
      </div>`;
    })
    .join('');
  return `
    <div class="bc-goals-title">📅 ${delivery.shiftDay}일차 오늘의 목표 (${done}/${goals.length})</div>
    ${rows}
  `;
}

export function renderFinanceTab(delivery: DeliveryManager): string {
  const l = delivery.getDailyLedger();
  const fmt = (n: number) => `₩${Math.abs(n).toLocaleString()}`;
  const walletSign = l.walletBalance < 0 ? '-' : '';
  const dateStr = `${l.shiftDay}일차 · ${l.completedCount}건`;

  return `
    ${renderDailyMissionWidget(delivery)}
    <div class="bc-receipt">
      <div class="bc-receipt-hdr">
        <span class="bc-receipt-brand">🧾 배민커넥트 일일 정산 명세서</span>
        <span class="bc-receipt-date">${dateStr} · ★ ${l.riderRating.toFixed(1)}</span>
      </div>
      ${compactLines(ledgerIncomeLines(l), PHONE_RECEIPT_GROUPS)
        .map((r) => `<div class="bc-rcpt-row inc"><span>${r.label}</span><span>${lineValue(r)}</span></div>`)
        .join('')}
      <div class="bc-rcpt-divider"></div>
      ${compactLines(ledgerExpenseLines(l), PHONE_RECEIPT_GROUPS)
        .map((r) => `<div class="bc-rcpt-row ded"><span>${r.label}</span><span>${lineValue(r)}</span></div>`)
        .join('')}
      <div class="bc-rcpt-total">
        <span>누적 지갑 잔고 (${l.riderTier.icon} ${l.lifetimeCompleted}건)</span>
        <span class="bc-rcpt-net ${l.walletBalance < 0 ? 'neg' : ''}">${walletSign}${fmt(l.walletBalance)}</span>
      </div>
    </div>
    <button class="fin-open-btn" data-action="open_report">📊 전체 화면 정산 명세서 크게 보기</button>
    <button class="fin-open-btn clock-out" data-action="clock_out">🏁 퇴근하기 · ${l.shiftDay}일차 마감 후 다음 날 출근</button>
  `;
}

export function renderReviewsTab(delivery: DeliveryManager): string {
  const reviews = delivery.getRecentReviews();
  const avg = delivery.getAverageReviewStars();
  const rep = delivery.getReputation();
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
    <div class="reputation-strip ${rep.tier}">${rep.icon} <b>${rep.label}</b> · ${rep.description}</div>
    <div class="regular-shops-strip">
      <div class="reg-strip-title">⭐ 나의 단골 매장 우대 <span class="reg-perk-note">조리 대기 단축 · 즉시 수령</span></div>
      <div class="reg-strip-chips">${regularChipsHtml}</div>
    </div>
    <div class="order-list">${reviewCardsHtml}</div>
  `;
}

/** [수익] → 🏆 커리어: day-by-day history (last 7 days chart + list) and achievements */
export function renderCareerTab(delivery: DeliveryManager): string {
  const history = delivery.getDayHistory();
  const achievements = delivery.getAchievements();
  const unlockedCnt = achievements.filter((a) => a.unlocked).length;
  const best = bestDay(history);
  const streak = safeDayStreak(history);
  const won = (n: number) => `${n < 0 ? '-' : ''}₩${Math.abs(n).toLocaleString()}`;

  const last7 = history.slice(-7);
  const maxAbs = Math.max(1, ...last7.map((d) => Math.abs(d.net)));
  const chartHtml =
    last7.length > 0
      ? `<div class="career-chart">${last7
          .map((d) => {
            const h = Math.max(4, Math.round((Math.abs(d.net) / maxAbs) * 100));
            return `<div class="career-bar-col" title="${d.day}일차 ${won(d.net)}">
              <div class="career-bar ${d.net < 0 ? 'neg' : ''}" style="height:${h}%"></div>
              <span>${d.day}</span>
            </div>`;
          })
          .join('')}</div>`
      : '<div class="empty-tab-msg">아직 마친 근무일이 없어요.<br/>[수익 정산]에서 🏁 퇴근하면 하루 기록이 쌓입니다.</div>';

  const rowsHtml = [...history]
    .reverse()
    .slice(0, 10)
    .map(
      (d) => `<div class="career-day-row">
        <span class="cd-day">${d.day}일차</span>
        <span>📦 ${d.deliveries}건</span>
        <span>${d.avgStars !== null ? `★ ${d.avgStars.toFixed(1)}` : '★ -'}</span>
        <span>🎯 ${d.goalsMet}/${d.goalsTotal}</span>
        <span class="cd-net ${d.net < 0 ? 'neg' : ''}">${won(d.net)}</span>
      </div>`
    )
    .join('');

  const achHtml = achievements
    .map(
      (a) => `<div class="career-ach ${a.unlocked ? 'on' : ''}" title="${a.desc}">
        <div class="ca-icon">${a.icon}</div>
        <div class="ca-title">${a.title}</div>
        <div class="ca-sub">${a.unlocked ? (a.unlockedDay ? `${a.unlockedDay}일차 달성` : '달성') : a.target >= 1000 ? `${Math.round((a.current / a.target) * 100)}%` : `${a.current}/${a.target}`}</div>
      </div>`
    )
    .join('');

  return `
    <div class="career-summary">
      <div><b>${history.length}</b><span>근무일</span></div>
      <div><b>${delivery.lifetimeCompleted}</b><span>누적 배달</span></div>
      <div><b>${best ? won(best.net) : '-'}</b><span>최고 하루${best ? ` (${best.day}일차)` : ''}</span></div>
      <div><b>${streak}일</b><span>무사고 연속</span></div>
    </div>
    <div class="career-section-title">📈 최근 7일 순수익</div>
    ${chartHtml}
    ${rowsHtml ? `<div class="career-day-list">${rowsHtml}</div>` : ''}
    <div class="career-section-title">🏆 업적 (${unlockedCnt}/${achievements.length})</div>
    <div class="career-ach-grid">${achHtml}</div>
  `;
}
