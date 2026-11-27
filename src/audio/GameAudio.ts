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


export class GameAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;

  private screechOsc: OscillatorNode | null = null;
  private screechGain: GainNode | null = null;

  private hornOsc: OscillatorNode | null = null;
  private hornGain: GainNode | null = null;

  private rainGain: GainNode | null = null;
  private rainFilter: BiquadFilterNode | null = null;
  private elevHumOsc: OscillatorNode | null = null;
  private elevHumGain: GainNode | null = null;

  public muted = false;
  public masterVolume = 0.8;
  /** Effect modules (sfx/*) play through these */
  private readonly sfx: Sfx = {
    tone: (o) => this.tone(o),
    noise: (o) => this.noise(o),
    notes: (notes, type, spacing, peak, length) => this.playNotes(notes, type, spacing, peak, length),
    ready: () => this.ready(),
  };

  private started = false;
  private lastBlinkPhase = false;
  private lastLowFuelBeepTime = -10;

  public ensureStarted(): void {
    if (this.started) {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.3 * this.masterVolume;
      this.masterGain.connect(this.ctx.destination);

      // Compact 125cc CVT scooter buzz
      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 320;
      this.engineFilter.Q.value = 1.8;

      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;

      this.engineOsc1 = this.ctx.createOscillator();
      this.engineOsc1.type = 'sawtooth';
      this.engineOsc1.frequency.value = 62;

      this.engineOsc2 = this.ctx.createOscillator();
      this.engineOsc2.type = 'triangle';
      this.engineOsc2.frequency.value = 124;

      this.engineOsc1.connect(this.engineFilter);
      this.engineOsc2.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.masterGain);

      this.engineOsc1.start();
      this.engineOsc2.start();

      // Tire slip / screech warning synth when over-leaning in corners
      this.screechGain = this.ctx.createGain();
      this.screechGain.gain.value = 0;
      const screechFilter = this.ctx.createBiquadFilter();
      screechFilter.type = 'bandpass';
      screechFilter.frequency.value = 1450;
      screechFilter.Q.value = 6.0;
      this.screechOsc = this.ctx.createOscillator();
      this.screechOsc.type = 'sawtooth';
      this.screechOsc.frequency.value = 740;
      this.screechOsc.connect(screechFilter);
      screechFilter.connect(this.screechGain);
      this.screechGain.connect(this.masterGain);
      this.screechOsc.start();

      // Scooter horn
      this.hornGain = this.ctx.createGain();
      this.hornGain.gain.value = 0;
      this.hornOsc = this.ctx.createOscillator();
      this.hornOsc.type = 'sawtooth';
      this.hornOsc.frequency.value = 460;
      const hornFilter = this.ctx.createBiquadFilter();
      hornFilter.type = 'bandpass';
      hornFilter.frequency.value = 900;
      this.hornOsc.connect(hornFilter);
      hornFilter.connect(this.hornGain);
      this.hornGain.connect(this.masterGain);
      this.hornOsc.start();

      // Continuous procedural rainfall ambience (looping filtered pink-ish noise buffer)
      const rainLen = Math.floor(this.ctx.sampleRate * 2.5);
      const rainBuf = this.ctx.createBuffer(1, rainLen, this.ctx.sampleRate);
      const rData = rainBuf.getChannelData(0);
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      for (let i = 0; i < rainLen; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.997 * b0 + white * 0.029;
        b1 = 0.985 * b1 + white * 0.032;
        b2 = 0.95 * b2 + white * 0.048;
        rData[i] = (b0 + b1 + b2 + white * 0.18) * 0.65;
      }
      const rainSrc = this.ctx.createBufferSource();
      rainSrc.buffer = rainBuf;
      rainSrc.loop = true;

      this.rainFilter = this.ctx.createBiquadFilter();
      this.rainFilter.type = 'bandpass';
      this.rainFilter.frequency.value = 1150;
      this.rainFilter.Q.value = 0.65;

      this.rainGain = this.ctx.createGain();
      this.rainGain.gain.value = 0;

      rainSrc.connect(this.rainFilter);
      this.rainFilter.connect(this.rainGain);
      this.rainGain.connect(this.masterGain);
      rainSrc.start();

      this.started = true;
    } catch {
      // AudioContext unavailable
    }
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

  private playBlinkerClick(isOnPhase: boolean): void {
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

  /** Continuous low traction-motor hum while riding the 3D apartment elevator */
  public setElevatorHum(active: boolean): void {
    if (!this.started || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    if (!this.elevHumOsc || !this.elevHumGain) {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 74;
      const filt = this.ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 170;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      osc.connect(filt);
      filt.connect(g);
      g.connect(this.masterGain);
      osc.start();
      this.elevHumOsc = osc;
      this.elevHumGain = g;
    }
    const target = active && !this.muted ? 0.14 : 0;
    this.elevHumGain.gain.setTargetAtTime(target, now, 0.12);
  }

  /**
   * Controls continuous rain ambience volume.
   * Immediately silences rain audio with zero fade tail when inside underground corridors (y = -500)!
   */
  public updateWeatherAudio(rainIntensity: number, inCorridor: boolean): void {
    if (!this.started || !this.ctx || !this.rainGain) return;
    const now = this.ctx.currentTime;
    if (inCorridor || this.muted || rainIntensity <= 0.01) {
      this.rainGain.gain.cancelScheduledValues(now);
      this.rainGain.gain.setValueAtTime(0, now);
      return;
    }
    const targetVol = 0.34 * rainIntensity;
    this.rainGain.gain.setTargetAtTime(targetVol, now, 0.14);
  }

  public update(scooter: ScooterState, elapsedTime: number): void {
    if (
      !this.started ||
      !this.ctx ||
      !this.engineOsc1 ||
      !this.engineOsc2 ||
      !this.engineFilter ||
      !this.engineGain ||
      !this.screechGain ||
      !this.screechOsc
    ) {
      return;
    }

    const now = this.ctx.currentTime;

    // Periodic low-fuel warning beep while mounted with <= 10% fuel (even when completely empty!)
    if (scooter.mounted && scooter.lowFuelWarning && elapsedTime - this.lastLowFuelBeepTime >= 4.2) {
      this.lastLowFuelBeepTime = elapsedTime;
      this.playLowFuelWarningBeep();
    }

    if (!scooter.engineOn) {
      this.engineGain.gain.setTargetAtTime(0, now, 0.08);
      this.screechGain.gain.setTargetAtTime(0, now, 0.05);
      return;
    }

    if (scooter.modelId === 'electric') {
      // Ultra-quiet futuristic EV inverter motor whirr (silent at standstill, silky pitch rise with speed!)
      const evSpeedFrac = Math.min(1, Math.abs(scooter.speed) / 23.9);
      const evFreq = 210 + evSpeedFrac * 560 + scooter.throttleAmount * 90;
      this.engineOsc1.type = 'sine';
      this.engineOsc2.type = 'triangle';
      this.engineOsc1.frequency.setTargetAtTime(evFreq, now, 0.05);
      this.engineOsc2.frequency.setTargetAtTime(evFreq * 1.5, now, 0.05);
      this.engineFilter.frequency.setTargetAtTime(900 + evSpeedFrac * 1400, now, 0.05);
      const evGain = (evSpeedFrac * 0.08 + scooter.throttleAmount * 0.045);
      this.engineGain.gain.setTargetAtTime(evGain, now, 0.06);
    } else if (scooter.modelId === 'cub') {
      // Classic Super Cub low-pitch warm single-cylinder retro thump!
      const cubFreq = 42 + scooter.rpmNorm * 98;
      this.engineOsc1.type = 'sawtooth';
      this.engineOsc2.type = 'triangle';
      this.engineOsc1.frequency.setTargetAtTime(cubFreq, now, 0.04);
      this.engineOsc2.frequency.setTargetAtTime(cubFreq * 2.0, now, 0.04);
      this.engineFilter.frequency.setTargetAtTime(
        180 + scooter.rpmNorm * 420 + scooter.throttleAmount * 160,
        now,
        0.05
      );
      this.engineGain.gain.setTargetAtTime(
        0.13 + scooter.throttleAmount * 0.13 + scooter.rpmNorm * 0.07,
        now,
        0.06
      );
    } else {
      // Standard PCX 125 crisp CVT scooter engine
      const freq = 58 + scooter.rpmNorm * 135;
      this.engineOsc1.type = 'sawtooth';
      this.engineOsc2.type = 'triangle';
      this.engineOsc1.frequency.setTargetAtTime(freq, now, 0.04);
      this.engineOsc2.frequency.setTargetAtTime(freq * 1.99, now, 0.04);
      this.engineFilter.frequency.setTargetAtTime(
        220 + scooter.rpmNorm * 580 + scooter.throttleAmount * 220,
        now,
        0.05
      );
      this.engineGain.gain.setTargetAtTime(
        0.14 + scooter.throttleAmount * 0.14 + scooter.rpmNorm * 0.08,
        now,
        0.06
      );
    }

    // Tire screech scales smoothly when corner lean approaches traction limit
    const screechAmt = scooter.slipWarning ? Math.min((scooter.leanRisk - 0.7) * 0.85, 0.28) : 0;
    this.screechGain.gain.setTargetAtTime(screechAmt, now, 0.04);
    this.screechOsc.frequency.setTargetAtTime(700 + scooter.leanRisk * 240, now, 0.04);

    const anyBlink = scooter.leftBlinker || scooter.rightBlinker || scooter.hazard;
    const blinkPhase = Math.floor(elapsedTime * 2.5) % 2 === 0;
    if (anyBlink && blinkPhase !== this.lastBlinkPhase) {
      this.playBlinkerClick(blinkPhase);
    }
    this.lastBlinkPhase = blinkPhase;
  }
}
