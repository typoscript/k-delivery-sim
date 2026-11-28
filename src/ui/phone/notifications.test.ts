import { describe, expect, it } from 'vitest';
import { NotificationCenter, notificationsHtml } from './notifications';

describe('phone notification center', () => {
  it('keeps the latest 30 notifications newest first, counts unread until opened', () => {
    const c = new NotificationCenter();
    for (let i = 0; i < 35; i++) c.push('🌤️', '날씨', `알림 ${i}`, '12:00');
    expect(c.list()).toHaveLength(30);
    expect(c.list()[0].text).toBe('알림 34');
    expect(c.unread).toBe(35);
    c.markAllRead();
    expect(c.unread).toBe(0);
    const html = notificationsHtml(c);
    expect(html).toContain('알림 34');
    expect(html).toContain('모두 지우기');
    c.clear();
    expect(c.list()).toHaveLength(0);
    expect(notificationsHtml(c)).toContain('새 알림이 없어요');
  });

  it('escapes notification text', () => {
    const c = new NotificationCenter();
    c.push('💬', '메신저', '<b>hi</b>', '12:00');
    expect(notificationsHtml(c)).toContain('&lt;b&gt;hi&lt;/b&gt;');
  });
});

describe('notification save', () => {
  it('round-trips the list and drops junk', async () => {
    const { parseNotificationSave, appOfNotification } = await import('./notifications');
    const c = new NotificationCenter();
    c.push('🌤️', '날씨', '비', '12:00');
    c.push('💬', '메신저 · 고객', '안녕하세요', '12:01');
    const again = new NotificationCenter();
    again.restore(JSON.parse(JSON.stringify(c.toSave())));
    expect(again.list().map((n) => n.text)).toEqual(['안녕하세요', '비']);
    expect(again.unread).toBe(2);
    expect(parseNotificationSave({ v: 1, unread: 'x', items: [{ icon: 1 }, { icon: '🔋', app: '배터리', text: 'ok', time: '12:00' }] })).toEqual({
      v: 1,
      unread: 0,
      items: [{ icon: '🔋', app: '배터리', text: 'ok', time: '12:00' }],
    });
    expect(parseNotificationSave(null)).toBeNull();
    expect(appOfNotification('뱅크')).toBe('bank');
    expect(appOfNotification('배터리')).toBeNull();
  });
});
