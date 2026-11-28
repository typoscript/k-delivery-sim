import { GameSettings, GraphicsQuality } from '../types';
import { DeliveryManager } from '../delivery/DeliveryManager';
import { PlayerState } from '../player/PlayerController';
import { SaveBackup, applyBackup, backupFileName, buildBackup, parseBackup } from '../game/saveBackup';

const SETTINGS_STORAGE_KEY = 'k_delivery_settings_v1';
const TUTORIAL_STORAGE_KEY = 'k_delivery_tutorial_done_v1';
/** Second guide stage (working day: peak time, daily goals, clock-out), saved separately so riders who
 *  finished the first-shift guide before it existed still see it once */
const SHIFT_GUIDE_STORAGE_KEY = 'k_delivery_shift_guide_done_v1';
/** Third stage (the phone's apps: weather, messenger, bank), saved on its own so every rider sees it once */
const APPS_GUIDE_STORAGE_KEY = 'k_delivery_phone_apps_guide_done_v1';

/** Extra live state the guide watches (from the game loop) */
export interface OnboardingWatch {
  /** The phone shows the 💳 뱅크 app (정산 · 목표) */
  financeTabOpen: boolean;
  /** The game clock is in a lunch / dinner rush */
  isPeakTime: boolean;
  /** The app open on the phone, and whether the phone is out of the pocket */
  phoneApp?: 'delivery' | 'weather' | 'messenger' | 'bank';
  phoneOut?: boolean;
}

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  masterVolume: 0.8,
  voiceNaviEnabled: true,
  mouseSensitivity: 1.0,
  graphicsQuality: 'high',
  autoResolution: true,
  powerSaving: true,
};

export interface SettingsCallbacks {
  onApplySettings: (settings: GameSettings) => void;
  onTutorialCompleted: () => void;
  onOpenDistrictSelector?: () => void;
  /** A backup was loaded into storage (the game reloads to use it) */
  onSaveImported?: () => void;
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
  private readonly autoResToggle = document.getElementById('set-auto-res') as HTMLInputElement | null;
  private readonly powerSaveToggle = document.getElementById('set-power-save') as HTMLInputElement | null;
  private readonly importFileEl = document.getElementById('set-import-file') as HTMLInputElement;
  private readonly saveStatusEl = document.getElementById('set-save-status')!;

  // Interactive First-Shift Onboarding Guide Card
  private readonly guideCard = document.getElementById('onboarding-card')!;
  private readonly guideStepList = document.getElementById('onboarding-steps')!;
  private readonly guideFill = document.getElementById('onboarding-fill')!;
  private readonly guideSkipBtn = document.getElementById('onboarding-skip-btn')!;
  private readonly guideTitle = document.getElementById('onboarding-title')!;

  private tutorialDismissed = false;
  private stepAcceptDone = false;
  private stepMountDone = false;
  private stepLoadDone = false;
  private stepDeliverDone = false;
  private lastGuideFp = '';
  /** Second stage: working day guide (shown after the first-shift guide) */
  private shiftGuideDone = false;
  private shiftStepPeakDone = false;
  private shiftStepGoalsDone = false;
  private shiftStepBonusDone = false;
  private shiftStepClockOutDone = false;
  private shiftGuideStartDay = -1;
  private shiftGuideClosing = false;
  /** Third stage: the phone's apps */
  private appsGuideDone = false;
  private appsSeen = new Set<string>();
  private appsGuideClosing = false;

