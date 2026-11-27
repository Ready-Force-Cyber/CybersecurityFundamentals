// Waiting-room music for the instructor's screen while students join.
//
// A short, calm synthwave loop made in the browser with the Web Audio API, so
// there is no audio file to download or license: a soft kick and hats, a
// syncopated bass, a pad, a bubbling arpeggio through an echo, and a simple
// lead melody every other pass. Eight bars in A minor (Am, F, C, G) at 104 BPM,
// repeating seamlessly. It fades in on start and out on stop, and goes quiet
// while the tab is hidden.

const BPM = 104;
const STEP = 60 / BPM / 4; // one sixteenth note, in seconds
const STEPS_PER_BAR = 16;
const BARS = 8;
const LOOP_STEPS = STEPS_PER_BAR * BARS;
const LOOKAHEAD = 0.15; // schedule this far ahead, in seconds
const TICK_MS = 25;
const VOLUME = 0.55;

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

// Am, F, C, G, twice. Pad voicings sit around middle C; bass roots below.
const CHORDS = [
  { bass: 45, pad: [57, 60, 64] }, // Am
  { bass: 41, pad: [57, 60, 65] }, // F
  { bass: 48, pad: [55, 60, 64] }, // C
  { bass: 43, pad: [55, 59, 62] }, // G
];

// The lead plays on the second half of the loop: step-in-bar → MIDI note.
const LEAD: Record<number, Record<number, number>> = {
  4: { 0: 76, 3: 74, 6: 72, 8: 69 },
  5: { 0: 72, 3: 74, 6: 76, 10: 72 },
  6: { 0: 79, 3: 76, 6: 74, 8: 72 },
  7: { 0: 74, 4: 71, 8: 74, 12: 76 },
};

const ARP_ORDER = [0, 1, 2, 3, 2, 1, 0, 1];
const BASS_STEPS = new Set([0, 3, 6, 8, 11, 14]);

class LobbyMusic {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private echo: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private timer: number | null = null;
  private step = 0;
  private nextTime = 0;
  private unlock: (() => void) | null = null;
  private onVisibility: (() => void) | null = null;

  get playing() {
    return this.ctx !== null;
  }

  start() {
    if (this.ctx) return;
    let ctx: AudioContext;
    try {
      ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch {
      return; // no Web Audio: just no music
    }
    this.ctx = ctx;

    // master → gentle compressor → speakers
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    comp.connect(ctx.destination);
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, ctx.currentTime);
    master.gain.exponentialRampToValueAtTime(VOLUME, ctx.currentTime + 2.5);
    master.connect(comp);
    this.master = master;

    // A dotted-eighth echo for the arpeggio and lead.
    const echo = ctx.createGain();
    const delay = ctx.createDelay(1);
    delay.delayTime.value = STEP * 3;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 2400;
    echo.connect(delay);
    delay.connect(tone);
    tone.connect(feedback);
    feedback.connect(delay);
    tone.connect(master);
    echo.gain.value = 0.5;
    this.echo = echo;

    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = noise;

    this.step = 0;
    this.nextTime = ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);

