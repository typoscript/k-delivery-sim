/**
 * Career history across working days: one record per finished shift, lifetime counters and achievements.
 * Saved with the rider career (localStorage is user-editable, so every parser validates). Pure logic, unit tested.
 */
import { VIOLATION_COUNTER } from './ShiftDay';

/** Keep the most recent finished days */
export const MAX_DAY_HISTORY = 30;

/** Counter keys that hold the day's review star sum / count (not goal counters) */
export const STAR_SUM_COUNTER = '_starSum';
export const STAR_COUNT_COUNTER = '_starCount';

export interface DayRecord {
  day: number;
  deliveries: number;
  income: number;
  expenses: number;
  net: number;
  /** Average review stars of the day (null when no review came in) */
  avgStars: number | null;
  goalsMet: number;
  goalsTotal: number;
  accidents: number;
  /** Traffic violations of the day (missing on days recorded before violations were counted) */
  violations?: number;
}

export interface CareerStats {
  lifetimeCompleted: number;
  /** Lifetime totals of the daily goal counters (villa, rain, far, district:<id> ...) */
  counters: Readonly<Record<string, number>>;
  history: readonly DayRecord[];
  /** Deliverable district ids (for the "deliver everywhere" achievement) */
  districtIds: readonly string[];
}

export interface AchievementSpec {
  id: string;
  icon: string;
  title: string;
  desc: string;
  target: number;
  /** Current progress toward target */
  progress: (s: CareerStats) => number;
}

export interface AchievementStatus {
  id: string;
  icon: string;
  title: string;
  desc: string;
  target: number;
  current: number;
  unlocked: boolean;
  /** Working day it was unlocked (when unlocked) */
  unlockedDay?: number;
}

const counter = (key: string) => (s: CareerStats) => s.counters[key] ?? 0;

/** Consecutive finished days (newest first) with at least 3 deliveries and no pedestrian accident */
export function safeDayStreak(history: readonly DayRecord[]): number {
  let streak = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const d = history[i];
    if (d.deliveries >= 3 && d.accidents === 0) streak++;
    else break;
  }
  return streak;
}

/**
 * Days in a row (newest first) with 3+ deliveries and no traffic violation. Days recorded before violations were
 * counted end the streak (unknown, so never counted as clean).
 */
export function cleanDayStreak(history: readonly DayRecord[]): number {
  let streak = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const d = history[i];
    if (d.deliveries >= 3 && d.violations === 0) streak++;
    else break;
  }
  return streak;
}

/** The newest finished day before `day` (yesterday's record when the rider works every day) */
export function previousDay(history: readonly DayRecord[], day: number): DayRecord | null {
  let prev: DayRecord | null = null;
  for (const d of history) if (d.day < day && (!prev || d.day > prev.day)) prev = d;
  return prev;
}

/** Locked achievement closest to done (highest progress ratio), for a "다음 업적" hint */
export function nextAchievement(statuses: readonly AchievementStatus[]): AchievementStatus | null {
  let best: AchievementStatus | null = null;
  for (const a of statuses) {
    if (a.unlocked) continue;
    if (!best || a.current / a.target > best.current / best.target) best = a;
  }
  return best;
}

export function bestDay(history: readonly DayRecord[]): DayRecord | null {
  let best: DayRecord | null = null;
  for (const d of history) if (!best || d.net > best.net) best = d;
  return best;
}

