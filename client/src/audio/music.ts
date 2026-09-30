import { audio } from './AudioEngine';

// Procedural music: every track is composed from a compact definition + a seeded melody generator.

type Pat = string; // 16 chars, 'x' = hit, '.' = rest, 'o' = accent/open
interface DrumDef { kick?: Pat[]; snare?: Pat[]; clap?: Pat[]; hat?: Pat[]; ohat?: Pat[]; perc?: Pat[]; roll?: boolean }
interface VoiceDef { type: 'saw' | 'square' | 'pluck' | 'cowbell' | 'brass' | 'bell' | 'choir'; octave: number; vol: number; pattern?: Pat; seed?: number; density?: number; bars?: number }
export interface TrackDef {
  bpm: number;
  swing?: number;
  root: number; // midi
  scale: number[];
  prog: number[]; // chord degree per bar
  drums: DrumDef;
  bass?: { type: '808' | 'saw' | 'acid' | 'sub'; pattern: Pat; octave: number; vol: number };
  pad?: { type: 'pad' | 'choir' | 'brass'; octave: number; vol: number; stab?: Pat };
  lead?: VoiceDef;
  arp?: { type: 'pluck' | 'saw' | 'square'; pattern: Pat; octave: number; vol: number };
  hit?: boolean; // orchestral hit on bar 1
  intro?: number; // bars with only pads before drums
}

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const PHRYG_DOM = [0, 1, 4, 5, 7, 8, 10]; // "Mizrahi" flavour
const HARM_MINOR = [0, 2, 3, 5, 7, 8, 11];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];

export const TRACKS: Record<string, TrackDef> = {
  title: {
    bpm: 86, root: 38, scale: HARM_MINOR, prog: [0, 5, 3, 4], hit: true, intro: 2,
    drums: { kick: ['x.........x.....', 'x.........x..x..'], snare: ['........x.......'], hat: ['x.x.x.x.x.x.x.xx'], roll: true },
    bass: { type: '808', pattern: 'x.........x.....', octave: 1, vol: 0.9 },
    pad: { type: 'choir', octave: 3, vol: 0.18 },
    lead: { type: 'brass', octave: 4, vol: 0.16, seed: 11, density: 0.35 },
  },
  menu: {
    bpm: 140, root: 40, scale: MINOR, prog: [0, 5, 2, 6],
    drums: { kick: ['x.......x.x.....', 'x.......x....x..'], clap: ['........x.......'], hat: ['x.x.x.x.x.x.x.x.', 'x.x.x.x.xxx.x.xx'] },
    bass: { type: '808', pattern: 'x.......x.x.....', octave: 1, vol: 0.75 },
    pad: { type: 'pad', octave: 3, vol: 0.1 },
    arp: { type: 'pluck', pattern: 'x.xx.xx.x.xx.x.x', octave: 5, vol: 0.09 },
  },
  select: {
    bpm: 150, root: 41, scale: PHRYG_DOM, prog: [0, 0, 1, 0],
    drums: { kick: ['x.....x...x.....', 'x.....x...x...x.'], snare: ['........x.......'], hat: ['xxxxxxxxxxxxxxxx'], ohat: ['..............x.'], roll: true },
    bass: { type: '808', pattern: 'x.....x...x.....', octave: 1, vol: 0.95 },
    lead: { type: 'cowbell', octave: 5, vol: 0.13, pattern: 'x.xx.x.xx.x.x.xx', seed: 5 },
  },
  kick: {
    bpm: 128, root: 43, scale: MINOR, prog: [0, 5, 3, 6],
    drums: { kick: ['x...x...x...x...'], clap: ['....x.......x...'], hat: ['..x...x...x...x.'], ohat: ['..o...o...o...o.'] },
    bass: { type: 'saw', pattern: '.xx..xx..xx..xx.', octave: 2, vol: 0.3 },
    pad: { type: 'pad', octave: 3, vol: 0.09 },
    lead: { type: 'saw', octave: 5, vol: 0.1, seed: 21, density: 0.5 },
  },
  bedroom: {
    bpm: 112, root: 45, scale: DORIAN, prog: [0, 3, 5, 4],
    drums: { kick: ['x.....x...x.....'], snare: ['....x.......x...'], hat: ['x.x.x.x.x.x.x.x.'] },
    bass: { type: 'saw', pattern: 'x.x...x.x.x...x.', octave: 2, vol: 0.28 },
    pad: { type: 'pad', octave: 3, vol: 0.12 },
    arp: { type: 'square', pattern: 'xxxxxxxxxxxxxxxx', octave: 5, vol: 0.05 },
    lead: { type: 'square', octave: 5, vol: 0.07, seed: 33, density: 0.4 },
  },
  rooftop: {
    bpm: 146, root: 40, scale: PHRYG_DOM, prog: [0, 1, 0, 6],
    drums: { kick: ['x.....x...x.....'], snare: ['........x.......'], hat: ['x.x.x.x.x.x.x.x.'], perc: ['x..x..x.x..x.x..'], roll: true },
    bass: { type: '808', pattern: 'x.....x...x.....', octave: 1, vol: 0.9 },
    lead: { type: 'saw', octave: 5, vol: 0.09, seed: 7, density: 0.55 },
    pad: { type: 'pad', octave: 3, vol: 0.07 },
  },
  arena: {
    bpm: 172, root: 38, scale: MINOR, prog: [0, 5, 6, 4],
    drums: { kick: ['x.........x.....', 'x.....x...x.....'], snare: ['....x.......x...'], hat: ['x.x.x.x.x.x.x.x.'], ohat: ['..............o.'] },
    bass: { type: 'sub', pattern: 'x.........x.....', octave: 1, vol: 0.8 },
    pad: { type: 'brass', octave: 3, vol: 0.1, stab: 'x.....x.........' },
    lead: { type: 'saw', octave: 5, vol: 0.09, seed: 44, density: 0.45 },
    hit: true,
  },
  red: {
    bpm: 94, root: 41, scale: DORIAN, prog: [0, 0, 3, 4],
    drums: { kick: ['x.......x.x.....'], snare: ['....x.......x...'], hat: ['x.x.x.x.x.x.x.xx'] },
    bass: { type: 'saw', pattern: 'x..x....x.x..x..', octave: 2, vol: 0.35 },
    pad: { type: 'brass', octave: 4, vol: 0.12, stab: '..x.......x.....' },
    lead: { type: 'bell', octave: 5, vol: 0.08, seed: 8, density: 0.3 },
  },
  servers: {
    bpm: 132, root: 36, scale: MINOR, prog: [0, 0, 5, 6],
    drums: { kick: ['x...x...x...x...'], clap: ['....x.......x...'], hat: ['.xxx.xxx.xxx.xxx'] },
    bass: { type: 'acid', pattern: 'xxx.xx.xxx.x.xx.', octave: 2, vol: 0.28 },
    pad: { type: 'pad', octave: 3, vol: 0.06 },
  },
};