  constructor(callbacks: SettingsCallbacks) {
    this.callbacks = callbacks;
    this.settings = this.loadSettings();
    this.tutorialDismissed = this.loadTutorialDone();
    this.shiftGuideDone = this.loadFlag(SHIFT_GUIDE_STORAGE_KEY);
    this.appsGuideDone = this.loadFlag(APPS_GUIDE_STORAGE_KEY);

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
      } else if (btn.dataset.action === 'open_districts') {
        this.closeSettingsModal();
        this.callbacks.onOpenDistrictSelector?.();
      } else if (btn.dataset.action === 'restart_tutorial') {
        this.restartTutorial();
        this.closeSettingsModal();
      } else if (btn.dataset.action === 'export_save') {
        this.exportSave();
      } else if (btn.dataset.action === 'import_save') {
        this.importFileEl.click();
      }
    });

    this.importFileEl.addEventListener('change', () => {
      const file = this.importFileEl.files?.[0];
      this.importFileEl.value = '';
      if (file) void file.text().then((text) => this.importSave(text));
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

    this.autoResToggle?.addEventListener('change', () => {
      this.settings.autoResolution = this.autoResToggle!.checked;
      this.persistAndApply();
    });

    this.powerSaveToggle?.addEventListener('change', () => {
      this.settings.powerSaving = this.powerSaveToggle!.checked;
      this.persistAndApply();
    });

    this.guideSkipBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dismissTutorial();
    });

    if (this.tutorialDismissed && this.shiftGuideDone && this.appsGuideDone) {
      this.guideCard.classList.add('hidden');
    } else {
      this.guideCard.classList.remove('hidden');
      this.renderOnboarding();
    }
  }

  private loadFlag(key: string): boolean {
    try {
      return window.localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  }

  private saveFlag(key: string, done: boolean): void {
    try {
      window.localStorage.setItem(key, done ? '1' : '0');
    } catch {
      // ignore
    }
  }

  /** The guide card currently shows the working-day stage */
  private get inShiftStage(): boolean {
    return this.tutorialDismissed && !this.shiftGuideDone;
  }

  /** The guide card currently shows the phone-apps stage (after the working-day stage) */
  private get inAppsStage(): boolean {
    return this.tutorialDismissed && this.shiftGuideDone && !this.appsGuideDone;
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
        autoResolution:
          typeof parsed.autoResolution === 'boolean' ? parsed.autoResolution : DEFAULT_GAME_SETTINGS.autoResolution,
        powerSaving: typeof parsed.powerSaving === 'boolean' ? parsed.powerSaving : DEFAULT_GAME_SETTINGS.powerSaving,
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
    if (this.autoResToggle) this.autoResToggle.checked = this.settings.autoResolution;
    if (this.powerSaveToggle) this.powerSaveToggle.checked = this.settings.powerSaving;
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

  /** Downloads every saved key as one backup file */
  public exportSave(): SaveBackup {
    const backup = buildBackup(window.localStorage, new Date().toISOString());
    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = backupFileName(backup.savedAt);
    a.click();
    URL.revokeObjectURL(a.href);
    this.saveStatusEl.textContent = `💾 ${a.download} 저장됨`;
    return backup;
  }

  /**
   * Loads a backup file's text: checked first, then the rider confirms (it replaces the current save) and the game
   * reloads with it. Returns whether it was applied.
   */
  public importSave(text: string, confirmFn: (msg: string) => boolean = (m) => window.confirm(m)): boolean {
    const parsed = parseBackup(text);
    if (!parsed.ok) {
      this.saveStatusEl.textContent = `⚠️ 불러올 수 없어요: ${parsed.reason}`;
      return false;
    }
    const when = parsed.backup.savedAt ? parsed.backup.savedAt.slice(0, 16).replace('T', ' ') : '날짜 모름';
    if (!confirmFn(`${when} 백업으로 지금 세이브를 덮어쓸까요? (지금 진행은 사라져요)`)) return false;
    applyBackup(window.localStorage, parsed.backup);
    this.saveStatusEl.textContent = '📂 불러왔어요 · 다시 시작합니다';
    this.callbacks.onSaveImported?.();
    return true;
  }

  public toggleSettingsModal(): void {
    if (this.isSettingsOpen) this.closeSettingsModal();
    else this.openSettingsModal();
  }

  /** Skip / finish: the first-shift stage hands over to the working-day stage, which then closes the card */
  public dismissTutorial(): void {
    if (this.inAppsStage) {
      this.appsGuideDone = true;
      this.saveFlag(APPS_GUIDE_STORAGE_KEY, true);
      this.guideCard.classList.add('hidden');
      return;
    }
    if (this.inShiftStage) {
      this.shiftGuideDone = true;
      this.saveFlag(SHIFT_GUIDE_STORAGE_KEY, true);
      this.lastGuideFp = '';
      if (this.appsGuideDone) this.guideCard.classList.add('hidden');
      else this.renderOnboarding();
      return;
    }
    this.tutorialDismissed = true;
    this.saveTutorialDone(true);
    this.lastGuideFp = '';
    if (this.shiftGuideDone && this.appsGuideDone) {
      this.guideCard.classList.add('hidden');
    } else {
      this.renderOnboarding();
    }
  }

  public restartTutorial(): void {
    this.tutorialDismissed = false;
    this.stepAcceptDone = false;
    this.stepMountDone = false;
    this.stepLoadDone = false;
    this.stepDeliverDone = false;
    this.shiftGuideDone = false;
    this.shiftStepPeakDone = false;
    this.shiftStepGoalsDone = false;
    this.shiftStepBonusDone = false;
    this.shiftStepClockOutDone = false;
    this.shiftGuideStartDay = -1;
    this.appsGuideDone = false;
    this.appsSeen.clear();
    this.lastGuideFp = '';
    this.saveTutorialDone(false);
    this.saveFlag(SHIFT_GUIDE_STORAGE_KEY, false);
    this.saveFlag(APPS_GUIDE_STORAGE_KEY, false);
    this.guideCard.classList.remove('hidden');
    this.renderOnboarding();
  }

  /** Tracks live player progress through the 4-step first-shift onboarding checklist */
  public updateOnboarding(player: PlayerState, delivery: DeliveryManager, watch: OnboardingWatch): void {
    if (this.inAppsStage) {
      this.updateAppsGuide(watch);
      return;
    }
    if (this.inShiftStage) {
      this.updateShiftGuide(delivery, watch);
      return;
    }
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

  /** Working-day guide: peak time, today's goals in the 💳 뱅크 app, goal bonuses, clocking out */
  private updateShiftGuide(delivery: DeliveryManager, watch: OnboardingWatch): void {
    if (this.shiftGuideStartDay < 0) this.shiftGuideStartDay = delivery.shiftDay;
    if (watch.isPeakTime || delivery.peakDeliveries > 0) this.shiftStepPeakDone = true;
    if (watch.financeTabOpen) this.shiftStepGoalsDone = true;
    if (delivery.missionBonusTotal > 0 || delivery.getShiftGoals().some((g) => g.claimed)) this.shiftStepBonusDone = true;
    if (delivery.shiftDay > this.shiftGuideStartDay) {
      // Clocking out implies the rider found the goals and the finance tab too
      this.shiftStepClockOutDone = this.shiftStepGoalsDone = this.shiftStepBonusDone = true;
    }
    const allDone = this.shiftStepPeakDone && this.shiftStepGoalsDone && this.shiftStepBonusDone && this.shiftStepClockOutDone;
    this.renderOnboarding();
    if (allDone && !this.shiftGuideClosing) {
      this.shiftGuideClosing = true;
      window.setTimeout(() => {
        this.shiftGuideClosing = false;
        if (this.inShiftStage) this.dismissTutorial();
      }, 3600);
    }
  }

  /** Phone apps guide: each app opened once (switching with [Y] or the dock) */
  private updateAppsGuide(watch: OnboardingWatch): void {
    if (watch.phoneOut && watch.phoneApp) this.appsSeen.add(watch.phoneApp);
    this.renderOnboarding();
    const allDone = ['weather', 'messenger', 'bank'].every((a) => this.appsSeen.has(a));
    if (allDone && !this.appsGuideClosing) {
      this.appsGuideClosing = true;
      window.setTimeout(() => {
        this.appsGuideClosing = false;
        if (this.inAppsStage) this.dismissTutorial();
      }, 3600);
    }
  }

  private renderOnboarding(): void {
    if (this.inAppsStage) {
      this.renderAppsGuide();
      return;
    }
    const shift = this.inShiftStage;
    const fp = shift
      ? `shift:${this.shiftStepPeakDone}:${this.shiftStepGoalsDone}:${this.shiftStepBonusDone}:${this.shiftStepClockOutDone}`
      : `${this.stepAcceptDone}:${this.stepMountDone}:${this.stepLoadDone}:${this.stepDeliverDone}`;
    if (fp === this.lastGuideFp) return;
    this.lastGuideFp = fp;
    this.guideTitle.textContent = shift ? '📅 근무 하루 가이드' : '🎓 첫 출근 1분 가이드';

    const steps = shift
      ? [
          {
            done: this.shiftStepPeakDone,
            label: '① 상단 시계: 점심 11:00·저녁 17:00 피크엔 콜 2배 + 건당 +₩1,000 (밤 19시~ 심야 할증)',
          },
          {
            done: this.shiftStepGoalsDone,
            label: '② 휴대폰 💳 뱅크 앱([Y] 또는 앱 독)에서 오늘의 목표 확인',
          },
          {
            done: this.shiftStepBonusDone,
            label: '③ 목표 달성 시 보너스 즉시 지급 (배달 3건 + 매일 바뀌는 목표 2개)',
          },
          {
            done: this.shiftStepClockOutDone,
            label: '④ 하루를 마치면 💳 뱅크 앱 🏁 퇴근하기 → 무사고 보너스 · 다음 날 출근',
          },
        ]
      : [
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

    this.renderSteps(steps);
  }

  private renderAppsGuide(): void {
    const seen = (a: string) => this.appsSeen.has(a);
    const fp = `apps:${[...this.appsSeen].sort().join(',')}`;
    if (fp === this.lastGuideFp) return;
    this.lastGuideFp = fp;
    this.guideTitle.textContent = '📱 휴대폰 앱 가이드';
    this.renderSteps([
      { done: seen('weather') || seen('messenger') || seen('bank'), label: '① [Tab]으로 휴대폰을 꺼내고 [Y] (또는 화면 아래 앱 독)로 앱 바꾸기' },
      { done: seen('weather'), label: '② 🌤️ 날씨 앱: 오늘의 특보·시간별 예보 확인 (비 예보면 정비소 🧥 우비)' },
      { done: seen('messenger'), label: '③ 💬 메신저: 고객·가게 메시지 확인 — 고객 요청에 빠른 답장하면 +₩300' },
      { done: seen('bank'), label: '④ 💳 뱅크 앱: 정산·오늘의 목표 확인, 하루를 마치면 🏁 퇴근하기' },
    ]);
  }

  private renderSteps(steps: ReadonlyArray<{ done: boolean; label: string }>): void {
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
