/**
 * The phone's weather app (날씨 앱): an HTML screen for the zoomed phone and a canvas version for the 3D phone in the
 * hand / on the handlebar. Both draw the same WeatherReport (see game/weatherReport.ts).
 */
import type { WeatherReport } from '../../game/weatherReport';

export type PhoneApp = 'delivery' | 'weather' | 'messenger';

/** Apps on the dock, in order ([Y] cycles through them) */
export const PHONE_APPS: ReadonlyArray<{ id: PhoneApp; label: string }> = [
  { id: 'delivery', label: '🛵 배달' },
  { id: 'weather', label: '🌤️ 날씨' },
  { id: 'messenger', label: '💬 메신저' },
];

/** Height of the 3D phone's dock strip at the bottom of the screen (clear of the camera notch at the top) */
export const DOCK3D_H = 34;

/** The 3D phone's dock: a strip at the bottom of the screen, one pill per app (x range) */
export function dock3DLayout(w: number): Array<{ id: PhoneApp; label: string; x0: number; x1: number }> {
  const x0 = w * 0.12;
  const pill = (w * 0.76) / PHONE_APPS.length;
  return PHONE_APPS.map((a, i) => ({ ...a, x0: x0 + pill * i, x1: x0 + pill * (i + 1) }));
}

/** Which dock pill a tap at (x, y) on the 3D screen (height h) hits, or null */
export function hitDock3D(x: number, y: number, w: number, h: number): PhoneApp | null {
  if (y < h - DOCK3D_H - 4) return null;
  return dock3DLayout(w).find((p) => x >= p.x0 && x < p.x1)?.id ?? null;
}

