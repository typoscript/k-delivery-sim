/**
 * Today's goal progress (counters + claimed goals) and the career progress built on it (lifetime counters,
 * finished days, achievements). Owned by DeliveryManager, which keeps the money: claim() only reports the bonus.
 */
import { deliverableDistricts, districtIdAt } from '../data/suwonDistricts';
import { RiderCareerSave } from './RiderCareer';
import {
  ShiftGoalId,
  ShiftGoalSpec,
  ShiftGoalState,
  ShiftGoalStatus,
  goalsForDay,
  goalsToAward,
  shiftGoalStatuses,
} from './ShiftDay';
import {
  AchievementSpec,
  AchievementStatus,
  CareerStats,
  DayRecord,
  DayRecordInput,
  achievementStatuses,
  appendDay,
  makeDayRecord,
  newlyUnlocked,
} from './careerHistory';
import { ActiveMission } from './deliveryTypes';
import { SettlementPay } from './settlementPay';

/** Goal counters one delivery bumps (peak, villa, rain, night, perfect, urgentOnTime, regular, far, district:<id>) */
export function settlementGoalCounters(
  m: ActiveMission,
  pay: Pick<SettlementPay, 'peakBonus' | 'rainBonus' | 'nightBonus' | 'specialBonus'>,
  districtOf: (x: number, z: number) => string = districtIdAt
): string[] {
  const keys: string[] = [];
  if (pay.peakBonus > 0) keys.push('peak');
  if (m.order.customer.residenceKind === 'walkup_villa') keys.push('villa');
  if (pay.rainBonus > 0) keys.push('rain');
  if (pay.nightBonus > 0) keys.push('night');
  if (m.foodIntegrity >= 95) keys.push('perfect');
  if (m.order.special === 'urgent' && pay.specialBonus > 0) keys.push('urgentOnTime');
  if (m.order.regularCustomer) keys.push('regular');
  if (m.order.distanceMeters > 1000) keys.push('far');
  keys.push(`district:${districtOf(m.order.customer.x, m.order.customer.z)}`);
  return keys;
}

export class ShiftProgress {
  /** Today's goal counters (keys starting with `_` are bookkeeping, e.g. the day's review stars) */
  public counters: Record<string, number> = {};
  public readonly claimed = new Set<ShiftGoalId>();
  /** Districts district goals can name (all four in the open world) */
  private readonly districts = deliverableDistricts();

  constructor(private readonly career: RiderCareerSave) {}

  public restore(counters: Readonly<Record<string, number>>, claimed: readonly ShiftGoalId[]): void {
    this.counters = { ...counters };
    this.claimed.clear();
    for (const id of claimed) this.claimed.add(id);
  }

  /** New working day: no counters, nothing claimed */
  public reset(): void {
    this.counters = {};
    this.claimed.clear();
  }

  /** Today's goal specs: 배달 3건, two rotating goals for this day, 무사고 퇴근 */
  public goals(day: number): ShiftGoalSpec[] {
    return goalsForDay(day, this.districts);
  }

  public state(completedCount: number, pedestrianAccidentCount: number): ShiftGoalState {
    return { completedCount, pedestrianAccidentCount, counters: this.counters, claimed: this.claimed };
  }

  public statuses(day: number, completedCount: number, pedestrianAccidentCount: number): ShiftGoalStatus[] {
    return shiftGoalStatuses(this.goals(day), this.state(completedCount, pedestrianAccidentCount));
  }

  /** Goals that pay out now (not yet claimed) */
  public toAward(day: number, completedCount: number, pedestrianAccidentCount: number, moment: 'delivery' | 'clock_out'): ShiftGoalSpec[] {
    return goalsToAward(this.goals(day), this.state(completedCount, pedestrianAccidentCount), moment);
  }

  /** Marks goals claimed and returns their total bonus (the caller pays it) */
  public claim(goals: readonly ShiftGoalSpec[]): number {
    let total = 0;
    for (const g of goals) {
      this.claimed.add(g.id);
      total += g.bonus;
    }
    return total;
  }

  /** Today's goal counter (+ its lifetime total for achievements) */
  public bump(key: string, amount = 1): void {
    this.counters[key] = (this.counters[key] ?? 0) + amount;
    if (!key.startsWith('_')) {
      const life = (this.career.lifetimeCounters ??= {});
      life[key] = (life[key] ?? 0) + amount;
    }
  }

  /** Finished working days, oldest first */
  public get history(): readonly DayRecord[] {
    return this.career.history ?? [];
  }

  /** Closes a working day into the career history */
  public recordDay(day: Omit<DayRecordInput, 'counters'>): void {
    this.career.history = appendDay(this.history, makeDayRecord({ ...day, counters: this.counters }));
  }

  private stats(lifetimeCompleted: number): CareerStats {
    return {
      lifetimeCompleted,
      counters: this.career.lifetimeCounters ?? {},
      history: this.history,
      districtIds: this.districts.map((d) => d.id),
    };
  }

  public achievements(lifetimeCompleted: number): AchievementStatus[] {
    return achievementStatuses(this.stats(lifetimeCompleted), this.career.achievements ?? {});
  }

  /** Records (on `day`) and returns achievements reached since the last call */
  public collectNewAchievements(lifetimeCompleted: number, day: number): AchievementSpec[] {
    const unlocked = (this.career.achievements ??= {});
    const fresh = newlyUnlocked(this.stats(lifetimeCompleted), unlocked);
    for (const a of fresh) unlocked[a.id] = day;
    return fresh;
  }
}
