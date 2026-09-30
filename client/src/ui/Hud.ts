import { ALERTS, BADGE_ICON, EMOTES, LINES, USERS, USER_COLORS, fill, pick } from '../data/chat';
import { FLAVOR } from '../data/flavor';
import { ROSTER } from '../data/roster';
import * as C from '../sim/constants';
import type { MatchState } from '../sim/types';
import { clear, h } from './dom';
import { portraitUrl } from './portraits';
import { banalityInputs, hypeInput, K } from './keys';
import { stone } from './stone';

export class Hud {
  el: HTMLElement;
  private bars: { fill: HTMLElement; trail: HTMLElement; trailV: number; wins: HTMLElement; meter: HTMLElement; meterLbl: HTMLElement; combo: HTMLElement; callout: HTMLElement }[] = [];
  private timer: HTMLElement;
  private big: HTMLElement;
  private chat: HTMLElement;
  private viewersEl: HTMLElement;
  private alertEl: HTMLElement;
  private stream: HTMLElement;
  private inputDisp: HTMLElement[] = [];
  private card: HTMLElement;
  private dialog: HTMLElement;
  private finisher: HTMLElement;
  private stamp: HTMLElement;
  viewers = 1200;
  private chatTimer = 0;
  private comboTimers = [0, 0];
  private calloutTimers = [0, 0];
  private names: [string, string] = ['', ''];
  private alertQueue: { text: string; kind: string }[] = [];
  private alertBusy = false;
  chatSpeed = 1;
  private lastRounds = -1;
  private lastSecs = '';

