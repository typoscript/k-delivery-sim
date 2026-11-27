import type { RouteRoadworks } from '../delivery/deliveryTypes';
import { TurnGuidance } from '../world/RoadNavigator';
import { UpcomingCameraAlert } from '../types';

/**
 * Korean Turn-by-Turn & Enforcement Voice Navigator using native browser Web Speech API (`ko-KR`).
 * Zero audio asset footprint (0 KB), non-blocking, with smart anti-spam deduplication & priority cues.
 */
/** Distance from a construction zone on the route at which the slow-down warning is spoken */
export const ROADWORK_WARN_DIST_M = 90;

export class VoiceNavigator {
  private roadworkTargetKey: string | null = null;
  private roadworkDetourAnnounced = false;
  private readonly roadworkWarned = new Set<string>();
  public enabled = true;
  public muted = false;
  public volume = 0.85;

  private readonly supported: boolean;
  private koVoice: SpeechSynthesisVoice | null = null;
  private lastSpokenText = '';
  private lastSpokenAt = 0;

  // Deduplication state
  private lastTurnKey = '';
  private lastTurnAt = 0;
  private lastCameraId = '';
  private lastCameraOverSpeedAt = 0;

  constructor() {
    this.supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
    if (this.supported) {
      this.pickKoreanVoice();
      window.speechSynthesis.addEventListener?.('voiceschanged', () => {
        this.pickKoreanVoice();
      });
    }
  }

  private pickKoreanVoice(): void {
    if (!this.supported) return;
    try {
      const voices = window.speechSynthesis.getVoices();
      this.koVoice =
        voices.find((v) => v.lang.toLowerCase() === 'ko-kr') ??
        voices.find((v) => v.lang.toLowerCase().startsWith('ko')) ??
        null;
    } catch {
      this.koVoice = null;
    }
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled && this.supported) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted && this.supported) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
  }

  public speak(text: string, priority: 'normal' | 'high' = 'normal'): void {
    if (!this.supported || !this.enabled || this.muted || this.volume <= 0.02) return;
    const now = performance.now();
    // Deduplicate identical messages within 5.5s, and throttle normal cues to >= 2.8s apart
    if (text === this.lastSpokenText && now - this.lastSpokenAt < 5500) return;
    if (priority === 'normal' && now - this.lastSpokenAt < 2800) return;

    try {
      const synth = window.speechSynthesis;
      if (priority === 'high') {
        synth.cancel();
      } else if (synth.speaking) {
        return;
      }

      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'ko-KR';
      if (this.koVoice) {
        utter.voice = this.koVoice;
      }
      utter.rate = 1.12; // Crisp Korean navigation cadence
      utter.pitch = 1.04;
      utter.volume = this.volume;

      this.lastSpokenText = text;
      this.lastSpokenAt = now;
      synth.speak(utter);
    } catch {
      // SpeechSynthesis blocked or unavailable
    }
  }

  /** Speaks Korean turn-by-turn guidance while riding with an active A* navigation target */
  public updateTurnGuidance(
    guidance: TurnGuidance | null,
    targetKey: string | null,
    isRiding: boolean,
    inCorridor: boolean
  ): void {
    if (!isRiding || inCorridor || !guidance || !targetKey) return;
    const now = performance.now();

    if (guidance.direction === 'arrive' && guidance.totalDistance <= 28) {
      const key = `${targetKey}:arrive`;
      if (key !== this.lastTurnKey) {
        this.lastTurnKey = key;
        this.lastTurnAt = now;
        this.speak('잠시 후 목적지 부근입니다. 안전하게 정차하세요.');
      }
      return;
    }

    if (
      (guidance.direction === 'left' ||
        guidance.direction === 'right' ||
        guidance.direction === 'uturn') &&
      guidance.distanceToTurn <= 52 &&
      guidance.distanceToTurn >= 8
    ) {
      const distBucket = guidance.distanceToTurn <= 22 ? 'near' : 'mid';
      const key = `${targetKey}:${guidance.direction}:${distBucket}`;
      if (key !== this.lastTurnKey && now - this.lastTurnAt > 4200) {
        this.lastTurnKey = key;
        this.lastTurnAt = now;
        const distRounded = Math.max(10, Math.round(guidance.distanceToTurn / 10) * 10);
        const dirKo =
          guidance.direction === 'left'
            ? '좌회전입니다.'
            : guidance.direction === 'right'
              ? '우회전입니다.'
              : '유턴입니다.';
        this.speak(
          distBucket === 'near' ? `잠시 후 ${dirKo}` : `약 ${distRounded}미터 앞에서 ${dirKo}`
        );
      }
    }
  }

  /** Speaks Korean 80m speed-camera enforcement approach & overspeed warnings */
  public updateSpeedCameraAlert(
    alert: UpcomingCameraAlert | null,
    isRiding: boolean,
    inCorridor: boolean
  ): void {
    if (!isRiding || inCorridor || !alert) {
      this.lastCameraId = '';
      return;
    }
    const now = performance.now();
    if (alert.cameraId !== this.lastCameraId) {
      this.lastCameraId = alert.cameraId;
      const distRounded = Math.max(20, Math.round(alert.distanceMeters / 10) * 10);
      this.speak(
        `전방 ${distRounded}미터 앞, 시속 ${alert.limitKmh}킬로미터 신호 과속 단속 구간입니다.`,
        'high'
      );
      return;
    }

    if (alert.isOverSpeed && now - this.lastCameraOverSpeedAt > 4800) {
      this.lastCameraOverSpeedAt = now;
      this.speak('제한 속도를 초과했습니다. 감속하세요.', 'high');
    }
  }

  /**
   * Construction on the route: once per destination announce a detour around a construction zone, and warn
   * ~80m before a construction zone the route has to pass through. Returns what was announced (for a banner).
   */
  public updateRoadworks(
    roadworks: RouteRoadworks,
    targetKey: string | null,
    riderX: number,
    riderZ: number,
    isRiding: boolean,
    inCorridor: boolean
  ): 'detour' | 'approach' | null {
    if (!isRiding || inCorridor || !targetKey) return null;
    if (targetKey !== this.roadworkTargetKey) {
      this.roadworkTargetKey = targetKey;
      this.roadworkDetourAnnounced = false;
      this.roadworkWarned.clear();
    }
    if (roadworks.avoided > 0 && !this.roadworkDetourAnnounced) {
      this.roadworkDetourAnnounced = true;
      this.speak('전방 공사 구간을 피해 우회 경로로 안내합니다.');
      return 'detour';
    }
    for (const p of roadworks.points) {
      const key = `${Math.round(p.x)},${Math.round(p.z)}`;
      if (this.roadworkWarned.has(key)) continue;
      const d = Math.hypot(p.x - riderX, p.z - riderZ);
      if (d <= ROADWORK_WARN_DIST_M) {
        this.roadworkWarned.add(key);
        this.speak(`전방 ${Math.max(20, Math.round(d / 10) * 10)}미터 공사 구간입니다. 서행하세요.`, 'high');
        return 'approach';
      }
    }
    return null;
  }
}
