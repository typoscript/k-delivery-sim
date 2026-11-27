import { DispatchOffer } from '../../delivery/OrderDispatchManager';
import { clamp } from '../../types';
import { offerBannerText } from './topbarBanners';
import { fitName } from './canvasText';

/**
 * Compact incoming call banner on the in-world 3D phone (handheld or handlebar): drawn at the top of the screen so
 * the map below stays visible. Tap 수락 / ✕ directly, or the banner body to open the full call card.
 */

/** Banner rectangle on the 3D phone canvas (screen space, below the 34px status bar) */
export function callBannerRect(w: number): { x: number; y: number; w: number; h: number } {
  return { x: 12, y: 42, w: w - 24, h: 78 };
}

const BUTTON_H = 44;
const ACCEPT_W = 74;
const REJECT_W = 44;
const GAP = 8;

function buttonRects(w: number) {
  const r = callBannerRect(w);
  const by = r.y + (r.h - BUTTON_H) / 2 - 2;
  const reject = { x: r.x + r.w - 10 - REJECT_W, y: by, w: REJECT_W, h: BUTTON_H };
  const accept = { x: reject.x - GAP - ACCEPT_W, y: by, w: ACCEPT_W, h: BUTTON_H };
  return { banner: r, accept, reject };
}

const inside = (px: number, py: number, b: { x: number; y: number; w: number; h: number }, pad = 0) =>
  px >= b.x - pad && px <= b.x + b.w + pad && py >= b.y - pad && py <= b.y + b.h + pad;

/** What a tap at canvas (cx, cy) hits on the banner, or null when it is outside it */
export function hitCallBanner(cx: number, cy: number, w: number): 'accept_offer' | 'reject_offer' | 'expand_offer' | null {
  const { banner, accept, reject } = buttonRects(w);
  if (inside(cx, cy, accept, 4)) return 'accept_offer';
  if (inside(cx, cy, reject, 4)) return 'reject_offer';
  if (inside(cx, cy, banner)) return 'expand_offer';
  return null;
}

export function render3DCallBanner(ctx: CanvasRenderingContext2D, w: number, offer: DispatchOffer, elapsedTime: number): void {
  const { banner: r, accept, reject } = buttonRects(w);
  const isSingle = offer.type === 'SINGLE';
  const urgent = offer.remainingOfferSec <= 5;
  // Short shake right after arrival and in the last 5 seconds
  const age = offer.durationOfferSec - offer.remainingOfferSec;
  const shakeX = age < 0.6 || urgent ? Math.sin(elapsedTime * 55) * 3 : 0;
  const { title, meta } = offerBannerText(offer);

  ctx.save();
  ctx.translate(shakeX, 0);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
  ctx.strokeStyle = urgent ? '#ef4444' : isSingle ? '#2dd4bf' : '#a78bfa';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, 16);
  ctx.fill();
  ctx.stroke();

  // Title / meta on the left of the buttons
  const textW = accept.x - r.x - 22;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f8fafc';
  ctx.font = '900 17px sans-serif';
  ctx.fillText(fitName(ctx, '', title, '', textW), r.x + 14, r.y + 28);
  ctx.fillStyle = '#94a3b8';
  ctx.font = 'bold 12.5px sans-serif';
  ctx.fillText(fitName(ctx, '', meta, '', textW), r.x + 14, r.y + 52);

  // 수락 / ✕
  ctx.fillStyle = isSingle ? '#0d9488' : '#7c3aed';
  ctx.beginPath();
  ctx.roundRect(accept.x, accept.y, accept.w, accept.h, 11);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.beginPath();
  ctx.roundRect(reject.x, reject.y, reject.w, reject.h, 11);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 16px sans-serif';
  ctx.fillText('수락', accept.x + accept.w / 2, accept.y + accept.h / 2 + 1);
  ctx.fillStyle = '#cbd5e1';
  ctx.fillText('✕', reject.x + reject.w / 2, reject.y + reject.h / 2 + 1);

  // Countdown bar along the bottom edge
  const frac = clamp(offer.remainingOfferSec / offer.durationOfferSec, 0, 1);
  ctx.fillStyle = 'rgba(148, 163, 184, 0.25)';
  ctx.fillRect(r.x + 10, r.y + r.h - 7, r.w - 20, 3);
  ctx.fillStyle = urgent ? '#ef4444' : isSingle ? '#2dd4bf' : '#a78bfa';
  ctx.fillRect(r.x + 10, r.y + r.h - 7, (r.w - 20) * frac, 3);
  ctx.restore();
}
