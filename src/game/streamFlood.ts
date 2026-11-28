/**
 * Streams rise in the rain (하천 수위): the water level climbs while it rains - faster during 장마 - and falls again
 * after. Above CLOSE_LEVEL the walkways and stepping stones go under: the walkways close (통제), strollers leave,
 * new bench calls stop and walking there is wading; below OPEN_LEVEL they reopen. Pure logic of game minutes, unit
 * tested; the game applies the effects.
 */

/** Level (0 dry season .. 1 bank-full) at which the walkways close / reopen (hysteresis) */
export const CLOSE_LEVEL = 0.75;
export const OPEN_LEVEL = 0.4;
/** Rise per game minute of rain (full in ~2 hours), x1.6 in 장마; fall per dry minute (~3 hours) */
export const RISE_PER_MIN = 1 / 120;
export const MONSOON_RISE_MUL = 1.6;
export const FALL_PER_MIN = 1 / 180;

export class StreamFlood {
  public level = 0;
  public closed = false;

  /**
   * Advances `dtMin` game minutes of rain / no rain. Returns 'closed' or 'opened' when the walkways change, else
   * null.
   */
  public step(dtMin: number, raining: boolean, monsoon: boolean): 'closed' | 'opened' | null {
    if (dtMin <= 0) return null;
    const rate = raining ? RISE_PER_MIN * (monsoon ? MONSOON_RISE_MUL : 1) : -FALL_PER_MIN;
    this.level = Math.max(0, Math.min(1, this.level + rate * dtMin));
    if (!this.closed && this.level >= CLOSE_LEVEL) {
      this.closed = true;
      return 'closed';
    }
    if (this.closed && this.level <= OPEN_LEVEL) {
      this.closed = false;
      return 'opened';
    }
    return null;
  }

  /** Rising toward closing (shown in the weather app before it closes) */
  public get rising(): boolean {
    return !this.closed && this.level >= OPEN_LEVEL;
  }
}
