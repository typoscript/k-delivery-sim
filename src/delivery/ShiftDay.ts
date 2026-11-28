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
/** Daily count of traffic violations (speeding / red light / sidewalk riding, warnings and tickets alike) */
export const VIOLATION_COUNTER = '_violations';
/** Every day: no traffic violation all day (paid at clock-out, like the accident-free goal) */
export const CLEAN_GOAL: ShiftGoalSpec = { id: 'clean', icon: '🚦', title: '교통 위반 0회 퇴근 (3건 이상)', target: 3, bonus: 2500, awardAt: 'clock_out' };
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
  { id: 'event', icon: '🍲', title: '이벤트 콜 할증 2건 (국물 · 눈 · 야식 · 점심 · 카페)', target: 2, bonus: 3000, awardAt: 'delivery', counter: 'event' },
  { id: 'snow', icon: '❄️', title: '눈 오는 날 배달 1건', target: 1, bonus: 3000, awardAt: 'delivery', counter: 'snow' },
  { id: 'walk_in', icon: '🚶', title: '지상 차량 출입 금지 단지 도보 배달 2건', target: 2, bonus: 3000, awardAt: 'delivery', counter: 'walkIn' },
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

/** The two rotating goals drawn for a working day (from the pool + district goals) */
export function rotatingGoalsForDay(day: number, districts: readonly GoalDistrict[]): ShiftGoalSpec[] {
  const pool = [...ROTATING_GOALS, ...districts.map(districtGoal)];
  const first = pool[Math.floor(dayRand(day, 1) * pool.length)];
  const rest = pool.filter((g) => g !== first);
  const second = rest[Math.floor(dayRand(day, 2) * rest.length)];
  return [first, second];
}

/** A rotating goal by id (district goals: `district:<id>`), or null when it no longer exists */
export function rotatingGoalById(id: string, districts: readonly GoalDistrict[]): ShiftGoalSpec | null {
  const pooled = ROTATING_GOALS.find((g) => g.id === id);
  if (pooled) return pooled;
  const d = id.startsWith('district:') ? districts.find((x) => `district:${x.id}` === id) : undefined;
  return d ? districtGoal(d) : null;
}

/** A day's goals around its rotating ones: 배달 3건 first, the two clock-out goals last */
export function withFixedGoals(rotating: readonly ShiftGoalSpec[]): ShiftGoalSpec[] {
  return [DELIVERIES_GOAL, ...rotating, SAFE_GOAL, CLEAN_GOAL];
}

/** Today's goals: deliveries, two rotating goals (from the pool + district goals), the clock-out goals */
export function goalsForDay(day: number, districts: readonly GoalDistrict[]): ShiftGoalSpec[] {
  return withFixedGoals(rotatingGoalsForDay(day, districts));
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
  /**
   * The day's two rotating goal ids, pinned when the day started so adding goals to the pool in an update never
   * changes a day in progress (missing in saves from before pinning: drawn on load, then pinned)
   */
  rotatingGoals?: ShiftGoalId[];
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
  const rotatingGoals = Array.isArray(r.rotatingGoals)
    ? r.rotatingGoals.filter((c): c is string => typeof c === 'string' && c.length > 0 && c.length < 64).slice(0, 4)
    : [];
  return {
    day: Math.max(1, Math.floor(r.day)),
    clockMinute: ((r.clockMinute % 1440) + 1440) % 1440,
    counters,
    claimed,
    ledger,
    ...(rotatingGoals.length > 0 ? { rotatingGoals } : {}),
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
  /** Can no longer be met today (an accident / a traffic violation already happened) */
  failed: boolean;
  progressPct: number;
}

function progressOf(g: ShiftGoalSpec, s: ShiftGoalState): { current: number; met: boolean } {
  if (g.id === SAFE_GOAL.id) {
    return { current: s.completedCount, met: s.completedCount >= g.target && s.pedestrianAccidentCount === 0 };
  }
  if (g.id === CLEAN_GOAL.id) {
    return { current: s.completedCount, met: s.completedCount >= g.target && (s.counters[VIOLATION_COUNTER] ?? 0) === 0 };
  }
  const current = g.counter ? (s.counters[g.counter] ?? 0) : s.completedCount;
  return { current, met: current >= g.target };
}

export function shiftGoalStatuses(goals: readonly ShiftGoalSpec[], s: ShiftGoalState): ShiftGoalStatus[] {
  return goals.map((g) => {
    const { current, met } = progressOf(g, s);
    const shown = Math.min(current, g.target);
    const failed =
      (g.id === SAFE_GOAL.id && s.pedestrianAccidentCount > 0) || (g.id === CLEAN_GOAL.id && (s.counters[VIOLATION_COUNTER] ?? 0) > 0);
    return { ...g, current: shown, claimed: s.claimed.has(g.id), met, failed, progressPct: Math.round((shown / g.target) * 100) };
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
