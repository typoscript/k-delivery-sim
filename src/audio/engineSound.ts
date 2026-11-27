/** Per-frame scooter sound: engine pitch / volume, tire screech, blinker clicks and the low-fuel beep */
import type { GameAudio } from './GameAudio';
import { ScooterState } from '../vehicle/ScooterPhysics';

export function update(host: GameAudio, scooter: ScooterState, elapsedTime: number): void {
  if (
    !host.started ||
    !host.ctx ||
    !host.engineOsc1 ||
    !host.engineOsc2 ||
    !host.engineFilter ||
    !host.engineGain ||
    !host.screechGain ||
    !host.screechOsc
  ) {
    return;
  }

  const now = host.ctx.currentTime;

  // Periodic low-fuel warning beep while mounted with <= 10% fuel (even when completely empty!)
  if (scooter.mounted && scooter.lowFuelWarning && elapsedTime - host.lastLowFuelBeepTime >= 4.2) {
    host.lastLowFuelBeepTime = elapsedTime;
    host.playLowFuelWarningBeep();
  }

  if (!scooter.engineOn) {
    host.engineGain.gain.setTargetAtTime(0, now, 0.08);
    host.screechGain.gain.setTargetAtTime(0, now, 0.05);
    return;
  }

  if (scooter.modelId === 'electric') {
    // Ultra-quiet futuristic EV inverter motor whirr (silent at standstill, silky pitch rise with speed!)
    const evSpeedFrac = Math.min(1, Math.abs(scooter.speed) / 23.9);
    const evFreq = 210 + evSpeedFrac * 560 + scooter.throttleAmount * 90;
    host.engineOsc1.type = 'sine';
    host.engineOsc2.type = 'triangle';
    host.engineOsc1.frequency.setTargetAtTime(evFreq, now, 0.05);
    host.engineOsc2.frequency.setTargetAtTime(evFreq * 1.5, now, 0.05);
    host.engineFilter.frequency.setTargetAtTime(900 + evSpeedFrac * 1400, now, 0.05);
    const evGain = evSpeedFrac * 0.08 + scooter.throttleAmount * 0.045;
    host.engineGain.gain.setTargetAtTime(evGain, now, 0.06);
  } else if (scooter.modelId === 'cub') {
    // Classic Super Cub low-pitch warm single-cylinder retro thump!
    const cubFreq = 42 + scooter.rpmNorm * 98;
    host.engineOsc1.type = 'sawtooth';
    host.engineOsc2.type = 'triangle';
    host.engineOsc1.frequency.setTargetAtTime(cubFreq, now, 0.04);
    host.engineOsc2.frequency.setTargetAtTime(cubFreq * 2.0, now, 0.04);
    host.engineFilter.frequency.setTargetAtTime(180 + scooter.rpmNorm * 420 + scooter.throttleAmount * 160, now, 0.05);
    host.engineGain.gain.setTargetAtTime(0.13 + scooter.throttleAmount * 0.13 + scooter.rpmNorm * 0.07, now, 0.06);
  } else {
    // Standard PCX 125 crisp CVT scooter engine
    const freq = 58 + scooter.rpmNorm * 135;
    host.engineOsc1.type = 'sawtooth';
    host.engineOsc2.type = 'triangle';
    host.engineOsc1.frequency.setTargetAtTime(freq, now, 0.04);
    host.engineOsc2.frequency.setTargetAtTime(freq * 1.99, now, 0.04);
    host.engineFilter.frequency.setTargetAtTime(220 + scooter.rpmNorm * 580 + scooter.throttleAmount * 220, now, 0.05);
    host.engineGain.gain.setTargetAtTime(0.14 + scooter.throttleAmount * 0.14 + scooter.rpmNorm * 0.08, now, 0.06);
  }

  // Tire screech scales smoothly when corner lean approaches traction limit
  const screechAmt = scooter.slipWarning ? Math.min((scooter.leanRisk - 0.7) * 0.85, 0.28) : 0;
  host.screechGain.gain.setTargetAtTime(screechAmt, now, 0.04);
  host.screechOsc.frequency.setTargetAtTime(700 + scooter.leanRisk * 240, now, 0.04);

  const anyBlink = scooter.leftBlinker || scooter.rightBlinker || scooter.hazard;
  const blinkPhase = Math.floor(elapsedTime * 2.5) % 2 === 0;
  if (anyBlink && blinkPhase !== host.lastBlinkPhase) {
    host.playBlinkerClick(blinkPhase);
  }
  host.lastBlinkPhase = blinkPhase;
}
