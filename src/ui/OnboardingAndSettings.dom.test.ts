// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGamePageDom } from '../test/domFixture';
import { OnboardingAndSettings } from './OnboardingAndSettings';
import type { DeliveryManager } from '../delivery/DeliveryManager';
import type { PlayerState } from '../player/PlayerController';

const callbacks = { onApplySettings: () => {}, onTutorialCompleted: () => {} };
const player = {} as PlayerState;
const delivery = {} as DeliveryManager;
const title = () => document.getElementById('onboarding-title')!.textContent;
const doneSteps = () => document.querySelectorAll('#onboarding-steps .ob-step.done').length;
const hidden = () => document.getElementById('onboarding-card')!.classList.contains('hidden');

describe('onboarding guide (DOM)', () => {
  beforeEach(() => {
    loadGamePageDom();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('after the first-shift and working-day guides, the phone apps guide walks through each app once', () => {
    window.localStorage.setItem('k_delivery_tutorial_done_v1', '1');
    window.localStorage.setItem('k_delivery_shift_guide_done_v1', '1');
    const ob = new OnboardingAndSettings(callbacks);
    expect(hidden()).toBe(false);
    expect(title()).toBe('📱 휴대폰 앱 가이드');
    const watch = (app: 'delivery' | 'weather' | 'messenger' | 'bank', out = true) => ({
      financeTabOpen: false,
      isPeakTime: false,
      phoneApp: app,
      phoneOut: out,
    });
    ob.updateOnboarding(player, delivery, watch('weather', false)); // phone in the pocket: does not count
    expect(doneSteps()).toBe(0);
    ob.updateOnboarding(player, delivery, watch('weather'));
    expect(doneSteps()).toBe(2); // switched apps + the weather app
    ob.updateOnboarding(player, delivery, watch('messenger'));
    ob.updateOnboarding(player, delivery, watch('bank'));
    expect(doneSteps()).toBe(4);
    vi.advanceTimersByTime(4000);
    expect(hidden()).toBe(true);
    expect(window.localStorage.getItem('k_delivery_phone_apps_guide_done_v1')).toBe('1');
  });

  it('a rider who finished every guide sees no card; restarting the tutorial starts from the first guide', () => {
    for (const k of [
      'k_delivery_tutorial_done_v1',
      'k_delivery_shift_guide_done_v1',
      'k_delivery_phone_apps_guide_done_v1',
    ]) {
      window.localStorage.setItem(k, '1');
    }
    const ob = new OnboardingAndSettings(callbacks);
    expect(hidden()).toBe(true);
    ob.restartTutorial();
    expect(hidden()).toBe(false);
    expect(title()).toBe('🎓 첫 출근 1분 가이드');
    expect(window.localStorage.getItem('k_delivery_phone_apps_guide_done_v1')).toBe('0');
  });

  it('save backup: exports the saved keys and imports a checked backup after the rider confirms', () => {
    window.localStorage.setItem('k_delivery_rider_career_v1', JSON.stringify({ walletBalance: 777 }));
    let imported = 0;
    const ob = new OnboardingAndSettings({ ...callbacks, onSaveImported: () => imported++ });
    URL.createObjectURL = () => 'blob:test';
    URL.revokeObjectURL = () => {};
    const backup = ob.exportSave();
    expect(backup.data.k_delivery_rider_career_v1).toContain('777');
    expect(document.getElementById('set-save-status')!.textContent).toContain('k-delivery-save-');

    // a broken file is refused with a reason, nothing changes
    expect(ob.importSave('{not json', () => true)).toBe(false);
    expect(document.getElementById('set-save-status')!.textContent).toContain('불러올 수 없어요');

    window.localStorage.setItem('k_delivery_rider_career_v1', JSON.stringify({ walletBalance: 1 }));
    expect(ob.importSave(JSON.stringify(backup), () => false)).toBe(false); // the rider said no
    expect(window.localStorage.getItem('k_delivery_rider_career_v1')).toContain('"walletBalance":1');
    expect(ob.importSave(JSON.stringify(backup), () => true)).toBe(true);
    expect(window.localStorage.getItem('k_delivery_rider_career_v1')).toContain('777');
    expect(imported).toBe(1);
  });
});

describe('notification settings (DOM)', () => {
  beforeEach(() => loadGamePageDom());

  it('toggles are saved, reloaded and reach the phone', async () => {
    const { PhoneMap } = await import('./PhoneMap');
    const applied: unknown[] = [];
    const ob = new OnboardingAndSettings({ ...callbacks, onApplySettings: (s) => applied.push(s.notifications) });
    const toggle = (key: string, on: boolean) => {
      const el = document.getElementById(`set-notif-${key}`) as HTMLInputElement;
      el.checked = on;
      el.dispatchEvent(new Event('change'));
    };
    toggle('weather', false);
    toggle('quietRiding', true);
    expect(ob.settings.notifications).toMatchObject({ weather: false, quietRiding: true, messenger: true });
    expect(applied.length).toBeGreaterThan(0);

    // a fresh start reads them back into the toggles
    const again = new OnboardingAndSettings(callbacks);
    expect(again.settings.notifications.weather).toBe(false);

    const phone = new PhoneMap(new Proxy({}, { get: () => () => {} }) as never);
    phone.notifPrefs = () => again.settings.notifications;
    expect(phone.notify('🌤️', '날씨', '비가 와요')).toBe('off');
    expect(phone.notifications.list()).toHaveLength(0);
    phone.ridingNow = true;
    expect(phone.notify('💬', '메신저 · 고객', '문 앞에요')).toBe('quiet');
    expect(phone.quietNow).toBe(true);
    expect(phone.notifications.unread).toBe(1);
  });
});

describe('settings saved by older versions', () => {
  beforeEach(() => loadGamePageDom());

  it('a settings save from before the notification options gets them all on, 방해 금지 off', () => {
    window.localStorage.setItem(
      'k_delivery_settings_v1',
      JSON.stringify({ masterVolume: 0.3, voiceNaviEnabled: false, mouseSensitivity: 1.4, graphicsQuality: 'low' }),
    );
    const ob = new OnboardingAndSettings(callbacks);
    expect(ob.settings.masterVolume).toBe(0.3);
    expect(ob.settings.graphicsQuality).toBe('low');
    expect(ob.settings.notifications).toEqual({ weather: true, messenger: true, goals: true, quietRiding: false });
    expect((document.getElementById('set-notif-quietRiding') as HTMLInputElement).checked).toBe(false);
  });
});

describe('ambience volume (DOM)', () => {
  beforeEach(() => loadGamePageDom());

  it('the slider sets and saves the ambience level; older settings get 100%', () => {
    window.localStorage.setItem('k_delivery_settings_v1', JSON.stringify({ masterVolume: 0.5 }));
    const applied: number[] = [];
    const ob = new OnboardingAndSettings({ ...callbacks, onApplySettings: (s) => applied.push(s.ambienceVolume) });
    expect(ob.settings.ambienceVolume).toBe(1);
    expect(document.getElementById('set-ambience-val')!.textContent).toBe('100%');
    const slider = document.getElementById('set-ambience') as HTMLInputElement;
    slider.value = '35';
    slider.dispatchEvent(new Event('input'));
    expect(ob.settings.ambienceVolume).toBe(0.35);
    expect(applied.at(-1)).toBe(0.35);
    expect(new OnboardingAndSettings(callbacks).settings.ambienceVolume).toBe(0.35);
  });
});

describe('accessibility settings (DOM)', () => {
  beforeEach(() => loadGamePageDom());

  it('toggles are saved and reach the game; older settings get everything off', () => {
    window.localStorage.setItem('k_delivery_settings_v1', JSON.stringify({ masterVolume: 0.5 }));
    const applied: unknown[] = [];
    const ob = new OnboardingAndSettings({ ...callbacks, onApplySettings: (s) => applied.push(s.accessibility) });
    expect(ob.settings.accessibility).toEqual({ reduceMotion: false, largeText: false, colorSafe: false });
    for (const key of ['reduceMotion', 'colorSafe']) {
      const el = document.getElementById(`set-a11y-${key}`) as HTMLInputElement;
      el.checked = true;
      el.dispatchEvent(new Event('change'));
    }
    expect(applied.at(-1)).toEqual({ reduceMotion: true, largeText: false, colorSafe: true });
    expect(new OnboardingAndSettings(callbacks).settings.accessibility.colorSafe).toBe(true);
  });
});
