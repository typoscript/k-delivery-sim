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
