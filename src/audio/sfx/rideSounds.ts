/** Riding, traffic and enforcement sounds */
import type { Sfx } from '../soundSynth';

export function playMountSound(s: Sfx, mounting: boolean): void {
  s.tone({ type: 'triangle', freq: mounting ? 140 : 200, sweep: [[0.14, mounting ? 240 : 95]], peak: 0.22, decay: 0.16, stop: 0.17 });
}

export function playCrashSound(s: Sfx): void {
  // Low impact thud + asphalt scrape noise burst
  s.tone({ type: 'sine', freq: 135, sweep: [[0.28, 34]], peak: 0.65, decay: 0.3, stop: 0.32 });
  s.noise({ duration: 0.55, env: (x) => Math.pow(1 - x, 1.4), filter: { type: 'bandpass', freq: 1100 }, peak: 0.45, decay: 0.54 });
}

export function playPhoneMountClick(s: Sfx, mounting: boolean): void {
  s.tone({
    type: 'triangle',
    freq: mounting ? 520 : 840,
    sweep: [[mounting ? 0.045 : 0.055, mounting ? 1120 : 360]],
    peak: 0.24,
    decay: 0.065,
    stop: 0.07,
  });
}

/** Dual-tone realistic car klaxon honk when player cuts in front of an AI sedan/taxi */
export function playAiCarHorn(s: Sfx): void {
  // Classic Korean sedan dual-horn harmony (F4 ~349Hz + A4 ~440Hz, crisp short warning blast)
  [349.23, 440.0].forEach((freq) =>
    s.tone({
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
export function playCameraApproachBeep(s: Sfx, overSpeed: boolean): void {
  if (overSpeed) {
    // Urgent T-map style overspeed double-beep ("삐! 삐!")
    [0, 0.12].forEach((at) =>
      s.tone({ type: 'square', freq: 1480, at, filter: { type: 'lowpass', freq: 2400 }, attack: 0.008, peak: 0.14, decay: 0.085, stop: 0.095 })
    );
  } else {
    // Friendly 80m camera-ahead notice chime ("딩~동!")
    [880, 1174.66].forEach((freq, idx) =>
      s.tone({ type: 'sine', freq, at: idx * 0.12, attack: 0.012, peak: 0.2, decay: 0.22, stop: 0.24 })
    );
  }
}

/** Korean police patrol car wail siren ("우~웅 우~웅!") on live patrol enforcement */
export function playPoliceSiren(s: Sfx): void {
  // 2 classic rising/falling siren sweeps (~1.45s)
  s.tone({
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

export function playCameraShutter(s: Sfx): void {
  s.noise({ duration: 0.09, env: (x) => Math.pow(1 - x, 2), filter: { type: 'highpass', freq: 1800 }, peak: 0.42, decay: 0.085 });
}

/** Sharp roadside speed/red-light enforcement camera strobe click + penalty warning beep */
export function playSpeedCameraFlash(s: Sfx): void {
  if (!s.ready()) return;
  // 1. Crisp camera shutter snap, 2. two-tone Korean enforcement alert chime (high-low)
  playCameraShutter(s);
  [1046.5, 783.99].forEach((freq, i) =>
    s.tone({ type: 'square', freq, at: 0.08 + i * 0.15, filter: { type: 'lowpass', freq: 2100 }, attack: 0.01, peak: 0.16, decay: 0.14, stop: 0.16 })
  );
}

/** Short startled pedestrian gasp when scooter passes within 3.5m on the sidewalk */
export function playPedestrianStartle(s: Sfx): void {
  s.tone({
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
export function playPedestrianAccidentAlert(s: Sfx): void {
  const tones = [
    { t: 0, f: 880, dur: 0.16 },
    { t: 0.17, f: 622.25, dur: 0.18 },
    { t: 0.36, f: 880, dur: 0.16 },
    { t: 0.53, f: 523.25, dur: 0.32 },
  ];
  for (const n of tones) {
    s.tone({ type: 'sawtooth', freq: n.f, at: n.t, filter: { type: 'lowpass', freq: 1800 }, attack: 0.015, peak: 0.26, decay: n.dur, stop: n.dur + 0.02 });
  }
}

/** Rain starts: distant low thunder roll (filtered noise) */
export function playThunderRumble(s: Sfx): void {
  // Two rolling swells
  s.noise({
    duration: 2.6,
    env: (t) => Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.6)), 2) * (1 - t) + 0.5 * Math.pow(Math.sin(Math.PI * t), 4),
    filter: { type: 'lowpass', freq: 180 },
    peak: 0.9,
  });
}

/** Synthesizes low-fuel dashboard warning double-beep */
export function playLowFuelWarningBeep(s: Sfx): void {
  [1318.5, 987.77].forEach((freq, i) =>
    s.tone({ type: 'sine', freq, at: i * 0.13, attack: 0.012, peak: 0.18, decay: 0.1, stop: 0.11 })
  );
}

/** Deep double-thud suspension jolt ("덜컹-덜컹!") when crossing a speed bump */
export function playSpeedBumpThud(s: Sfx, intensity = 0.7): void {
  const vol = Math.min(0.48, 0.18 + intensity * 0.3);
  [0, 0.095].forEach((at, idx) =>
    s.tone({
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
export function playLiquidSlosh(s: Sfx): void {
  s.noise({
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

/** Wet rubber glove wiping across helmet visor ("쓱~ 뽀드득!") */
export function playVisorWipeSound(s: Sfx): void {
  const dur = 0.34;
  s.noise({
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

/** Soft modern smartphone wireless charging confirmation harmonic ping */
export function playWirelessChargeStart(s: Sfx): void {
  [587.33, 880, 1174.66].forEach((freq, i) =>
    s.tone({ type: 'sine', freq, at: i * 0.075, attack: 0.012, peak: 0.16, decay: 0.24, stop: 0.26 })
  );
}

/** Gentle descending low-battery alert chime */
export function playLowBatteryBeep(s: Sfx): void {
  [740, 554.37].forEach((freq, i) =>
    s.tone({ type: 'triangle', freq, at: i * 0.14, attack: 0.01, peak: 0.18, decay: 0.14, stop: 0.16 })
  );
}

/** Subtle tactile capacitive glass tap click when touching the smartphone screen */
export function playPhoneScreenTap(s: Sfx): void {
  s.tone({ type: 'sine', freq: 1150, sweep: [[0.026, 380]], attack: 0.004, peak: 0.14, decay: 0.03, stop: 0.034 });
}
