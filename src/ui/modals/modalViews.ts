/**
 * HTML for the data-heavy modals (cargo box, garage, daily statement, settlement). Pure string builders:
 * ModalUi puts them into its elements, tests can check them without a DOM.
 */
import {
  ActiveMission,
  CARGO_SLOT_COUNT,
  ClockOutResult,
  DailyFinanceLedger,
  DeliveryInstruction,
  REPAIR_COST_PER_DAMAGE_STAGE,
  SettlementResult,
  getInstructionMeta,
} from '../../delivery/DeliveryManager';
import { BikeGarageSave, SCOOTER_MODEL_LIST, SCOOTER_PAINT_LIST } from '../../vehicle/ScooterModels';
import { CustomerReview, RIDER_UPGRADE_LIST, RiderCareerSave } from '../../delivery/RiderCareer';
import { LineTone, ledgerExpenseLines, ledgerIncomeLines, lineValue, settlementLines } from '../receiptLines';

// ---------------------------------------------------------------- cargo box

/** Banner above the 3 slots: the bag in hand, or empty hands */
export function cargoHandBanner(carrying: ActiveMission | null): { className: string; html: string } {
  if (!carrying) {
    return {
      className: 'cargo-hand-banner free',
      html: `
        <div class="chb-top">
          <span>✋ 양손 비어 있음</span>
          <span class="chb-tag">적재된 슬롯을 선택해 꺼내기</span>
        </div>
      `,
    };
  }
  const actionLabel = carrying.phase === 'carrying_to_box' ? '픽업 음식 적재 대기' : '꺼낸 음식 (다시 적재 가능)';
  return {
    className: 'cargo-hand-banner carrying',
    html: `
        <div class="chb-top">
          <span>🛍️ 손에 든 음식: <b>#${carrying.order.orderNumber}</b></span>
          <span class="chb-tag">${actionLabel}</span>
        </div>
        <div class="chb-sub">${carrying.order.shop.emoji} ${carrying.order.shop.name} → ${carrying.order.customer.emoji} ${carrying.order.customer.name} ${carrying.order.unitNumber}</div>
      `,
  };
}

const levelColor = (pct: number) => (pct >= 80 ? '#34d399' : pct >= 50 ? '#fbbf24' : '#f87171');

