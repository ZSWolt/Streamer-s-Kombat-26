import { ALERTS, EMOTES, LINES, USERS, USER_COLORS, fill, pick } from '../data/chat';
import { ROSTER } from '../data/roster';
import * as C from '../sim/constants';
import type { MatchState } from '../sim/types';
import { h } from './dom';
import { portraitUrl } from './portraits';

export class Hud {
  el: HTMLElement;
  private bars: { fill: HTMLElement; trail: HTMLElement; trailV: number; wins: HTMLElement; meter: HTMLElement; meterLbl: HTMLElement; combo: HTMLElement; banner: HTMLElement }[] = [];
  private timer: HTMLElement;
  private big: HTMLElement;
  private chat: HTMLElement;
  private viewersEl: HTMLElement;
  private alertEl: HTMLElement;
  private stream: HTMLElement;
  private inputDisp: HTMLElement[] = [];
  viewers = 1200;
  private chatTimer = 0;
  private comboTimers = [0, 0];
  private bannerTimers = [0, 0];
  private names: [string, string] = ['', ''];
  private alertQueue: { text: string; kind: string }[] = [];
  private alertBusy = false;
  chatSpeed = 1;
  private lastRounds = -1;

  constructor(parent: HTMLElement, private cfg: { streamHud: boolean; roundsToWin: number; showInput: boolean; practice?: boolean }) {
    this.el = h('div', { class: 'hud' });
    const top = h('div', { class: 'hud-top' });
    for (let p = 0; p < 2; p++) {
      const side = h('div', { class: `hud-side p${p + 1}` });
      const portrait = h('div', { class: 'hud-portrait' });
      const name = h('div', { class: 'hud-name' });
      const bar = h('div', { class: 'hud-bar' });
      const trail = h('div', { class: 'hud-trail' });
      const fillEl = h('div', { class: 'hud-fill' });
      bar.append(trail, fillEl, h('div', { class: 'hud-bar-shine' }));
      const wins = h('div', { class: 'hud-wins' });
      const barWrap = h('div', { class: 'hud-barwrap' }, [name, bar, wins]);
      side.append(portrait, barWrap);
      top.append(side);
      const meterWrap = h('div', { class: `hud-meter p${p + 1}` });
      const meterLbl = h('div', { class: 'hud-meter-lbl' }, ['HYPE TRAIN']);
      const meterBar = h('div', { class: 'hud-meter-bar' });
      const meterFill = h('div', { class: 'hud-meter-fill' });
      meterBar.append(meterFill);
      meterWrap.append(meterLbl, meterBar);
      this.el.append(meterWrap);
      const combo = h('div', { class: `hud-combo p${p + 1}` });
      const banner = h('div', { class: `hud-banner p${p + 1}` });
      this.el.append(combo, banner);
      this.bars.push({ fill: fillEl, trail, trailV: 1, wins, meter: meterFill, meterLbl, combo, banner });
      const inp = h('div', { class: `hud-input p${p + 1}` });
      this.inputDisp.push(inp);
      if (cfg.showInput) this.el.append(inp);
    }
    this.timer = h('div', { class: 'hud-timer' }, [h('span', {}, ['99'])]);
    top.insertBefore(this.timer, top.children[1]);
    this.el.append(top);
    this.big = h('div', { class: 'hud-big' });
    this.el.append(this.big);

    this.stream = h('div', { class: 'stream-hud' + (cfg.streamHud ? '' : ' hidden') });
    const live = h('div', { class: 'stream-live' }, [h('span', { class: 'dot' }), 'LIVE']);
    this.viewersEl = h('div', { class: 'stream-viewers' }, ['👁 1,200']);
    this.stream.append(h('div', { class: 'stream-top' }, [live, this.viewersEl]));
    this.chat = h('div', { class: 'stream-chat' });
    this.stream.append(this.chat);
    this.alertEl = h('div', { class: 'stream-alert' });
    this.el.append(this.stream, this.alertEl);
    parent.append(this.el);
  }

