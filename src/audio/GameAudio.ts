import { ScooterState } from '../vehicle/ScooterPhysics';
import { NoiseSpec, Sfx, ToneSpec, synthNoise, synthTone } from './soundSynth';
import {
  playAiCarHorn,
  playCameraApproachBeep,
  playCameraShutter,
  playCrashSound,
  playLiquidSlosh,
  playLowBatteryBeep,
  playLowFuelWarningBeep,
  playMountSound,
  playPedestrianAccidentAlert,
  playPedestrianStartle,
  playPhoneMountClick,
  playPhoneScreenTap,
  playPoliceSiren,
  playSpeedBumpThud,
  playSpeedCameraFlash,
  playThunderRumble,
  playVisorWipeSound,
  playWirelessChargeStart,
} from './sfx/rideSounds';
import {
  playCargoBoxSound,
  playConvenienceChime,
  playCustomerChatPing,
  playDispatchCallAlert,
  playDispatchExpiredSound,
  playDoorKnockSound,
  playElevatorDing,
  playElevatorDoorSlide,
  playElevatorFloorTick,
  playFoodReadyDingDong,
  playFuelPumpTick,
  playIntercomBellAndVoice,
  playKeypadBeep,
  playPaymentCompleteSound,
  playRepairSound,
  playSpecialOrderAlert,
  playStairFootstep,
  playUrgentTick,
} from './sfx/deliverySounds';
import {
  playChime,
  playGoalSparkle,
  playMissionBonusFanfare,
  playPeakEndChime,
  playPeakRushJingle,
  playShiftEndCadence,
} from './sfx/jingles';


import {
  ensureStarted as ensureStartedFn,
} from './audioGraph';
import {
  update as updateFn,
} from './engineSound';
import {
  setElevatorHum as setElevatorHumFn,
  setWaterAmbience as setWaterAmbienceFn,
  setWindAmbience as setWindAmbienceFn,
  updateWeatherAudio as updateWeatherAudioFn,
} from './ambience';

export class GameAudio {
  /** @internal split modules */
  ctx: AudioContext | null = null;
  /** @internal split modules */
  masterGain: GainNode | null = null;

  /** @internal split modules */
  engineOsc1: OscillatorNode | null = null;
  /** @internal split modules */
  engineOsc2: OscillatorNode | null = null;
  /** @internal split modules */
  engineFilter: BiquadFilterNode | null = null;
  /** @internal split modules */
  engineGain: GainNode | null = null;

  /** @internal split modules */
  screechOsc: OscillatorNode | null = null;
  /** @internal split modules */
  screechGain: GainNode | null = null;

  /** @internal split modules */
  hornOsc: OscillatorNode | null = null;
  /** @internal split modules */
  hornGain: GainNode | null = null;

  /** @internal split modules */
  rainGain: GainNode | null = null;
  /** @internal split modules */
  rainFilter: BiquadFilterNode | null = null;
  /** @internal split modules */
  elevHumOsc: OscillatorNode | null = null;
  /** @internal split modules */
  elevHumGain: GainNode | null = null;

  public muted = false;
  public masterVolume = 0.8;
  /** Effect modules (sfx/*) play through these */
  private readonly sfx: Sfx = {
    tone: (o) => this.tone(o),
    noise: (o) => this.noise(o),
    notes: (notes, type, spacing, peak, length) => this.playNotes(notes, type, spacing, peak, length),
    ready: () => this.ready(),
  };

  /** @internal split modules */
  started = false;
  /** @internal split modules */
  lastBlinkPhase = false;
  /** @internal split modules */
  lastLowFuelBeepTime = -10;

