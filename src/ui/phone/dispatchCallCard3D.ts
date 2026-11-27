import { DispatchOffer } from '../../delivery/OrderDispatchManager';
import { clamp } from '../../types';

/** Draws the vibrating 20-second circular-progress Baemin Connect style call card on the 3D phone screen */
export function render3DDispatchCallCard(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  offer: DispatchOffer,
  elapsedTime: number
): void {
  const isSingle = offer.type === 'SINGLE';
  const frac = clamp(offer.remainingOfferSec / offer.durationOfferSec, 0, 1);
  const secLeft = Math.max(0, Math.ceil(offer.remainingOfferSec));

  // Dim backdrop over map so call card pops clearly while riding
  ctx.fillStyle = 'rgba(7, 12, 24, 0.72)';
  ctx.fillRect(0, 34, w, h - 34);

  // Subtle phone vibration jitter during first 0.7s of arrival or final 5s urgency!
  const age = offer.durationOfferSec - offer.remainingOfferSec;
  const isVibrating = age < 0.7 || offer.remainingOfferSec <= 5.0;
  const shakeX = isVibrating ? Math.sin(elapsedTime * 55) * 4.2 : 0;

  const cardX = 18 + shakeX;
  const cardW = w - 36;
  const cardH = 344;
  const cardY = (h - cardH) * 0.5 + 8;

  ctx.save();
  ctx.fillStyle = '#0f172a';
  ctx.strokeStyle = isSingle ? '#2dd4bf' : '#a78bfa';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardW, cardH, 24);
  ctx.fill();
  ctx.stroke();

  // Header delivery type badge
  ctx.fillStyle = isSingle ? '#0d9488' : '#7c3aed';
  ctx.beginPath();
  ctx.roundRect(cardX + 16, cardY + 18, 178, 32, 16);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 14.5px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(isSingle ? '🚀 한집배달 (직행)' : '🛵 알뜰배달 (2건)', cardX + 105, cardY + 34);

  // 20-Second Circular Progress Ring Timer (top right of card)
  const ringCx = cardX + cardW - 44;
  const ringCy = cardY + 46;
  const ringR = 26;
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(ringCx, ringCy, ringR, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle =
    offer.remainingOfferSec <= 5 ? '#ef4444' : offer.remainingOfferSec <= 10 ? '#f59e0b' : '#2dd4bf';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(ringCx, ringCy, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = '900 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(String(secLeft), ringCx, ringCy + 1);

  // Total Payout Fee
  ctx.fillStyle = '#34d399';
  ctx.font = '900 36px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`₩${offer.totalFee.toLocaleString()}`, cardX + 18, cardY + 86);

  // A rival rider near the shop will take the call if we wait
  if (offer.rival) {
    ctx.fillStyle = '#fb923c';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`🛵 경쟁 라이더 ${Math.round(offer.rival.distM)}m`, cardX + cardW - 16, cardY + 86);
    ctx.textAlign = 'left';
  }

  // Time limit & total distance subline
  ctx.fillStyle = offer.totalRainBonus > 0 ? '#38bdf8' : '#94a3b8';
  ctx.font = 'bold 13.5px sans-serif';
  const metaLine =
    offer.totalRainBonus > 0
      ? `제한 ${offer.timeLimitSec}초 · ${offer.totalDistanceMeters}m · 🌧️할증포함`
      : `제한시간 ${offer.timeLimitSec}초 · 총 거리 ${offer.totalDistanceMeters}m`;
  ctx.fillText(metaLine, cardX + 18, cardY + 116);

  // Orders breakdown box
  ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.beginPath();
  ctx.roundRect(cardX + 16, cardY + 134, cardW - 32, 128, 14);
  ctx.fill();

  offer.orders.forEach((o, i) => {
    const oy = cardY + 158 + i * 56;
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'left';
    const prefix = offer.orders.length > 1 ? `${i + 1}. ` : '';
    ctx.fillText(`${prefix}${o.shop.emoji} ${o.shop.name} [#${o.orderNumber}]`, cardX + 28, oy);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '600 13.5px sans-serif';
    ctx.fillText(`→ ${o.customer.emoji} ${o.customer.name} ${o.unitNumber}`, cardX + 28, oy + 23);
  });

  // Bottom Split Touch Buttons on 3D Phone: [거절] (left) & [👆 콜 수락] (right) — directly clickable in 3D!
  // Reject button (x: 34..128, y: cardY+276..cardY+326)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.beginPath();
  ctx.roundRect(cardX + 16, cardY + 276, 94, 50, 14);
  ctx.fill();
  ctx.fillStyle = '#cbd5e1';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('거절', cardX + 63, cardY + 301);

  // Accept button (x: 138..326, y: cardY+276..cardY+326)
  ctx.fillStyle = isSingle ? '#0d9488' : '#7c3aed';
  ctx.beginPath();
  ctx.roundRect(cardX + 120, cardY + 276, cardW - 136, 50, 14);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = '900 17.5px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('👆 바로 터치 수락', cardX + 120 + (cardW - 136) / 2, cardY + 301);

  ctx.restore();
}