export const ACHIEVEMENTS: readonly AchievementSpec[] = [
  { id: 'first', icon: '🛵', title: '첫 배달', desc: '첫 배달 완료', target: 1, progress: (s) => s.lifetimeCompleted },
  { id: 'd50', icon: '📦', title: '배달 50건', desc: '누적 배달 50건', target: 50, progress: (s) => s.lifetimeCompleted },
  { id: 'd200', icon: '🏅', title: '배달 200건', desc: '누적 배달 200건', target: 200, progress: (s) => s.lifetimeCompleted },
  { id: 'far', icon: '🛣️', title: '첫 장거리 배달', desc: '1km 넘는 배달 1건', target: 1, progress: counter('far') },
  { id: 'stairs', icon: '🪜', title: '계단왕', desc: '빌라 계단 배달 20건', target: 20, progress: counter('villa') },
  { id: 'rain', icon: '🌧️', title: '빗속의 라이더', desc: '비 오는 날 배달 10건', target: 10, progress: counter('rain') },
  { id: 'owl', icon: '🌙', title: '올빼미 라이더', desc: '심야 배달 10건', target: 10, progress: counter('night') },
  { id: 'perfect', icon: '✨', title: '완벽주의자', desc: '음식 상태 95% 이상 25건', target: 25, progress: counter('perfect') },
  { id: 'urgent', icon: '⏱️', title: '번개 배달', desc: '급한 배달 제시간 5건', target: 5, progress: counter('urgentOnTime') },
  { id: 'safe3', icon: '🛡️', title: '무사고 3일', desc: '3건 이상 · 보행자 사고 0건으로 3일 연속 퇴근', target: 3, progress: (s) => safeDayStreak(s.history) },
  { id: 'safe7', icon: '🏆', title: '무사고 7일', desc: '3건 이상 · 보행자 사고 0건으로 7일 연속 퇴근', target: 7, progress: (s) => safeDayStreak(s.history) },
  { id: 'bigday', icon: '💰', title: '하루 5만 원', desc: '하루 순수익 ₩50,000 이상', target: 50000, progress: (s) => Math.max(0, bestDay(s.history)?.net ?? 0) },
  {
    id: 'everywhere',
    icon: '🗺️',
    title: '수원 한 바퀴',
    desc: '모든 구역에 배달 1건 이상',
    target: 1,
    progress: (s) => (s.districtIds.length > 0 && s.districtIds.every((id) => (s.counters[`district:${id}`] ?? 0) > 0) ? 1 : 0),
  },  { id: 'safestop30', icon: '🚦', title: '안전 운전 습관', desc: '경고 후 안전 정지 · 보행자 양보 누적 30회', target: 30, progress: counter('safeStop') },
  { id: 'clean7', icon: '🏁', title: '무위반 7일', desc: '3건 이상 · 교통 위반 0회로 7일 연속 퇴근', target: 7, progress: (s) => cleanDayStreak(s.history) },
  { id: 'soup', icon: '🍲', title: '국물 장인', desc: '비 오는 날 국물 콜을 안 쏟고 20건 (이벤트 할증)', target: 20, progress: counter('eventSoup') },
  { id: 'snack', icon: '🍗', title: '야식 배달왕', desc: '야식 콜을 따뜻하게 30건 (이벤트 할증)', target: 30, progress: counter('eventSnack') },
];

export function achievementStatuses(stats: CareerStats, unlocked: Readonly<Record<string, number>>): AchievementStatus[] {
  return ACHIEVEMENTS.map((a) => {
    const current = Math.min(a.target, Math.max(0, Math.floor(a.progress(stats))));
    const day = unlocked[a.id];
    return {
      id: a.id,
      icon: a.icon,
      title: a.title,
      desc: a.desc,
      target: a.target,
      current,
      unlocked: day !== undefined || current >= a.target,
      unlockedDay: day,
    };
  });
}

/** Achievements reached now that were not recorded as unlocked yet */
export function newlyUnlocked(stats: CareerStats, unlocked: Readonly<Record<string, number>>): AchievementSpec[] {
  return ACHIEVEMENTS.filter((a) => unlocked[a.id] === undefined && a.progress(stats) >= a.target);
}

export interface DayRecordInput {
  day: number;
  completedCount: number;
  grossIncome: number;
  totalExpenses: number;
  netProfit: number;
  pedestrianAccidentCount: number;
  goalsMet: number;
  goalsTotal: number;
  counters: Readonly<Record<string, number>>;
}

export function makeDayRecord(i: DayRecordInput): DayRecord {
  const n = i.counters[STAR_COUNT_COUNTER] ?? 0;
  const sum = i.counters[STAR_SUM_COUNTER] ?? 0;
  return {
    day: i.day,
    deliveries: i.completedCount,
    income: Math.round(i.grossIncome),
    expenses: Math.round(i.totalExpenses),
    net: Math.round(i.netProfit),
    avgStars: n > 0 ? Math.round((sum / n) * 10) / 10 : null,
    goalsMet: i.goalsMet,
    goalsTotal: i.goalsTotal,
    accidents: i.pedestrianAccidentCount,
    violations: i.counters[VIOLATION_COUNTER] ?? 0,
  };
}

