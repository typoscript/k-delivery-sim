/**
 * The phone's notification center: weather pushes, new messages and goal / achievement news are kept here after
 * their toast is gone. Tapping the zoomed phone's status bar pulls the list down (newest first). Pure store,
 * unit tested; the drawer HTML is built by `notificationsHtml`.
 */

export interface PhoneNotification {
  id: number;
  icon: string;
  app: string;
  text: string;
  /** Game clock "HH:MM" */
  time: string;
}

const MAX_NOTIFICATIONS = 30;

export class NotificationCenter {
  private items: PhoneNotification[] = [];
  private nextId = 1;
  /** Arrived since the drawer was last opened */
  public unread = 0;
  /** Bumped on every change (UI redraws lazily) */
  public version = 0;

  public push(icon: string, app: string, text: string, time: string): PhoneNotification {
    const n = { id: this.nextId++, icon, app, text, time };
    this.items.unshift(n);
    if (this.items.length > MAX_NOTIFICATIONS) this.items.length = MAX_NOTIFICATIONS;
    this.unread++;
    this.version++;
    return n;
  }

  /** Newest first */
  public list(): readonly PhoneNotification[] {
    return this.items;
  }

  public markAllRead(): void {
    if (this.unread === 0) return;
    this.unread = 0;
    this.version++;
  }

  public clear(): void {
    this.items = [];
    this.unread = 0;
    this.version++;
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Drawer HTML (zoomed phone) */
export function notificationsHtml(c: NotificationCenter): string {
  const rows = c
    .list()
    .map(
      (n) =>
        `<div class="notif-row"><span class="notif-icon">${n.icon}</span><div class="notif-main"><div class="notif-app">${esc(n.app)} · ${n.time}</div><div class="notif-text">${esc(n.text)}</div></div></div>`,
    )
    .join('');
  return `<div class="notif-head"><span>🔔 알림</span><button class="notif-clear" data-notif="clear">모두 지우기</button></div>${
    rows || '<div class="notif-empty">새 알림이 없어요</div>'
  }<button class="notif-close" data-notif="close">▲ 닫기</button>`;
}