    // Browsers only allow sound after the person has used the page; if it was
    // blocked, the next click or key press starts it.
    if (ctx.state === "suspended") {
      this.unlock = () => {
        if (!document.hidden) void this.ctx?.resume();
      };
      window.addEventListener("pointerdown", this.unlock);
      window.addEventListener("keydown", this.unlock);
      void ctx.resume();
    }
    // Pause while the tab is hidden (timers slow down there and would stutter).
    this.onVisibility = () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    };
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  stop(fade = 0.8) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.timer !== null) window.clearInterval(this.timer);
    if (this.unlock) {
      window.removeEventListener("pointerdown", this.unlock);
      window.removeEventListener("keydown", this.unlock);
    }
    if (this.onVisibility) document.removeEventListener("visibilitychange", this.onVisibility);
    const master = this.master;
    if (master) {
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), now);
      master.gain.exponentialRampToValueAtTime(0.0001, now + fade);
    }
    window.setTimeout(() => void ctx.close().catch(() => {}), fade * 1000 + 100);
    this.ctx = this.master = this.echo = null;
    this.noise = null;
    this.timer = null;
    this.unlock = this.onVisibility = null;
  }

  // --- scheduling -----------------------------------------------------------

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    // After a long pause, don't try to catch up on missed notes.
    if (this.nextTime < ctx.currentTime - 0.2) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step = (this.step + 1) % LOOP_STEPS;
    }
  }

  private playStep(step: number, t: number) {
    const bar = Math.floor(step / STEPS_PER_BAR);
    const s = step % STEPS_PER_BAR;
    const chord = CHORDS[bar % CHORDS.length];

    // Drums
    if (s === 0 || s === 8 || (s === 10 && bar % 2 === 1)) this.kick(t);
    if (s === 4 || s === 12) this.clap(t);
    if (s % 4 === 2) this.hat(t, 0.05);
    else if (s % 2 === 1) this.hat(t, 0.018);

    // Pad on each bar
    if (s === 0) this.pad(chord.pad, t, STEP * STEPS_PER_BAR);

    // Bass
    if (BASS_STEPS.has(s)) this.bass(chord.bass + (s === 6 || s === 14 ? 12 : 0), t);

    // Arpeggio: chord tones an octave up, plus the root two octaves up.
    const tones = [chord.pad[0] + 12, chord.pad[1] + 12, chord.pad[2] + 12, chord.pad[0] + 24];
    // Its brightness rises and falls over the loop.
    const sweep = 900 + 900 * (0.5 - 0.5 * Math.cos((2 * Math.PI * step) / LOOP_STEPS));
    this.arp(tones[ARP_ORDER[s % ARP_ORDER.length]], t, sweep);

    // Lead, second half of the loop
    const note = LEAD[bar]?.[s];
    if (note) this.lead(note, t);
  }

  // --- instruments ----------------------------------------------------------

  private envelope(gain: GainNode, t: number, peak: number, attack: number, release: number) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
  }

  private kick(t: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(130, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    this.envelope(gain, t, 0.55, 0.004, 0.22);
    osc.connect(gain).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  private noiseHit(t: number, type: BiquadFilterType, freq: number, peak: number, release: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    this.envelope(gain, t, peak, 0.002, release);
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + release + 0.05);
  }

  private clap(t: number) {
    this.noiseHit(t, "bandpass", 1600, 0.14, 0.14);
  }

  private hat(t: number, peak: number) {
    this.noiseHit(t, "highpass", 7500, peak, 0.04);
  }

  private bass(note: number, t: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = midi(note);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(700, t);
    filter.frequency.exponentialRampToValueAtTime(180, t + 0.2);
    const gain = ctx.createGain();
    this.envelope(gain, t, 0.22, 0.008, 0.26);
    osc.connect(filter).connect(gain).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.32);
  }

  private pad(notes: number[], t: number, length: number) {
    const ctx = this.ctx!;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1100;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.05, t + 0.5);
    gain.gain.setValueAtTime(0.05, t + length - 0.4);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length + 0.2);
    filter.connect(gain).connect(this.master!);
    for (const n of notes) {
      for (const detune of [-7, 7]) {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = midi(n);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(t);
        osc.stop(t + length + 0.3);
      }
    }
  }

  private arp(note: number, t: number, cutoff: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = midi(note);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    const gain = ctx.createGain();
    this.envelope(gain, t, 0.035, 0.004, 0.11);
    osc.connect(filter).connect(gain);
    gain.connect(this.master!);
    gain.connect(this.echo!);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  private lead(note: number, t: number) {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    this.envelope(gain, t, 0.07, 0.02, 0.5);
    gain.connect(this.master!);
    gain.connect(this.echo!);
    // Triangle body with a quiet sine an octave up, and a little vibrato.
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 5.5;
    const depth = ctx.createGain();
    depth.gain.value = 6;
    vibrato.connect(depth);
    for (const [type, mult, level] of [
      ["triangle", 1, 1],
      ["sine", 2, 0.3],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = midi(note) * mult;
      depth.connect(osc.detune);
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g).connect(gain);
      osc.start(t);
      osc.stop(t + 0.6);
    }
    vibrato.start(t);
    vibrato.stop(t + 0.6);
  }
}

export const lobbyMusic = new LobbyMusic();
