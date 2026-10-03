// All audio is synthesized at runtime (no copyrighted samples): SFX, music and UI sounds.

export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  musicBus!: GainNode;
  sfxBus!: GainNode;
  voiceBus!: GainNode;
  reverb!: ConvolverNode;
  reverbSend!: GainNode;
  private noiseBuf!: AudioBuffer;
  private vols = { music: 0.7, sfx: 0.8, voice: 1 };
  private buffers = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<AudioBuffer | null>>();
  onReady: (() => void)[] = [];

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(comp).connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.voiceBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.voiceBus.connect(this.master);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.4, 2.8);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.5;
    this.reverbSend.connect(this.reverb).connect(this.master);
    const n = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    for (const cb of this.onReady) cb();
  }

  setVolumes(music: number, sfx: number, voice: number) {
    this.vols = { music, sfx, voice };
    this.applyVolumes();
  }

  private applyVolumes() {
    if (!this.ctx) return;
    this.musicBus.gain.value = this.vols.music * 0.55;
    this.sfxBus.gain.value = this.vols.sfx;
    this.voiceBus.gain.value = this.vols.voice;
  }

  private impulse(sec: number, decay: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }

  get now() { return this.ctx?.currentTime ?? 0; }

  noise(t: number, dur: number, out: AudioNode, o: { type?: BiquadFilterType; f0?: number; f1?: number; q?: number; vol?: number; attack?: number } = {}) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const flt = ctx.createBiquadFilter();
    flt.type = o.type ?? 'lowpass';
    flt.Q.value = o.q ?? 1;
    flt.frequency.setValueAtTime(o.f0 ?? 2000, t);
    if (o.f1) flt.frequency.exponentialRampToValueAtTime(o.f1, t + dur);
    const g = ctx.createGain();
    const v = o.vol ?? 0.5;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + (o.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt).connect(g).connect(out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  tone(t: number, dur: number, out: AudioNode, o: { type?: OscillatorType; f0: number; f1?: number; vol?: number; attack?: number; detune?: number; glide?: number }) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + (o.glide ?? dur));
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    const v = o.vol ?? 0.4;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + (o.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
    return osc;
  }

  private panner(pan: number, out: AudioNode) {
    const p = this.ctx!.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(out);
    return p;
  }

  sfx(name: string, pan = 0, vol = 1) {
    if (!this.ctx) return;
    const t = this.now + 0.005;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    g.connect(this.panner(pan, this.sfxBus));
    const wet = this.ctx.createGain();
    wet.gain.value = 0;
    g.connect(wet).connect(this.reverbSend);
    const rnd = 0.94 + Math.random() * 0.12;
    switch (name) {
      case 'hitL':
        this.noise(t, 0.07, g, { f0: 3500 * rnd, f1: 800, vol: 0.55 });
        this.tone(t, 0.09, g, { f0: 180 * rnd, f1: 70, vol: 0.7 });
        break;
      case 'hitM':
        this.noise(t, 0.1, g, { f0: 4200 * rnd, f1: 600, vol: 0.7 });
        this.tone(t, 0.14, g, { f0: 150 * rnd, f1: 50, vol: 0.9, type: 'triangle' });
        this.noise(t, 0.02, g, { type: 'highpass', f0: 5000, vol: 0.5 });
        break;
      case 'hitH':
        this.noise(t, 0.16, g, { f0: 5000, f1: 300, vol: 0.9 });
        this.tone(t, 0.3, g, { f0: 120 * rnd, f1: 32, vol: 1.1 });
        this.tone(t, 0.05, g, { f0: 2400, f1: 900, vol: 0.25, type: 'square' });
        wet.gain.value = 0.25;
        break;
      case 'hitX':
        this.noise(t, 0.4, g, { f0: 6000, f1: 200, vol: 1 });
        this.tone(t, 0.6, g, { f0: 90, f1: 22, vol: 1.3 });
        this.tone(t, 0.12, g, { f0: 3000, f1: 400, vol: 0.3, type: 'sawtooth' });
        wet.gain.value = 0.6;
        break;
      case 'block':
        this.tone(t, 0.08, g, { f0: 1400 * rnd, f1: 900, vol: 0.28, type: 'square' });
        this.noise(t, 0.06, g, { type: 'highpass', f0: 3000, vol: 0.45 });
        this.tone(t, 0.05, g, { f0: 220, f1: 120, vol: 0.4 });
        break;
      case 'swingL':
        this.noise(t, 0.12, g, { type: 'bandpass', f0: 700 * rnd, f1: 2600, q: 1.5, vol: 0.25, attack: 0.03 });
        break;
      case 'swingH':
        this.noise(t, 0.2, g, { type: 'bandpass', f0: 400 * rnd, f1: 1800, q: 1.2, vol: 0.38, attack: 0.05 });
        break;
      case 'jump':
        this.noise(t, 0.15, g, { type: 'bandpass', f0: 500, f1: 1500, vol: 0.2, attack: 0.02 });
        break;
      case 'land':
        this.tone(t, 0.1, g, { f0: 110, f1: 50, vol: 0.5 });
        this.noise(t, 0.08, g, { f0: 900, f1: 200, vol: 0.3 });
        break;
      case 'knockdown':
        this.tone(t, 0.3, g, { f0: 90, f1: 30, vol: 1 });
        this.noise(t, 0.3, g, { f0: 1500, f1: 150, vol: 0.6 });
        wet.gain.value = 0.3;
        break;
      case 'ko':
        this.tone(t, 1.6, g, { f0: 70, f1: 18, vol: 1.3, glide: 1.4 });
        this.noise(t, 1.2, g, { f0: 4000, f1: 60, vol: 0.8 });
        this.tone(t, 0.8, g, { f0: 440, f1: 110, vol: 0.2, type: 'sawtooth' });
        wet.gain.value = 1;
        break;
      case 'special':
        for (let i = 0; i < 4; i++) this.tone(t + i * 0.03, 0.18, g, { f0: 600 + i * 300, f1: 1800 + i * 400, vol: 0.12, type: 'triangle' });
        this.noise(t, 0.25, g, { type: 'bandpass', f0: 800, f1: 4000, vol: 0.2 });
        wet.gain.value = 0.4;
        break;
      case 'proj':
        this.noise(t, 0.25, g, { type: 'bandpass', f0: 1200, f1: 400, q: 3, vol: 0.3 });
        this.tone(t, 0.2, g, { f0: 900, f1: 300, vol: 0.12, type: 'triangle' });
        break;
      case 'hype':
        this.tone(t, 0.8, g, { f0: 100, f1: 1200, vol: 0.35, type: 'sawtooth', glide: 0.7 });
        this.tone(t, 0.8, g, { f0: 150, f1: 1800, vol: 0.2, type: 'square', glide: 0.7 });
        this.noise(t, 0.9, g, { type: 'highpass', f0: 500, f1: 8000, vol: 0.3, attack: 0.5 });
        wet.gain.value = 0.8;
        break;
      case 'counter':
        this.tone(t, 0.4, g, { f0: 1800, f1: 1700, vol: 0.3, type: 'square' });
        this.tone(t, 0.4, g, { f0: 2700, vol: 0.15, type: 'sine' });
        this.noise(t, 0.1, g, { type: 'highpass', f0: 4000, vol: 0.6 });
        wet.gain.value = 0.5;
        break;
      case 'teleport':
        this.tone(t, 0.25, g, { f0: 2000, f1: 200, vol: 0.25, type: 'sawtooth' });
        this.tone(t + 0.1, 0.2, g, { f0: 200, f1: 2000, vol: 0.2, type: 'sawtooth' });
        break;
      case 'reflect':
        this.tone(t, 0.3, g, { f0: 2400, f1: 3200, vol: 0.25, type: 'triangle' });
        wet.gain.value = 0.6;
        break;
      case 'throw':
        this.noise(t, 0.3, g, { type: 'bandpass', f0: 300, f1: 1200, vol: 0.4, attack: 0.08 });
        break;
      case 'dash':
        this.noise(t, 0.12, g, { type: 'highpass', f0: 1500, f1: 5000, vol: 0.15, attack: 0.02 });
        break;
      case 'bell':
        for (const [f, v] of [[523, 0.4], [1046, 0.2], [1568, 0.1], [2093, 0.05]] as [number, number][]) this.tone(t, 2.2, g, { f0: f, vol: v, attack: 0.002 });
        wet.gain.value = 0.9;
        break;
      case 'ui_move':
        this.tone(t, 0.05, g, { f0: 1320, vol: 0.12, type: 'triangle' });
        break;
      case 'ui_ok':
        this.tone(t, 0.08, g, { f0: 880, vol: 0.18, type: 'square' });
        this.tone(t + 0.06, 0.14, g, { f0: 1320, vol: 0.16, type: 'square' });
        break;
      case 'ui_back':
        this.tone(t, 0.1, g, { f0: 660, f1: 440, vol: 0.15, type: 'triangle' });
        break;
      case 'ui_start':
        for (const f of [261.6, 329.6, 392, 523.3]) this.tone(t, 0.9, g, { f0: f, vol: 0.12, type: 'sawtooth', attack: 0.01 });
        this.tone(t, 0.9, g, { f0: 65, f1: 40, vol: 0.8 });
        this.noise(t, 0.6, g, { f0: 8000, f1: 500, vol: 0.4 });
        wet.gain.value = 0.9;
        break;
      case 'select':
        this.tone(t, 0.5, g, { f0: 70, f1: 35, vol: 0.9 });
        this.noise(t, 0.4, g, { f0: 5000, f1: 300, vol: 0.5 });
        for (const f of [440, 554, 659]) this.tone(t, 0.6, g, { f0: f, vol: 0.08, type: 'sawtooth' });
        wet.gain.value = 0.7;
        break;
      case 'chat':
        this.tone(t, 0.04, g, { f0: 1800 + Math.random() * 400, vol: 0.05, type: 'sine' });
        break;
      case 'alert':
        [784, 988, 1175, 1568].forEach((f, i) => this.tone(t + i * 0.07, 0.3, g, { f0: f, vol: 0.14, type: 'triangle' }));
        wet.gain.value = 0.6;
        break;
      case 'coin':
        this.tone(t, 0.07, g, { f0: 988, vol: 0.15, type: 'square' });
        this.tone(t + 0.07, 0.25, g, { f0: 1319, vol: 0.15, type: 'square' });
        break;
      case 'crowd':
        this.noise(t, 2.5, g, { type: 'bandpass', f0: 900, f1: 1300, q: 0.6, vol: 0.45, attack: 0.4 });
        this.noise(t, 2.2, g, { type: 'bandpass', f0: 2200, f1: 1800, q: 0.8, vol: 0.2, attack: 0.3 });
        break;
      case 'dizzy':
        for (let i = 0; i < 3; i++) this.tone(t + i * 0.15, 0.1, g, { f0: 2200 + i * 200, f1: 2800, vol: 0.08, type: 'sine' });
        break;
      case 'slam':
        this.tone(t, 0.5, g, { f0: 60, f1: 25, vol: 1.2 });
        this.noise(t, 0.5, g, { f0: 2500, f1: 100, vol: 0.9 });
        wet.gain.value = 0.5;
        break;
      case 'glass':
        for (let i = 0; i < 8; i++) this.tone(t + i * 0.015, 0.3, g, { f0: 3000 + Math.random() * 3000, vol: 0.06, type: 'sine' });
        this.noise(t, 0.3, g, { type: 'highpass', f0: 4000, vol: 0.5 });
        break;
      case 'engine':
        this.tone(t, 0.9, g, { f0: 55, f1: 110, vol: 0.4, type: 'sawtooth' });
        this.noise(t, 0.9, g, { f0: 400, vol: 0.3 });
        break;
      case 'guitar': { // one open strum, low string to high
        [110, 164.8, 220, 277.2, 329.6].forEach((f, i) => {
          this.tone(t + i * 0.022, 0.9, g, { f0: f * rnd, vol: 0.16, type: 'triangle', attack: 0.003 });
          this.tone(t + i * 0.022, 0.25, g, { f0: f * 2 * rnd, vol: 0.05, type: 'sawtooth', attack: 0.002 });
        });
        wet.gain.value = 0.5;
        break;
      }
      case 'twang': // a guitar coming to a bad end
        [98, 147, 233, 311].forEach((f, i) => this.tone(t + i * 0.01, 0.7, g, { f0: f * rnd, f1: f * 0.7, vol: 0.18, type: 'sawtooth', attack: 0.002 }));
        this.noise(t, 0.25, g, { f0: 2500, f1: 300, vol: 0.6 });
        wet.gain.value = 0.5;
        break;
      case 'spray':
        this.noise(t, 0.45, g, { type: 'highpass', f0: 3500, f1: 7000, vol: 0.35, attack: 0.03 });
        break;
      case 'bark':
        this.tone(t, 0.12, g, { f0: 500, f1: 300, vol: 0.4, type: 'sawtooth' });
        this.tone(t + 0.18, 0.12, g, { f0: 520, f1: 280, vol: 0.4, type: 'sawtooth' });
        break;
      case 'splat': // something soft and wet (a pizza) landing hard
        this.noise(t, 0.2, g, { f0: 1800 * rnd, f1: 180, vol: 0.75, attack: 0.003 });
        this.tone(t, 0.13, g, { f0: 150 * rnd, f1: 55, vol: 0.7 });
        this.noise(t + 0.02, 0.12, g, { type: 'bandpass', f0: 900, f1: 400, q: 2, vol: 0.35 });
        break;
      case 'pop': // a balloon going
        this.noise(t, 0.06, g, { type: 'highpass', f0: 1800 * rnd, vol: 0.9, attack: 0.001 });
        this.tone(t, 0.05, g, { f0: 900 * rnd, f1: 300, vol: 0.25, type: 'square' });
        wet.gain.value = 0.3;
        break;
      case 'fire': // a gust of flame: a roar that swells, and crackles
        this.noise(t, 0.6, g, { type: 'bandpass', f0: 280 * rnd, f1: 900, q: 0.7, vol: 0.6, attack: 0.12 });
        this.noise(t, 0.5, g, { type: 'lowpass', f0: 600, f1: 200, vol: 0.4, attack: 0.05 });
        for (let i = 0; i < 6; i++) this.noise(t + 0.05 + Math.random() * 0.4, 0.02, g, { type: 'highpass', f0: 3000 + Math.random() * 3000, vol: 0.35, attack: 0.001 });
        wet.gain.value = 0.25;
        break;
      case 'scratch': // a DJ scratch: the record dragged forward and back
        this.noise(t, 0.08, g, { type: 'bandpass', f0: 450 * rnd, f1: 3200, q: 5, vol: 0.55, attack: 0.01 });
        this.tone(t, 0.08, g, { f0: 260 * rnd, f1: 1100, vol: 0.1, type: 'sawtooth' });
        this.noise(t + 0.09, 0.11, g, { type: 'bandpass', f0: 3000 * rnd, f1: 380, q: 5, vol: 0.55, attack: 0.01 });
        this.tone(t + 0.09, 0.11, g, { f0: 1000 * rnd, f1: 210, vol: 0.1, type: 'sawtooth' });
        break;
    }
  }

  // ------------------------------------------------ samples (announcer / voices)
  async loadBuffer(url: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    const hit = this.buffers.get(url);
    if (hit) return hit;
    let p = this.loading.get(url);
    if (!p) {
      p = fetch(url).then(async (r) => {
        if (!r.ok) return null;
        const b = await this.ctx!.decodeAudioData(await r.arrayBuffer());
        this.buffers.set(url, b);
        return b;
      }).catch(() => null);
      this.loading.set(url, p);
    }
    return p;
  }

  playBuffer(buf: AudioBuffer, bus: 'voice' | 'sfx' = 'voice', o: { rate?: number; vol?: number; reverb?: number; pan?: number } = {}) {
    if (!this.ctx) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = o.rate ?? 1;
    const g = this.ctx.createGain();
    g.gain.value = o.vol ?? 1;
    const out = this.panner(o.pan ?? 0, bus === 'voice' ? this.voiceBus : this.sfxBus);
    src.connect(g).connect(out);
    if (o.reverb) {
      const w = this.ctx.createGain();
      w.gain.value = o.reverb;
      g.connect(w).connect(this.reverbSend);
    }
    src.start();
    return src;
  }
}

export const audio = new AudioEngine();
