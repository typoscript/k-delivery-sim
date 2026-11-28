/**
 * The phone's messenger app (메신저): a chat list and an open chat with quick-reply buttons (zoomed phone), and a
 * compact list of the latest messages on the 3D phone. Draws a Messenger (delivery/messenger.ts).
 */
import type { ChatThread, Messenger } from '../../delivery/messenger';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const last = (t: ChatThread) => t.messages[t.messages.length - 1];

/** Screen HTML: the chat list, or one open chat */
export function messengerHtml(m: Messenger, openId: string | null): string {
  const open = openId ? m.get(openId) : undefined;
  if (open) {
    const bubbles = open.messages
      .map(
        (msg) =>
          `<div class="msg ${msg.from}"><div class="msg-bubble">${esc(msg.text)}</div><div class="msg-time">${msg.time}</div></div>`,
      )
      .join('');
    const replies = open.replies
      .map(
        (r) => `<button class="msg-reply" data-reply="${r.id}" data-thread="${esc(open.id)}">${esc(r.text)}</button>`,
      )
      .join('');
    return `
      <div class="msg-head"><button class="msg-back" data-back="1">‹</button><span>${open.icon} ${esc(open.title)}</span></div>
      <div class="msg-log">${bubbles}</div>
      ${replies ? `<div class="msg-replies">${replies}</div>` : ''}`;
  }
  const rows = m
    .list()
    .map((t) => {
      const l = last(t);
      return `<button class="msg-row" data-thread="${esc(t.id)}">
        <span class="msg-row-icon">${t.icon}</span>
        <span class="msg-row-main"><span class="msg-row-title">${esc(t.title)}</span><span class="msg-row-last">${esc(l?.text ?? '')}</span></span>
        <span class="msg-row-side"><span class="msg-time">${l?.time ?? ''}</span>${t.unread > 0 ? `<span class="msg-unread">${t.unread}</span>` : ''}${t.replies.length > 0 ? '<span class="msg-needs-reply">답장</span>' : ''}</span>
      </button>`;
    })
    .join('');
  return `<div class="msg-title">💬 메신저</div>${rows || '<div class="msg-empty">아직 메시지가 없어요 · 콜을 수락하면 고객 채팅방이 열려요</div>'}`;
}

export interface Reply3DButton {
  threadId: string;
  replyId: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Height of the quick-reply panel above the 3D phone's dock */
const REPLY_PANEL_H = 148;

/**
 * 3D phone quick replies: the latest chat waiting for an answer gets its reply buttons in a panel above the dock,
 * so a customer can be answered right on the handlebar (stopped) without zooming the phone. Empty when no chat
 * waits for an answer.
 */
export function messenger3DReplyButtons(m: Messenger, w: number, h: number): Reply3DButton[] {
  const t = m.list().find((x) => x.replies.length > 0);
  if (!t) return [];
  const top = h - 34 - REPLY_PANEL_H;
  return t.replies.slice(0, 2).map((r, i) => ({
    threadId: t.id,
    replyId: r.id,
    text: r.text,
    x: 18,
    y: top + 38 + i * 52,
    w: w - 36,
    h: 44,
  }));
}

/** Which 3D quick-reply button a tap at (x, y) hits, or null */
export function hitMessengerReply3D(m: Messenger, x: number, y: number, w: number, h: number): Reply3DButton | null {
  return (
    messenger3DReplyButtons(m, w, h).find((b) => x >= b.x && x <= b.x + b.w && y >= b.y - 3 && y <= b.y + b.h + 3) ??
    null
  );
}

/** 3D phone: the latest chats (open the zoomed phone to read them), quick replies for a chat waiting for an answer */
export function renderMessenger3D(ctx: CanvasRenderingContext2D, w: number, h: number, m: Messenger): void {
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f8fafc';
  ctx.font = '800 20px sans-serif';
  ctx.fillText('💬 메신저', 18, 62);
  const list = m.list().slice(0, 7);
  if (list.length === 0) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px sans-serif';
    ctx.fillText('아직 메시지가 없어요', 18, 110);
  }
  list.forEach((t, i) => {
    const y = 92 + i * 74;
    ctx.fillStyle = t.unread > 0 ? 'rgba(14,165,233,0.25)' : 'rgba(30,41,59,0.9)';
    ctx.beginPath();
    ctx.roundRect(12, y, w - 24, 64, 12);
    ctx.fill();
    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 15px sans-serif';
    ctx.fillText(`${t.icon} ${t.title}`, 24, y + 20, w - 90);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '13px sans-serif';
    ctx.fillText(last(t)?.text ?? '', 24, y + 44, w - 60);
    if (t.unread > 0) {
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(w - 30, y + 20, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(Math.min(9, t.unread)), w - 30, y + 20.5);
      ctx.textAlign = 'left';
    }
  });
  const buttons = messenger3DReplyButtons(m, w, h);
  if (buttons.length > 0) {
    const t = m.get(buttons[0].threadId)!;
    const top = h - 34 - REPLY_PANEL_H;
    ctx.fillStyle = 'rgba(2, 6, 23, 0.94)';
    ctx.fillRect(0, top, w, REPLY_PANEL_H);
    ctx.fillStyle = '#7dd3fc';
    ctx.font = '700 13px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`↩ ${t.icon} ${t.title} · ${last(t)?.text ?? ''}`, 18, top + 18, w - 36);
    for (const b of buttons) {
      ctx.fillStyle = '#0ea5e9';
      ctx.beginPath();
      ctx.roundRect(b.x, b.y, b.w, b.h, 12);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(b.text, b.x + b.w / 2, b.y + b.h / 2 + 0.5, b.w - 16);
    }
    return;
  }
  ctx.fillStyle = '#94a3b8';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('휴대폰 확대(V)해서 읽기 · 답장할 채팅은 여기에 버튼이 떠요', w / 2, h - 52);
}
