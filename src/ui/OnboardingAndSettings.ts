import { GameSettings, GraphicsQuality } from '../types';
import { DeliveryManager } from '../delivery/DeliveryManager';
import { PlayerState } from '../player/PlayerController';

const SETTINGS_STORAGE_KEY = 'k_delivery_settings_v1';
const TUTORIAL_STORAGE_KEY = 'k_delivery_tutorial_done_v1';

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  masterVolume: 0.8,
  voiceNaviEnabled: true,
  mouseSensitivity: 1.0,
  graphicsQuality: 'high',
};

export interface SettingsCallbacks {
  onApplySettings: (settings: GameSettings) => void;
  onTutorialCompleted: () => void;
}

/**
 * Manages:
 * 1. Persistent Game Settings Modal (Master Volume, Korean Voice Navi ON/OFF, Mouse Sensitivity, Graphics Quality)
 * 2. Compact 1-Minute First-Shift Interactive Onboarding Checklist (auto-advances as rider completes first delivery!)
 */
export class OnboardingAndSettings {
  public settings: GameSettings;
  public isSettingsOpen = false;

  private readonly callbacks: SettingsCallbacks;

  // Settings Modal elements
  private readonly openBtn = document.getElementById('open-settings-btn')!;
  private readonly modalBackdrop = document.getElementById('settings-modal')!;
  private readonly volInput = document.getElementById('set-volume') as HTMLInputElement;
  private readonly volValEl = document.getElementById('set-volume-val')!;
  private readonly voiceToggle = document.getElementById('set-voice-navi') as HTMLInputElement;
  private readonly sensInput = document.getElementById('set-sensitivity') as HTMLInputElement;
  private readonly sensValEl = document.getElementById('set-sensitivity-val')!;
  private readonly gfxSelect = document.getElementById('set-graphics') as HTMLSelectElement;

  // Interactive First-Shift Onboarding Guide Card
  private readonly guideCard = document.getElementById('onboarding-card')!;
  private readonly guideStepList = document.getElementById('onboarding-steps')!;
  private readonly guideFill = document.getElementById('onboarding-fill')!;
  private readonly guideSkipBtn = document.getElementById('onboarding-skip-btn')!;

  private tutorialDismissed = false;
  private stepAcceptDone = false;
  private stepMountDone = false;
  private stepLoadDone = false;
  private stepDeliverDone = false;
  private lastGuideFp = '';

