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

  public muted = false;
  private started = false;
  private lastBlinkPhase = false;

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
      this.masterGain.gain.value = this.muted ? 0 : 0.25;
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

      this.started = true;
    } catch {
      // AudioContext unavailable
    }
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 0.25, this.ctx.currentTime, 0.04);
    }
    return this.muted;
  }

  public setHorn(active: boolean): void {
    if (!this.started || !this.hornGain || !this.ctx) return;
    this.hornGain.gain.setTargetAtTime(active ? 0.35 : 0, this.ctx.currentTime, 0.02);
  }

  public playMountSound(mounting: boolean): void {
    if (!this.started || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    if (mounting) {
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(240, now + 0.14);
    } else {
      osc.frequency.setValueAtTime(200, now);
      osc.frequency.exponentialRampToValueAtTime(95, now + 0.14);
    }
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.17);
  }

  public playCrashSound(): void {
    if (!this.started || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;

    // Low impact thud
    const thud = this.ctx.createOscillator();
    const thudGain = this.ctx.createGain();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(135, now);
    thud.frequency.exponentialRampToValueAtTime(34, now + 0.28);
    thudGain.gain.setValueAtTime(0.65, now);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    thud.connect(thudGain);
    thudGain.connect(this.masterGain);
    thud.start(now);
    thud.stop(now + 0.32);

    // Asphalt scrape noise burst
    const len = Math.floor(this.ctx.sampleRate * 0.55);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.4);
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1100;
    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.45, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.54);
    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(this.masterGain);
    noise.start(now);
  }

  public playPhoneMountClick(mounting: boolean): void {
    if (!this.started || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    if (mounting) {
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(1120, now + 0.045);
    } else {
      osc.frequency.setValueAtTime(840, now);
      osc.frequency.exponentialRampToValueAtTime(360, now + 0.055);
    }
    g.gain.setValueAtTime(0.24, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.065);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  public playKeypadBeep(ok: boolean): void {
    if (!this.started || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = ok ? 'sine' : 'sawtooth';
    osc.frequency.value = ok ? 920 : 210;
    g.gain.setValueAtTime(0.16, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + (ok ? 0.07 : 0.22));
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + (ok ? 0.08 : 0.24));
  }

  public playCargoBoxSound(): void {
    if (!this.started || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.16);
    g.gain.setValueAtTime(0.28, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.19);
  }

  public playElevatorDing(): void {
    if (!this.started || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    [880, 1174.66].forEach((freq, i) => {
      const osc = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = now + i * 0.18;
      g.gain.setValueAtTime(0.22, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      osc.connect(g);
      g.connect(this.masterGain!);
      osc.start(t);
      osc.stop(t + 0.58);
    });
  }

  public playCameraShutter(): void {
    if (!this.started || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * 0.09);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1800;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.42, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.085);
    noise.connect(filter);
    filter.connect(g);
    g.connect(this.masterGain);
    noise.start(now);
  }

  public playChime(kind: 'accept' | 'pickup' | 'complete'): void {
    if (!this.started || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const notes =
      kind === 'complete'
        ? [523.25, 659.25, 783.99, 1046.5]
        : kind === 'pickup'
          ? [440, 587.33, 659.25]
          : [523.25, 659.25];

    notes.forEach((freq, idx) => {
      const osc = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = now + idx * 0.085;
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.22, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
      osc.connect(g);
      g.connect(this.masterGain!);
      osc.start(t);
      osc.stop(t + 0.26);
    });
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
    if (!scooter.engineOn) {
      this.engineGain.gain.setTargetAtTime(0, now, 0.08);
      this.screechGain.gain.setTargetAtTime(0, now, 0.05);
      return;
    }

    const freq = 58 + scooter.rpmNorm * 135;
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