  setFighters(m: MatchState) {
    for (let p = 0; p < 2; p++) {
      const f = ROSTER[m.f[p].char];
      const side = this.el.querySelectorAll('.hud-side')[p] as HTMLElement;
      const portrait = side.querySelector('.hud-portrait') as HTMLElement;
      portrait.style.backgroundImage = `url(${portraitUrl(m.f[p].char, 'icon')})`;
      portrait.style.setProperty('--acc', f.accent);
      const name = side.querySelector('.hud-name') as HTMLElement;
      name.innerHTML = '';
      name.append(h('span', { class: 'he' }, [f.he]), h('span', { class: 'en' }, [f.title]));
      this.names[p] = f.he;
    }
    this.renderWins(m);
  }

  private renderWins(m: MatchState) {
    for (let p = 0; p < 2; p++) {
      const w = this.bars[p].wins;
      w.innerHTML = '';
      for (let i = 0; i < m.cfg.roundsToWin; i++) w.append(h('span', { class: 'win' + (i < m.f[p].roundWins ? ' on' : '') }));
    }
  }

  update(m: MatchState, dt: number, inputs?: [number, number]) {
    for (let p = 0; p < 2; p++) {
      const f = m.f[p];
      const b = this.bars[p];
      const v = Math.max(0, f.hp / C.MAX_HP);
      b.fill.style.transform = `scaleX(${v})`;
      b.fill.classList.toggle('low', v < 0.25);
      if (b.trailV > v) b.trailV = Math.max(v, b.trailV - dt * (f.st === 12 || f.st === 13 ? 0.05 : 0.6));
      else b.trailV = v;
      b.trail.style.transform = `scaleX(${b.trailV})`;
      const mv = f.meter / C.MAX_METER;
      b.meter.style.transform = `scaleX(${mv})`;
      b.meter.parentElement!.parentElement!.classList.toggle('full', mv >= 1);
      b.meterLbl.textContent = mv >= 1 ? 'HYPE! U+L' : `HYPE TRAIN LV.${Math.floor(mv * 4) + 1}`;
      if (this.comboTimers[p] > 0 && (this.comboTimers[p] -= dt) <= 0) b.combo.classList.remove('show');
      if (this.bannerTimers[p] > 0 && (this.bannerTimers[p] -= dt) <= 0) b.banner.classList.remove('show');
      if (inputs && this.cfg.showInput) this.renderInput(p, inputs[p], m.f[p].facing);
    }
    const secs = m.cfg.roundTime > 0 && !m.cfg.practice ? Math.ceil(m.timer / C.FPS) : -1;
    const span = this.timer.firstChild as HTMLElement;
    const txt = secs < 0 ? '∞' : String(secs);
    if (span.textContent !== txt) span.textContent = txt;
    this.timer.classList.toggle('danger', secs >= 0 && secs <= 10);
    const rw = m.f[0].roundWins * 10 + m.f[1].roundWins;
    if (rw !== this.lastRounds) { this.lastRounds = rw; this.renderWins(m); }

    // ambient chat
    if (this.cfg.streamHud) {
      this.chatTimer -= dt * this.chatSpeed;
      if (this.chatTimer <= 0) {
        this.chatTimer = 1.4 + Math.random() * 2.2;
        this.chatLine(Math.random() < 0.35 ? pick(EMOTES) : fill(pick(LINES.idle), { p1: this.names[0], p2: this.names[1] }));
      }
      this.viewers += (Math.random() - 0.45) * 3;
      this.viewersEl.textContent = '👁 ' + Math.max(0, Math.round(this.viewers)).toLocaleString('en-US');
    }
  }

  private renderInput(p: number, bits: number, facing: number) {
    const el = this.inputDisp[p];
    const f = facing === 1 ? C.IN_RIGHT : C.IN_LEFT;
    const b = facing === 1 ? C.IN_LEFT : C.IN_RIGHT;
    let dir = '•';
    const u = bits & C.IN_UP, d = bits & C.IN_DOWN, fw = bits & f, bk = bits & b;
    if (u && fw) dir = '↗'; else if (u && bk) dir = '↖'; else if (d && fw) dir = '↘'; else if (d && bk) dir = '↙';
    else if (u) dir = '↑'; else if (d) dir = '↓'; else if (fw) dir = '→'; else if (bk) dir = '←';
    const btn = [bits & C.IN_LP ? 'J' : '', bits & C.IN_HP ? 'I' : '', bits & C.IN_LK ? 'K' : '', bits & C.IN_HK ? 'O' : '', bits & C.IN_BLOCK ? 'L' : '', bits & C.IN_SP ? 'U' : ''].join('');
    const line = dir + ' ' + btn;
    if (el.firstChild?.textContent === line) return;
    el.prepend(h('div', {}, [line]));
    while (el.children.length > 12) el.lastChild!.remove();
  }

