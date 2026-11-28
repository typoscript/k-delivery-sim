/**
 * One working day (근무일) on the game clock: day number, the shift's own ledger and its daily goals.
 * Saved with the rider career so a reload resumes the same day and time (no re-claiming goal bonuses).
 * Pure logic, unit tested.
 */

/** Goal ids: the two daily constants plus rotating ones (district goals are `district:<id>`) */
export type ShiftGoalId = string;

export interface ShiftGoalSpec {
  id: ShiftGoalId;
  icon: string;
  title: string;
  target: number;
  bonus: number;
  /** Checked after every delivery, or only when clocking out */
  awardAt: 'delivery' | 'clock_out';
  /** Daily counter this goal reads (undefined: completed deliveries) */
  counter?: string;
}

/** Daily counter of safe stops / yields after a red-light or pedestrian warning */
export const SAFE_STOP_COUNTER = 'safeStop';
/** Safe stops that each give back rider rating (+SAFE_STOP_RATING_GAIN) per day */
export const SAFE_STOP_RATING_DAILY_MAX = 3;
export const SAFE_STOP_RATING_GAIN = 0.1;

/** Every day: the delivery count goal first, the accident-free clock-out goal last */
export const DELIVERIES_GOAL: ShiftGoalSpec = { id: 'deliveries', icon: '📦', title: '배달 3건 완료', target: 3, bonus: 5000, awardAt: 'delivery' };
export const SAFE_GOAL: ShiftGoalSpec = { id: 'safe', icon: '🛡️', title: '무사고 퇴근 (3건 이상 · 보행자 사고 0건)', target: 3, bonus: 2000, awardAt: 'clock_out' };

/** Rotating goals: two of these (plus district goals) are picked per working day */
export const ROTATING_GOALS: readonly ShiftGoalSpec[] = [
  { id: 'peak', icon: '🔥', title: '피크타임 배달 2건', target: 2, bonus: 3000, awardAt: 'delivery', counter: 'peak' },
  { id: 'villa', icon: '🪜', title: '빌라 계단 배달 2건', target: 2, bonus: 2500, awardAt: 'delivery', counter: 'villa' },
  { id: 'rain', icon: '🌧️', title: '비 오는 날 배달 1건', target: 1, bonus: 2500, awardAt: 'delivery', counter: 'rain' },
  { id: 'night', icon: '🌙', title: '심야 배달 2건', target: 2, bonus: 2500, awardAt: 'delivery', counter: 'night' },
  { id: 'perfect', icon: '✨', title: '음식 상태 95% 이상 3건', target: 3, bonus: 3000, awardAt: 'delivery', counter: 'perfect' },
  { id: 'urgent', icon: '⏱️', title: '급한 배달 제시간 1건', target: 1, bonus: 3000, awardAt: 'delivery', counter: 'urgentOnTime' },
  { id: 'regular', icon: '⭐', title: '단골 고객 배달 1건', target: 1, bonus: 2000, awardAt: 'delivery', counter: 'regular' },
  { id: 'far', icon: '🛣️', title: '1km 넘는 장거리 배달 2건', target: 2, bonus: 3000, awardAt: 'delivery', counter: 'far' },
  { id: 'safe_stop', icon: '🚦', title: '경고 후 안전 정지 3회', target: 3, bonus: 3000, awardAt: 'delivery', counter: SAFE_STOP_COUNTER },
];

export interface GoalDistrict {
  id: string;
  label: string;
}

/** "광교에서 3건" style goal for a district (counter `district:<id>`) */
export function districtGoal(d: GoalDistrict): ShiftGoalSpec {
  return { id: `district:${d.id}`, icon: '📍', title: `${d.label}에서 배달 3건`, target: 3, bonus: 3000, awardAt: 'delivery', counter: `district:${d.id}` };
}

