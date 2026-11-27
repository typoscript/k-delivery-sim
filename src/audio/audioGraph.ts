/** Creates the AudioContext and the always-on nodes (engine, screech, horn, rain) on the first user gesture */
import type { GameAudio } from './GameAudio';

export function ensureStarted(host: GameAudio): void {
  if (host.started) {
    if (host.ctx && host.ctx.state === 'suspended') {
      void host.ctx.resume();
    }
    return;
  }
  try {
    const AudioCtx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    host.ctx = new AudioCtx();

    host.masterGain = host.ctx.createGain();
    host.masterGain.gain.value = host.muted ? 0 : 0.3 * host.masterVolume;
    host.masterGain.connect(host.ctx.destination);

    // Compact 125cc CVT scooter buzz
    host.engineFilter = host.ctx.createBiquadFilter();
    host.engineFilter.type = 'lowpass';
    host.engineFilter.frequency.value = 320;
    host.engineFilter.Q.value = 1.8;

    host.engineGain = host.ctx.createGain();
    host.engineGain.gain.value = 0;

    host.engineOsc1 = host.ctx.createOscillator();
    host.engineOsc1.type = 'sawtooth';
    host.engineOsc1.frequency.value = 62;

    host.engineOsc2 = host.ctx.createOscillator();
    host.engineOsc2.type = 'triangle';
    host.engineOsc2.frequency.value = 124;

    host.engineOsc1.connect(host.engineFilter);
    host.engineOsc2.connect(host.engineFilter);
    host.engineFilter.connect(host.engineGain);
    host.engineGain.connect(host.masterGain);

    host.engineOsc1.start();
    host.engineOsc2.start();

    // Tire slip / screech warning synth when over-leaning in corners
    host.screechGain = host.ctx.createGain();
    host.screechGain.gain.value = 0;
    const screechFilter = host.ctx.createBiquadFilter();
    screechFilter.type = 'bandpass';
    screechFilter.frequency.value = 1450;
    screechFilter.Q.value = 6.0;
    host.screechOsc = host.ctx.createOscillator();
    host.screechOsc.type = 'sawtooth';
    host.screechOsc.frequency.value = 740;
    host.screechOsc.connect(screechFilter);
    screechFilter.connect(host.screechGain);
    host.screechGain.connect(host.masterGain);
    host.screechOsc.start();

    // Scooter horn
    host.hornGain = host.ctx.createGain();
    host.hornGain.gain.value = 0;
    host.hornOsc = host.ctx.createOscillator();
    host.hornOsc.type = 'sawtooth';
    host.hornOsc.frequency.value = 460;
    const hornFilter = host.ctx.createBiquadFilter();
    hornFilter.type = 'bandpass';
    hornFilter.frequency.value = 900;
    host.hornOsc.connect(hornFilter);
    hornFilter.connect(host.hornGain);
    host.hornGain.connect(host.masterGain);
    host.hornOsc.start();

    // Continuous procedural rainfall ambience (looping filtered pink-ish noise buffer)
    const rainLen = Math.floor(host.ctx.sampleRate * 2.5);
    const rainBuf = host.ctx.createBuffer(1, rainLen, host.ctx.sampleRate);
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
    const rainSrc = host.ctx.createBufferSource();
    rainSrc.buffer = rainBuf;
    rainSrc.loop = true;

    host.rainFilter = host.ctx.createBiquadFilter();
    host.rainFilter.type = 'bandpass';
    host.rainFilter.frequency.value = 1150;
    host.rainFilter.Q.value = 0.65;

    host.rainGain = host.ctx.createGain();
    host.rainGain.gain.value = 0;

    rainSrc.connect(host.rainFilter);
    host.rainFilter.connect(host.rainGain);
    host.rainGain.connect(host.masterGain);
    rainSrc.start();

    host.started = true;
  } catch {
    // AudioContext unavailable
  }
}
