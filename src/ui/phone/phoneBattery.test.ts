import { describe, expect, it } from 'vitest';
import { APP_DRAIN_MUL, POWER_SAVE_DRAIN_MUL, batteryDrainRate } from './phoneBattery';

describe('phone battery by app', () => {
  it('the delivery app (GPS + live map) drains the most; light apps much less; the pocket only background GPS', () => {
    const hand = (app: 'delivery' | 'weather' | 'messenger' | 'bank') => batteryDrainRate('in_hand', false, app, false);
    expect(hand('delivery')).toBeGreaterThan(hand('messenger'));
    expect(hand('messenger')).toBeGreaterThan(hand('bank'));
    expect(hand('weather') / hand('delivery')).toBeCloseTo(APP_DRAIN_MUL.weather, 5);
    expect(batteryDrainRate('pocket', false, 'weather', false)).toBe(
      batteryDrainRate('pocket', false, 'delivery', false),
    );
    expect(batteryDrainRate('in_hand', true, 'delivery', false)).toBeGreaterThan(hand('delivery')); // zoomed screen
  });

  it('power saving slows the drain', () => {
    expect(
      batteryDrainRate('in_hand', false, 'delivery', true) / batteryDrainRate('in_hand', false, 'delivery', false),
    ).toBeCloseTo(POWER_SAVE_DRAIN_MUL, 5);
  });
});