  bigText(text: string, sub = '', cls = '', ms = 1400) {
    this.big.innerHTML = '';
    const t = h('div', { class: 'big-main ' + cls }, [text]);
    this.big.append(t);
    if (sub) this.big.append(h('div', { class: 'big-sub' }, [sub]));
    this.big.classList.remove('show');
    void this.big.offsetWidth;
    this.big.classList.add('show');
    clearTimeout((this.big as any)._t);
    (this.big as any)._t = setTimeout(() => this.big.classList.remove('show'), ms);
  }

  combo(p: number, n: number, dmg: number) {
    const b = this.bars[p];
    b.combo.innerHTML = '';
    b.combo.append(h('div', { class: 'n' }, [`${n}`]), h('div', { class: 'l' }, ['HITS']), h('div', { class: 'd' }, [`${Math.round((dmg / C.MAX_HP) * 100)}%`]));
    b.combo.classList.remove('show');
    void b.combo.offsetWidth;
    b.combo.classList.add('show');
    this.comboTimers[p] = 1.6;
  }

  banner(p: number, name: string, input: string, hype = false) {
    const b = this.bars[p];
    b.banner.innerHTML = '';
    b.banner.append(h('div', { class: 'bn-name' }, [name]), h('div', { class: 'bn-input' }, [input]));
    b.banner.classList.toggle('hype', hype);
    b.banner.classList.remove('show');
    void b.banner.offsetWidth;
    b.banner.classList.add('show');
    this.bannerTimers[p] = hype ? 2.4 : 1.6;
  }

  chatLine(text: string, user?: string) {
    if (!this.cfg.streamHud) return;
    const u = user ?? pick(USERS);
    const col = USER_COLORS[Math.abs(hashStr(u)) % USER_COLORS.length];
    const badge = Math.random() < 0.3 ? h('span', { class: 'badge' }, [pick(['⭐', '💎', '🗡️', '👑'])]) : '';
    const line = h('div', { class: 'chat-line' }, [badge, h('span', { class: 'u', style: `color:${col}` }, [u]), h('span', { class: 'm' }, [': ' + text])]);
    this.chat.append(line);
    while (this.chat.children.length > 9) this.chat.firstChild!.remove();
  }

  react(kind: keyof typeof LINES, vars: Record<string, string | number> = {}, count = 1) {
    if (!this.cfg.streamHud) return;
    for (let i = 0; i < count; i++) {
      setTimeout(() => this.chatLine(fill(pick(LINES[kind]), vars)), i * (120 + Math.random() * 250));
    }
    this.viewers += count * (8 + Math.random() * 20);
  }

  alert(kind: keyof typeof ALERTS, vars: Record<string, string | number> = {}) {
    if (!this.cfg.streamHud) return;
    const text = fill(pick(ALERTS[kind]), { u: pick(USERS), n: 5 + Math.floor(Math.random() * 95), m: 2 + Math.floor(Math.random() * 20), s: pick(USERS), ...vars });
    this.alertQueue.push({ text, kind });
    this.pumpAlerts();
  }

  private pumpAlerts() {
    if (this.alertBusy || !this.alertQueue.length) return;
    const a = this.alertQueue.shift()!;
    this.alertBusy = true;
    this.alertEl.innerHTML = '';
    this.alertEl.className = 'stream-alert show ' + a.kind;
    const icon = { sub: '⭐', gift: '🎁', donate: '💸', raid: '🚀', follow: '❤️' }[a.kind] ?? '⭐';
    this.alertEl.append(h('div', { class: 'al-icon' }, [icon]), h('div', { class: 'al-text' }, [a.text]));
    setTimeout(() => { this.alertEl.classList.remove('show'); setTimeout(() => { this.alertBusy = false; this.pumpAlerts(); }, 350); }, 2400);
  }

  setVisible(v: boolean) { this.el.style.display = v ? '' : 'none'; }

  destroy() { this.el.remove(); }
}

function hashStr(s: string) {
  let x = 0;
  for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0;
  return x;
}
