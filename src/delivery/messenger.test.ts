import { describe, expect, it } from 'vitest';
import { CUSTOMER_REPLIES, Messenger, QUICK_REPLY_TIP } from './messenger';
import { DeliveryManager } from './DeliveryManager';
import type { DeliveryLocation } from '../types';

const LOCATIONS: DeliveryLocation[] = [
  { id: 'shop-a', name: '테스트 치킨', x: 0, z: 0, type: 'shop', emoji: '🍗', menus: ['후라이드 치킨'] },
  {
    id: 'home-a',
    name: '테스트 아파트 101동',
    x: 120,
    z: 40,
    type: 'residential',
    emoji: '🏢',
    residenceKind: 'apartment',
  },
  { id: 'home-b', name: '테스트 빌라', x: -90, z: 60, type: 'residential', emoji: '🏠', residenceKind: 'walkup_villa' },
];
const chat = { kind: 'customer' as const, title: '고객', icon: '🙋' };

describe('messenger', () => {
  it('chats keep messages, count unread, list latest first; a quick reply answers once', () => {
    const m = new Messenger();
    m.post('a', chat, { from: 'them', text: '안녕하세요', time: '12:00' });
    m.post('b', { ...chat, kind: 'shop' }, { from: 'them', text: '조리 완료', time: '12:01' });
    m.post('a', chat, { from: 'them', text: '문 앞에 놔주세요', time: '12:02' }, CUSTOMER_REPLIES);
    expect(m.unread).toBe(3);
    expect(m.list().map((t) => t.id)).toEqual(['a', 'b']);
    expect(m.reply('a', 'nope', '12:03')).toBeNull();
    const t = m.reply('a', 'ok', '12:03')!;
    expect(t.messages.at(-1)).toMatchObject({ from: 'me', text: CUSTOMER_REPLIES[0].text });
    expect(t.replies).toHaveLength(0);
    expect(m.reply('a', 'ok', '12:04')).toBeNull(); // answered already
    expect(m.unread).toBe(1); // replying reads the chat
    m.markRead('b');
    expect(m.unread).toBe(0);
  });

  it('keeps the latest 14 chats', () => {
    const m = new Messenger();
    for (let i = 0; i < 20; i++) m.post(`t${i}`, chat, { from: 'them', text: `${i}`, time: '12:00' });
    expect(m.list()).toHaveLength(14);
    expect(m.get('t0')).toBeUndefined();
    expect(m.get('t19')).toBeDefined();
  });

  it('accepting a call opens the customer chat; answering their request pays the 빠른 답장 tip', () => {
    const dm = new DeliveryManager(LOCATIONS);
    const o = dm.availableOrders[0];
    dm.acceptOrder(o.id);
    const t = dm.messenger.get(`c:${o.id}`)!;
    expect(t.kind).toBe('customer');
    expect(t.messages.some((x) => x.text.includes('요청사항'))).toBe(true);
    // a mid-ride request with quick replies
    dm.messenger.post(
      `c:${o.id}`,
      { ...chat, missionId: o.id },
      { from: 'them', text: '문 앞에!', time: '12:00' },
      CUSTOMER_REPLIES,
    );
    expect(dm.replyToChat(`c:${o.id}`, 'eta')).toBe(true);
    expect(dm.getMissionById(o.id)!.chatReplied).toBe(true);
    expect(QUICK_REPLY_TIP).toBeGreaterThan(0);
  });
});
