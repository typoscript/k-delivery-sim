// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { loadGamePageDom } from '../test/domFixture';
import { PhoneMap, PHONE_APP_STORAGE_KEY } from './PhoneMap';
import { Messenger, CUSTOMER_REPLIES } from '../delivery/messenger';
import type { PhoneCallbacks } from './phone/types';

const noop = () => {};
const replies: Array<[string, string]> = [];
const callbacks = new Proxy(
  { onChatReply: (t: string, r: string) => replies.push([t, r]) } as Record<string, unknown>,
  {
    get: (t, k) => (k in t ? t[k as string] : noop),
  },
) as unknown as PhoneCallbacks;

const screen = () => document.querySelector('#rider-phone .phone-screen')!;
const activeDock = () => document.querySelector('#phone-app-dock .dock-app.active')!.getAttribute('data-app');

describe('phone apps (DOM)', () => {
  beforeEach(() => {
    loadGamePageDom();
    replies.length = 0;
  });

  it('the dock switches apps: screens, active button, remembered for the next session', () => {
    const phone = new PhoneMap(callbacks);
    expect(phone.app).toBe('delivery');
    (document.querySelector('[data-app="weather"]') as HTMLButtonElement).click();
    expect(phone.app).toBe('weather');
    expect(activeDock()).toBe('weather');
    expect(screen().classList.contains('app-weather')).toBe(true);
    expect(document.getElementById('phone-weather-app')!.classList.contains('hidden')).toBe(false);
    expect(phone.cycleApp()).toBe('messenger');
    expect(document.getElementById('phone-weather-app')!.classList.contains('hidden')).toBe(true);
    expect(phone.cycleApp()).toBe('bank');
    expect(screen().classList.contains('app-bank')).toBe(true);
    expect(phone.topNav).toBe('earnings'); // the bank shows the earnings sheet
    expect(phone.cycleApp()).toBe('delivery');
    expect(phone.topNav).toBe('calls');
    phone.setApp('messenger');
    expect(window.localStorage.getItem(PHONE_APP_STORAGE_KEY)).toBe('messenger');
    expect(new PhoneMap(callbacks).app).toBe('messenger');
  });

  it('mounting the phone on the handlebar goes back to the delivery app (navigation)', () => {
    const phone = new PhoneMap(callbacks);
    phone.setApp('weather');
    phone.setPlacement('mounted');
    expect(phone.app).toBe('delivery');
  });

  it('messenger: open a chat, answer with a quick reply, unread badge on the dock', () => {
    const phone = new PhoneMap(callbacks);
    const m = new Messenger();
    phone.messenger = m;
    m.post(
      'c:1',
      { kind: 'customer', title: '고객 101호', icon: '🙋' },
      { from: 'them', text: '문 앞에 놔주세요', time: '12:00' },
      CUSTOMER_REPLIES,
    );
    phone.syncDockBadge();
    expect(document.getElementById('dock-msg-badge')!.textContent).toBe('1');
    phone.setApp('messenger');
    phone.syncMessengerApp();
    const app = document.getElementById('phone-messenger-app')!;
    (app.querySelector('[data-thread="c:1"]') as HTMLButtonElement).click();
    expect(app.textContent).toContain('문 앞에 놔주세요');
    expect(m.unread).toBe(0);
    (app.querySelector('[data-reply="ok"]') as HTMLButtonElement).click();
    expect(replies).toEqual([['c:1', 'ok']]);
  });

  it('notification center: tapping the status bar pulls the list down and reads it', () => {
    const phone = new PhoneMap(callbacks);
    phone.notify('🌤️', '날씨', '비가 내리기 시작했어요');
    phone.syncNotifications();
    expect(document.getElementById('sb-notif-badge')!.classList.contains('hidden')).toBe(false);
    document.getElementById('phone-statusbar')!.click();
    const drawer = document.getElementById('phone-notif-drawer')!;
    expect(drawer.classList.contains('hidden')).toBe(false);
    expect(drawer.textContent).toContain('비가 내리기 시작했어요');
    expect(phone.notifications.unread).toBe(0);
    (drawer.querySelector('[data-notif="close"]') as HTMLButtonElement).click();
    expect(drawer.classList.contains('hidden')).toBe(true);
  });

  it('below 15% the phone goes into power saving (dimmed) and leaves a battery notification', () => {
    const phone = new PhoneMap(callbacks);
    phone.setPlacement('in_hand');
    phone.battery = 15.2;
    for (let i = 0; i < 40; i++) phone.stepBattery(0.05, false);
    expect(phone.powerSave).toBe(true);
    expect(document.getElementById('rider-phone')!.classList.contains('power-save')).toBe(true);
    expect(phone.notifications.list()[0].text).toContain('절전 모드');
    phone.setPlacement('mounted');
    for (let i = 0; i < 40; i++) phone.stepBattery(0.05, true); // wireless charging on the handlebar
    expect(phone.powerSave).toBe(false);
  });
});
