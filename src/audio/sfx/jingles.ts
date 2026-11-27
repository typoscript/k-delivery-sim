/** Short melodic jingles and chimes (calls accepted, goals, rush hours, shift end) */
import type { Sfx } from '../soundSynth';

export function playChime(s: Sfx, kind: 'accept' | 'pickup' | 'complete'): void {
  const notes =
    kind === 'complete' ? [523.25, 659.25, 783.99, 1046.5] : kind === 'pickup' ? [440, 587.33, 659.25] : [523.25, 659.25];
  notes.forEach((freq, idx) =>
    s.tone({ type: 'sine', freq, at: idx * 0.085, attack: 0.015, peak: 0.22, decay: 0.24, stop: 0.26 })
  );
}

/** Celebratory fanfare chime for completing the Daily Delivery Mission (+₩5,000 bonus!) */
export function playMissionBonusFanfare(s: Sfx): void {
  const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98];
  notes.forEach((freq, idx) =>
    s.tone({
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

/** Lunch / dinner rush begins: bright rising "rush hour" jingle */
export function playPeakRushJingle(s: Sfx): void {
  s.notes([392, 523.25, 659.25, 783.99, 1046.5, 1318.5], 'triangle', 0.075, 0.2, 0.28);
}

/** Rush hour over: gentle falling two-note sign-off */
export function playPeakEndChime(s: Sfx): void {
  s.notes([659.25, 523.25], 'sine', 0.16, 0.14, 0.4);
}

/** Daily goal reached (sparkle on top of the mission fanfare) */
export function playGoalSparkle(s: Sfx): void {
  s.notes([1567.98, 2093, 2637, 3135.96], 'sine', 0.05, 0.08, 0.22);
}

/** Clock-out: warm closing cadence for the end of the working day */
export function playShiftEndCadence(s: Sfx): void {
  s.notes([523.25, 659.25, 783.99, 659.25, 523.25, 392, 523.25], 'triangle', 0.13, 0.17, 0.42);
}
