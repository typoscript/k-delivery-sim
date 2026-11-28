/**
 * In-game clock that drives day / night, dusk and dawn lighting and delivery demand.
 * 1 real second = 1 game minute (a full day takes 24 real minutes). Pure logic, unit tested.
 */

export const DAY_MINUTES = 24 * 60;
export const GAME_MINUTES_PER_SECOND = 1;
/** Shift starts just before the lunch rush so the first peak arrives within a minute */
export const SHIFT_START_MINUTE = 10 * 60 + 40;
/** Peak-time surcharge added to every call generated during a lunch / dinner rush */
export const PEAK_SURCHARGE_BONUS = 1000;

// Dusk and dawn: lighting blends over an hour, "night" (surcharge, lamps) is the darker half
const TWILIGHT_MIN = 60;

/** When dawn and dusk begin (game minutes); the seasons move them (long summer days, early winter nights) */
export interface SunTimes {
  dawnStart: number;
  duskStart: number;
}
/** Year-round default: dawn 05:30~06:30, dusk 18:30~19:30 */
export const DEFAULT_SUN: SunTimes = { dawnStart: 5 * 60 + 30, duskStart: 18 * 60 + 30 };
/** `N` key: jump to this time when switching to day / night */
export const DAY_JUMP_MINUTE = 7 * 60;
export const NIGHT_JUMP_MINUTE = 20 * 60;

export type DemandPhaseId = 'dawn' | 'morning' | 'lunch_peak' | 'afternoon' | 'dinner_peak' | 'evening';

export interface DemandPhase {
  id: DemandPhaseId;
  label: string;
  emoji: string;
  /** Minute of day this phase starts (inclusive) and ends (exclusive) */
  startMin: number;
  endMin: number;
  isPeak: boolean;
  /** Multiplier on the wait between call offers (< 1 = calls come faster) */
  offerIntervalMul: number;
  /** Extra fee on every call generated in this phase */
  peakBonus: number;
  /** Multiplier on the kitchen cooking wait at pickup (busy kitchens during rushes) */
  cookingMul: number;
}

export const DEMAND_PHASES: readonly DemandPhase[] = [
  { id: 'dawn', label: '새벽', emoji: '🌌', startMin: 0, endMin: 6 * 60, isPeak: false, offerIntervalMul: 2.0, peakBonus: 0, cookingMul: 1 },
  { id: 'morning', label: '오전', emoji: '🌅', startMin: 6 * 60, endMin: 11 * 60, isPeak: false, offerIntervalMul: 1.3, peakBonus: 0, cookingMul: 1 },
  { id: 'lunch_peak', label: '점심 피크', emoji: '🔥', startMin: 11 * 60, endMin: 13 * 60 + 30, isPeak: true, offerIntervalMul: 0.45, peakBonus: PEAK_SURCHARGE_BONUS, cookingMul: 1.4 },
  { id: 'afternoon', label: '오후 한산', emoji: '☕', startMin: 13 * 60 + 30, endMin: 17 * 60, isPeak: false, offerIntervalMul: 1.2, peakBonus: 0, cookingMul: 1 },
  { id: 'dinner_peak', label: '저녁 피크', emoji: '🔥', startMin: 17 * 60, endMin: 20 * 60 + 30, isPeak: true, offerIntervalMul: 0.45, peakBonus: PEAK_SURCHARGE_BONUS, cookingMul: 1.4 },
  { id: 'evening', label: '야간', emoji: '🌙', startMin: 20 * 60 + 30, endMin: DAY_MINUTES, isPeak: false, offerIntervalMul: 0.9, peakBonus: 0, cookingMul: 1 },
];

/** Wraps any minute value into [0, 1440) */
export function wrapMinute(min: number): number {
  return ((min % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
}

export function demandPhaseAt(minute: number): DemandPhase {
  const m = wrapMinute(minute);
  return DEMAND_PHASES.find((p) => m >= p.startMin && m < p.endMin) ?? DEMAND_PHASES[0];
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** 0 = full day, 1 = full night; smooth hour-long ramps through dusk and dawn (default 18:30~19:30 / 05:30~06:30) */
export function nightnessAt(minute: number, sun: SunTimes = DEFAULT_SUN): number {
  const m = wrapMinute(minute);
  const duskEnd = sun.duskStart + TWILIGHT_MIN;
  const dawnEnd = sun.dawnStart + TWILIGHT_MIN;
  if (m >= duskEnd || m < sun.dawnStart) return 1;
  if (m >= dawnEnd && m < sun.duskStart) return 0;
  if (m >= sun.duskStart) return smooth((m - sun.duskStart) / TWILIGHT_MIN);
  return 1 - smooth((m - sun.dawnStart) / TWILIGHT_MIN);
}

/** Night for gameplay (night surcharge, street lamps, review context): the darker half of dusk / dawn */
export function isNightAt(minute: number, sun: SunTimes = DEFAULT_SUN): boolean {
  return nightnessAt(minute, sun) >= 0.5;
}

export function formatClock(minute: number): string {
  const m = Math.floor(wrapMinute(minute));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export class GameClock {
  /** Minute of day, fractional */
  public minute: number;
  /** Dawn / dusk of the current season */
  public sun: SunTimes = DEFAULT_SUN;

  constructor(startMinute = SHIFT_START_MINUTE) {
    this.minute = wrapMinute(startMinute);
  }

  public advance(dtSec: number): void {
    this.minute = wrapMinute(this.minute + Math.max(0, dtSec) * GAME_MINUTES_PER_SECOND);
  }

  public jumpTo(minute: number): void {
    this.minute = wrapMinute(minute);
  }

  /** `N` key: skip to the next morning when it is night, otherwise to the evening */
  public toggleDayNight(): boolean {
    // the usual 07:00 / 20:00, pushed past the season's twilight (a winter 07:00 is still dark)
    this.jumpTo(
      this.isNight
        ? Math.max(DAY_JUMP_MINUTE, this.sun.dawnStart + TWILIGHT_MIN + 10)
        : Math.max(NIGHT_JUMP_MINUTE, this.sun.duskStart + TWILIGHT_MIN + 10)
    );
    return this.isNight;
  }

  public get isNight(): boolean {
    return isNightAt(this.minute, this.sun);
  }

  public get nightness(): number {
    return nightnessAt(this.minute, this.sun);
  }

  public get phase(): DemandPhase {
    return demandPhaseAt(this.minute);
  }

  public get label(): string {
    return formatClock(this.minute);
  }
}
