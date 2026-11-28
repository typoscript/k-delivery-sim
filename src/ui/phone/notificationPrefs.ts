/**
 * Notification settings (설정 `O` → 🔔 알림): which phone notifications arrive at all (weather pushes, messenger,
 * goal news) and 🔕 방해 금지 - while riding, pushes land silently in the notification center (bell badge) instead
 * of popping up over the road. Battery / system notices always arrive. Pure logic, unit tested.
 */

export interface NotificationPrefs {
  weather: boolean;
  messenger: boolean;
  goals: boolean;
  /** 방해 금지: no pop-ups while riding (they still land in the notification center) */
  quietRiding: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  weather: true,
  messenger: true,
  goals: true,
  quietRiding: false,
};

export type NotificationCategory = 'weather' | 'messenger' | 'goals' | 'system';

/** Category of a notification by the app that sent it ('날씨', '메신저 · 고객', '뱅크', '배터리' ...) */
export function categoryOfApp(app: string): NotificationCategory {
  if (app === '날씨') return 'weather';
  if (app.startsWith('메신저')) return 'messenger';
  if (app === '뱅크') return 'goals';
  return 'system';
}

/**
 * What happens to a notification: 'show' (stored + may pop up), 'quiet' (stored, no pop-up: 방해 금지 while riding)
 * or 'off' (its category is turned off: dropped)
 */
export function notificationDelivery(
  prefs: NotificationPrefs,
  app: string,
  riding: boolean,
): 'show' | 'quiet' | 'off' {
  const cat = categoryOfApp(app);
  if (cat !== 'system' && !prefs[cat]) return 'off';
  return prefs.quietRiding && riding ? 'quiet' : 'show';
}

/** Validates saved notification settings (missing / wrong fields fall back to the defaults) */
export function parseNotificationPrefs(raw: unknown): NotificationPrefs {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const pick = (k: keyof NotificationPrefs) => (typeof r[k] === 'boolean' ? (r[k] as boolean) : DEFAULT_NOTIFICATION_PREFS[k]);
  return { weather: pick('weather'), messenger: pick('messenger'), goals: pick('goals'), quietRiding: pick('quietRiding') };
}
