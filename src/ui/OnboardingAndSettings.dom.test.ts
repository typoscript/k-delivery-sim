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