/** Appends a finished day (replacing a record of the same day) and keeps the newest MAX_DAY_HISTORY */
export function appendDay(history: readonly DayRecord[], rec: DayRecord): DayRecord[] {
  const next = history.filter((d) => d.day !== rec.day);
  next.push(rec);
  next.sort((a, b) => a.day - b.day);
  return next.slice(-MAX_DAY_HISTORY);
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parseDayHistory(raw: unknown): DayRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: DayRecord[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (!finite(o.day) || !finite(o.deliveries) || !finite(o.net)) continue;
    const avg = finite(o.avgStars) ? Math.max(1, Math.min(5, o.avgStars)) : null;
    const goalsTotal = finite(o.goalsTotal) ? Math.max(0, Math.floor(o.goalsTotal)) : 0;
    out.push({
      day: Math.max(1, Math.floor(o.day)),
      deliveries: Math.max(0, Math.floor(o.deliveries)),
      income: finite(o.income) ? Math.round(o.income) : 0,
      expenses: finite(o.expenses) ? Math.round(o.expenses) : 0,
      net: Math.round(o.net),
      avgStars: avg,
      goalsMet: finite(o.goalsMet) ? Math.max(0, Math.min(goalsTotal, Math.floor(o.goalsMet))) : 0,
      goalsTotal,
      accidents: finite(o.accidents) ? Math.max(0, Math.floor(o.accidents)) : 0,
      ...(finite(o.violations) ? { violations: Math.max(0, Math.floor(o.violations)) } : {}),
    });
  }
  let merged: DayRecord[] = [];
  for (const d of out) merged = appendDay(merged, d);
  return merged;
}

/** Positive integer counters / unlock days keyed by short strings */
export function parseCountMap(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (finite(v) && v > 0 && k.length > 0 && k.length < 64) out[k] = Math.floor(v);
    }
  }
  return out;
}

/** Working days per week (weekly statement every 7th day) */
export const DAYS_PER_WEEK = 7;

export const weekOfDay = (day: number) => Math.ceil(Math.max(1, day) / DAYS_PER_WEEK);

export interface WeekSummary {
  week: number;
  firstDay: number;
  lastDay: number;
  /** Finished days of the week (oldest first; days not worked are missing) */
  days: DayRecord[];
  deliveries: number;
  income: number;
  expenses: number;
  net: number;
  bestDay: DayRecord | null;
  /** Average of the days' review averages (days with reviews only) */
  avgStars: number | null;
  /** Days with 3+ deliveries and no pedestrian accident */
  safeDays: number;
  /** Achievements unlocked during the week */
  achievements: AchievementStatus[];
}

/** Totals of the week that contains `day` */
export function weekSummary(history: readonly DayRecord[], day: number, achievements: readonly AchievementStatus[] = []): WeekSummary {
  const week = weekOfDay(day);
  const firstDay = (week - 1) * DAYS_PER_WEEK + 1;
  const lastDay = week * DAYS_PER_WEEK;
  const days = history.filter((d) => d.day >= firstDay && d.day <= lastDay).sort((a, b) => a.day - b.day);
  const sum = (f: (d: DayRecord) => number) => days.reduce((acc, d) => acc + f(d), 0);
  const starred = days.filter((d) => d.avgStars !== null);
  return {
    week,
    firstDay,
    lastDay,
    days,
    deliveries: sum((d) => d.deliveries),
    income: sum((d) => d.income),
    expenses: sum((d) => d.expenses),
    net: sum((d) => d.net),
    bestDay: bestDay(days),
    avgStars: starred.length > 0 ? Math.round((starred.reduce((a, d) => a + (d.avgStars ?? 0), 0) / starred.length) * 10) / 10 : null,
    safeDays: days.filter((d) => d.deliveries >= 3 && d.accidents === 0).length,
    achievements: achievements.filter((a) => a.unlockedDay !== undefined && a.unlockedDay >= firstDay && a.unlockedDay <= lastDay),
  };
}

