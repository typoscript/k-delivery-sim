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