function mtof(m: number) { return 440 * Math.pow(2, (m - 69) / 12); }

function rng(seed: number) {
  let s = seed * 9301 + 49297;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

export class MusicPlayer {
  private def: TrackDef | null = null;
  private name = '';
  private step = 0;
  private nextTime = 0;
  private timer: number | null = null;
  private out: GainNode | null = null;
  private melody: (number | null)[] = [];
  intensity = 1; // 0..1, drives drum density

  get current() { return this.name; }

  play(name: string, fade = 0.6) {
    if (this.name === name) return;
    this.stop(fade);
    const def = TRACKS[name];
    if (!def || !audio.ctx) { this.name = name; return; }
    this.name = name;
    this.def = def;
    this.step = 0;
    this.out = audio.ctx.createGain();
    this.out.gain.setValueAtTime(0.0001, audio.now);
    this.out.gain.exponentialRampToValueAtTime(1, audio.now + fade);
    this.out.connect(audio.musicBus);
    this.melody = this.makeMelody(def);
    this.nextTime = audio.now + 0.08;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stop(fade = 0.5) {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    if (this.out && audio.ctx) {
      const o = this.out;
      o.gain.cancelScheduledValues(audio.now);
      o.gain.setValueAtTime(Math.max(0.0001, o.gain.value), audio.now);
      o.gain.exponentialRampToValueAtTime(0.0001, audio.now + fade);
      setTimeout(() => o.disconnect(), fade * 1000 + 200);
    }
    this.out = null;
    this.name = '';
  }

  private makeMelody(def: TrackDef): (number | null)[] {
    const L = def.lead;
    if (!L) return [];
    const r = rng(L.seed ?? 1);
    const bars = 4;
    const out: (number | null)[] = [];
    const motif: (number | null)[] = [];
    const pat = L.pattern;
    for (let i = 0; i < 16 * 2; i++) {
      const on = pat ? pat[i % 16] === 'x' : r() < (L.density ?? 0.4) && (i % 2 === 0 || r() < 0.3);
      motif.push(on ? Math.floor(r() * 7) - (r() < 0.3 ? 7 : 0) : null);
    }
    for (let b = 0; b < bars; b++) {
      for (let i = 0; i < 16; i++) {
        const src = motif[(b % 2) * 16 + i];
        out.push(src === null ? null : src + (b === 3 && i > 8 ? 2 : 0));
      }
    }
    return out;
  }

  private schedule() {
    if (!this.def || !audio.ctx || !this.out) return;
    const def = this.def;
    const spb = 60 / def.bpm / 4;
    while (this.nextTime < audio.now + 0.14) {
      this.playStep(this.step, this.nextTime, spb);
      const swing = def.swing ?? 0;
      this.nextTime += spb * (this.step % 2 === 0 ? 1 + swing : 1 - swing);
      this.step++;
    }
  }

  private chord(def: TrackDef, bar: number, octave: number) {
    const deg = def.prog[bar % def.prog.length];
    const sc = def.scale;
    const n = (d: number) => def.root + octave * 12 - 12 + sc[d % 7] + Math.floor(d / 7) * 12;
    return [n(deg), n(deg + 2), n(deg + 4)];
  }

  private playStep(step: number, t: number, spb: number) {
    const def = this.def!;
    const out = this.out!;
    const s = step % 16;
    const bar = Math.floor(step / 16);
    const inIntro = def.intro !== undefined && bar < def.intro;
    const pick = (p?: Pat[]) => (p ? p[bar % p.length][s] : '.');
    const A = audio;
    const ctx = A.ctx!;

    if (!inIntro) {
      if (pick(def.drums.kick) === 'x') this.kick(t, out);
      if (pick(def.drums.snare) === 'x') { A.noise(t, 0.18, out, { type: 'bandpass', f0: 1900, q: 0.7, vol: 0.45 }); A.tone(t, 0.1, out, { f0: 200, f1: 150, vol: 0.3, type: 'triangle' }); }
      if (pick(def.drums.clap) === 'x') for (let i = 0; i < 3; i++) A.noise(t + i * 0.011, 0.12, out, { type: 'bandpass', f0: 1400, q: 1.2, vol: 0.4 });
      const hat = pick(def.drums.hat);
      if (hat === 'x' && this.intensity > 0.3) A.noise(t, 0.035, out, { type: 'highpass', f0: 8500, vol: s % 4 === 0 ? 0.2 : 0.13 });
      if (pick(def.drums.ohat) === 'o') A.noise(t, 0.22, out, { type: 'highpass', f0: 7000, vol: 0.15 });
      const perc = pick(def.drums.perc);
      if (perc === 'x') {
        if (s % 4 === 0) A.tone(t, 0.12, out, { f0: 140, f1: 90, vol: 0.45 });
        else A.noise(t, 0.04, out, { type: 'bandpass', f0: 3500, q: 3, vol: 0.35 });
      }
      if (def.drums.roll && bar % 4 === 3 && s >= 12) {
        for (let k = 0; k < 3; k++) A.noise(t + (k * spb) / 3, 0.03, out, { type: 'highpass', f0: 9000, vol: 0.12 });
      }
    }

    // bass
    if (def.bass && !inIntro && def.bass.pattern[s] === 'x') {
      const root = this.chord(def, bar, def.bass.octave + 1)[0];
      this.bassNote(def.bass.type, mtof(root), t, spb * (def.bass.type === '808' ? 6 : 1.6), def.bass.vol, out);
    }

    // pads / chords
    if (def.pad) {
      const c = this.chord(def, bar, def.pad.octave + 1);
      if (def.pad.stab) {
        if (def.pad.stab[s] === 'x') for (const n of c) this.voice('brass', mtof(n), t, spb * 2, def.pad.vol, out);
      } else if (s === 0) {
        for (const n of c) this.voice(def.pad.type === 'choir' ? 'choir' : 'pad', mtof(n), t, spb * 16, def.pad.vol, out);
      }
    }
    if (def.hit && s === 0 && bar % 4 === 0) {
      const c = this.chord(def, bar, 3);
      for (const n of c) A.tone(t, 0.9, out, { f0: mtof(n), vol: 0.1, type: 'sawtooth' });
      A.noise(t, 0.6, out, { f0: 5000, f1: 300, vol: 0.4 });
      A.tone(t, 1.2, out, { f0: 55, f1: 30, vol: 0.8 });
    }
    // arp
    if (def.arp && !inIntro && def.arp.pattern[s] === 'x') {
      const c = this.chord(def, bar, def.arp.octave);
      const n = c[s % 3] + (s % 6 >= 3 ? 12 : 0);
      this.voice(def.arp.type, mtof(n), t, spb * 0.9, def.arp.vol, out);
    }
    // lead
    if (def.lead && this.melody.length && !inIntro && bar % 8 >= 2) {
      const idx = (bar % 4) * 16 + s;
      const deg = this.melody[idx];
      if (deg !== null && deg !== undefined) {
        const chordDeg = def.prog[bar % def.prog.length];
        const d = chordDeg + deg;
        const note = def.root + def.lead.octave * 12 - 12 + def.scale[((d % 7) + 7) % 7] + Math.floor(d / 7) * 12;
        this.voice(def.lead.type, mtof(note), t, spb * (def.lead.type === 'brass' ? 3 : 1.8), def.lead.vol, out);
      }
    }
    void ctx;
  }

  private kick(t: number, out: AudioNode) {
    audio.tone(t, 0.38, out, { f0: 155, f1: 42, vol: 0.95, glide: 0.12 });
    audio.noise(t, 0.012, out, { type: 'highpass', f0: 2500, vol: 0.25 });
  }

  private bassNote(type: string, f: number, t: number, dur: number, vol: number, out: AudioNode) {
    const ctx = audio.ctx!;
    if (type === '808' || type === 'sub') {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(type === '808' ? f * 1.9 : f, t);
      osc.frequency.exponentialRampToValueAtTime(f, t + 0.06);
      const sh = ctx.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; curve[i] = Math.tanh(x * 2.2); }
      sh.curve = curve;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(sh).connect(g).connect(out);
      osc.start(t); osc.stop(t + dur + 0.05);
      return;
    }
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = f;
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.Q.value = type === 'acid' ? 14 : 3;
    flt.frequency.setValueAtTime(type === 'acid' ? 2600 : 900, t);
    flt.frequency.exponentialRampToValueAtTime(type === 'acid' ? 220 : 160, t + dur * 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(flt).connect(g).connect(out);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  private voice(type: string, f: number, t: number, dur: number, vol: number, out: AudioNode) {
    const ctx = audio.ctx!;
    const g = ctx.createGain();
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    const oscs: OscillatorNode[] = [];
    const mk = (tp: OscillatorType, fr: number, det = 0) => { const o = ctx.createOscillator(); o.type = tp; o.frequency.value = fr; o.detune.value = det; oscs.push(o); return o; };
    let attack = 0.005, release = dur;
    switch (type) {
      case 'saw': mk('sawtooth', f, -9); mk('sawtooth', f, 9); flt.frequency.setValueAtTime(4200, t); flt.frequency.exponentialRampToValueAtTime(900, t + dur); break;
      case 'square': mk('square', f); flt.frequency.value = 2600; break;
      case 'pluck': mk('square', f); mk('triangle', f * 2); flt.frequency.setValueAtTime(5000, t); flt.frequency.exponentialRampToValueAtTime(400, t + 0.2); release = Math.min(dur, 0.35); break;
      case 'cowbell': mk('square', f); mk('square', f * 1.483); flt.type = 'bandpass'; flt.frequency.value = f * 1.3; flt.Q.value = 2; release = 0.28; break;
      case 'brass': mk('sawtooth', f, -6); mk('sawtooth', f, 6); flt.frequency.setValueAtTime(500, t); flt.frequency.exponentialRampToValueAtTime(3000, t + 0.08); flt.frequency.exponentialRampToValueAtTime(1200, t + dur); attack = 0.03; break;
      case 'bell': mk('sine', f); mk('sine', f * 2.76); mk('sine', f * 5.4); flt.frequency.value = 9000; release = 1.2; break;
      case 'pad': mk('sawtooth', f, -12); mk('sawtooth', f, 12); mk('triangle', f / 2); flt.frequency.value = 1300; attack = 0.5; break;
      case 'choir': mk('sawtooth', f, -8); mk('sawtooth', f, 8); flt.type = 'bandpass'; flt.frequency.value = 800; flt.Q.value = 1.4; attack = 0.6; break;
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + Math.max(attack, release * 0.6));
    g.gain.exponentialRampToValueAtTime(0.0001, t + release);
    for (const o of oscs) { o.connect(flt); o.start(t); o.stop(t + release + 0.05); }
    flt.connect(g).connect(out);
    if (type === 'pad' || type === 'choir' || type === 'bell' || type === 'brass') {
      const w = ctx.createGain(); w.gain.value = 0.5; g.connect(w).connect(audio.reverbSend);
    }
  }

  stinger(kind: 'ko' | 'victory' | 'round') {
    if (!audio.ctx) return;
    const t = audio.now + 0.02;
    const out = audio.musicBus;
    if (kind === 'victory') {
      const notes = [60, 64, 67, 72, 76, 79];
      notes.forEach((n, i) => this.voice('brass', mtof(n), t + i * 0.09, 1.4 - i * 0.1, 0.12, out));
      audio.tone(t, 1.5, out, { f0: 65, f1: 40, vol: 0.8 });
    } else if (kind === 'ko') {
      [50, 53, 57].forEach((n) => this.voice('brass', mtof(n), t, 2.2, 0.12, out));
    } else {
      audio.noise(t, 1.2, out, { type: 'highpass', f0: 300, f1: 6000, vol: 0.25, attack: 1 });
    }
  }
}

export const music = new MusicPlayer();
