/** Clock-out: daily / weekly goal bonuses, the day record and the shift recap */
import type { DeliveryManager } from './DeliveryManager';
import { SHIFT_START_MINUTE } from '../game/GameClock';
import { ShiftGoalSpec, emptyShift } from './ShiftDay';
import { ClockOutResult, ShiftRecap } from './deliveryTypes';
import {
  DAYS_PER_WEEK,
  DayRecord,
  appendDay,
  makeDayRecord,
  nextAchievement,
  previousDay,
  safeDayStreak,
  weekSummary,
} from './careerHistory';
import { WeekGoalStatus, weekGoalStatuses } from './weeklyGoals';

/** Pays goals that are due now (after a delivery / at clock-out) into the ledger and wallet */
export function awardDueGoals(
  host: DeliveryManager,
  moment: 'delivery' | 'clock_out',
): { goals: ShiftGoalSpec[]; bonus: number } {
  const goals = host.progress.toAward(host.shiftDay, host.completedCount, host.pedestrianAccidentCount, moment);
  const bonus = host.progress.claim(goals);
  host.missionBonusTotal += bonus;
  host.totalEarnings += bonus;
  return { goals, bonus };
}

/** Finished days plus today's work so far as a provisional record (week goals counted "if the day ended now") */
export function historyWithToday(host: DeliveryManager): DayRecord[] {
  const today = host.getDailyLedger();
  const goalsNow = host.getShiftGoals();
  return appendDay(
    host.progress.history,
    makeDayRecord({
      day: host.shiftDay,
      completedCount: today.completedCount,
      grossIncome: today.grossIncome,
      totalExpenses: today.totalExpenses,
      netProfit: today.netProfit,
      pedestrianAccidentCount: today.pedestrianAccidentCount,
      goalsMet: goalsNow.filter((g) => g.claimed).length,
      goalsTotal: goalsNow.length,
      counters: host.progress.counters,
    }),
  );
}

/**
 * 퇴근: pays clock-out goals, closes today's ledger and starts the next working day at the shift start
 * time with an empty ledger and fresh goals. Not allowed while orders are still being delivered.
 */
export function clockOut(host: DeliveryManager): ClockOutResult | null {
  if (host.activeMissions.length > 0) return null;
  const awardedAtClockOut = host.awardDueGoals('clock_out').goals;
  const day = host.shiftDay;
  // Week end: check the week's goals (including today) and pay their bonus into today's ledger
  let weekGoals: WeekGoalStatus[] | null = null;
  let weeklyBonus = 0;
  if (day % DAYS_PER_WEEK === 0) {
    const withToday = historyWithToday(host);
    weekGoals = weekGoalStatuses(weekSummary(withToday, day), host.weekGoalSpecs(), 0);
    weeklyBonus = weekGoals.filter((g) => g.met).reduce((a, g) => a + g.bonus, 0);
    host.weeklyBonusTotal += weeklyBonus;
    host.totalEarnings += weeklyBonus;
  }
  const ledger = host.getDailyLedger();
  const goals = host.getShiftGoals();
  const previous = previousDay(host.progress.history, day);
  host.progress.recordDay({
    day,
    completedCount: ledger.completedCount,
    grossIncome: ledger.grossIncome,
    totalExpenses: ledger.totalExpenses,
    netProfit: ledger.netProfit,
    pedestrianAccidentCount: ledger.pedestrianAccidentCount,
    goalsMet: goals.filter((g) => g.claimed).length,
    goalsTotal: goals.length,
  });
  // Achievements the finished day completes (streaks, best day) count for this day
  const newAtClockOut = host.progress.collectNewAchievements(host.lifetimeCompleted, day);
  const statuses = host.getAchievements();
  const recap: ShiftRecap = {
    previous,
    safeStreak: safeDayStreak(host.progress.history),
    achievementsToday: statuses.filter((a) => a.unlockedDay === day),
    newAtClockOut,
    next: nextAchievement(statuses),
    week: day % DAYS_PER_WEEK === 0 ? weekSummary(host.progress.history, day, statuses) : null,
    weekGoals,
    weeklyBonus,
  };

  host.shiftDay = day + 1;
  host.shiftClockMinute = SHIFT_START_MINUTE;
  host.progress.reset();
  host.restoreLedger(emptyShift(host.shiftDay, SHIFT_START_MINUTE).ledger);
  host.persistCareer();
  host.refreshAvailableOrders();
  return { day, ledger, goals, awardedAtClockOut, nextDay: host.shiftDay, recap };
}