  constructor(parent: HTMLElement, private cfg: { streamHud: boolean; roundsToWin: number; showInput: boolean; practice?: boolean }) {
    this.el = h('div', { class: 'hud' });
    const top = h('div', { class: 'hud-top' });
    for (let p = 0; p < 2; p++) {
      const side = h('div', { class: `hud-side p${p + 1}` });
      const portrait = h('div', { class: 'hud-portrait' }, [h('img', { class: 'face', alt: '' })]);
      const name = h('div', { class: 'hud-name' });
      const bar = h('div', { class: 'hud-bar' });
      const trail = h('div', { class: 'hud-trail' });
      const fillEl = h('div', { class: 'hud-fill' });
      bar.append(trail, fillEl, h('div', { class: 'hud-bar-shine' }));
      const tip = h('div', { class: 'hud-tip' });
      const wins = h('div', { class: 'hud-wins' });
      const barWrap = h('div', { class: 'hud-barwrap' }, [name, h('div', { class: 'hud-barrow' }, [bar, tip]), wins]);
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
      const callout = h('div', { class: `pmove p${p + 1}` });
      this.el.append(combo, callout);
      this.bars.push({ fill: fillEl, trail, trailV: 1, wins, meter: meterFill, meterLbl, combo, callout });
      const inp = h('div', { class: `hud-input p${p + 1}` });
      this.inputDisp.push(inp);
      if (cfg.showInput) this.el.append(inp);
    }
    this.timer = h('div', { class: 'hud-timer' }, [stone('99')]);
    top.insertBefore(this.timer, top.children[1]);
    this.el.append(top);
    this.big = h('div', { class: 'hud-big' });
    this.card = h('div', { class: 'name-card' });
    this.dialog = h('div', { class: 'banter' });
    this.finisher = h('div', { class: 'finisher' });
    this.stamp = h('div', { class: 'bstamp' });
    this.el.append(this.big, this.card, this.dialog, this.finisher, this.stamp);

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
      (side.querySelector('.hud-portrait img') as HTMLImageElement).src = portraitUrl(m.f[p].char, 'icon', m.f[p].skin) || portraitUrl(m.f[p].char, 'icon');
      const name = side.querySelector('.hud-name') as HTMLElement;
      clear(name);
      name.append(stone(f.he), h('span', { class: 'en' }, [f.title]));
      this.names[p] = f.he;
    }
    this.renderWins(m);
  }

  private renderWins(m: MatchState) {
    for (let p = 0; p < 2; p++) {
      const w = this.bars[p].wins;
      clear(w);
      for (let i = 0; i < Math.min(5, m.cfg.roundsToWin); i++) w.append(h('span', { class: 'win' + (i < m.f[p].roundWins ? ' on' : '') }));
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
      b.meterLbl.textContent = mv >= 1 ? `HYPE! ${hypeInput()}` : `HYPE TRAIN LV.${Math.floor(mv * 4) + 1}`;
      if (this.comboTimers[p] > 0 && (this.comboTimers[p] -= dt) <= 0) b.combo.classList.remove('show');
      if (this.calloutTimers[p] > 0 && (this.calloutTimers[p] -= dt) <= 0) b.callout.classList.remove('show');
      if (inputs && this.cfg.showInput) this.renderInput(p, inputs[p], m.f[p].facing);
    }
    const secs = m.cfg.roundTime > 0 && !m.cfg.practice ? Math.ceil(m.timer / C.FPS) : -1;
    const txt = secs < 0 ? '∞' : String(secs);
    if (txt !== this.lastSecs) {
      this.lastSecs = txt;
      const st = this.timer.firstChild as HTMLElement;
      st.textContent = txt;
      st.setAttribute('data-t', txt);
    }
    this.timer.classList.toggle('hot', secs >= 0 && secs <= 10);
    const rw = m.f[0].roundWins * 10 + m.f[1].roundWins;
    if (rw !== this.lastRounds) { this.lastRounds = rw; this.renderWins(m); }

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
    const btn = [bits & C.IN_LP ? K('lp') : '', bits & C.IN_HP ? K('hp') : '', bits & C.IN_LK ? K('lk') : '', bits & C.IN_HK ? K('hk') : '', bits & C.IN_BLOCK ? '🛡' : '', bits & C.IN_SP ? K('sp') : ''].join(' ');
    const line = dir + ' ' + btn;
    if (el.firstChild?.textContent === line) return;
    el.prepend(h('div', {}, [line]));
    while (el.children.length > 12) el.lastChild!.remove();
  }

  /** Round calls / KO / FINISH etc. as a stone plate */
  bigText(text: string, sub = '', cls = '', ms = 1400) {
    clear(this.big);
    if (text) this.big.append(h('div', { class: 'big-main ' + cls }, [stone(text)]));
    if (sub) this.big.append(h('div', { class: 'big-sub ' + cls }, [sub]));
    this.big.classList.remove('show');
    void this.big.offsetWidth;
    this.big.classList.add('show');
    clearTimeout((this.big as any)._t);
    (this.big as any)._t = setTimeout(() => this.big.classList.remove('show'), ms);
  }

  /** Intro name card: big English title, Hebrew name under it */
  nameCard(p: number, title: string, he: string, ms = 1800) {
    clear(this.card);
    this.card.className = `name-card p${p + 1}`;
    this.card.append(stone(title, 'nc-title'), h('div', { class: 'nc-name' }, [he]));
    void this.card.offsetWidth;
    this.card.classList.add('show');
    clearTimeout((this.card as any)._t);
    (this.card as any)._t = setTimeout(() => this.card.classList.remove('show'), ms);
  }

  /** Pre-fight banter line */
  banter(p: number, who: string, text: string, ms = 2000) {
    clear(this.dialog);
    this.dialog.className = `banter p${p + 1}`;
    this.dialog.append(h('b', {}, [who + ':']), ' ', h('span', {}, [`«${text}»`]));
    void this.dialog.offsetWidth;
    this.dialog.classList.add('show');
    clearTimeout((this.dialog as any)._t);
    (this.dialog as any)._t = setTimeout(() => this.dialog.classList.remove('show'), ms);
  }

  combo(p: number, n: number, dmg: number) {
    const b = this.bars[p];
    clear(b.combo);
    b.combo.append(stone(`${n} מכות`), h('div', { class: 'd' }, [`${Math.round((dmg / C.MAX_HP) * 100)}%`]));
    b.combo.classList.remove('show');
    void b.combo.offsetWidth;
    b.combo.classList.add('show');
    this.comboTimers[p] = 1.6;
  }

  /** Special move callout: name + the fighter's shout + input */
  callout(p: number, name: string, shout: string, input: string, hype = false) {
    const b = this.bars[p];
    clear(b.callout);
    b.callout.append(stone(name), shout ? h('div', { class: 'pm-shout' }, [shout]) : '', h('div', { class: 'pm-input' }, [input]));
    b.callout.classList.toggle('hype', hype);
    b.callout.classList.remove('show', 'hit');
    void b.callout.offsetWidth;
    b.callout.classList.add('show');
    this.calloutTimers[p] = hype ? 2.4 : 1.7;
  }

  calloutHit(p: number) {
    const c = this.bars[p].callout;
    if (!c.classList.contains('show')) return;
    c.classList.remove('hit');
    void c.offsetWidth;
    c.classList.add('hit');
  }

  /** FINISH HIM: two banality cards + surprise */
  showFinisher(winnerChar: number, human: boolean, female: boolean) {
    const f = ROSTER[winnerChar];
    const fl = FLAVOR[f.id];
    clear(this.finisher);
    if (!fl) return;
    const [i1, i2] = banalityInputs();
    const card = (b: (typeof fl.banalities)[number], input: string, side: string) => h('div', { class: 'fcard ' + side }, [
      h('div', { class: 'fk' }, [input]), stone(b.name), h('div', { class: 'fen' }, [b.en]),
    ]);
    this.finisher.append(
      h('div', { class: 'f-title' }, [stone(human ? 'בחרו בנאליטי!' : `${f.he} ${female ? 'בוחרת' : 'בוחר'}...`)]),
      h('div', { class: 'f-cards' }, [card(fl.banalities[0], i1, 'left'), h('div', { class: 'fcard surprise' }, [h('div', { class: 'fk' }, [K('sp')]), stone('הפתעה 🎲')]), card(fl.banalities[1], i2, 'right')]),
      human ? h('div', { class: 'f-hint' }, ['אגרוף ← הכרטיס השמאלי · בעיטה ← הימני · מיוחד ← הפתעה']) : '',
    );
    this.finisher.classList.add('show');
  }

  pickFinisher(idx: number) {
    const cards = this.finisher.querySelectorAll('.fcard:not(.surprise)');
    cards.forEach((c, i) => c.classList.toggle('picked', i === idx));
    setTimeout(() => this.finisher.classList.remove('show'), 700);
  }

  hideFinisher() { this.finisher.classList.remove('show'); }

  /** Result after the banality: stamp word + the winner's line */
  banalityStamp(idx: number, name: string, en: string, stampWord: string, line: string, who: string) {
    clear(this.stamp);
    this.stamp.append(
      h('div', { class: 'bs-kind' }, [`BANALITY ${idx + 1} · ${who}`]),
      stone(name, 'bs-name'),
      h('div', { class: 'bs-en' }, [en]),
      h('div', { class: 'bs-stamp' }, [stampWord]),
      h('div', { class: 'bs-line' }, [`«${line}»`]),
    );
    this.stamp.classList.remove('show');
    void this.stamp.offsetWidth;
    this.stamp.classList.add('show');
    setTimeout(() => this.stamp.classList.remove('show'), 4200);
  }

  chatLine(text: string, user?: string) {
    if (!this.cfg.streamHud) return;
    const c = user ? { name: user, badge: '' as const } : pick(USERS);
    const u = c.name;
    const col = USER_COLORS[Math.abs(hashStr(u)) % USER_COLORS.length];
    const badge = c.badge ? h('span', { class: 'badge' }, [BADGE_ICON[c.badge]]) : '';
    const line = h('div', { class: 'chat-line' }, [badge, h('span', { class: 'u', style: `color:${col}` }, [u]), h('span', { class: 'm' }, [': ' + text])]);
    this.chat.append(line);
    while (this.chat.children.length > 9) this.chat.firstChild!.remove();
  }

  react(kind: keyof typeof LINES, vars: Record<string, string | number> = {}, count = 1) {
    if (!this.cfg.streamHud) return;
    const list = LINES[kind] ?? LINES.idle;
    for (let i = 0; i < count; i++) {
      setTimeout(() => this.chatLine(fill(pick(list), vars)), i * (120 + Math.random() * 250));
    }
    this.viewers += count * (8 + Math.random() * 20);
  }

  alert(kind: keyof typeof ALERTS, vars: Record<string, string | number> = {}) {
    if (!this.cfg.streamHud) return;
    const text = fill(pick(ALERTS[kind]), { u: pick(USERS).name, n: 5 + Math.floor(Math.random() * 95), m: 2 + Math.floor(Math.random() * 20), s: pick(USERS).name, ...vars });
    this.alertQueue.push({ text, kind });
    this.pumpAlerts();
  }

  private pumpAlerts() {
    if (this.alertBusy || !this.alertQueue.length) return;
    const a = this.alertQueue.shift()!;
    this.alertBusy = true;
    clear(this.alertEl);
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