/** Deterministic 0..1 values from the day number (same goals for the same day, after reloads too) */
function dayRand(day: number, salt: number): number {
  let h = (Math.imul(day, 2654435761) ^ Math.imul(salt + 1, 40503)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Today's goals: deliveries, two rotating goals (from the pool + district goals), accident-free clock-out */
export function goalsForDay(day: number, districts: readonly GoalDistrict[]): ShiftGoalSpec[] {
  const pool = [...ROTATING_GOALS, ...districts.map(districtGoal)];
  const first = pool[Math.floor(dayRand(day, 1) * pool.length)];
  const rest = pool.filter((g) => g !== first);
  const second = rest[Math.floor(dayRand(day, 2) * rest.length)];
  return [DELIVERIES_GOAL, first, second, SAFE_GOAL];
}

/** Per-shift totals (the daily ledger) that are saved with the shift */
export const SHIFT_LEDGER_KEYS = [
  'completedCount',
  'baseFeeTotal',
  'distanceBonusTotal',
  'rainBonusTotal',
  'nightBonusTotal',
  'peakBonusTotal',
  'specialBonusTotal',
  'eventBonusTotal',
  'tierBonusTotal',
  'tipTotal',
  'missionBonusTotal',
  'weeklyBonusTotal',
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
  /** Today's goal counters (peak, villa, rain, district:<id> ...) */
  counters: Record<string, number>;
  claimed: ShiftGoalId[];
  ledger: ShiftLedger;
}

export function emptyLedger(): ShiftLedger {
  return Object.fromEntries(SHIFT_LEDGER_KEYS.map((k) => [k, 0])) as ShiftLedger;
}

export function emptyShift(day: number, clockMinute: number): ShiftSave {
  return { day, clockMinute, counters: {}, claimed: [], ledger: emptyLedger() };
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
  const claimed = Array.isArray(r.claimed)
    ? [...new Set(r.claimed.filter((c): c is string => typeof c === 'string' && c.length > 0 && c.length < 64))]
    : [];
  const counters: Record<string, number> = {};
  if (r.counters && typeof r.counters === 'object') {
    for (const [k, v] of Object.entries(r.counters as Record<string, unknown>)) {
      if (finite(v) && v > 0 && k.length < 64) counters[k] = Math.floor(v);
    }
  }
  // Saves from before rotating goals kept only the rush-hour count
  if (finite(r.peakDeliveries) && r.peakDeliveries > 0 && counters.peak === undefined) counters.peak = Math.floor(r.peakDeliveries);
  return {
    day: Math.max(1, Math.floor(r.day)),
    clockMinute: ((r.clockMinute % 1440) + 1440) % 1440,
    counters,
    claimed,
    ledger,
  };
}

export interface ShiftGoalState {
  completedCount: number;
  pedestrianAccidentCount: number;
  counters: Readonly<Record<string, number>>;
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
  if (g.id === SAFE_GOAL.id) {
    return { current: s.completedCount, met: s.completedCount >= g.target && s.pedestrianAccidentCount === 0 };
  }
  const current = g.counter ? (s.counters[g.counter] ?? 0) : s.completedCount;
  return { current, met: current >= g.target };
}

export function shiftGoalStatuses(goals: readonly ShiftGoalSpec[], s: ShiftGoalState): ShiftGoalStatus[] {
  return goals.map((g) => {
    const { current, met } = progressOf(g, s);
    const shown = Math.min(current, g.target);
    return { ...g, current: shown, claimed: s.claimed.has(g.id), met, progressPct: Math.round((shown / g.target) * 100) };
  });
}

/** Goals that pay out now: met, not yet claimed, and checked at this moment (after a delivery / at clock-out) */
export function goalsToAward(goals: readonly ShiftGoalSpec[], s: ShiftGoalState, moment: 'delivery' | 'clock_out'): ShiftGoalSpec[] {
  return goals.filter((g) => {
    if (s.claimed.has(g.id)) return false;
    if (g.awardAt === 'clock_out' && moment !== 'clock_out') return false;
    return progressOf(g, s).met;
  });
}
