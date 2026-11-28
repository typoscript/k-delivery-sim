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
  /** Called after every change (the game keeps the list across reloads) */
  public onChange: ((c: NotificationCenter) => void) | null = null;

  private changed(): void {
    this.version++;
    this.onChange?.(this);
  }

  /** Save data: the list (newest first) and the unread count */
  public toSave(): NotificationSave {
    return { v: 1, unread: this.unread, items: this.items.map((n) => ({ icon: n.icon, app: n.app, text: n.text, time: n.time })) };
  }

  /** Restores a saved list (anything malformed is skipped) */
  public restore(raw: unknown): void {
    const save = parseNotificationSave(raw);
    if (!save) return;
    this.items = save.items.map((n, i) => ({ id: i + 1, ...n }));
    this.nextId = this.items.length + 1;
    this.unread = Math.min(save.unread, this.items.length);
    this.version++;
  }

  public push(icon: string, app: string, text: string, time: string): PhoneNotification {
    const n = { id: this.nextId++, icon, app, text, time };
    this.items.unshift(n);
    if (this.items.length > MAX_NOTIFICATIONS) this.items.length = MAX_NOTIFICATIONS;
    this.unread++;
    this.changed();
    return n;
  }

  /** Newest first */
  public list(): readonly PhoneNotification[] {
    return this.items;
  }

  public markAllRead(): void {
    if (this.unread === 0) return;
    this.unread = 0;
    this.changed();
  }

  public clear(): void {
    this.items = [];
    this.unread = 0;
    this.changed();
  }

  public get(id: number): PhoneNotification | undefined {
    return this.items.find((n) => n.id === id);
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Drawer HTML (zoomed phone) */
export function notificationsHtml(c: NotificationCenter): string {
  const rows = c
    .list()
    .map(
      (n) =>
        `<button class="notif-row" data-notif-id="${n.id}"><span class="notif-icon">${n.icon}</span><div class="notif-main"><div class="notif-app">${esc(n.app)} · ${n.time}</div><div class="notif-text">${esc(n.text)}</div></div></button>`,
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

export interface NotificationSave {
  v: 1;
  unread: number;
  items: Array<{ icon: string; app: string; text: string; time: string }>;
}

const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

/** Validates saved notifications (null when it is not a notification save) */
export function parseNotificationSave(raw: unknown): NotificationSave | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { v?: unknown; unread?: unknown; items?: unknown };
  if (r.v !== 1 || !Array.isArray(r.items)) return null;
  const items: NotificationSave['items'] = [];
  for (const it of r.items.slice(0, MAX_NOTIFICATIONS)) {
    const x = it as Record<string, unknown>;
    if (x && str(x.icon, 16) && str(x.app, 60) && str(x.text, 300) && str(x.time, 8)) {
      items.push({ icon: x.icon, app: x.app, text: x.text, time: x.time });
    }
  }
  const unread = typeof r.unread === 'number' && Number.isFinite(r.unread) ? Math.max(0, Math.floor(r.unread)) : 0;
  return { v: 1, unread, items };
}

export const NOTIFICATIONS_STORAGE_KEY = 'k_delivery_notifications_v1';

export function loadNotificationSave(): unknown {
  try {
    const raw = window.localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function storeNotificationSave(save: NotificationSave): void {
  try {
    window.localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(save));
  } catch {
    // storage full / blocked: the list is just not kept
  }
}

/** The phone app a notification opens when tapped (battery / system notices open none) */
export function appOfNotification(app: string): 'weather' | 'messenger' | 'bank' | null {
  if (app === '날씨') return 'weather';
  if (app.startsWith('메신저')) return 'messenger';
  if (app === '뱅크') return 'bank';
  return null;
}

/** 3D phone: which pulled-down notification row a tap at (x, y) hits (same layout as renderNotifications3D) */
export function hitNotification3D(c: NotificationCenter, x: number, y: number, w: number): PhoneNotification | null {
  const list = c.list().slice(0, 7);
  const i = Math.floor((y - 76) / 66);
  if (i < 0 || i >= list.length || x < 10 || x > w - 10) return null;
  const top = 76 + i * 66;
  return y <= top + 58 ? list[i] : null;
}