  constructor(callbacks: SettingsCallbacks) {
    this.callbacks = callbacks;
    this.settings = this.loadSettings();
    this.tutorialDismissed = this.loadTutorialDone();

    this.syncControlsFromState();

    this.openBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleSettingsModal();
    });

    this.modalBackdrop.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target === this.modalBackdrop) {
        this.closeSettingsModal();
        return;
      }
      const btn = target.closest('button') as HTMLButtonElement | null;
      if (!btn) return;
      if (btn.dataset.action === 'close') {
        this.closeSettingsModal();
      } else if (btn.dataset.action === 'restart_tutorial') {
        this.restartTutorial();
        this.closeSettingsModal();
      }
    });

    this.volInput.addEventListener('input', () => {
      this.settings.masterVolume = Number(this.volInput.value) / 100;
      this.volValEl.textContent = `${Math.round(this.settings.masterVolume * 100)}%`;
      this.persistAndApply();
    });

    this.voiceToggle.addEventListener('change', () => {
      this.settings.voiceNaviEnabled = this.voiceToggle.checked;
      this.persistAndApply();
    });

    this.sensInput.addEventListener('input', () => {
      this.settings.mouseSensitivity = Number(this.sensInput.value);
      this.sensValEl.textContent = `${this.settings.mouseSensitivity.toFixed(1)}x`;
      this.persistAndApply();
    });

    this.gfxSelect.addEventListener('change', () => {
      this.settings.graphicsQuality = this.gfxSelect.value as GraphicsQuality;
      this.persistAndApply();
    });

    this.guideSkipBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dismissTutorial();
    });

    if (this.tutorialDismissed) {
      this.guideCard.classList.add('hidden');
    } else {
      this.guideCard.classList.remove('hidden');
      this.renderOnboarding();
    }
  }

  private loadSettings(): GameSettings {
    try {
      const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!raw) return { ...DEFAULT_GAME_SETTINGS };
      const parsed = JSON.parse(raw) as Partial<GameSettings>;
      return {
        masterVolume:
          typeof parsed.masterVolume === 'number'
            ? Math.max(0, Math.min(1, parsed.masterVolume))
            : DEFAULT_GAME_SETTINGS.masterVolume,
        voiceNaviEnabled:
          typeof parsed.voiceNaviEnabled === 'boolean'
            ? parsed.voiceNaviEnabled
            : DEFAULT_GAME_SETTINGS.voiceNaviEnabled,
        mouseSensitivity:
          typeof parsed.mouseSensitivity === 'number'
            ? Math.max(0.5, Math.min(2.0, parsed.mouseSensitivity))
            : DEFAULT_GAME_SETTINGS.mouseSensitivity,
        graphicsQuality:
          parsed.graphicsQuality === 'high' ||
          parsed.graphicsQuality === 'medium' ||
          parsed.graphicsQuality === 'low'
            ? parsed.graphicsQuality
            : DEFAULT_GAME_SETTINGS.graphicsQuality,
      };
    } catch {
      return { ...DEFAULT_GAME_SETTINGS };
    }
  }

  private loadTutorialDone(): boolean {
    try {
      return window.localStorage.getItem(TUTORIAL_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  private saveTutorialDone(done: boolean): void {
    try {
      window.localStorage.setItem(TUTORIAL_STORAGE_KEY, done ? '1' : '0');
    } catch {
      // ignore
    }
  }

  private syncControlsFromState(): void {
    this.volInput.value = String(Math.round(this.settings.masterVolume * 100));
    this.volValEl.textContent = `${Math.round(this.settings.masterVolume * 100)}%`;
    this.voiceToggle.checked = this.settings.voiceNaviEnabled;
    this.sensInput.value = String(this.settings.mouseSensitivity);
    this.sensValEl.textContent = `${this.settings.mouseSensitivity.toFixed(1)}x`;
    this.gfxSelect.value = this.settings.graphicsQuality;
  }

  private persistAndApply(): void {
    try {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // ignore
    }
    this.callbacks.onApplySettings(this.settings);
  }

  public openSettingsModal(): void {
    this.isSettingsOpen = true;
    this.syncControlsFromState();
    this.modalBackdrop.classList.remove('hidden');
  }

  public closeSettingsModal(): void {
    this.isSettingsOpen = false;
    this.modalBackdrop.classList.add('hidden');
  }

  public toggleSettingsModal(): void {
    if (this.isSettingsOpen) this.closeSettingsModal();
    else this.openSettingsModal();
  }

  public dismissTutorial(): void {
    this.tutorialDismissed = true;
    this.saveTutorialDone(true);
    this.guideCard.classList.add('hidden');
  }

  public restartTutorial(): void {
    this.tutorialDismissed = false;
    this.stepAcceptDone = false;
    this.stepMountDone = false;
    this.stepLoadDone = false;
    this.stepDeliverDone = false;
    this.lastGuideFp = '';
    this.saveTutorialDone(false);
    this.guideCard.classList.remove('hidden');
    this.renderOnboarding();
  }

  /** Tracks live player progress through the 4-step first-shift onboarding checklist */
  public updateOnboarding(player: PlayerState, delivery: DeliveryManager): void {
    if (this.tutorialDismissed) return;

    if (!this.stepAcceptDone && (delivery.activeMissions.length > 0 || delivery.completedCount > 0)) {
      this.stepAcceptDone = true;
    }
    if (!this.stepMountDone && this.stepAcceptDone && player.mode === 'riding') {
      this.stepMountDone = true;
    }
    if (!this.stepLoadDone && (delivery.isCargoLoaded() || delivery.completedCount > 0)) {
      this.stepLoadDone = true;
    }
    if (!this.stepDeliverDone && delivery.completedCount > 0) {
      this.stepDeliverDone = true;
      this.renderOnboarding();
      this.callbacks.onTutorialCompleted();
      window.setTimeout(() => {
        if (this.stepDeliverDone) {
          this.dismissTutorial();
        }
      }, 3600);
      return;
    }

    this.renderOnboarding();
  }

  private renderOnboarding(): void {
    const fp = `${this.stepAcceptDone}:${this.stepMountDone}:${this.stepLoadDone}:${this.stepDeliverDone}`;
    if (fp === this.lastGuideFp) return;
    this.lastGuideFp = fp;

    const steps = [
      {
        done: this.stepAcceptDone,
        label: '① [Tab] → [V] (또는 3D 폰 클릭) 첫 콜 수락',
      },
      {
        done: this.stepMountDone,
        label: '② [F] 오토바이 탑승 후 내비 따라 매장 이동',
      },
      {
        done: this.stepLoadDone,
        label: '③ 하차 → 매장 [E] 픽업 → 배달통 [E] 적재',
      },
      {
        done: this.stepDeliverDone,
        label: '④ 목적지 PIN 해제 후 문 앞 배달 완료!',
      },
    ];

    const doneCount = steps.filter((s) => s.done).length;
    this.guideFill.style.width = `${(doneCount / steps.length) * 100}%`;

    const firstPending = steps.findIndex((s) => !s.done);
    this.guideStepList.innerHTML = steps
      .map((s, idx) => {
        const cls = s.done ? 'ob-step done' : idx === firstPending ? 'ob-step active' : 'ob-step';
        return `<div class="${cls}"><span>${s.done ? '✓' : '○'}</span><span>${s.label}</span></div>`;
      })
      .join('');
  }
}
