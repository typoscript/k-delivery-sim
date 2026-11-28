import { DEMAND_EVENTS } from '../delivery/demandEvents';
import { DailyFinanceLedger, FINE_KINDS, FineKind, SPECIAL_ORDERS, SettlementResult } from '../delivery/DeliveryManager';

/**
 * Line items shared by every receipt: the per-delivery settlement popup, the full-screen daily report and the
 * phone [수익] receipt. Adding a new surcharge here shows it everywhere; amounts always add up to the payout
 * (settlement) and the net profit (daily ledger) - see receiptLines.test.ts.
 */

export type LineTone = 'income' | 'rain' | 'expense' | 'warn' | 'info';

export interface ReceiptLine {
  key: string;
  label: string;
  /** Signed won amount counted in the total (0 for information-only lines) */
  amount: number;
  tone: LineTone;
  /** Text shown instead of the formatted amount */
  valueText?: string;
}

export const fmtWon = (n: number) => `₩${Math.abs(n).toLocaleString()}`;

/** "+₩1,000" / "-₩500" / "₩0", or the line's own value text */
export function lineValue(l: ReceiptLine): string {
  if (l.valueText !== undefined) return l.valueText;
  return l.amount > 0 ? `+${fmtWon(l.amount)}` : l.amount < 0 ? `-${fmtWon(l.amount)}` : '₩0';
}

export function ledgerIncomeLines(l: DailyFinanceLedger): ReceiptLine[] {
  return [
    { key: 'base', label: `기본 배달료 합계 (${l.completedCount}건)`, amount: l.baseFeeTotal, tone: 'income' },
    { key: 'distance', label: '거리 할증 합계', amount: l.distanceBonusTotal, tone: 'income' },
    { key: 'rain', label: '🌧️ 우천/기상 할증', amount: l.rainBonusTotal, tone: 'income' },
    { key: 'night', label: '🌙 심야 할증', amount: l.nightBonusTotal, tone: 'income' },
    { key: 'peak', label: '🔥 피크타임 할증', amount: l.peakBonusTotal, tone: 'income' },
    { key: 'special', label: '⏱️🍱 특별 주문 · ⭐단골 고객', amount: l.specialBonusTotal, tone: 'income' },
    ...(l.eventBonusTotal > 0
      ? [{ key: 'event', label: '🍲🍗 이벤트 콜 (국물 · 야식)', amount: l.eventBonusTotal, tone: 'income' as const }]
      : []),
    { key: 'tier', label: `${l.riderTier.icon} ${l.riderTier.name} 등급 보너스`, amount: l.tierBonusTotal, tone: 'income' },
    { key: 'tip', label: '안전 배달 팁', amount: l.tipTotal, tone: 'income' },
    { key: 'mission', label: '🏆 오늘의 목표 보너스', amount: l.missionBonusTotal, tone: 'income' },
    ...(l.weeklyBonusTotal > 0
      ? [{ key: 'weekly', label: '📆 주간 목표 보너스', amount: l.weeklyBonusTotal, tone: 'income' as const }]
      : []),
  ];
}

const FINE_LABELS: Record<FineKind, string> = {
  speeding: '📸 과속 단속 과태료',
  signal: '🚦 신호위반 과태료',
  sidewalk: '🚸 인도 주행 과태료',
  pedestrian: '🚑 보행자 사고 합의금',
};

/** Fines by kind (only the kinds paid today); a single ₩0 line on a clean day */
export function fineLines(l: DailyFinanceLedger): ReceiptLine[] {
  if (l.fineExpense === 0) return [{ key: 'fine', label: '🚨 과태료 · 사고 합의금', amount: 0, tone: 'expense' }];
  const lines: ReceiptLine[] = FINE_KINDS.filter((k) => l.fines[k] > 0).map((k) => ({
    key: `fine:${k}`,
    label: FINE_LABELS[k],
    amount: -l.fines[k],
    tone: 'expense' as const,
  }));
  const other = l.fineExpense - FINE_KINDS.reduce((sum, k) => sum + l.fines[k], 0);
  if (other > 0) lines.push({ key: 'fine:other', label: '🚨 기타 과태료', amount: -other, tone: 'expense' });
  return lines;
}

export function ledgerExpenseLines(l: DailyFinanceLedger): ReceiptLine[] {
  return [
    ...fineLines(l),
    { key: 'damage', label: '📦 음식 파손 페널티 차감', amount: -l.damageDeductionTotal, tone: 'expense' },
    { key: 'fuel', label: '⛽ 유류비 지출', amount: -l.fuelExpense, tone: 'expense' },
    { key: 'repair', label: '🔧 오토바이 수리·기종·도색', amount: -l.repairExpense, tone: 'expense' },
    { key: 'upgrade', label: '⚙️ 성능 장비 업그레이드', amount: -l.upgradeExpense, tone: 'expense' },
    { key: 'convenience', label: '🏪 편의점 음료·충전', amount: -l.convenienceExpense, tone: 'expense' },
  ];
}

