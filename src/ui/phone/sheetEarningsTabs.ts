import { DeliveryManager } from '../../delivery/DeliveryManager';
import { WeekSummary, bestDay, safeDayStreak } from '../../delivery/careerHistory';
import { seasonOfDay } from '../../game/seasons';
import { weeklyStatementHtml } from '../modals/modalViews';
import { weekGoalProgressPct, weekGoalProgressText } from '../../delivery/weeklyGoals';
import { PHONE_RECEIPT_GROUPS, compactLines, ledgerExpenseLines, ledgerIncomeLines, lineValue } from '../receiptLines';

/** 💳 뱅크 app tabs (일일 미션 위젯 · 수익 정산 명세서 · 고객 리뷰) */
export function renderDailyMissionWidget(delivery: DeliveryManager): string {
  const goals = delivery.getShiftGoals();
  const done = goals.filter((g) => g.claimed).length;
  const rows = goals
    .map((g) => {
      const reward = g.claimed
        ? '✓ 지급완료'
        : g.failed
          ? '✕ 오늘은 불가'
          : g.awardAt === 'clock_out'
          ? `퇴근 시 +₩${g.bonus.toLocaleString()}`
          : `+₩${g.bonus.toLocaleString()}`;
      const sub =
        g.id === 'clean'
          ? delivery.todayViolations > 0
            ? `오늘 교통 위반 ${delivery.todayViolations}회 · 무위반 보너스는 지급되지 않아요`
            : g.met
              ? '지금 퇴근하면 무위반 보너스가 지급돼요'
              : `${g.target - g.current}건 더 배달하고 신호·속도·인도 위반 없이 퇴근하기`
          : g.id === 'safe'
          ? delivery.pedestrianAccidentCount > 0
            ? '오늘 보행자 사고가 있어 무사고 보너스는 지급되지 않아요'
            : g.met
              ? '지금 퇴근하면 무사고 보너스가 지급돼요'
              : `${g.target - g.current}건 더 배달하고 사고 없이 퇴근하기`
          : g.claimed
            ? '보너스 지갑 반영 완료'
            : g.id === 'safe_stop'
              ? `빨간불·보행자 경고 뒤 멈추기 · 앞으로 ${g.target - g.current}회`
              : `앞으로 ${g.target - g.current}건`;
      return `
      <div class="bc-mission-card ${g.claimed ? 'done' : g.failed ? 'failed' : ''}">
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

/** "이번 주 목표": week goals counting today's work so far, paid at the week's last clock-out */
export function renderWeeklyGoalWidget(delivery: DeliveryManager): string {
  const w = delivery.getWeekSummary();
  const goals = delivery.getWeekGoalsLive();
  const left = w.lastDay - delivery.shiftDay;
  const met = goals.filter((g) => g.met);
  const pay = met.reduce((a, g) => a + g.bonus, 0);
  const rows = goals
    .map(
      (g) => `
      <div class="bc-mission-card week ${g.met ? 'done' : g.failed ? 'failed' : ''}">
        <div class="bc-mission-top">
          <span>${g.icon} ${g.title}</span>
          <span class="bc-mission-reward">${g.met ? '✓ 달성' : g.failed ? '✕ 이번 주는 불가' : `+₩${g.bonus.toLocaleString()}`}</span>
        </div>
        <div class="bc-mission-track">
          <div class="bc-mission-fill" style="width:${weekGoalProgressPct(g)}%"></div>
        </div>
        <div class="bc-mission-sub"><span>${weekGoalProgressText(g)}</span><span>${weekGoalProgressPct(g)}%</span></div>
      </div>`,
    )
    .join('');
  const when = left === 0 ? '오늘 퇴근 때 지급' : `${w.lastDay}일차 퇴근 때 지급 · ${left}일 남음`;
  return `
    <div class="bc-goals-title week">📆 ${w.week}주차 주간 목표 (${met.length}/${goals.length}) <span class="bc-goals-sub">${when}${
      pay > 0 ? ` · 지금 +₩${pay.toLocaleString()}` : ''
    }</span></div>
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
    ${renderWeeklyGoalWidget(delivery)}
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
          .map((rs) => `<span class="regular-shop-chip">${rs.name} <b>${rs.count}회</b></span>`)
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

/** 💳 뱅크 → 🏆 커리어: day-by-day history (last 7 days chart + list) and achievements */
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
      </div>`,
    )
    .join('');

  const achHtml = achievements
    .map(
      (a) => `<div class="career-ach ${a.unlocked ? 'on' : ''}" title="${a.desc}">
        <div class="ca-icon">${a.icon}</div>
        <div class="ca-title">${a.title}</div>
        <div class="ca-sub">${a.unlocked ? (a.unlockedDay ? `${a.unlockedDay}일차 달성` : '달성') : a.target >= 1000 ? `${Math.round((a.current / a.target) * 100)}%` : `${a.current}/${a.target}`}</div>
      </div>`,
    )
    .join('');

  return `
    <div class="career-summary">
      <div><b>${history.length}</b><span>근무일</span></div>
      <div><b>${delivery.lifetimeCompleted}</b><span>누적 배달</span></div>
      <div><b>${best ? won(best.net) : '-'}</b><span>최고 하루${best ? ` (${best.day}일차)` : ''}</span></div>
      <div><b>${streak}일</b><span>무사고 연속</span></div>
    </div>
    ${weekCardHtml(delivery)}
    ${pastWeeksHtml(delivery.getPastWeeks())}
    <div class="career-section-title">📈 최근 7일 순수익</div>
    ${chartHtml}
    ${rowsHtml ? `<div class="career-day-list">${rowsHtml}</div>` : ''}
    <div class="career-section-title">🏆 업적 (${unlockedCnt}/${achievements.length})</div>
    <div class="career-ach-grid">${achHtml}</div>
  `;
}

/** "이번 주" progress card: days finished this week, net so far, best day; the statement comes on day 7 */
function weekCardHtml(delivery: DeliveryManager): string {
  const w = delivery.getWeekSummary();
  const won = (n: number) => `${n < 0 ? '-' : ''}₩${Math.abs(n).toLocaleString()}`;
  const left = w.lastDay - delivery.shiftDay;
  return `
    <div class="career-week-card">
      <div class="cw-title">📆 이번 주 · ${w.week}주차 <span>${w.firstDay}~${w.lastDay}일차</span></div>
      <div class="cw-row"><span>마친 근무일 ${w.days.length}일 · 배달 ${w.deliveries}건</span><b class="${w.net < 0 ? 'neg' : ''}">${won(w.net)}</b></div>
      ${delivery
        .getWeekGoalsLive()
        .map(
          (g) =>
            `<div class="cw-goal ${g.met ? 'met' : g.failed ? 'failed' : ''}"><span>${g.met ? '✅' : g.failed ? '✖️' : '⬜'} ${g.icon} ${g.title}</span><span>${weekGoalProgressText(g)} · ${g.failed ? '이번 주 불가' : `+₩${g.bonus.toLocaleString()}`}</span></div>`,
        )
        .join('')}
      <div class="cw-sub">${left === 0 ? '오늘 퇴근하면 주간 정산서가 나와요' : `${w.lastDay}일차 퇴근 때 주간 정산서가 나와요 (${left}일 남음)`}${w.bestDay ? ` · 최고 ${w.bestDay.day}일차 ${won(w.bestDay.net)}` : ''}</div>
    </div>`;
}

/** The past week left open: the sheet is redrawn as the game runs, so its open line is restored on every redraw */
let openPastWeek: number | null = null;
let watchingToggles = false;
function watchPastWeekToggles(): void {
  if (watchingToggles || typeof document === 'undefined') return;
  watchingToggles = true;
  // 'toggle' does not bubble: listen in the capture phase
  document.addEventListener(
    'toggle',
    (e) => {
      const el = e.target as HTMLElement;
      if (!(el instanceof HTMLDetailsElement) || !el.classList.contains('past-week')) return;
      const week = Number(el.dataset.week);
      if (el.open) openPastWeek = week;
      else if (openPastWeek === week) openPastWeek = null;
    },
    true,
  );
}

/**
 * "지난 주 기록": finished weeks, newest first, one line each (season, deliveries, net and the change against the week
 * before); tapping a line opens that week's full statement (the same one shown at its last clock-out)
 */
export function pastWeeksHtml(weeks: readonly WeekSummary[]): string {
  if (weeks.length === 0) return '';
  watchPastWeekToggles();
  const won = (n: number) => `${n < 0 ? '-' : ''}₩${Math.abs(n).toLocaleString()}`;
  const rows = weeks
    .map((w, i) => {
      const season = seasonOfDay(w.firstDay);
      const before = weeks[i + 1];
      const diff = before && before.week === w.week - 1 ? w.net - before.net : null;
      const delta =
        diff === null
          ? ''
          : `<span class="pw-delta ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}">${diff > 0 ? '▲' : diff < 0 ? '▼' : '='} ${won(Math.abs(diff))}</span>`;
      return `<details class="past-week" data-week="${w.week}"${w.week === openPastWeek ? ' open' : ''}>
        <summary><span class="pw-name">${season.emoji} ${w.week}주차 <small>${w.firstDay}~${w.lastDay}일차 · ${season.label}</small></span><span class="pw-stats">${w.deliveries}건 · <b class="${w.net < 0 ? 'neg' : ''}">${won(w.net)}</b>${delta}</span></summary>
        ${weeklyStatementHtml(w)}
      </details>`;
    })
    .join('');
  return `<div class="career-section-title">📚 지난 주 기록</div><div class="past-weeks">${rows}</div>`;
}
