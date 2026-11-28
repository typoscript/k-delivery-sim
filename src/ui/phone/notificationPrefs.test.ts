import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATION_PREFS,
  categoryOfApp,
  notificationDelivery,
  parseNotificationPrefs,
} from './notificationPrefs';

describe('notification settings', () => {
  it('sorts notifications by the app that sent them', () => {
    expect(categoryOfApp('날씨')).toBe('weather');
    expect(categoryOfApp('메신저 · 고객 101호')).toBe('messenger');
    expect(categoryOfApp('뱅크')).toBe('goals');
    expect(categoryOfApp('배터리')).toBe('system');
  });

  it('a category turned off drops its notifications; system notices always arrive', () => {
    const prefs = { ...DEFAULT_NOTIFICATION_PREFS, weather: false };
    expect(notificationDelivery(prefs, '날씨', false)).toBe('off');
    expect(notificationDelivery(prefs, '메신저 · 고객', false)).toBe('show');
    expect(notificationDelivery({ ...prefs, messenger: false, goals: false }, '배터리', false)).toBe('show');
  });

  it('방해 금지: quiet only while riding', () => {
    const prefs = { ...DEFAULT_NOTIFICATION_PREFS, quietRiding: true };
    expect(notificationDelivery(prefs, '날씨', true)).toBe('quiet');
    expect(notificationDelivery(prefs, '날씨', false)).toBe('show');
    expect(notificationDelivery(DEFAULT_NOTIFICATION_PREFS, '날씨', true)).toBe('show');
  });

  it('saved settings: wrong or missing fields fall back to the defaults', () => {
    expect(parseNotificationPrefs(undefined)).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(parseNotificationPrefs({ weather: false, goals: 'no', quietRiding: true })).toEqual({
      ...DEFAULT_NOTIFICATION_PREFS,
      weather: false,
      quietRiding: true,
    });
  });
});
