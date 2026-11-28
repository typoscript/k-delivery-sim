/**
 * Summer heatwave (폭염): on clear summer afternoons the street is scorching. Walking outdoors drains stamina instead
 * of restoring it, resting recovers slowly, and chilled food loses its cold much faster even in the box. An iced
 * ion drink from the convenience store cools the rider down for a while. Pure rules, unit tested.
 */

/** Heatwave hours (game minutes): 12:00 - 16:30 */
export const HEAT_START_MIN = 12 * 60;
export const HEAT_END_MIN = 16 * 60 + 30;
/** Stamina: sprint / stair drain x this, recovery x this */
export const HEAT_DRAIN_MUL = 1.7;
export const HEAT_RECOVER_MUL = 0.45;
/** Walking outdoors in the heat drains this much stamina per second (instead of recovering) */
export const HEAT_WALK_DRAIN = 2.2;
/** Chilled food loses its cold this much faster */
export const HEAT_COLD_FOOD_MUL = 1.6;
/** Iced ion drink: price and how long it keeps the heat off */
export const ION_DRINK_COST = 1300;
export const ION_DRINK_COOL_SEC = 180;

/** True on a clear summer afternoon */
export function heatwaveActive(season: string, weather: string, minuteOfDay: number): boolean {
  return season === 'summer' && weather === 'clear' && minuteOfDay >= HEAT_START_MIN && minuteOfDay < HEAT_END_MIN;
}
