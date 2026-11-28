/**
 * Weekly goals: every week (days 1~7, 8~14, ...) has the delivery goal plus two goals picked for that week. They
 * are checked on the 7th day's clock-out against the whole week and pay a bonus. Pure logic, unit tested.
 */
import type { WeekSummary } from './careerHistory';

export interface WeekGoalSpec {
  id: string;
  icon: string;
  title: string;
  target: number;
  bonus: number;
  /** Progress of a week toward the target */
  progress: (w: WeekSummary) => number;
  /** How to show the progress (₩ / ★ / count) */
  unit: 'count' | 'won' | 'stars';
}

export interface WeekGoalStatus {
  id: string;
  icon: string;
  title: string;
  target: number;
  bonus: number;
  current: number;
  met: boolean;
  unit: WeekGoalSpec['unit'];
}

/** Every week */
export const WEEK_DELIVERIES_GOAL: WeekGoalSpec = {
  id: 'week_deliveries',
  icon: '📦',
  title: '주간 배달 25건',
  target: 25,
  bonus: 20000,
  progress: (w) => w.deliveries,
  unit: 'count',
};

/** Two of these are picked per week */
export const ROTATING_WEEK_GOALS: readonly WeekGoalSpec[] = [
  { id: 'week_safe', icon: '🛡️', title: '무사고 퇴근 5일', target: 5, bonus: 15000, progress: (w) => w.safeDays, unit: 'count' },
  { id: 'week_net', icon: '💰', title: '주간 순수익 ₩200,000', target: 200000, bonus: 20000, progress: (w) => w.net, unit: 'won' },
  { id: 'week_all_days', icon: '📅', title: '7일 모두 출근', target: 7, bonus: 10000, progress: (w) => w.days.length, unit: 'count' },
  { id: 'week_stars', icon: '⭐', title: '평균 별점 4.5 이상', target: 4.5, bonus: 15000, progress: (w) => w.avgStars ?? 0, unit: 'stars' },
];

/** Deterministic 0..1 from the week number (same goals after reloads) */
function weekRand(week: number, salt: number): number {
  let h = (Math.imul(week, 2246822519) ^ Math.imul(salt + 7, 3266489917)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 668265263) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** This week's goals: deliveries + two rotating goals */
export function weekGoalsFor(week: number): WeekGoalSpec[] {
  const pool = [...ROTATING_WEEK_GOALS];
  const first = pool.splice(Math.floor(weekRand(week, 1) * pool.length), 1)[0];
  const second = pool[Math.floor(weekRand(week, 2) * pool.length)];
  return [WEEK_DELIVERIES_GOAL, first, second];
}

/** Week goals from pinned rotating ids (WEEK_DELIVERIES_GOAL first); null when an id no longer exists */
export function weekGoalsFromIds(ids: readonly string[]): WeekGoalSpec[] | null {
  const rotating = ids.map((id) => ROTATING_WEEK_GOALS.find((g) => g.id === id));
  if (rotating.length === 0 || rotating.some((g) => !g)) return null;
  return [WEEK_DELIVERIES_GOAL, ...(rotating as WeekGoalSpec[])];
}

/** Rotating goal ids of a week's goals (what gets pinned in the save) */
export const rotatingWeekGoalIds = (goals: readonly WeekGoalSpec[]) => goals.filter((g) => g !== WEEK_DELIVERIES_GOAL).map((g) => g.id);

export function weekGoalStatuses(w: WeekSummary, goals: readonly WeekGoalSpec[] = weekGoalsFor(w.week)): WeekGoalStatus[] {
  return goals.map((g) => {
    const current = g.progress(w);
    return { id: g.id, icon: g.icon, title: g.title, target: g.target, bonus: g.bonus, unit: g.unit, current, met: current >= g.target };
  });
}

/** Progress text: "18/25", "₩152,000 / ₩200,000", "★ 4.3 / 4.5" */
export function weekGoalProgressText(g: WeekGoalStatus): string {
  if (g.unit === 'won') return `₩${Math.max(0, Math.round(g.current)).toLocaleString()} / ₩${g.target.toLocaleString()}`;
  if (g.unit === 'stars') return `★ ${g.current > 0 ? g.current.toFixed(1) : '-'} / ${g.target.toFixed(1)}`;
  return `${Math.min(g.current, g.target)}/${g.target}`;
}

/** One line for toasts: "📦 18/25 · 💰 ₩152,000 / ₩200,000 · 📅 3/7" */
export function weekGoalsSummaryText(goals: readonly WeekGoalStatus[]): string {
  return goals.map((g) => `${g.met ? '✅' : g.icon} ${weekGoalProgressText(g)}`).join(' · ');
}

/** 0..100 progress toward a goal (for the phone progress bars) */
export function weekGoalProgressPct(g: WeekGoalStatus): number {
  if (g.target <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((g.current / g.target) * 100)));
}