function emptySlotCard(i: number, carrying: ActiveMission | null): string {
  const slotNo = i + 1;
  const canLoad = carrying !== null && (carrying.phase === 'carrying_to_box' || carrying.phase === 'carrying_to_lobby');
  return `
          <div class="cargo-slot-card empty ${canLoad ? 'actionable' : ''}">
            <div class="cs-left">
              <div class="cs-slot-badge"><kbd>${slotNo}</kbd> 슬롯 ${slotNo}</div>
              <div class="cs-empty-text">비어 있음</div>
            </div>
            <button class="cs-btn load" data-slot="${i}" ${canLoad ? '' : 'disabled'}>
              ${canLoad ? `+ #${carrying!.order.orderNumber} 적재` : '빈 칸'}
            </button>
          </div>
        `;
}

function loadedSlotCard(i: number, m: ActiveMission, carrying: ActiveMission | null, playerX: number, playerZ: number): string {
  const slotNo = i + 1;
  const dist = Math.round(Math.hypot(playerX - m.order.customer.x, playerZ - m.order.customer.z));
  const isHere = dist <= 18;
  const canUnload = carrying === null;
  const intPct = Math.round(m.foodIntegrity);
  const tempPct = Math.round(m.foodTemp);
  const tempIcon = m.order.foodTempType === 'cold' ? '🧊' : '🔥';
  const villaBadge = m.order.customer.residenceKind === 'walkup_villa' ? '<span class="villa-tag">🪜 계단 +₩500</span>' : '';
  const chatBadge = m.chatNote ? `<div class="chat-note-tag">💬 ${m.chatNote}</div>` : '';
  return `
          <div class="cargo-slot-card occupied ${isHere ? 'near-dest' : ''}">
            <div class="cs-main">
              <div class="cs-top-row">
                <span class="cs-slot-badge filled"><kbd>${slotNo}</kbd> 슬롯 ${slotNo}</span>
                <span class="cs-ord-num">#${m.order.orderNumber}</span>
                <span class="cs-dist ${isHere ? 'here' : ''}">${isHere ? `📍 바로 앞 (${dist}m)` : `${dist}m`}</span>
              </div>
              <div class="cs-dest">${m.order.customer.emoji} ${m.order.customer.name} <b>${m.order.unitNumber}</b>${villaBadge}</div>
              <div class="cs-meta">
                <span>${m.order.shop.emoji} ${m.order.shop.name} · ${m.order.menuName} <span class="food-meta-chip ${m.order.foodTempType === 'cold' ? 'cold' : m.order.isSpillSensitive ? 'spill' : ''}">${m.order.foodCategoryTag}</span></span>
              </div>
              ${chatBadge}
              <div class="cs-foot-row">
                <span class="cs-pin">현관 <b>${m.order.doorPinLabel}</b> · ${getInstructionMeta(m.order.deliveryInstruction).badge}</span>
                <span class="cs-int" style="color:${levelColor(tempPct)}">${tempIcon}${tempPct}%</span>
                <span class="cs-int" style="color:${levelColor(intPct)}">상태 ${intPct}%</span>
              </div>
            </div>
            <button class="cs-btn unload" data-slot="${i}" ${canUnload ? '' : 'disabled'}>
              ${canUnload ? '꺼내기' : '손 사용중'}
            </button>
          </div>
        `;
}

/** One card per cargo slot: empty (load the bag in hand) or loaded (destination, food state, unload) */
export function cargoSlotCardsHtml(
  slotMission: (slot: number) => ActiveMission | null,
  carrying: ActiveMission | null,
  playerX: number,
  playerZ: number
): string {
  const cards: string[] = [];
  for (let i = 0; i < CARGO_SLOT_COUNT; i++) {
    const m = slotMission(i);
    cards.push(m ? loadedSlotCard(i, m, carrying, playerX, playerZ) : emptySlotCard(i, carrying));
  }
  return cards.join('');
}

// ---------------------------------------------------------------- repair & custom garage

export function repairCostFor(damageLevel: number): number {
  return damageLevel * REPAIR_COST_PER_DAMAGE_STAGE;
}

export function repairDiagHtml(damageLevel: number, crashCount: number): string {
  if (damageLevel > 0) {
    return `
        <div class="svc-meter-row">
          <span>차량 파손 단계</span>
          <strong style="color:#fb923c">${damageLevel}단계 / 3 (누적 전도 ${crashCount}회)</strong>
        </div>
        <div class="svc-status-text">• 사이드미러 축 틀어짐 및 가속력 <b>-${damageLevel * 10}%</b> 저하 중</div>
      `;
  }
  return `
        <div class="svc-meter-row">
          <span>차량 정비 상태</span>
          <strong style="color:#34d399">양호 ✓ (파손 없음)</strong>
        </div>
        <div class="svc-status-text">아래에서 오토바이 기종을 변경하거나 커스텀 도색을 적용할 수 있습니다!</div>
      `;
}

export function garageBikeListHtml(garage: BikeGarageSave): string {
  return SCOOTER_MODEL_LIST.map((m) => {
    const isCurrent = garage.modelId === m.id;
    const isOwned = garage.ownedModels.includes(m.id);
    const cost = isOwned ? 0 : m.price;
    const badgeClass = isCurrent ? 'active' : isOwned ? 'owned' : '';
    const badgeText = isCurrent ? '✓ 탑승 중' : isOwned ? '무료 교체' : `₩${m.price.toLocaleString()}`;
    const fuelText = m.isElectric ? '⚡ EV 정숙모터' : m.fuelBurnMul < 0.7 ? '⛽ 초고연비' : '⛽ 표준 연비';
    return `
        <button class="garage-bike-btn ${isCurrent ? 'active' : ''}" data-bike-model="${m.id}" data-cost="${cost}">
          <div class="gb-info">
            <div class="gb-name">${m.icon} ${m.name}</div>
            <div class="gb-desc">${m.tagline}</div>
            <div class="gb-stats">
              <span class="gb-stat-pill">최고 ${m.maxKmh}km/h</span>
              <span class="gb-stat-pill">가속 ${Math.round(m.accelMul * 100)}%</span>
              <span class="gb-stat-pill">${fuelText}</span>
            </div>
          </div>
          <span class="gb-price-tag ${badgeClass}">${badgeText}</span>
        </button>
      `;
  }).join('');
}

export function garagePaintGridHtml(garage: BikeGarageSave): string {
  return SCOOTER_PAINT_LIST.map((p) => {
    const isCurrent = garage.paintId === p.id;
    const isOwned = garage.ownedPaints.includes(p.id);
    const cost = isOwned ? 0 : p.price;
    const priceTxt = isCurrent ? '적용 중' : isOwned ? '무료' : `₩${p.price.toLocaleString()}`;
    return `
        <button class="garage-paint-btn ${isCurrent ? 'active' : ''}" data-bike-paint="${p.id}" data-cost="${cost}">
          <span class="gp-swatch" style="background:${p.swatchHex}"></span>
          <span class="gp-meta">
            <span>${p.name}</span>
            <span class="gp-price">${priceTxt}</span>
          </span>
        </button>
      `;
  }).join('');
}

export function garageUpgradeListHtml(career: RiderCareerSave): string {
  return RIDER_UPGRADE_LIST.map((u) => {
    const owned = career.upgrades.includes(u.id);
    const canAfford = career.walletBalance >= u.price;
    const cls = owned ? 'upg-owned' : canAfford ? '' : 'upg-locked';
    const tagClass = owned ? 'active' : canAfford ? 'owned' : '';
    const tagText = owned ? '✓ 장착 완료' : `₩${u.price.toLocaleString()}`;
    return `
        <button class="garage-bike-btn ${cls}" data-upgrade-id="${u.id}" data-cost="${u.price}">
          <div class="gb-info">
            <div class="gb-name">${u.icon} ${u.name}</div>
            <div class="gb-desc">${u.shortDesc}</div>
            <div class="gb-stats">
              <span class="gb-stat-pill">${u.statBadge}</span>
            </div>
          </div>
          <span class="gb-price-tag ${tagClass}">${tagText}</span>
        </button>
      `;
  }).join('');
}

// ---------------------------------------------------------------- daily statement

/** Daily statement body; with `clockOut` it also lists the day's goals */
export function dailyReportHtml(ledger: DailyFinanceLedger, clockOut?: ClockOutResult): string {
  const goalsHtml = clockOut
    ? `<div class="rep-section">
        <div class="rep-sec-title">📅 ${clockOut.day}일차 목표</div>
        ${clockOut.goals
          .map(
            (g) =>
              `<div class="rep-line ${g.claimed ? 'inc' : ''}"><span>${g.claimed ? '✅' : '⬜'} ${g.icon} ${g.title}</span><span>${g.claimed ? `+₩${g.bonus.toLocaleString()}` : '미달성'}</span></div>`
          )
          .join('')}
      </div>`
    : '';
  const fmt = (n: number) => `₩${Math.abs(n).toLocaleString()}`;
  const netText = `${ledger.netProfit < 0 ? '-' : '+'}${fmt(ledger.netProfit)}`;
  return `
      <div class="rep-hero">
        <div>
          <div class="rep-hero-label">오늘 최종 순수익 (${ledger.completedCount}건 완료)</div>
          <div class="rep-hero-val ${ledger.netProfit < 0 ? 'neg' : ''}">${netText}</div>
        </div>
        <div style="text-align:right;font-size:11.5px;color:#cbd5e1">
          <div>총 수입 <b style="color:#4ade80">+${fmt(ledger.grossIncome)}</b></div>
          <div>총 지출 <b style="color:#f87171">-${fmt(ledger.totalExpenses)}</b></div>
        </div>
      </div>

      <div class="rep-section">
        <div class="rep-sec-title">💰 배달 수입 명세</div>
        ${ledgerIncomeLines(ledger).map((l) => `<div class="rep-line inc"><span>${l.label}</span><span>${lineValue(l)}</span></div>`).join('')}
        <div class="rep-line sub inc"><span>총 수입 소계</span><span>+${fmt(ledger.grossIncome)}</span></div>
      </div>

      <div class="rep-section">
        <div class="rep-sec-title">🧾 차감 및 운영 지출 명세</div>
        ${ledgerExpenseLines(ledger).map((l) => `<div class="rep-line exp"><span>${l.label}</span><span>${lineValue(l)}</span></div>`).join('')}
        <div class="rep-line sub exp"><span>총 차감/지출 소계</span><span>-${fmt(ledger.totalExpenses)}</span></div>
      </div>
      ${goalsHtml}
      <div class="rep-section">
        <div class="rep-line inc"><span>💼 누적 영구 저장 지갑 잔고 (${ledger.riderTier.icon} 누적 ${ledger.lifetimeCompleted}건)</span><span>₩${ledger.walletBalance.toLocaleString()}</span></div>
      </div>
    `;
}

// ---------------------------------------------------------------- settlement popup

/** Settlement popup row classes by line tone */
const SETTLEMENT_ROW_CLASS: Record<LineTone, string> = { income: 'tip', rain: 'rain-bonus', expense: 'warn', warn: 'warn', info: '' };

export function settlementPhotoBadge(instruction: DeliveryInstruction): string {
  return instruction === 'MEET_FACE'
    ? '✓ 고객 직접 대면 전달 완료'
    : instruction === 'KNOCK_DOOR'
      ? '✓ 노크 후 문 앞 전달 완료'
      : '✓ 문 앞 배달 인증 완료';
}

export function settlementReviewHtml(review: CustomerReview): string {
  const stars = '★'.repeat(review.stars) + '☆'.repeat(5 - review.stars);
  return `
      <div class="settlement-review-box">
        <div class="st-rev-hdr">
          <span>💬 방금 도착한 고객 리뷰</span>
          <span class="st-rev-stars">${stars} (${review.stars}.0)</span>
        </div>
        <div class="st-rev-comment">"${review.comment}"</div>
        <div class="st-rev-tags">${review.tags.map((t) => `<span class="st-rev-tag">${t}</span>`).join('')}</div>
      </div>
    `;
}

/** Pay lines + the customer's review */
export function settlementBreakdownHtml(result: SettlementResult): string {
  return `
      ${settlementLines(result)
        .map((l) => `<div class="st-row ${SETTLEMENT_ROW_CLASS[l.tone]}"><span>${l.label}</span><span>${lineValue(l)}</span></div>`)
        .join('')}
      ${settlementReviewHtml(result.review)}
    `;
}
