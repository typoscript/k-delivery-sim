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

  it('running late, the customer asks where the food is; an apology softens the review', async () => {
    const { generateCustomerReview } = await import('./customerReviews');
    const dm = new DeliveryManager(LOCATIONS);
    const o = dm.availableOrders[0];
    dm.acceptOrder(o.id);
    const m = dm.getMissionById(o.id)!;
    m.pickedUp = true;
    m.phase = 'cargo_loaded';
    dm.stepTimers(m.remainingTimeSec - 30);
    const t = dm.messenger.get(`c:${o.id}`)!;
    expect(t.messages.at(-1)!.text).toContain('언제 오세요');
    expect(t.replies.map((r) => r.id)).toEqual(['sorry', 'traffic']);
    dm.stepTimers(1);
    expect(t.messages.filter((x) => x.text.includes('언제 오세요'))).toHaveLength(1); // asked once
    expect(dm.replyToChat(`c:${o.id}`, 'sorry')).toBe(true);
    expect(m.lateApologized).toBe(true);
    expect(m.chatReplied).toBeFalsy(); // an apology is not a quick-reply tip
    const review = (late: boolean, apologized: boolean) =>
      generateCustomerReview({
        orderNumber: 'A-1',
        shopId: 's',
        shopName: '가게',
        shopEmoji: '🍗',
        menuName: '치킨',
        customerName: '고객',
        unitNumber: '101호',
        foodIntegrity: 92,
        foodTemp: 85,
        foodTempType: 'hot',
        isSpillSensitive: false,
        spillDamageAccum: 0,
        remainingRatio: 0,
        isWalkupVilla: false,
        isRain: false,
        isNight: false,
        deliveryInstruction: 'PHOTO_DOOR',
        createdAt: '12:00',
        late,
        apologized,
      }).stars;
    expect(review(true, false)).toBeLessThan(review(false, false));
    expect(review(true, true)).toBeGreaterThanOrEqual(review(true, false));
  });

  it('shops say when the kitchen is busy; regular customers say hello', () => {
    const dm = new DeliveryManager(LOCATIONS);
    const o = dm.availableOrders[0];
    o.regularCustomer = true;
    dm.acceptOrder(o.id);
    expect(dm.messenger.get(`c:${o.id}`)!.messages.some((x) => x.text.includes('또 뵙네요'))).toBe(true);
    const r = dm.completePosPickup(o.id, true)!;
    if (r.status === 'cooking') {
      const shop = dm.messenger.get(`s:${o.shop.id}`)!;
      expect(shop.messages.at(-1)!.text).toMatch(/조리/);
    }
  });
});

describe('messenger save', () => {
  it('chats survive a save / restore; quick replies are dropped (their orders are gone)', async () => {
    const { parseMessengerSave } = await import('./messenger');
    const m = new Messenger();
    m.post(
      'c:1',
      { kind: 'customer', title: '고객', icon: '🙋', missionId: 'o1' },
      { from: 'them', text: '문 앞에!', time: '12:00' },
      CUSTOMER_REPLIES,
    );
    m.post('notice', { kind: 'notice', title: '민원', icon: '📢' }, { from: 'them', text: '민원', time: '12:01' });
    const copy = new Messenger();
    copy.restore(JSON.parse(JSON.stringify(m.toSave())));
    expect(copy.list().map((t) => t.id)).toEqual(['notice', 'c:1']);
    expect(copy.get('c:1')!.messages[0].text).toBe('문 앞에!');
    expect(copy.get('c:1')!.replies).toHaveLength(0);
    expect(copy.unread).toBe(2);
    // new chats continue after the restored ones
    copy.post('s:1', { kind: 'shop', title: '가게', icon: '🍗' }, { from: 'them', text: '완료', time: '12:02' });
    expect(copy.list()[0].id).toBe('s:1');
    // malformed saves are rejected or cleaned
    expect(parseMessengerSave(null)).toBeNull();
    expect(parseMessengerSave({ v: 2, threads: [] })).toBeNull();
    const cleaned = parseMessengerSave({
      v: 1,
      seq: 3,
      threads: [
        {
          id: 'a',
          kind: 'customer',
          title: 't',
          icon: 'i',
          unread: -5,
          seq: 1,
          messages: [
            { from: 'hacker', text: 'x', time: '1' },
            { from: 'me', text: 'ok', time: '12:00' },
          ],
        },
        { id: 'b', kind: 'weird', title: 't', icon: 'i', messages: [] },
      ],
    })!;
    expect(cleaned).toHaveLength(1);
    expect(cleaned[0].messages).toEqual([{ from: 'me', text: 'ok', time: '12:00' }]);
    expect(cleaned[0].unread).toBe(0);
  });
});