/** Merges lines into fewer rows for the small phone receipt (same totals) */
export function compactLines(lines: readonly ReceiptLine[], groups: ReadonlyArray<{ keys: string[]; label: string }>): ReceiptLine[] {
  const out: ReceiptLine[] = [];
  const done = new Set<string>();
  for (const line of lines) {
    if (done.has(line.key)) continue;
    const g = groups.find((x) => x.keys.includes(line.key));
    if (!g) {
      out.push(line);
      continue;
    }
    const members = lines.filter((l) => g.keys.includes(l.key));
    members.forEach((m) => done.add(m.key));
    out.push({ key: g.keys.join('+'), label: g.label, amount: members.reduce((s, m) => s + m.amount, 0), tone: line.tone });
  }
  return out;
}

/** Phone receipt grouping */
export const PHONE_RECEIPT_GROUPS = [
  { keys: ['tip', 'mission', 'weekly'], label: '안전 배달 팁 / 목표 보너스' },
  { keys: ['fuel', 'repair', 'upgrade', 'convenience'], label: '⛽ 유류 · 🔧 정비 · ⚙️ 업그레이드 · 🏪 편의점' },
];

/** Per-delivery settlement receipt rows (conditional rows only when they apply) */
export function settlementLines(r: SettlementResult): ReceiptLine[] {
  const lines: ReceiptLine[] = [
    { key: 'base', label: `기본 배달료 (${r.order.menuName})`, amount: r.baseFee, tone: 'info', valueText: fmtWon(r.baseFee) },
  ];
  const add = (key: string, label: string, amount: number, tone: LineTone = 'income') => {
    if (amount > 0) lines.push({ key, label, amount, tone });
  };
  add('rain', '🌧️ 우천 할증 보너스', r.rainBonus, 'rain');
  add('night', '🌙 심야 할증 보너스', r.nightBonus);
  add('peak', '🔥 피크타임 할증', r.peakBonus);
  const sp = r.order.special ? SPECIAL_ORDERS[r.order.special] : null;
  if (sp) {
    if (r.specialBonus > 0) add('special', `${sp.icon} ${sp.label} 할증`, r.specialBonus);
    else lines.push({ key: 'special', label: `${sp.icon} ${sp.label} 제한시간 초과 · 급송 할증 없음`, amount: 0, tone: 'warn' });
  }
  const ev = r.order.demandEvent ? DEMAND_EVENTS[r.order.demandEvent] : null;
  if (ev) {
    if (r.eventBonus > 0) add('event', `${ev.icon} ${ev.label} 할증`, r.eventBonus);
    else
      lines.push({
        key: 'event',
        label: `${ev.icon} ${ev.label} · ${ev.id === 'rain_soup' ? '국물이 쏟아져' : '음식이 식어'} 할증 없음`,
        amount: 0,
        tone: 'warn',
      });
  }
  add('regular', '⭐ 단골 고객 팁', r.regularCustomerTip);
  add('tier', '🏅 라이더 등급 보너스', r.tierBonus);

  const tempIcon = r.order.foodTempType === 'cold' ? '🧊 보냉' : '🔥 보온';
  if (r.tempBonus > 0) add('temp', `${tempIcon} 최적 온도 유지 (${r.foodTemp}%)`, r.tempBonus);
  else if (r.foodTemp < 50) lines.push({ key: 'temp', label: `${tempIcon} 온도 저하 (${r.foodTemp}%)`, amount: 0, tone: 'warn', valueText: '배달팁 감액 반영' });
  else lines.push({ key: 'temp', label: `${tempIcon} 상태 (${r.foodTemp}%)`, amount: 0, tone: 'info', valueText: '보통' });

  add('villa', '🪜 구축 빌라 계단 수고비', r.villaStairBonus);
  add('chatTip', '💬 고객 약속 조심배달 팁', r.promisedTipBonus);

  const spillNote = r.spillDamageAccum > 0 ? ` · 국물/방지턱 -${r.spillDamageAccum}%` : '';
  if (r.tipPenalty === 0) {
    lines.push({ key: 'tip', label: `안전 배달 팁 (음식 상태 ${r.foodIntegrity}%)`, amount: r.tip, tone: 'income' });
  } else {
    lines.push({
      key: 'tip',
      label: `파손 배달팁 감액 (상태 ${r.foodIntegrity}%${spillNote})`,
      amount: r.tip,
      tone: 'warn',
      valueText: `팁 ${fmtWon(r.tip)} (-${fmtWon(r.tipPenalty)})`,
    });
  }
  if (r.damageDeduction > 0) {
    lines.push({ key: 'damage', label: '음식 파손 배상 차감', amount: -r.damageDeduction, tone: 'warn' });
  }
  return lines;
}
