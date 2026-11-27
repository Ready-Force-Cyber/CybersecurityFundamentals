class AudioController {
  private ctx: AudioContext | null = null;
  private enabled: boolean = true;

  /** Turn every sound effect on or off (an instructor setting). */
  setEnabled(on: boolean) {
    this.enabled = on;
  }

  isEnabled() {
    return this.enabled;
  }

  private getContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  private playTone(
    frequency: number,
    type: OscillatorType,
    duration: number,
    volume: number = 0.1,
    frequencySlideTo?: number
  ) {
    if (!this.enabled) return;
    try {
      const ctx = this.getContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(frequency, ctx.currentTime);
      if (frequencySlideTo) {
        osc.frequency.exponentialRampToValueAtTime(frequencySlideTo, ctx.currentTime + duration);
      }

      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) {
      // Ignore audio errors (e.g. user hasn't interacted with page yet)
    }
  }

  private playComplexTone(
    frequencies: number[],
    type: OscillatorType,
    duration: number,
    volume: number = 0.1,
    filterFreq?: number
  ) {
      if (!this.enabled) return;
      try {
        const ctx = this.getContext();
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(volume, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        
        // Add lowpass filter if requested
        let outputNode: AudioNode = gain;
        if (filterFreq) {
            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(filterFreq, ctx.currentTime);
            filter.frequency.exponentialRampToValueAtTime(Math.max(filterFreq * 0.1, 20), ctx.currentTime + duration);
            gain.connect(filter);
            outputNode = filter;
        }

        outputNode.connect(ctx.destination);

        frequencies.forEach(freq => {
            const osc = ctx.createOscillator();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, ctx.currentTime);
            osc.connect(gain);
            osc.start();
            osc.stop(ctx.currentTime + duration);
        });
      } catch (e) { }
  }

  playCorrect() {
    // A nice sparkly major third ping
    this.playTone(523.25, 'sine', 0.15, 0.08); 
    setTimeout(() => this.playComplexTone([659.25, 1318.51], 'sine', 0.5, 0.08), 80); 
  }

  playIncorrect() {
    // Subtle low thud/buzz with filter
    this.playComplexTone([150, 155], 'sawtooth', 0.3, 0.06, 400);
    setTimeout(() => this.playComplexTone([100, 103], 'square', 0.4, 0.06, 200), 120);
  }

  playTick() {
    // Very subtle high tick
    this.playTone(1200, 'sine', 0.03, 0.01, 800);
  }

  playStart() {
    // A quick rising whoosh/chime to get ready
    this.playTone(300, 'sine', 0.4, 0.05, 800);
    setTimeout(() => this.playTone(600, 'sine', 0.3, 0.05, 1200), 100);
    setTimeout(() => this.playComplexTone([800, 1600], 'sine', 0.6, 0.06), 200);
  }

  playEnd() {
    // Triumphant ending chord arpeggio
    this.playTone(440, 'triangle', 0.15, 0.08); // A4
    setTimeout(() => this.playTone(554.37, 'triangle', 0.15, 0.08), 100); // C#5
    setTimeout(() => this.playTone(659.25, 'triangle', 0.15, 0.08), 200); // E5
    setTimeout(() => this.playComplexTone([880, 1760], 'sine', 1.0, 0.1), 300); // A5 big resolve
  }

  /**
   * The winners' podium: a short brass-style fanfare ("da-da-da DAAA ...")
   * that lands on a big C major chord with a sparkle, then applause.
   */
  playFanfare() {
    if (!this.enabled) return;
    // A slightly detuned octave through a closing lowpass sounds brassy.
    const horn = (freq: number, at: number, dur: number, vol = 0.05) =>
      setTimeout(() => this.playComplexTone([freq, freq * 2.004], 'sawtooth', dur, vol, 2600), at);
    horn(392, 0, 0.14); // G4
    horn(392, 150, 0.14); // G4
    horn(392, 300, 0.14); // G4
    horn(523.25, 450, 0.45, 0.06); // C5, held
    horn(659.25, 820, 0.16); // E5
    horn(783.99, 990, 0.16); // G5
    setTimeout(() => this.playComplexTone([523.25, 659.25, 783.99, 1046.5], 'sawtooth', 1.8, 0.04, 3200), 1160);
    setTimeout(() => this.playComplexTone([2093, 2637.02, 3135.96], 'sine', 1.4, 0.025), 1200);
    setTimeout(() => this.playApplause(), 1100);
  }

  // --- The game-show wheel ---------------------------------------------------

  private lastWheelClick = 0;
  private noiseBuffer: AudioBuffer | null = null;

  private noise(ctx: AudioContext) {
    if (!this.noiseBuffer || this.noiseBuffer.sampleRate !== ctx.sampleRate) {
      const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buffer;
    }
    return this.noiseBuffer;
  }

  /**
   * The flapper hitting a peg: a sharp wooden "tk", a little different each
   * time. Called for every peg that passes the pointer; at top speed the
   * clicks are thinned out so they don't blur into a buzz.
   */
  playWheelClick() {
    if (!this.enabled) return;
    const now = performance.now();
    if (now - this.lastWheelClick < 40) return;
    this.lastWheelClick = now;
    try {
      const ctx = this.getContext();
      const t = ctx.currentTime;
      const pitch = 0.9 + Math.random() * 0.2;

      const src = ctx.createBufferSource();
      src.buffer = this.noise(ctx);
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 3000 * pitch;
      band.Q.value = 2.5;
      const clack = ctx.createGain();
      clack.gain.setValueAtTime(0.35, t);
      clack.gain.exponentialRampToValueAtTime(0.001, t + 0.025);
      src.connect(band).connect(clack).connect(ctx.destination);
      src.start(t, Math.random() * 0.5);
      src.stop(t + 0.04);

      const knock = ctx.createOscillator();
      knock.type = 'triangle';
      knock.frequency.setValueAtTime(1500 * pitch, t);
      knock.frequency.exponentialRampToValueAtTime(700 * pitch, t + 0.03);
      const body = ctx.createGain();
      body.gain.setValueAtTime(0.08, t);
      body.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      knock.connect(body).connect(ctx.destination);
      knock.start(t);
      knock.stop(t + 0.05);
    } catch (e) { }
  }

  /** The wheel being pulled: a quick rising-then-falling whoosh of air. */
  playWheelWhoosh() {
    if (!this.enabled) return;
    try {
      const ctx = this.getContext();
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = this.noise(ctx);
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = 1.2;
      band.frequency.setValueAtTime(350, t);
      band.frequency.exponentialRampToValueAtTime(2200, t + 0.25);
      band.frequency.exponentialRampToValueAtTime(500, t + 0.9);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.22, t + 0.18);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      src.connect(band).connect(gain).connect(ctx.destination);
      src.start(t);
      src.stop(t + 0.95);
    } catch (e) { }
  }

  /** The wheel comes to rest: a bright bell "ding". */
  playWheelLand() {
    if (!this.enabled) return;
    // A bell: a fundamental, its octave, and a slightly "off" partial that
    // makes it ring like metal rather than a pure beep.
    this.playComplexTone([987.77, 1975.53], 'sine', 1.4, 0.09);
    this.playTone(987.77 * 2.76, 'sine', 0.6, 0.025);
    setTimeout(() => this.playComplexTone([1318.51, 2637.02], 'sine', 1.2, 0.07), 140);
  }

  /**
   * A snare drumroll that builds for `seconds`, for a big reveal. Rapid
   * soft noise hits, getting louder towards the end.
   */
  playDrumroll(seconds = 2) {
    if (!this.enabled) return;
    try {
      const ctx = this.getContext();
      const start = ctx.currentTime + 0.02;
      const gap = 0.045;
      const hits = Math.floor(seconds / gap);
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 2200;
      band.Q.value = 0.8;
      band.connect(ctx.destination);
      for (let i = 0; i < hits; i++) {
        const t = start + i * gap + (Math.random() - 0.5) * 0.008;
        const level = 0.05 + 0.2 * Math.pow(i / hits, 1.6);
        const src = ctx.createBufferSource();
        src.buffer = this.noise(ctx);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(level, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
        src.connect(gain).connect(band);
        src.start(t, Math.random() * 0.5);
        src.stop(t + 0.07);
      }
    } catch (e) { }
  }

  /** A couple of seconds of applause: quick claps over a soft crowd hiss. */
  playApplause(duration = 2.4) {
    if (!this.enabled) return;
    try {
      const ctx = this.getContext();
      const rate = ctx.sampleRate;
      const length = Math.floor(rate * duration);
      const buffer = ctx.createBuffer(1, length, rate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * 0.12;
      const clapLength = Math.floor(rate * 0.02);
      for (let c = 0; c < duration * 30; c++) {
        const start = Math.floor(Math.random() * (length - clapLength));
        for (let j = 0; j < clapLength; j++) {
          data[start + j] += (Math.random() * 2 - 1) * 0.8 * Math.exp(-j / (clapLength / 4));
        }
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 1800;
      band.Q.value = 0.6;
      const gain = ctx.createGain();
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.08, t + 0.3);
      gain.gain.setValueAtTime(0.08, t + duration * 0.45);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

      source.connect(band);
      band.connect(gain);
      gain.connect(ctx.destination);
      source.start();
      source.stop(t + duration);
    } catch (e) { }
  }
}

export const audio = new AudioController();
