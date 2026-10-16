/**
 * Web Audio Ambient Soundscape Synthesizer for RIVER.EYE Cinematic Landing.
 * Generates realistic procedural river flow, mountain wind, and underwater acoustics.
 */
class RiverAudioSynthesizer {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.riverGain = null;
    this.windGain = null;
    this.underwaterFilter = null;
    this.isMuted = true;
    this.isPlaying = false;
  }

  init() {
    if (this.ctx) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(0.0, this.ctx.currentTime);
    this.masterGain.connect(this.ctx.destination);

    // Master filter (normal vs underwater)
    this.underwaterFilter = this.ctx.createBiquadFilter();
    this.underwaterFilter.type = "lowpass";
    this.underwaterFilter.frequency.setValueAtTime(14000, this.ctx.currentTime);
    this.underwaterFilter.connect(this.masterGain);

    // 1. Procedural River Water Flow Sound (Dual pink noise with resonance)
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    const riverFilter1 = this.ctx.createBiquadFilter();
    riverFilter1.type = "bandpass";
    riverFilter1.frequency.setValueAtTime(450, this.ctx.currentTime);
    riverFilter1.Q.setValueAtTime(1.2, this.ctx.currentTime);

    const riverFilter2 = this.ctx.createBiquadFilter();
    riverFilter2.type = "lowpass";
    riverFilter2.frequency.setValueAtTime(1800, this.ctx.currentTime);

    this.riverGain = this.ctx.createGain();
    this.riverGain.gain.setValueAtTime(0.45, this.ctx.currentTime);

    whiteNoise.connect(riverFilter1);
    riverFilter1.connect(riverFilter2);
    riverFilter2.connect(this.riverGain);
    this.riverGain.connect(this.underwaterFilter);
    whiteNoise.start();

    // 2. Mountain Wind Breeze
    const windNoise = this.ctx.createBufferSource();
    windNoise.buffer = noiseBuffer;
    windNoise.loop = true;

    const windFilter = this.ctx.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.setValueAtTime(220, this.ctx.currentTime);
    windFilter.Q.setValueAtTime(2.0, this.ctx.currentTime);

    this.windGain = this.ctx.createGain();
    this.windGain.gain.setValueAtTime(0.2, this.ctx.currentTime);

    windNoise.connect(windFilter);
    windFilter.connect(this.windGain);
    this.windGain.connect(this.underwaterFilter);
    windNoise.start();

    // Subtle wind oscillation (breathing breeze)
    const lfo = this.ctx.createOscillator();
    lfo.frequency.setValueAtTime(0.15, this.ctx.currentTime);
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.setValueAtTime(120, this.ctx.currentTime);
    lfo.connect(lfoGain);
    lfoGain.connect(windFilter.frequency);
    lfo.start();
  }

  toggleMute() {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume();
    }
    this.isMuted = !this.isMuted;
    const targetGain = this.isMuted ? 0.0 : 0.65;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.masterGain.gain.linearRampToValueAtTime(targetGain, this.ctx.currentTime + 0.4);
    }
    return !this.isMuted;
  }

  setUnderwater(isUnderwater) {
    if (!this.ctx || !this.underwaterFilter) return;
    const freq = isUnderwater ? 380 : 14000;
    this.underwaterFilter.frequency.cancelScheduledValues(this.ctx.currentTime);
    this.underwaterFilter.frequency.exponentialRampToValueAtTime(freq, this.ctx.currentTime + 0.5);
  }

  setIntensity(riverIntensity, windIntensity) {
    if (!this.ctx) return;
    if (this.riverGain) {
      this.riverGain.gain.linearRampToValueAtTime(Math.max(0.1, riverIntensity * 0.6), this.ctx.currentTime + 0.3);
    }
    if (this.windGain) {
      this.windGain.gain.linearRampToValueAtTime(Math.max(0.05, windIntensity * 0.35), this.ctx.currentTime + 0.3);
    }
  }
}

export const riverAudio = new RiverAudioSynthesizer();
