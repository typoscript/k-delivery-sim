/**
 * The phone's messenger app (메신저): one chat per customer order, one per shop, and a notice thread (민원 · 알림).
 * Customers message about their order (assignment, mid-ride requests, the review after delivery), shops say when
 * the food is ready, and complaints land in the notices. A customer's request can be answered with a quick reply;
 * answering in time earns a small "빠른 답장" tip at the settlement. Pure logic, unit tested.
 */

export type ThreadKind = 'customer' | 'shop' | 'notice';

export interface ChatMessage {
  from: 'them' | 'me' | 'system';
  text: string;
  /** Game clock "HH:MM" */
  time: string;
}

export interface QuickReply {
  id: string;
  text: string;
}

export interface ChatThread {
  id: string;
  kind: ThreadKind;
  title: string;
  icon: string;
  messages: ChatMessage[];
  unread: number;
  /** Quick replies offered right now (answering clears them) */
  replies: QuickReply[];
  /** Order this chat belongs to (customer chats) */
  missionId?: string;
  /** Ordering of the chat list (latest activity first) */
  seq: number;
}

/** Tip for answering a customer's mid-ride message before the delivery */
export const QUICK_REPLY_TIP = 300;
/** Chats kept (oldest dropped) and messages per chat */
const MAX_THREADS = 14;
const MAX_MESSAGES = 30;

/** Quick replies offered to a customer's mid-ride request */
export const CUSTOMER_REPLIES: readonly QuickReply[] = [
  { id: 'ok', text: '네 알겠습니다! 안전하게 갈게요 🙏' },
  { id: 'eta', text: '지금 가는 중이에요, 곧 도착합니다!' },
];

/** Replies to a customer asking where the late order is (apologizing softens the review) */
export const LATE_REPLIES: readonly QuickReply[] = [
  { id: 'sorry', text: '죄송해요! 곧 도착합니다 🙏' },
  { id: 'traffic', text: '길이 막혀서 조금 늦어요, 정말 죄송합니다' },
];
/** The customer asks once this little time is left */
export const LATE_ASK_SEC = 45;

export class Messenger {
  private readonly threads = new Map<string, ChatThread>();
  private seq = 0;
  /** Bumped on every change (UI redraws lazily) */
  public version = 0;

  /** Adds a message to a chat (created on first use) and optionally offers quick replies */
  public post(
    id: string,
    init: { kind: ThreadKind; title: string; icon: string; missionId?: string },
    msg: ChatMessage,
    replies: readonly QuickReply[] = [],
  ): ChatThread {
    let t = this.threads.get(id);
    if (!t) {
      t = { id, ...init, messages: [], unread: 0, replies: [], seq: 0 };
      this.threads.set(id, t);
    }
    t.messages.push(msg);
    if (t.messages.length > MAX_MESSAGES) t.messages.splice(0, t.messages.length - MAX_MESSAGES);
    if (msg.from !== 'me') t.unread++;
    if (replies.length > 0) t.replies = [...replies];
    t.seq = ++this.seq;
    this.trim();
    this.version++;
    return t;
  }

  /** The rider answers with a quick reply: returns the chat (null when that reply is not offered) */
  public reply(threadId: string, replyId: string, time: string): ChatThread | null {
    const t = this.threads.get(threadId);
    const r = t?.replies.find((x) => x.id === replyId);
    if (!t || !r) return null;
    t.messages.push({ from: 'me', text: r.text, time });
    t.replies = [];
    t.unread = 0;
    t.seq = ++this.seq;
    this.version++;
    return t;
  }

  public markRead(threadId: string): void {
    const t = this.threads.get(threadId);
    if (!t || t.unread === 0) return;
    t.unread = 0;
    this.version++;
  }

  public get(threadId: string): ChatThread | undefined {
    return this.threads.get(threadId);
  }

  /** Chats, latest activity first */
  public list(): ChatThread[] {
    return [...this.threads.values()].sort((a, b) => b.seq - a.seq);
  }

  public get unread(): number {
    let n = 0;
    for (const t of this.threads.values()) n += t.unread;
    return n;
  }

  private trim(): void {
    if (this.threads.size <= MAX_THREADS) return;
    const oldest = [...this.threads.values()].sort((a, b) => a.seq - b.seq)[0];
    this.threads.delete(oldest.id);
  }
}
