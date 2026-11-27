/** Delivery, building and shop sounds */
import type { Sfx } from '../soundSynth';

export function playKeypadBeep(s: Sfx, ok: boolean): void {
  s.tone({ type: ok ? 'sine' : 'sawtooth', freq: ok ? 920 : 210, peak: 0.16, decay: ok ? 0.07 : 0.22, stop: ok ? 0.08 : 0.24 });
}

export function playCargoBoxSound(s: Sfx): void {
  s.tone({ type: 'triangle', freq: 220, sweep: [[0.16, 110]], peak: 0.28, decay: 0.18, stop: 0.19 });
}

export function playElevatorDing(s: Sfx): void {
  [880, 1174.66].forEach((freq, i) => s.tone({ type: 'sine', freq, at: i * 0.18, peak: 0.22, decay: 0.55, stop: 0.58 }));
}

/** Bright restaurant pickup counter "딩동~ 딩동!" bell ("음식이 준비되었습니다!") */
export function playFoodReadyDingDong(s: Sfx): void {
  const tones = [
    { t: 0, f: 783.99, dur: 0.24 }, // G5
    { t: 0.16, f: 659.25, dur: 0.28 }, // E5
    { t: 0.36, f: 1046.5, dur: 0.45 }, // C6 bright finish
  ];
  for (const n of tones) {
    s.tone({ type: 'sine', freq: n.f, at: n.t, attack: 0.012, peak: 0.28, decay: n.dur, stop: n.dur + 0.02 });
  }
}

/** Realistic hollow wooden apartment door knock sound ("똑! 똑! 똑!") */
export function playDoorKnockSound(s: Sfx): void {
  [0, 0.22, 0.44].forEach((at) =>
    s.tone({ type: 'triangle', freq: 190, at, sweep: [[0.075, 72]], peak: 0.42, decay: 0.085, stop: 0.09 })
  );
}

/** Apartment intercom doorbell ("딩동~") + synthesized friendly dialogue cadence ("누구세요? 배달이요!") */
export function playIntercomBellAndVoice(s: Sfx): void {
  // 1. Classic Korean apartment "딩~ 동~" chime (E5 -> C5)
  [659.25, 523.25].forEach((freq, i) =>
    s.tone({ type: 'sine', freq, at: i * 0.28, attack: 0.015, peak: 0.28, decay: 0.46, stop: 0.48 })
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
    s.tone({
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
export function playDispatchCallAlert(s: Sfx): void {
  // Signature bright "띠리링~ 띠리링~" ascending electronic chime (E6 - G#6 - B6 - E7), twice,
  // over a low haptic smartphone vibration hum on the handlebar mount
  const melody = [1318.5, 1661.2, 1975.5, 2637.0];
  for (let rep = 0; rep < 2; rep++) {
    const baseT = rep * 0.34;
    melody.forEach((freq, idx) =>
      s.tone({
        type: idx === melody.length - 1 ? 'triangle' : 'sine',
        freq,
        at: baseT + idx * 0.062,
        attack: 0.01,
        peak: 0.24,
        decay: 0.16,
        stop: 0.18,
      })
    );
    s.tone({ type: 'sawtooth', freq: 92, at: baseT, filter: { type: 'lowpass', freq: 180 }, peak: 0.14, decay: 0.2, stop: 0.22 });
  }
}

/** Soft descending two-tone sound when a 20s call offer expires or is declined */
export function playDispatchExpiredSound(s: Sfx): void {
  [440, 311.13].forEach((freq, i) => s.tone({ type: 'sine', freq, at: i * 0.12, peak: 0.16, decay: 0.14, stop: 0.16 }));
}

/** Soft rhythmic pump click while refueling */
export function playFuelPumpTick(s: Sfx): void {
  s.tone({ type: 'triangle', freq: 340, sweep: [[0.04, 520]], peak: 0.12, decay: 0.05, stop: 0.055 });
}

/** Korean self-service POS / card terminal payment complete chime ("결제가 완료되었습니다" tone) */
export function playPaymentCompleteSound(s: Sfx): void {
  [1046.5, 1318.5, 1567.98, 2093.0].forEach((freq, idx) =>
    s.tone({ type: 'triangle', freq, at: idx * 0.075, attack: 0.01, peak: 0.24, decay: 0.22, stop: 0.24 })
  );
}

/** Mechanic air-wrench whir & confirmation chime for scooter repair */
export function playRepairSound(s: Sfx): void {
  for (let i = 0; i < 3; i++) {
    s.tone({ type: 'sawtooth', freq: 220, at: i * 0.14, sweep: [[0.09, 640]], peak: 0.18, decay: 0.11, stop: 0.12 });
  }
}

/** Crisp Korean messenger-style two-tone ping ("카톡/띠링!") for live customer chat messages */
export function playCustomerChatPing(s: Sfx): void {
  const notes = [
    { t: 0, f: 880, dur: 0.11 },
    { t: 0.095, f: 1318.5, dur: 0.22 },
  ];
  for (const n of notes) {
    s.tone({ type: 'sine', freq: n.f, at: n.t, attack: 0.01, peak: 0.25, decay: n.dur, stop: n.dur + 0.02 });
  }
}

/** Subtle terrazzo stair footstep click while climbing walk-up villa stairs */
export function playStairFootstep(s: Sfx): void {
  if (!s.ready()) return;
  s.tone({ type: 'triangle', freq: 175 + Math.random() * 35, sweep: [[0.055, 62]], peak: 0.14, decay: 0.065, stop: 0.07 });
}

/** Classic Korean 24h convenience store bright entrance/checkout chime ("띠리링~!") */
export function playConvenienceChime(s: Sfx): void {
  const notes = [
    { t: 0, f: 987.77, dur: 0.16 }, // B5
    { t: 0.13, f: 1318.51, dur: 0.16 }, // E6
    { t: 0.26, f: 1567.98, dur: 0.32 }, // G6
  ];
  for (const n of notes) {
    s.tone({ type: 'sine', freq: n.f, at: n.t, attack: 0.012, peak: 0.24, decay: n.dur, stop: n.dur + 0.02 });
  }
}

/** Metallic sliding sound for 3D stainless-steel apartment elevator doors */
export function playElevatorDoorSlide(s: Sfx): void {
  const dur = 0.55;
  s.noise({
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
export function playElevatorFloorTick(s: Sfx): void {
  s.tone({ type: 'sine', freq: 1120, attack: 0.008, peak: 0.055, decay: 0.055, stop: 0.065 });
}

/** Special order call (urgent / group): distinct double alert before the normal call alert */
export function playSpecialOrderAlert(s: Sfx, kind: 'urgent' | 'group'): void {
  if (kind === 'urgent') s.notes([1318.5, 987.77, 1318.5, 987.77], 'square', 0.09, 0.08, 0.08);
  else s.notes([523.25, 659.25, 783.99, 659.25, 783.99], 'triangle', 0.07, 0.16, 0.18);
}

/** Urgent delivery running out (last 30s): short clock tick */
export function playUrgentTick(s: Sfx, final: boolean): void {
  s.notes([final ? 1760 : 1320], 'square', 0, final ? 0.1 : 0.06, 0.05);
}