  public ensureStarted(): void {
    ensureStartedFn(this);
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(
        this.muted ? 0 : 0.3 * this.masterVolume,
        this.ctx.currentTime,
        0.04
      );
    }
    return this.muted;
  }

  public setMasterVolume(vol: number): void {
    this.masterVolume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx && !this.muted) {
      this.masterGain.gain.setTargetAtTime(0.3 * this.masterVolume, this.ctx.currentTime, 0.04);
    }
  }

  /** True when one-shot effects can play (audio started, not muted) */
  private ready(): boolean {
    return this.started && !!this.ctx && !!this.masterGain && !this.muted;
  }

  /** One synthesized note into the master output (see soundSynth.synthTone) */
  private tone(o: ToneSpec): void {
    if (this.ready()) synthTone(this.ctx!, this.masterGain!, o);
  }

  /** One noise burst into the master output (see soundSynth.synthNoise) */
  private noise(o: NoiseSpec): void {
    if (this.ready()) synthNoise(this.ctx!, this.masterGain!, o);
  }

  public setHorn(active: boolean): void {
    if (!this.started || !this.hornGain || !this.ctx) return;
    this.hornGain.gain.setTargetAtTime(active ? 0.35 : 0, this.ctx.currentTime, 0.02);
  }

  public playMountSound(mounting: boolean): void {
    playMountSound(this.sfx, mounting);
  }

  public playCrashSound(): void {
    playCrashSound(this.sfx);
  }

  public playPhoneMountClick(mounting: boolean): void {
    playPhoneMountClick(this.sfx, mounting);
  }

  public playKeypadBeep(ok: boolean): void {
    playKeypadBeep(this.sfx, ok);
  }

  public playCargoBoxSound(): void {
    playCargoBoxSound(this.sfx);
  }

  public playElevatorDing(): void {
    playElevatorDing(this.sfx);
  }

  public playCameraShutter(): void {
    playCameraShutter(this.sfx);
  }

  public playChime(kind: 'accept' | 'pickup' | 'complete'): void {
    playChime(this.sfx, kind);
  }

  /** @internal split modules */
  playBlinkerClick(isOnPhase: boolean): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    // Realistic alternating tick / tock blinker relay frequency
    osc.frequency.value = isOnPhase ? 820 : 620;
    gain.gain.setValueAtTime(0.085, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.026);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.03);
  }

  /** Dual-tone realistic car klaxon honk when player cuts in front of an AI sedan/taxi */
  public playAiCarHorn(): void {
    playAiCarHorn(this.sfx);
  }

  /** Korean GPS navi 80m speed-camera zone chime ("딩동!" entry, or rapid "삐-삐!" when speeding >50km/h) */
  public playCameraApproachBeep(overSpeed: boolean): void {
    playCameraApproachBeep(this.sfx, overSpeed);
  }

  /** Korean police patrol car wail siren ("우~웅 우~웅!") on live patrol enforcement */
  public playPoliceSiren(): void {
    playPoliceSiren(this.sfx);
  }

  /** Sharp roadside speed/red-light enforcement camera strobe click + penalty warning beep */
  public playSpeedCameraFlash(): void {
    playSpeedCameraFlash(this.sfx);
  }

  /** Subtle tactile capacitive glass tap click when touching the smartphone screen */
  public playPhoneScreenTap(): void {
    playPhoneScreenTap(this.sfx);
  }

  /** Short startled pedestrian gasp when scooter passes within 3.5m on the sidewalk */
  public playPedestrianStartle(): void {
    playPedestrianStartle(this.sfx);
  }

  /** Urgent emergency alert chime for pedestrian contact accident */
  public playPedestrianAccidentAlert(): void {
    playPedestrianAccidentAlert(this.sfx);
  }

  /** Celebratory fanfare chime for completing the Daily Delivery Mission (+₩5,000 bonus!) */
  public playMissionBonusFanfare(): void {
    playMissionBonusFanfare(this.sfx);
  }

  /** Short melodic phrase: notes (Hz) played one after another */
  private playNotes(notes: number[], type: OscillatorType, spacing: number, peak: number, length: number): void {
    notes.forEach((freq, idx) =>
      this.tone({ type, freq, at: idx * spacing, attack: 0.015, peak, decay: length, stop: length + 0.02 })
    );
  }

  /** Lunch / dinner rush begins: bright rising "rush hour" jingle */
  public playPeakRushJingle(): void {
    playPeakRushJingle(this.sfx);
  }

  /** Rush hour over: gentle falling two-note sign-off */
  public playPeakEndChime(): void {
    playPeakEndChime(this.sfx);
  }

  /** Rain starts: distant low thunder roll (filtered noise) */
  public playThunderRumble(): void {
    playThunderRumble(this.sfx);
  }

  /** Special order call (urgent / group): distinct double alert before the normal call alert */
  public playSpecialOrderAlert(kind: 'urgent' | 'group'): void {
    playSpecialOrderAlert(this.sfx, kind);
  }

  /** Urgent delivery running out (last 30s): short clock tick */
  public playUrgentTick(final: boolean): void {
    playUrgentTick(this.sfx, final);
  }

  /** Daily goal reached (sparkle on top of the mission fanfare) */
  public playGoalSparkle(): void {
    playGoalSparkle(this.sfx);
  }

  /** Clock-out: warm closing cadence for the end of the working day */
  public playShiftEndCadence(): void {
    playShiftEndCadence(this.sfx);
  }

  /** Bright restaurant pickup counter "딩동~ 딩동!" bell ("음식이 준비되었습니다!") */
  public playFoodReadyDingDong(): void {
    playFoodReadyDingDong(this.sfx);
  }

  /** Realistic hollow wooden apartment door knock sound ("똑! 똑! 똑!") */
  public playDoorKnockSound(): void {
    playDoorKnockSound(this.sfx);
  }

  /** Apartment intercom doorbell ("딩동~") + synthesized friendly dialogue cadence ("누구세요? 배달이요!") */
  public playIntercomBellAndVoice(): void {
    playIntercomBellAndVoice(this.sfx);
  }

  /** Baemin Connect style crisp double-arpeggio dispatch notification + haptic vibrate pulse */
  public playDispatchCallAlert(): void {
    playDispatchCallAlert(this.sfx);
  }

  /** Soft descending two-tone sound when a 20s call offer expires or is declined */
  public playDispatchExpiredSound(): void {
    playDispatchExpiredSound(this.sfx);
  }

  /** Synthesizes low-fuel dashboard warning double-beep */
  public playLowFuelWarningBeep(): void {
    playLowFuelWarningBeep(this.sfx);
  }

  /** Soft rhythmic pump click while refueling */
  public playFuelPumpTick(): void {
    playFuelPumpTick(this.sfx);
  }

  /** Korean self-service POS / card terminal payment complete chime ("결제가 완료되었습니다" tone) */
  public playPaymentCompleteSound(): void {
    playPaymentCompleteSound(this.sfx);
  }

  /** Mechanic air-wrench whir & confirmation chime for scooter repair */
  public playRepairSound(): void {
    playRepairSound(this.sfx);
  }

  /** Deep double-thud suspension jolt ("덜컹-덜컹!") when crossing a speed bump */
  public playSpeedBumpThud(intensity = 0.7): void {
    playSpeedBumpThud(this.sfx, intensity);
  }

  /** Filtered liquid slosh cue when soup/drink spills inside top box from harsh lean/braking */
  public playLiquidSlosh(): void {
    playLiquidSlosh(this.sfx);
  }

  /** Crisp Korean messenger-style two-tone ping ("카톡/띠링!") for live customer chat messages */
  public playCustomerChatPing(): void {
    playCustomerChatPing(this.sfx);
  }

  /** Subtle terrazzo stair footstep click while climbing walk-up villa stairs */
  public playStairFootstep(): void {
    playStairFootstep(this.sfx);
  }

  /** Wet rubber glove wiping across helmet visor ("쓱~ 뽀드득!") */
  public playVisorWipeSound(): void {
    playVisorWipeSound(this.sfx);
  }

  /** Classic Korean 24h convenience store bright entrance/checkout chime ("띠리링~!") */
  public playConvenienceChime(): void {
    playConvenienceChime(this.sfx);
  }

  /** Soft modern smartphone wireless charging confirmation harmonic ping */
  public playWirelessChargeStart(): void {
    playWirelessChargeStart(this.sfx);
  }

  /** Gentle descending low-battery alert chime */
  public playLowBatteryBeep(): void {
    playLowBatteryBeep(this.sfx);
  }

  /** Metallic sliding sound for 3D stainless-steel apartment elevator doors */
  public playElevatorDoorSlide(): void {
    playElevatorDoorSlide(this.sfx);
  }

  /** Soft digital LED floor-pass tick inside the 3D apartment elevator */
  public playElevatorFloorTick(): void {
    playElevatorFloorTick(this.sfx);
  }

  /** Wind rushing past on a bridge (0 = calm) */
  public setWind(level: number): void {
    setWindAmbienceFn(this, level);
  }

  /** Running water of a nearby stream (0 = none) */
  public setWater(level: number): void {
    setWaterAmbienceFn(this, level);
  }

  /** Continuous low traction-motor hum while riding the 3D apartment elevator */
  public setElevatorHum(active: boolean): void {
    setElevatorHumFn(this, active);
  }

  /**
   * Controls continuous rain ambience volume.
   * Immediately silences rain audio with zero fade tail when inside underground corridors (y = -500)!
   */
  public updateWeatherAudio(rainIntensity: number, inCorridor: boolean): void {
    updateWeatherAudioFn(this, rainIntensity, inCorridor);
  }

  public update(scooter: ScooterState, elapsedTime: number): void {
    updateFn(this, scooter, elapsedTime);
  }
}
