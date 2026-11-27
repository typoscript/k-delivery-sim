import { ScooterState } from '../vehicle/ScooterPhysics';

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

  /**
   * One synthesized note: oscillator (optional frequency sweep) -> optional filter -> gain envelope -> master.
   * Envelope: start at `peak` (or ramp up from silence over `attack`), optional `hold` step, then an
   * exponential decay to silence at `decay`; the oscillator stops at `stop`. Times are seconds after `at`.
   */
  private tone(o: ToneSpec): void {
    if (!this.ready()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + (o.at ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type;
    applyFreq(osc.frequency, o.freq, o.sweep, t);
    const g = ctx.createGain();
    envelope(g.gain, t, o);
    const filter = o.filter ? makeFilter(ctx, o.filter, t) : null;
    if (filter) {
      osc.connect(filter);
      filter.connect(g);
    } else {
      osc.connect(g);
    }
    g.connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + o.stop);
  }

  /**
   * One noise burst: white noise shaped by `env(x)` (x = 0..1 over the buffer) -> optional filter -> gain.
   * Without `decay` the gain stays at `peak`.
   */
  private noise(o: NoiseSpec): void {
    if (!this.ready()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * o.duration);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * o.env(i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    if (o.decay === undefined) g.gain.value = o.peak;
    else envelope(g.gain, t, { peak: o.peak, attack: o.attack, decay: o.decay });
    const filter = o.filter ? makeFilter(ctx, o.filter, t) : null;
    if (filter) {
      src.connect(filter);
      filter.connect(g);
    } else {
      src.connect(g);
    }
    g.connect(this.masterGain!);
    src.start(t);
    if (o.stop !== undefined) src.stop(t + o.stop);
  }

  public setHorn(active: boolean): void {
    if (!this.started || !this.hornGain || !this.ctx) return;
    this.hornGain.gain.setTargetAtTime(active ? 0.35 : 0, this.ctx.currentTime, 0.02);
  }

  public playMountSound(mounting: boolean): void {
    this.tone({ type: 'triangle', freq: mounting ? 140 : 200, sweep: [[0.14, mounting ? 240 : 95]], peak: 0.22, decay: 0.16, stop: 0.17 });
  }

  public playCrashSound(): void {
    // Low impact thud + asphalt scrape noise burst
    this.tone({ type: 'sine', freq: 135, sweep: [[0.28, 34]], peak: 0.65, decay: 0.3, stop: 0.32 });
    this.noise({ duration: 0.55, env: (x) => Math.pow(1 - x, 1.4), filter: { type: 'bandpass', freq: 1100 }, peak: 0.45, decay: 0.54 });
  }

  public playPhoneMountClick(mounting: boolean): void {
    this.tone({
      type: 'triangle',
      freq: mounting ? 520 : 840,
      sweep: [[mounting ? 0.045 : 0.055, mounting ? 1120 : 360]],
      peak: 0.24,
      decay: 0.065,
      stop: 0.07,
    });
  }

  public playKeypadBeep(ok: boolean): void {
    this.tone({ type: ok ? 'sine' : 'sawtooth', freq: ok ? 920 : 210, peak: 0.16, decay: ok ? 0.07 : 0.22, stop: ok ? 0.08 : 0.24 });
  }

  public playCargoBoxSound(): void {
    this.tone({ type: 'triangle', freq: 220, sweep: [[0.16, 110]], peak: 0.28, decay: 0.18, stop: 0.19 });
  }

  public playElevatorDing(): void {
    [880, 1174.66].forEach((freq, i) => this.tone({ type: 'sine', freq, at: i * 0.18, peak: 0.22, decay: 0.55, stop: 0.58 }));
  }

  public playCameraShutter(): void {
    this.noise({ duration: 0.09, env: (x) => Math.pow(1 - x, 2), filter: { type: 'highpass', freq: 1800 }, peak: 0.42, decay: 0.085 });
  }

  public playChime(kind: 'accept' | 'pickup' | 'complete'): void {
    const notes =
      kind === 'complete' ? [523.25, 659.25, 783.99, 1046.5] : kind === 'pickup' ? [440, 587.33, 659.25] : [523.25, 659.25];
    notes.forEach((freq, idx) =>
      this.tone({ type: 'sine', freq, at: idx * 0.085, attack: 0.015, peak: 0.22, decay: 0.24, stop: 0.26 })
    );
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
    // Classic Korean sedan dual-horn harmony (F4 ~349Hz + A4 ~440Hz, crisp short warning blast)
    [349.23, 440.0].forEach((freq) =>
      this.tone({
        type: 'sawtooth',
        freq,
        filter: { type: 'bandpass', freq: 920, Q: 1.6 },
        attack: 0.02,
        peak: 0.24,
        hold: [0.28, 0.22],
        decay: 0.36,
        stop: 0.38,
      })
    );
  }

  /** Korean GPS navi 80m speed-camera zone chime ("딩동!" entry, or rapid "삐-삐!" when speeding >50km/h) */
  public playCameraApproachBeep(overSpeed: boolean): void {
    if (overSpeed) {
      // Urgent T-map style overspeed double-beep ("삐! 삐!")
      [0, 0.12].forEach((at) =>
        this.tone({ type: 'square', freq: 1480, at, filter: { type: 'lowpass', freq: 2400 }, attack: 0.008, peak: 0.14, decay: 0.085, stop: 0.095 })
      );
    } else {
      // Friendly 80m camera-ahead notice chime ("딩~동!")
      [880, 1174.66].forEach((freq, idx) =>
        this.tone({ type: 'sine', freq, at: idx * 0.12, attack: 0.012, peak: 0.2, decay: 0.22, stop: 0.24 })
      );
    }
  }

  /** Korean police patrol car wail siren ("우~웅 우~웅!") on live patrol enforcement */
  public playPoliceSiren(): void {
    // 2 classic rising/falling siren sweeps (~1.45s)
    this.tone({
      type: 'sawtooth',
      freq: 620,
      sweep: [
        [0.36, 1260, 'lin'],
        [0.72, 640, 'lin'],
        [1.08, 1280, 'lin'],
        [1.44, 600, 'lin'],
      ],
      filter: { type: 'bandpass', freq: 1100, Q: 1.8 },
      attack: 0.06,
      peak: 0.2,
      hold: [1.25, 0.18],
      decay: 1.48,
      stop: 1.5,
    });
  }

  /** Sharp roadside speed/red-light enforcement camera strobe click + penalty warning beep */
  public playSpeedCameraFlash(): void {
    if (!this.ready()) return;
    // 1. Crisp camera shutter snap, 2. two-tone Korean enforcement alert chime (high-low)
    this.playCameraShutter();
    [1046.5, 783.99].forEach((freq, i) =>
      this.tone({ type: 'square', freq, at: 0.08 + i * 0.15, filter: { type: 'lowpass', freq: 2100 }, attack: 0.01, peak: 0.16, decay: 0.14, stop: 0.16 })
    );
  }

  /** Subtle tactile capacitive glass tap click when touching the smartphone screen */
  public playPhoneScreenTap(): void {
    this.tone({ type: 'sine', freq: 1150, sweep: [[0.026, 380]], attack: 0.004, peak: 0.14, decay: 0.03, stop: 0.034 });
  }

  /** Short startled pedestrian gasp when scooter passes within 3.5m on the sidewalk */
  public playPedestrianStartle(): void {
    this.tone({
      type: 'triangle',
      freq: 340,
      sweep: [
        [0.08, 590],
        [0.19, 420],
      ],
      filter: { type: 'bandpass', freq: 950, Q: 2.0 },
      attack: 0.02,
      peak: 0.24,
      decay: 0.21,
      stop: 0.23,
    });
  }

  /** Urgent emergency alert chime for pedestrian contact accident */
  public playPedestrianAccidentAlert(): void {
    const tones = [
      { t: 0, f: 880, dur: 0.16 },
      { t: 0.17, f: 622.25, dur: 0.18 },
      { t: 0.36, f: 880, dur: 0.16 },
      { t: 0.53, f: 523.25, dur: 0.32 },
    ];
    for (const n of tones) {
      this.tone({ type: 'sawtooth', freq: n.f, at: n.t, filter: { type: 'lowpass', freq: 1800 }, attack: 0.015, peak: 0.26, decay: n.dur, stop: n.dur + 0.02 });
    }
  }

  /** Celebratory fanfare chime for completing the Daily Delivery Mission (+₩5,000 bonus!) */
  public playMissionBonusFanfare(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98];
    notes.forEach((freq, idx) =>
      this.tone({
        type: idx >= 4 ? 'triangle' : 'sine',
        freq,
        at: idx * 0.08,
        attack: 0.014,
        peak: 0.26,
        decay: idx === notes.length - 1 ? 0.55 : 0.22,
        stop: 0.58,
      })
    );
  }

  /** Short melodic phrase: notes (Hz) played one after another */
  private playNotes(notes: number[], type: OscillatorType, spacing: number, peak: number, length: number): void {
    notes.forEach((freq, idx) =>
      this.tone({ type, freq, at: idx * spacing, attack: 0.015, peak, decay: length, stop: length + 0.02 })
    );
  }

  /** Lunch / dinner rush begins: bright rising "rush hour" jingle */
  public playPeakRushJingle(): void {
    this.playNotes([392, 523.25, 659.25, 783.99, 1046.5, 1318.5], 'triangle', 0.075, 0.2, 0.28);
  }

  /** Rush hour over: gentle falling two-note sign-off */
  public playPeakEndChime(): void {
    this.playNotes([659.25, 523.25], 'sine', 0.16, 0.14, 0.4);
  }

  /** Rain starts: distant low thunder roll (filtered noise) */
  public playThunderRumble(): void {
    // Two rolling swells
    this.noise({
      duration: 2.6,
      env: (t) => Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.6)), 2) * (1 - t) + 0.5 * Math.pow(Math.sin(Math.PI * t), 4),
      filter: { type: 'lowpass', freq: 180 },
      peak: 0.9,
    });
  }

  /** Special order call (urgent / group): distinct double alert before the normal call alert */
  public playSpecialOrderAlert(kind: 'urgent' | 'group'): void {
    if (kind === 'urgent') this.playNotes([1318.5, 987.77, 1318.5, 987.77], 'square', 0.09, 0.08, 0.08);
    else this.playNotes([523.25, 659.25, 783.99, 659.25, 783.99], 'triangle', 0.07, 0.16, 0.18);
  }

  /** Urgent delivery running out (last 30s): short clock tick */
  public playUrgentTick(final: boolean): void {
    this.playNotes([final ? 1760 : 1320], 'square', 0, final ? 0.1 : 0.06, 0.05);
  }

  /** Daily goal reached (sparkle on top of the mission fanfare) */
  public playGoalSparkle(): void {
    this.playNotes([1567.98, 2093, 2637, 3135.96], 'sine', 0.05, 0.08, 0.22);
  }

  /** Clock-out: warm closing cadence for the end of the working day */
  public playShiftEndCadence(): void {
    this.playNotes([523.25, 659.25, 783.99, 659.25, 523.25, 392, 523.25], 'triangle', 0.13, 0.17, 0.42);
  }

  /** Bright restaurant pickup counter "딩동~ 딩동!" bell ("음식이 준비되었습니다!") */
  public playFoodReadyDingDong(): void {
    const tones = [
      { t: 0, f: 783.99, dur: 0.24 }, // G5
      { t: 0.16, f: 659.25, dur: 0.28 }, // E5
      { t: 0.36, f: 1046.5, dur: 0.45 }, // C6 bright finish
    ];
    for (const n of tones) {
      this.tone({ type: 'sine', freq: n.f, at: n.t, attack: 0.012, peak: 0.28, decay: n.dur, stop: n.dur + 0.02 });
    }
  }

  /** Realistic hollow wooden apartment door knock sound ("똑! 똑! 똑!") */
  public playDoorKnockSound(): void {
    [0, 0.22, 0.44].forEach((at) =>
      this.tone({ type: 'triangle', freq: 190, at, sweep: [[0.075, 72]], peak: 0.42, decay: 0.085, stop: 0.09 })
    );
  }

  /** Apartment intercom doorbell ("딩동~") + synthesized friendly dialogue cadence ("누구세요? 배달이요!") */
  public playIntercomBellAndVoice(): void {
    // 1. Classic Korean apartment "딩~ 동~" chime (E5 -> C5)
    [659.25, 523.25].forEach((freq, i) =>
      this.tone({ type: 'sine', freq, at: i * 0.28, attack: 0.015, peak: 0.28, decay: 0.46, stop: 0.48 })
    );
    // 2. Intercom speaker cadence: "누-구-세-요?" rising, then "배-달-이-요!" slightly lower rider voice contour
    const syllables: Array<{ t: number; f: number; dur: number }> = [
      { t: 0.65, f: 290, dur: 0.08 },
      { t: 0.75, f: 310, dur: 0.08 },
      { t: 0.85, f: 340, dur: 0.09 },
      { t: 0.96, f: 390, dur: 0.12 },
      { t: 1.22, f: 210, dur: 0.08 },
      { t: 1.32, f: 230, dur: 0.08 },
      { t: 1.42, f: 245, dur: 0.08 },
      { t: 1.52, f: 265, dur: 0.11 },
    ];
    for (const sy of syllables) {
      this.tone({
        type: 'sawtooth',
        freq: sy.f,
        sweep: [], // pitch set at the syllable start (as before), no glide
        at: sy.t,
        filter: { type: 'bandpass', freq: 1100, Q: 3.2 },
        attack: 0.015,
        peak: 0.11,
        decay: sy.dur,
        stop: sy.dur + 0.02,
      });
    }
  }

  /** Baemin Connect style crisp double-arpeggio dispatch notification + haptic vibrate pulse */
  public playDispatchCallAlert(): void {
    // Signature bright "띠리링~ 띠리링~" ascending electronic chime (E6 - G#6 - B6 - E7), twice,
    // over a low haptic smartphone vibration hum on the handlebar mount
    const melody = [1318.5, 1661.2, 1975.5, 2637.0];
    for (let rep = 0; rep < 2; rep++) {
      const baseT = rep * 0.34;
      melody.forEach((freq, idx) =>
        this.tone({
          type: idx === melody.length - 1 ? 'triangle' : 'sine',
          freq,
          at: baseT + idx * 0.062,
          attack: 0.01,
          peak: 0.24,
          decay: 0.16,
          stop: 0.18,
        })
      );
      this.tone({ type: 'sawtooth', freq: 92, at: baseT, filter: { type: 'lowpass', freq: 180 }, peak: 0.14, decay: 0.2, stop: 0.22 });
    }
  }

  /** Soft descending two-tone sound when a 20s call offer expires or is declined */
  public playDispatchExpiredSound(): void {
    [440, 311.13].forEach((freq, i) => this.tone({ type: 'sine', freq, at: i * 0.12, peak: 0.16, decay: 0.14, stop: 0.16 }));
  }

  /** Synthesizes low-fuel dashboard warning double-beep */
  public playLowFuelWarningBeep(): void {
    [1318.5, 987.77].forEach((freq, i) =>
      this.tone({ type: 'sine', freq, at: i * 0.13, attack: 0.012, peak: 0.18, decay: 0.1, stop: 0.11 })
    );
  }

  /** Soft rhythmic pump click while refueling */
  public playFuelPumpTick(): void {
    this.tone({ type: 'triangle', freq: 340, sweep: [[0.04, 520]], peak: 0.12, decay: 0.05, stop: 0.055 });
  }

  /** Korean self-service POS / card terminal payment complete chime ("결제가 완료되었습니다" tone) */
  public playPaymentCompleteSound(): void {
    [1046.5, 1318.5, 1567.98, 2093.0].forEach((freq, idx) =>
      this.tone({ type: 'triangle', freq, at: idx * 0.075, attack: 0.01, peak: 0.24, decay: 0.22, stop: 0.24 })
    );
  }

  /** Mechanic air-wrench whir & confirmation chime for scooter repair */
  public playRepairSound(): void {
    for (let i = 0; i < 3; i++) {
      this.tone({ type: 'sawtooth', freq: 220, at: i * 0.14, sweep: [[0.09, 640]], peak: 0.18, decay: 0.11, stop: 0.12 });
    }
  }

  /** Deep double-thud suspension jolt ("덜컹-덜컹!") when crossing a speed bump */
  public playSpeedBumpThud(intensity = 0.7): void {
    const vol = Math.min(0.48, 0.18 + intensity * 0.3);
    [0, 0.095].forEach((at, idx) =>
      this.tone({
        type: 'triangle',
        freq: idx === 0 ? 128 : 104,
        at,
        sweep: [[0.11, 38]],
        peak: vol * (idx === 0 ? 1 : 0.8),
        decay: 0.13,
        stop: 0.14,
      })
    );
  }

  /** Filtered liquid slosh cue when soup/drink spills inside top box from harsh lean/braking */
  public playLiquidSlosh(): void {
    this.noise({
      duration: 0.24,
      env: (x) => Math.sin(x * Math.PI),
      filter: {
        type: 'bandpass',
        freq: 480,
        sweep: [
          [0.11, 1150],
          [0.23, 420],
        ],
        Q: 3.2,
      },
      peak: 0.24,
      decay: 0.24,
    });
  }

  /** Crisp Korean messenger-style two-tone ping ("카톡/띠링!") for live customer chat messages */
  public playCustomerChatPing(): void {
    const notes = [
      { t: 0, f: 880, dur: 0.11 },
      { t: 0.095, f: 1318.5, dur: 0.22 },
    ];
    for (const n of notes) {
      this.tone({ type: 'sine', freq: n.f, at: n.t, attack: 0.01, peak: 0.25, decay: n.dur, stop: n.dur + 0.02 });
    }
  }

  /** Subtle terrazzo stair footstep click while climbing walk-up villa stairs */
  public playStairFootstep(): void {
    if (!this.ready()) return;
    this.tone({ type: 'triangle', freq: 175 + Math.random() * 35, sweep: [[0.055, 62]], peak: 0.14, decay: 0.065, stop: 0.07 });
  }

  /** Wet rubber glove wiping across helmet visor ("쓱~ 뽀드득!") */
  public playVisorWipeSound(): void {
    const dur = 0.34;
    this.noise({
      duration: dur,
      env: (x) => Math.sin(x * Math.PI),
      filter: {
        type: 'bandpass',
        freq: 720,
        sweep: [
          [dur * 0.55, 1950],
          [dur, 640],
        ],
        Q: 3.8,
      },
      peak: 0.26,
      decay: dur,
    });
  }

  /** Classic Korean 24h convenience store bright entrance/checkout chime ("띠리링~!") */
  public playConvenienceChime(): void {
    const notes = [
      { t: 0, f: 987.77, dur: 0.16 }, // B5
      { t: 0.13, f: 1318.51, dur: 0.16 }, // E6
      { t: 0.26, f: 1567.98, dur: 0.32 }, // G6
    ];
    for (const n of notes) {
      this.tone({ type: 'sine', freq: n.f, at: n.t, attack: 0.012, peak: 0.24, decay: n.dur, stop: n.dur + 0.02 });
    }
  }

  /** Soft modern smartphone wireless charging confirmation harmonic ping */
  public playWirelessChargeStart(): void {
    [587.33, 880, 1174.66].forEach((freq, i) =>
      this.tone({ type: 'sine', freq, at: i * 0.075, attack: 0.012, peak: 0.16, decay: 0.24, stop: 0.26 })
    );
  }

  /** Gentle descending low-battery alert chime */
  public playLowBatteryBeep(): void {
    [740, 554.37].forEach((freq, i) =>
      this.tone({ type: 'triangle', freq, at: i * 0.14, attack: 0.01, peak: 0.18, decay: 0.14, stop: 0.16 })
    );
  }

  /** Metallic sliding sound for 3D stainless-steel apartment elevator doors */
  public playElevatorDoorSlide(): void {
    const dur = 0.55;
    this.noise({
      duration: dur,
      env: () => 0.45,
      filter: {
        type: 'bandpass',
        freq: 420,
        sweep: [
          [dur * 0.5, 680, 'lin'],
          [dur, 340, 'lin'],
        ],
        Q: 3.2,
      },
      attack: 0.08,
      peak: 0.14,
      decay: dur,
      stop: dur + 0.02,
    });
  }

  /** Soft digital LED floor-pass tick inside the 3D apartment elevator */
  public playElevatorFloorTick(): void {
    this.tone({ type: 'sine', freq: 1120, attack: 0.008, peak: 0.055, decay: 0.055, stop: 0.065 });
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

/** [seconds after the note start, value, curve] frequency automation step (exponential by default) */
type FreqStep = [number, number, ('exp' | 'lin')?];

interface FilterSpec {
  type: BiquadFilterType;
  freq: number;
  Q?: number;
  sweep?: FreqStep[];
}

interface ToneSpec {
  type: OscillatorType;
  freq: number;
  sweep?: FreqStep[];
  /** Start offset from now (s) */
  at?: number;
  peak: number;
  /** Linear fade-in from silence (s); without it the note starts at `peak` */
  attack?: number;
  /** Extra [time, level] step before the decay (sustain then release) */
  hold?: [number, number];
  /** Exponential decay to silence at this time (s) */
  decay: number;
  /** Oscillator stop time (s) */
  stop: number;
  filter?: FilterSpec;
}

interface NoiseSpec {
  duration: number;
  /** Amplitude shape over the buffer, x = 0..1 */
  env: (x: number) => number;
  filter?: FilterSpec;
  peak: number;
  attack?: number;
  decay?: number;
  stop?: number;
}

function applyFreq(param: AudioParam, freq: number, sweep: FreqStep[] | undefined, t: number): void {
  if (!sweep) {
    param.value = freq;
    return;
  }
  param.setValueAtTime(freq, t);
  for (const [dt, value, curve] of sweep) {
    if (curve === 'lin') param.linearRampToValueAtTime(value, t + dt);
    else param.exponentialRampToValueAtTime(value, t + dt);
  }
}

function envelope(gain: AudioParam, t: number, o: { peak: number; attack?: number; hold?: [number, number]; decay: number }): void {
  if (o.attack !== undefined) {
    gain.setValueAtTime(0.001, t);
    gain.linearRampToValueAtTime(o.peak, t + o.attack);
  } else {
    gain.setValueAtTime(o.peak, t);
  }
  if (o.hold) gain.setValueAtTime(o.hold[1], t + o.hold[0]);
  gain.exponentialRampToValueAtTime(0.001, t + o.decay);
}

function makeFilter(ctx: BaseAudioContext, f: FilterSpec, t: number): BiquadFilterNode {
  const filter = ctx.createBiquadFilter();
  filter.type = f.type;
  applyFreq(filter.frequency, f.freq, f.sweep, t);
  if (f.Q !== undefined) filter.Q.value = f.Q;
  return filter;
}
