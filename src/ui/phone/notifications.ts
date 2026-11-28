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

/** 3D phone: the notification list pulled down over the screen (tap the status bar again to close) */
export function renderNotifications3D(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  c: NotificationCenter,
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
  ctx.beginPath();
  ctx.roundRect(0, 34, w, Math.min(h - 80, 92 + c.list().slice(0, 7).length * 66), [0, 0, 18, 18]);
  ctx.fill();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f8fafc';
  ctx.font = '800 16px sans-serif';
  ctx.fillText('🔔 알림', 16, 58);
  const list = c.list().slice(0, 7);
  if (list.length === 0) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px sans-serif';
    ctx.fillText('새 알림이 없어요', 16, 92);
  }
  list.forEach((n, i) => {
    const y = 76 + i * 66;
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.roundRect(10, y, w - 20, 58, 10);
    ctx.fill();
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px sans-serif';
    ctx.fillText(`${n.icon} ${n.app} · ${n.time}`, 20, y + 16);
    ctx.fillStyle = '#f1f5f9';
    ctx.font = '13px sans-serif';
    ctx.fillText(n.text, 20, y + 38, w - 40);
  });
  ctx.restore();
}

/** 3D phone status bar: a 🔔 with the unread count in the middle (tap the status bar to read them) */
export function renderBell3D(ctx: CanvasRenderingContext2D, w: number, unread: number): void {
  if (unread <= 0) return;
  ctx.save();
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.roundRect(w / 2 - 26, 7, 52, 22, 11);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`🔔 ${Math.min(99, unread)}`, w / 2, 18.5);
  ctx.restore();
}
