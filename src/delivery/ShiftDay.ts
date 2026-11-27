/**
 * One working day (근무일) on the game clock: day number, the shift's own ledger and its daily goals.
 * Saved with the rider career so a reload resumes the same day and time (no re-claiming goal bonuses).
 * Pure logic, unit tested.
 */

export type ShiftGoalId = 'deliveries' | 'peak' | 'safe';

export interface ShiftGoalSpec {
  id: ShiftGoalId;
  icon: string;
  title: string;
  target: number;
  bonus: number;
  /** Checked after every delivery, or only when clocking out */
  awardAt: 'delivery' | 'clock_out';
}

export const SHIFT_GOALS: readonly ShiftGoalSpec[] = [
  { id: 'deliveries', icon: '📦', title: '배달 3건 완료', target: 3, bonus: 5000, awardAt: 'delivery' },
  { id: 'peak', icon: '🔥', title: '피크타임 배달 2건', target: 2, bonus: 3000, awardAt: 'delivery' },
  { id: 'safe', icon: '🛡️', title: '무사고 퇴근 (3건 이상 · 보행자 사고 0건)', target: 3, bonus: 2000, awardAt: 'clock_out' },
];

/** Per-shift totals (the daily ledger) that are saved with the shift */
export const SHIFT_LEDGER_KEYS = [
  'completedCount',
  'baseFeeTotal',
  'distanceBonusTotal',
  'rainBonusTotal',
  'nightBonusTotal',
  'peakBonusTotal',
  'specialBonusTotal',
  'tierBonusTotal',
  'tipTotal',
  'missionBonusTotal',
  'damageDeductionTotal',
  'fuelExpense',
  'repairExpense',
  'upgradeExpense',
  'convenienceExpense',
  'fineExpense',
  'pedestrianAccidentCount',
] as const;
export type ShiftLedgerKey = (typeof SHIFT_LEDGER_KEYS)[number];
export type ShiftLedger = Record<ShiftLedgerKey, number>;

export interface ShiftSave {
  /** 1-based working day */
  day: number;
  /** Game clock minute of day to resume at */
  clockMinute: number;
  /** Deliveries of calls generated during a lunch / dinner rush */
  peakDeliveries: number;
  claimed: ShiftGoalId[];
  ledger: ShiftLedger;
}

export function emptyLedger(): ShiftLedger {
  return Object.fromEntries(SHIFT_LEDGER_KEYS.map((k) => [k, 0])) as ShiftLedger;
}

export function emptyShift(day: number, clockMinute: number): ShiftSave {
  return { day, clockMinute, peakDeliveries: 0, claimed: [], ledger: emptyLedger() };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validates a saved shift (localStorage is user-editable); undefined if it is unusable */
export function parseShiftSave(raw: unknown): ShiftSave | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (!finite(r.day) || !finite(r.clockMinute)) return undefined;
  const ledger = emptyLedger();
  const rl = (r.ledger && typeof r.ledger === 'object' ? r.ledger : {}) as Record<string, unknown>;
  for (const k of SHIFT_LEDGER_KEYS) {
    const v = rl[k];
    if (finite(v)) ledger[k] = Math.round(v);
  }
  const ids = new Set<ShiftGoalId>(SHIFT_GOALS.map((g) => g.id));
  const claimed = Array.isArray(r.claimed)
    ? [...new Set(r.claimed.filter((c): c is ShiftGoalId => ids.has(c as ShiftGoalId)))]
    : [];
  return {
    day: Math.max(1, Math.floor(r.day)),
    clockMinute: ((r.clockMinute % 1440) + 1440) % 1440,
    peakDeliveries: finite(r.peakDeliveries) ? Math.max(0, Math.floor(r.peakDeliveries)) : 0,
    claimed,
    ledger,
  };
}

export interface ShiftGoalState {
  completedCount: number;
  peakDeliveries: number;
  pedestrianAccidentCount: number;
  claimed: ReadonlySet<ShiftGoalId>;
}

export interface ShiftGoalStatus extends ShiftGoalSpec {
  current: number;
  claimed: boolean;
  /** Condition currently met (for 'safe': would pay if clocking out now) */
  met: boolean;
  progressPct: number;
}

function progressOf(g: ShiftGoalSpec, s: ShiftGoalState): { current: number; met: boolean } {
  switch (g.id) {
    case 'deliveries':
      return { current: s.completedCount, met: s.completedCount >= g.target };
    case 'peak':
      return { current: s.peakDeliveries, met: s.peakDeliveries >= g.target };
    case 'safe':
      return { current: s.completedCount, met: s.completedCount >= g.target && s.pedestrianAccidentCount === 0 };
  }
}

export function shiftGoalStatuses(s: ShiftGoalState): ShiftGoalStatus[] {
  return SHIFT_GOALS.map((g) => {
    const { current, met } = progressOf(g, s);
    const shown = Math.min(current, g.target);
    return {
      ...g,
      current: shown,
      claimed: s.claimed.has(g.id),
      met,
      progressPct: Math.round((shown / g.target) * 100),
    };
  });
}

/** Goals that pay out now: met, not yet claimed, and checked at this moment (after a delivery / at clock-out) */
export function goalsToAward(s: ShiftGoalState, moment: 'delivery' | 'clock_out'): ShiftGoalSpec[] {
  return SHIFT_GOALS.filter((g) => {
    if (s.claimed.has(g.id)) return false;
    if (g.awardAt === 'clock_out' && moment !== 'clock_out') return false;
    return progressOf(g, s).met;
  });
}