/** Draws the dock pills over the 3D phone's status bar (the open app highlighted, unread badges) */
export function renderDock3D(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  app: PhoneApp,
  unread: Partial<Record<PhoneApp, number>> = {},
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(15,23,42,0.6)';
  ctx.fillRect(0, h - DOCK3D_H, w, DOCK3D_H);
  const top = h - DOCK3D_H + 5;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 11px sans-serif';
  for (const p of dock3DLayout(w)) {
    const active = p.id === app;
    ctx.fillStyle = active ? 'rgba(248,250,252,0.95)' : 'rgba(15,23,42,0.55)';
    ctx.beginPath();
    ctx.roundRect(p.x0 + 3, top, p.x1 - p.x0 - 6, 24, 12);
    ctx.fill();
    ctx.fillStyle = active ? '#0f172a' : '#e2e8f0';
    ctx.fillText(p.label, (p.x0 + p.x1) / 2, top + 12.5);
    const n = unread[p.id] ?? 0;
    if (n > 0 && !active) {
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(p.x1 - 8, top + 2, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 8px sans-serif';
      ctx.fillText(String(Math.min(9, n)), p.x1 - 8, top + 2.5);
      ctx.font = 'bold 11px sans-serif';
    }
  }
  ctx.restore();
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Screen HTML of the weather app (zoomed phone) */
export function weatherAppHtml(r: WeatherReport): string {
  const alerts = r.alerts
    .map(
      (a) =>
        `<div class="wx-alert ${a.level}"><span class="wx-alert-icon">${a.icon}</span><div><div class="wx-alert-title">${esc(a.title)}</div><div class="wx-alert-detail">${esc(a.detail)}</div></div></div>`,
    )
    .join('');
  const hourly = r.hourly
    .map(
      (h) =>
        `<div class="wx-hour"><span>${h.label}</span><span class="wx-hour-icon">${h.icon}</span><span>${h.tempC}°</span></div>`,
    )
    .join('');
  const t = r.tomorrow;
  return `
    <div class="wx-head">
      <div class="wx-place">수원시 · ${r.season.emoji} ${r.season.label} ${r.season.day}/${r.season.days}일차 · 근무 ${r.workDay}일차</div>
      <div class="wx-now"><span class="wx-now-icon">${r.icon}</span><span class="wx-temp">${r.tempC}°</span></div>
      <div class="wx-label">${r.label} · ${r.clock}</div>
      <div class="wx-sun">🌅 일출 ${r.sunrise} · 🌇 일몰 ${r.sunset}</div>
    </div>
    <div class="wx-section-title">시간별 예보</div>
    <div class="wx-hourly">${hourly}</div>
    <div class="wx-section-title">오늘의 라이더 특보</div>
    <div class="wx-alerts">${alerts || '<div class="wx-alert info"><span class="wx-alert-icon">✅</span><div><div class="wx-alert-title">특보 없음</div><div class="wx-alert-detail">달리기 좋은 날씨예요</div></div></div>'}</div>
    <div class="wx-section-title">내일</div>
    <div class="wx-tomorrow">
      <span>${t.seasonEmoji} ${t.seasonLabel}${t.monsoon ? ' · ☔ 장마' : ''}</span>
      <span>${esc(t.note)}</span>
      <span>강수 ${t.rainPct}%${t.snowPct > 0 ? ` · 눈 ${t.snowPct}%` : ''}</span>
    </div>`;
}

/** Draws the weather app on the 3D phone's canvas (in the hand / on the handlebar) */
export function renderWeatherApp3D(ctx: CanvasRenderingContext2D, w: number, h: number, r: WeatherReport): void {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  const top =
    r.mode === 'clear' ? '#38bdf8' : r.mode === 'cloudy' ? '#64748b' : r.mode === 'rain' ? '#334155' : '#94a3b8';
  bg.addColorStop(0, top);
  bg.addColorStop(1, '#0f172a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const s = w / 400;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e2e8f0';
  ctx.font = `600 ${16 * s}px sans-serif`;
  ctx.fillText(`수원시 · ${r.season.emoji} ${r.season.label} ${r.season.day}/${r.season.days}일차`, w / 2, 70 * s);
  ctx.font = `${64 * s}px sans-serif`;
  ctx.fillText(r.icon, w / 2 - 70 * s, 150 * s);
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 ${64 * s}px sans-serif`;
  ctx.fillText(`${r.tempC}°`, w / 2 + 50 * s, 152 * s);
  ctx.font = `600 ${20 * s}px sans-serif`;
  ctx.fillText(`${r.label} · ${r.clock}`, w / 2, 215 * s);
  // hourly strip
  const n = r.hourly.length;
  r.hourly.forEach((hh, i) => {
    const x = (w / (n + 1)) * (i + 1);
    ctx.font = `${13 * s}px sans-serif`;
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(hh.label, x, 262 * s);
    ctx.font = `${22 * s}px sans-serif`;
    ctx.fillText(hh.icon, x, 292 * s);
    ctx.font = `600 ${13 * s}px sans-serif`;
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(`${hh.tempC}°`, x, 322 * s);
  });
  // up to four warnings
  ctx.textAlign = 'left';
  r.alerts.slice(0, 4).forEach((a, i) => {
    const y = 370 * s + i * 62 * s;
    ctx.fillStyle =
      a.level === 'danger'
        ? 'rgba(220,38,38,0.85)'
        : a.level === 'warn'
          ? 'rgba(234,88,12,0.8)'
          : 'rgba(30,64,175,0.75)';
    ctx.beginPath();
    ctx.roundRect(18 * s, y, w - 36 * s, 52 * s, 12 * s);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${16 * s}px sans-serif`;
    ctx.fillText(`${a.icon} ${a.title}`, 32 * s, y + 18 * s, w - 64 * s);
    ctx.font = `${12 * s}px sans-serif`;
    ctx.fillStyle = '#f1f5f9';
    ctx.fillText(a.detail, 32 * s, y + 38 * s, w - 64 * s);
  });
  ctx.textAlign = 'center';
  ctx.fillStyle = '#cbd5e1';
  ctx.font = `${13 * s}px sans-serif`;
  ctx.fillText(`내일 ${r.tomorrow.seasonEmoji} ${r.tomorrow.note} · 강수 ${r.tomorrow.rainPct}%`, w / 2, h - 60 * s);
}
