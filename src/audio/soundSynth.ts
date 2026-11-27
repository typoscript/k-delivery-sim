/**
 * Procedural sound building blocks shared by every effect: one oscillator note (`synthTone`) or one noise burst
 * (`synthNoise`), each with an optional filter and a gain envelope, into an output node.
 */

/** What an effect needs: play notes / noise bursts through the master output (no-ops while muted or not started) */
export interface Sfx {
  tone(o: ToneSpec): void;
  noise(o: NoiseSpec): void;
  /** Same-shape notes one after another (`spacing` s apart) */
  notes(notes: number[], type: OscillatorType, spacing: number, peak: number, length: number): void;
  ready(): boolean;
}

/**
 * One synthesized note: oscillator (optional frequency sweep) -> optional filter -> gain envelope -> master.
 * Envelope: start at `peak` (or ramp up from silence over `attack`), optional `hold` step, then an
 * exponential decay to silence at `decay`; the oscillator stops at `stop`. Times are seconds after `at`.
 */
export function synthTone(ctx: BaseAudioContext, out: AudioNode, o: ToneSpec): void {
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
  g.connect(out);
  osc.start(t);
  osc.stop(t + o.stop);
}

/**
 * One noise burst: white noise shaped by `env(x)` (x = 0..1 over the buffer) -> optional filter -> gain.
 * Without `decay` the gain stays at `peak`.
 */
export function synthNoise(ctx: BaseAudioContext, out: AudioNode, o: NoiseSpec): void {
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
  g.connect(out);
  src.start(t);
  if (o.stop !== undefined) src.stop(t + o.stop);
}

/** [seconds after the note start, value, curve] frequency automation step (exponential by default) */
export type FreqStep = [number, number, ('exp' | 'lin')?];

export interface FilterSpec {
  type: BiquadFilterType;
  freq: number;
  Q?: number;
  sweep?: FreqStep[];
}

export interface ToneSpec {
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

export interface NoiseSpec {
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
