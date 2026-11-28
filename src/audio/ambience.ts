/** Background loops: rain by intensity (muffled indoors) and the elevator hum */
import type { GameAudio } from './GameAudio';

/** Continuous low traction-motor hum while riding the 3D apartment elevator */
export function setElevatorHum(host: GameAudio, active: boolean): void {
  if (!host.started || !host.ctx || !host.masterGain) return;
  const now = host.ctx.currentTime;
  if (!host.elevHumOsc || !host.elevHumGain) {
    const osc = host.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 74;
    const filt = host.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 170;
    const g = host.ctx.createGain();
    g.gain.value = 0;
    osc.connect(filt);
    filt.connect(g);
    g.connect(host.masterGain);
    osc.start();
    host.elevHumOsc = osc;
    host.elevHumGain = g;
  }
  const target = active && !host.muted ? 0.14 : 0;
  host.elevHumGain.gain.setTargetAtTime(target, now, 0.12);
}

/**
 * Controls continuous rain ambience volume.
 * Immediately silences rain audio with zero fade tail when inside underground corridors (y = -500)!
 */
export function updateWeatherAudio(host: GameAudio, rainIntensity: number, inCorridor: boolean): void {
  if (!host.started || !host.ctx || !host.rainGain) return;
  const now = host.ctx.currentTime;
  if (inCorridor || host.muted || rainIntensity <= 0.01) {
    host.rainGain.gain.cancelScheduledValues(now);
    host.rainGain.gain.setValueAtTime(0, now);
    return;
  }
  const targetVol = 0.34 * rainIntensity;
  host.rainGain.gain.setTargetAtTime(targetVol, now, 0.14);
}

/** Looping noise beds made on first use (wind on bridges, a stream's water), one per kind */
interface NoiseBed {
  gain: GainNode;
  filter: BiquadFilterNode;
}
const beds = new WeakMap<GameAudio, Map<string, NoiseBed>>();

function noiseBed(host: GameAudio, kind: string, type: BiquadFilterType, freq: number, q: number): NoiseBed | null {
  if (!host.started || !host.ctx || !host.masterGain) return null;
  let map = beds.get(host);
  if (!map) beds.set(host, (map = new Map()));
  const have = map.get(kind);
  if (have) return have;
  const ctx = host.ctx;
  const len = Math.floor(ctx.sampleRate * 3);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  // brown-ish noise: a smoothed random walk (seeded so the bed is the same every time)
  let seed = kind === 'wind' ? 0x2f6b1 : 0x51a7e;
  let last = 0;
  for (let i = 0; i < len; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const white = seed / 2147483648 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.2;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  src.connect(filter);
  filter.connect(gain);
  gain.connect(host.masterGain);
  src.start();
  const bed = { gain, filter };
  map.set(kind, bed);
  return bed;
}

/**
 * Wind on a bridge: a low rushing whoosh whose loudness and brightness follow the gust (`level` 0..1); silent
 * indoors / muted / calm
 */
export function setWindAmbience(host: GameAudio, level: number): void {
  const bed = level > 0.01 || beds.get(host)?.has('wind') ? noiseBed(host, 'wind', 'lowpass', 380, 0.9) : null;
  if (!bed || !host.ctx) return;
  const now = host.ctx.currentTime;
  const l = host.muted ? 0 : Math.max(0, Math.min(1, level));
  bed.gain.gain.setTargetAtTime(0.42 * l, now, 0.25);
  bed.filter.frequency.setTargetAtTime(300 + 900 * l, now, 0.3);
}

/** A stream's running water near the rider (`level` 0..1 by distance; louder after rain via the caller) */
export function setWaterAmbience(host: GameAudio, level: number): void {
  const bed = level > 0.01 || beds.get(host)?.has('water') ? noiseBed(host, 'water', 'bandpass', 1400, 0.55) : null;
  if (!bed || !host.ctx) return;
  const now = host.ctx.currentTime;
  const l = host.muted ? 0 : Math.max(0, Math.min(1, level));
  bed.gain.gain.setTargetAtTime(0.3 * l, now, 0.4);
}
