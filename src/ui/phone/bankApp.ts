/**
 * The phone's 라이더 뱅크 app on the 3D phone: wallet, today's net and deliveries, and today's goals. The zoomed
 * phone shows the full earnings sheet (정산 · 리뷰 · 커리어) instead (deliverySheet).
 */
import type { DeliveryManager } from '../../delivery/DeliveryManager';

export function renderBank3D(ctx: CanvasRenderingContext2D, w: number, h: number, delivery: DeliveryManager): void {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#0f766e');
  bg.addColorStop(1, '#0f172a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ccfbf1';
  ctx.font = '700 15px sans-serif';
  ctx.fillText('💳 라이더 뱅크', 20, 62);
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 34px sans-serif';
  ctx.fillText(`₩${delivery.totalEarnings.toLocaleString()}`, 20, 104);
  ctx.fillStyle = '#99f6e4';
  ctx.font = '13px sans-serif';
  ctx.fillText(`지갑 잔액 · ${delivery.shiftDay}일차 배달 ${delivery.completedCount}건`, 20, 134);

  ctx.fillStyle = '#f8fafc';
  ctx.font = '700 15px sans-serif';
  ctx.fillText('오늘의 목표', 20, 178);
  delivery.getShiftGoals().slice(0, 5).forEach((g, i) => {
    const y = 200 + i * 62;
    ctx.fillStyle = g.claimed ? 'rgba(16,185,129,0.35)' : 'rgba(15,23,42,0.6)';
    ctx.beginPath();
    ctx.roundRect(14, y, w - 28, 52, 12);
    ctx.fill();
    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 13px sans-serif';
    ctx.fillText(`${g.claimed ? '✅' : g.failed ? '✕' : g.icon} ${g.title}`, 26, y + 18, w - 120);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#5eead4';
    ctx.fillText(`+₩${g.bonus.toLocaleString()}`, w - 24, y + 18);
    ctx.textAlign = 'left';
    const p = Math.min(1, g.progressPct / 100);
    ctx.fillStyle = 'rgba(148,163,184,0.35)';
    ctx.fillRect(26, y + 34, w - 52, 6);
    ctx.fillStyle = g.claimed ? '#10b981' : '#2dd4bf';
    ctx.fillRect(26, y + 34, (w - 52) * p, 6);
  });
  ctx.textAlign = 'center';
  ctx.fillStyle = '#94a3b8';
  ctx.font = '12px sans-serif';
  ctx.fillText('휴대폰 확대(V) → 정산 · 리뷰 · 커리어 · 🏁 퇴근', w / 2, h - 52);
}
