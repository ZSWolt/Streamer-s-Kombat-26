import * as THREE from 'three';
import { Cpu } from '../ai/Cpu';
import { audio } from '../audio/AudioEngine';
import { announcer, voices } from '../audio/announcer';
import { music } from '../audio/music';
import { ROSTER } from '../data/roster';
import { MV, spSlot } from '../sim/moves';
import * as C from '../sim/constants';
import { cloneMatch, createMatch, step } from '../sim/match';
import type { MatchConfig, MatchState, SimEvent } from '../sim/types';
import { St } from '../sim/types';
import { CameraDirector } from '../render/CameraDirector';
import { Cinematics } from '../render/cinematics';
import { ProceduralFighterView } from '../render/FighterView';
import type { Renderer } from '../render/Renderer';
import { STAGES, buildStage, type StageScene } from '../render/stages';
import { Vfx } from '../render/vfx';
import { Hud } from '../ui/Hud';
import type { App } from '../app/App';
import { hypeInput, spInput } from '../ui/keys';
import { FLAVOR, banterFor } from '../data/flavor';

export type InputSource = { kind: 'local'; player: 0 | 1 } | { kind: 'cpu'; level: number } | { kind: 'remote' } | { kind: 'none' };

export interface Driver {
  state(): MatchState;
  prev(): MatchState;
  tick(dt: number): { events: SimEvent[]; alpha: number; inputs: [number, number] };
  dispose?(): void;
}

export class LocalDriver implements Driver {
  m: MatchState;
  p: MatchState;
  private acc = 0;
  private cpus: (Cpu | null)[];
  private last: [number, number] = [0, 0];
  paused = false;
  override: ((i: 0 | 1) => number | null) | null = null;
  constructor(cfg: MatchConfig, private sources: [InputSource, InputSource], private app: App) {
    this.m = createMatch(cfg);
    this.p = cloneMatch(this.m);
    this.cpus = sources.map((s, i) => (s.kind === 'cpu' ? new Cpu(i, s.level) : null));
  }
  state() { return this.m; }
  prev() { return this.p; }
  private read(i: 0 | 1): number {
    const o = this.override?.(i);
    if (o !== null && o !== undefined) return o;
    const s = this.sources[i];
    if (s.kind === 'local') return this.app.input.read(s.player) & ~C.IN_START;
    if (s.kind === 'cpu') return this.cpus[i]!.input(this.m);
    return 0;
  }
  tick(dt: number) {
    const events: SimEvent[] = [];
    if (this.paused) return { events, alpha: 1, inputs: this.last };
    this.acc += Math.min(dt, 0.1);
    let n = 0;
    while (this.acc >= 1 / C.FPS && n < 4) {
      this.p = cloneMatch(this.m);
      const inputs: [number, number] = [this.read(0), this.read(1)];
      this.app.input.clearTaps();
      this.last = inputs;
      step(this.m, inputs);
      events.push(...this.m.events);
      this.acc -= 1 / C.FPS;
      n++;
    }
    return { events, alpha: Math.min(1, this.acc * C.FPS), inputs: this.last };
  }
}

export interface BattleOptions {
  mode: 'arcade' | 'versus' | 'practice' | 'demo' | 'online';
  cfg: MatchConfig;
  sources: [InputSource, InputSource];
  driver?: Driver;
  onEnd: (winner: number, m: MatchState) => void;
  onQuit: () => void;
  arcadeStage?: number;
  labels?: [string, string];
  showStart?: boolean;
}

export class Battle {
  root = new THREE.Group();
  stage: StageScene;
  views: ProceduralFighterView[];
  vfx: Vfx;
  cam: CameraDirector;
  hud: Hud;
  cine: Cinematics;
  driver: Driver;
  private t = 0;
  private ended = false;
  private pauseEl: HTMLElement | null = null;
  private unsubs: (() => void)[] = [];
  private introShown = [false, false];
  private hitEmoteCd = 0;
  private gate = false;
  private pauseBtn: HTMLButtonElement | null = null;
  /** the pause / match menu is up (in an online match the fight goes on behind it) */
  private menuOpen = false;
  private banter: [string, string] = ['', ''];
  practice: { dummy: () => string; cycle: () => void } | null = null;

  constructor(private app: App, private r: Renderer, public opts: BattleOptions) {
    const cfg = opts.cfg;
    this.driver = opts.driver ?? new LocalDriver(cfg, opts.sources, app);
    this.stage = buildStage(cfg.stage);
    this.root.add(this.stage.group);
    this.views = [new ProceduralFighterView(cfg.chars[0], cfg.skins[0]), new ProceduralFighterView(cfg.chars[1], cfg.skins[1])];
    for (const v of this.views) this.root.add(v.root, v.shadow);
    this.vfx = new Vfx(STAGES[cfg.stage]?.accent ?? '#ffae42');
    this.root.add(this.vfx.group);
    r.scene.add(this.root);
    r.scene.fog = this.stage.fog;
    r.scene.background = this.stage.bg;
    this.cam = new CameraDirector(r.camera);
    this.cam.shakeScale = app.settings.shake;
    const s = app.settings;
    this.hud = new Hud(app.uiRoot, { streamHud: s.streamHud && opts.mode !== 'practice', roundsToWin: cfg.roundsToWin, showInput: s.inputDisplay || opts.mode === 'practice', practice: cfg.practice });
    this.hud.chatSpeed = s.chatSpeed;
    this.hud.setFighters(this.driver.state());
    this.cine = new Cinematics(this.vfx, this.cam, r, this.hud);
    const m = this.driver.state();
    this.cam.update(0, new THREE.Vector3(m.f[0].x / 1000, 0, 0), new THREE.Vector3(m.f[1].x / 1000, 0, 0));
    this.cam.snap();
    music.play(STAGES[cfg.stage]?.music ?? 'kick', 1.2);
    announcer.preload(['round1', 'round2', 'round3', 'final', 'fight', 'ko', 'finish_him', 'finish_her', 'flawless', 'wins', 'banality']);
    if (opts.mode !== 'demo') {
      this.unsubs.push(app.input.onUi((e) => { if (e === 'start' && !this.ended) this.togglePause(); }));
      // a button for the mouse, and Esc swallowed by the browser (leaving full screen) still opens the menu
      this.pauseBtn = document.createElement('button');
      this.pauseBtn.className = 'pause-btn';
      this.pauseBtn.textContent = '☰';
      this.pauseBtn.title = 'תפריט (Esc / P)';
      this.pauseBtn.addEventListener('click', () => { this.pauseBtn?.blur(); if (!this.ended) this.togglePause(); });
      app.uiRoot.append(this.pauseBtn);
      const onFs = () => { if (!document.fullscreenElement && !this.ended && !this.menuOpen) this.togglePause(); };
      const onHide = () => { if (document.hidden && !this.ended && !this.menuOpen && this.driver instanceof LocalDriver) this.togglePause(); };
      document.addEventListener('fullscreenchange', onFs);
      document.addEventListener('visibilitychange', onHide);
      this.unsubs.push(() => { document.removeEventListener('fullscreenchange', onFs); document.removeEventListener('visibilitychange', onHide); });
    }
    if (opts.mode === 'demo') {
      this.unsubs.push(app.input.onUi((e) => { if (e === 'any' || e === 'confirm' || e === 'start') this.quit(); }));
      this.hud.bigText('DEMO', 'לחצו על מקש כדי לחזור', 'demo', 3000);
    }
    this.banter = banterFor(ROSTER[cfg.chars[0]].id, ROSTER[cfg.chars[1]].id);
    // pre-fight card over the stage (local modes)
    if (opts.showStart && this.driver instanceof LocalDriver) {
      this.gate = true;
      this.driver.paused = true;
      this.hud.setVisible(false);
      app.menus.startOverlay(cfg, undefined, () => {
        this.gate = false;
        (this.driver as LocalDriver).paused = false;
        this.hud.setVisible(true);
        audio.sfx('ui_start');
      });
    }
  }

  /** practice: put everyone back to the starting spots */
  resetPositions() {
    const d = this.driver as LocalDriver;
    if (!(d instanceof LocalDriver)) return;
    const m = d.m;
    m.f.forEach((f, i) => { f.x = i === 0 ? -1300 : 1300; f.y = 0; f.vx = 0; f.vy = 0; f.hp = C.MAX_HP; f.st = St.Idle; f.stFrame = 0; f.move = -1; f.facing = i === 0 ? 1 : -1; });
    m.proj = [];
    this.vfx.clear();
  }

  /** practice: jump straight to FINISH HIM so the player can try the banalities */
  practiceBanality() {
    const d = this.driver as LocalDriver;
    if (!(d instanceof LocalDriver) || d.m.phase !== 'fight') return;
    const m = d.m;
    this.resetPositions();
    m.f[1].x = m.f[0].x + 1100;
    m.f[1].hp = 0;
    m.f[1].st = St.Dizzy;
    m.f[1].stFrame = 0;
    m.winner = 0;
    m.phase = 'finish';
    m.phaseFrame = 0;
    this.onEvent({ f: m.frame, type: 'finish', p: 1, a: ROSTER[m.f[1].char].female ? 1 : 0 }, m);
  }

  togglePause() {
    if (this.opts.mode === 'demo' || this.gate) return;
    const open = !this.menuOpen;
    if (open) this.showPause(); else this.hidePause();
    audio.sfx(open ? 'ui_back' : 'ui_ok');
  }

  private showPause() {
    const d = this.driver;
    const local = d instanceof LocalDriver;
    if (local) d.paused = true;
    this.menuOpen = true;
    this.hud.el.classList.add('paused');
    this.pauseEl = this.app.menus.pauseMenu(this, {
      online: !local,
      resume: () => this.togglePause(),
      restart: () => { this.hidePause(); this.app.restartBattle(); },
      select: () => { this.hidePause(); this.ended = true; this.app.reselect(); },
      quit: () => { this.hidePause(); this.quit(); },
      practice: this.practice ? {
        dummy: this.practice.dummy, cycleDummy: this.practice.cycle,
        banality: () => { this.hidePause(); this.practiceBanality(); },
        resetPos: () => { this.hidePause(); this.resetPositions(); },
      } : undefined,
    });
  }

  private hidePause() {
    this.menuOpen = false;
    this.hud.el.classList.remove('paused');
    this.pauseEl?.remove();
    this.pauseEl = null;
    const d = this.driver as LocalDriver;
    if (d instanceof LocalDriver) d.paused = false;
  }

  /** true while the match menu covers the fight (online: the local player's buttons are ignored) */
  get inMenu() { return this.menuOpen; }

  quit() {
    if (this.ended) return;
    this.ended = true;
    this.opts.onQuit();
  }

  update(dt: number) {
    this.t += dt;
    const res = this.driver.tick(dt);
    const m = this.driver.state();
    const prev = this.driver.prev();
    for (const e of res.events) this.onEvent(e, m);
    for (let i = 0; i < 2; i++) this.views[i].update(m.f[i], prev.f[i], res.alpha, dt);
    this.vfx.syncProjectiles(m.proj, this.t);
    this.cine.update(dt, m, this.views);

    const p0 = this.views[0].root.position;
    const p1 = this.views[1].root.position;
    if (!this.cine.running) {
      if (m.phase === 'intro') {
        const who = m.phaseFrame < C.CHAR_INTRO_FRAMES / 2 ? 0 : 1;
        this.cam.mode = 'focus';
        this.cam.focusTarget.set(this.views[who].root.position.x, 1.35, 0);
        this.cam.focusDist = 3.1;
        this.cam.focusSide = who === 0 ? 1 : -1;
        this.cam.lerpSpeed = 3;
      } else if (m.superFreeze > 0 && m.superOwner >= 0) {
        this.cam.mode = 'focus';
        this.cam.focusTarget.set(this.views[m.superOwner].root.position.x, 1.45, 0);
        this.cam.focusDist = 2.6;
        this.cam.focusSide = m.f[m.superOwner].facing;
        this.cam.lerpSpeed = 9;
      } else if ((m.phase === 'roundEnd' || m.phase === 'matchEnd') && m.roundWinner >= 0 && m.roundWinner < 2) {
        const w = m.roundWinner as 0 | 1;
        this.cam.mode = 'focus';
        this.cam.focusTarget.set(this.views[w].root.position.x, 1.3, 0);
        this.cam.focusDist = 3.4;
        this.cam.focusSide = m.f[w].facing;
        this.cam.lerpSpeed = 2.5;
      } else {
        this.cam.mode = 'fight';
        this.cam.lerpSpeed = m.slowmo > 0 ? 3 : 6;
      }
    }
    this.cam.update(dt, p0, p1);
    this.stage.update(this.t, dt);
    this.vfx.update(dt, this.t);
    this.hud.update(m, dt, res.inputs);
    this.hud.el.classList.toggle('letterbox', m.phase === 'intro');
    music.intensity = m.phase === 'finish' ? 0.2 : 1;
  }

  /** What a thrown thing does when it lands on someone or on the floor (`vfx` as the projectile carries it). */
  private propImpact(vfx: string, x: number, y: number) {
    const pan = THREE.MathUtils.clamp((x - this.cam.pos.x) / 5, -1, 1);
    switch (vfx.split(':')[0]) {
      case 'wine': audio.sfx('glass', pan); this.vfx.hitSpark(x, y, 1, false, '#c2183a'); this.vfx.burst(x, y, '🍷', 4, 4, 0.4); break;
      case 'perfume': audio.sfx('glass', pan, 0.7); audio.sfx('spray', pan); this.vfx.hitSpark(x, y, 1, false, '#d58cff'); this.vfx.burst(x, y, '💨', 6, 3, 0.6); break;
      case 'creep': audio.sfx('twang', pan); this.vfx.burst(x, y, '🎵', 6, 5, 0.45); break;
      case 'lettuce': this.vfx.burst(x, y, '🥬', 4, 4, 0.4); break;
      case 'batza': this.vfx.burst(x, y, '🍃', 4, 4, 0.35); break;
    }
  }

  private onEvent(e: SimEvent, m: MatchState) {
    const A = audio;
    const pan = (x?: number) => THREE.MathUtils.clamp(((x ?? 0) / 1000 - this.cam.pos.x) / 5, -1, 1);
    const fx = this.app.settings.effects;
    switch (e.type) {
      case 'charIntro': {
        const p = e.p!;
        const f = ROSTER[m.f[p].char];
        this.hud.nameCard(p, f.title, f.he, 1900);
        setTimeout(() => this.hud.banter(p, f.he, this.banter[p], 2100), 650);
        void voices.play(f.id, 'intro', p === 0 ? -0.4 : 0.4);
        audio.sfx('select', 0, 0.6);
        break;
      }
      case 'round': {
        const final = e.b === 1;
        this.hud.bigText(final ? 'סיבוב אחרון' : `סיבוב ${['', 'ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שביעי', 'שמיני', 'תשיעי'][e.a!] ?? e.a}`, final ? 'FINAL ROUND' : `ROUND ${e.a}`, 'round', 1500);
        void announcer.say(final ? 'final' : `round${Math.min(5, e.a!)}`);
        A.sfx('crowd', 0, 0.5);
        this.vfx.clear();
        this.views.forEach((v) => { v.fx.squash = 1; v.fx.offsetY = 0; v.fx.spin = 0; v.fx.shrink = 1; v.fx.tintAmt = 0; v.fx.hidden = false; v.setOverride(null); });
        break;
      }
      case 'fight':
        this.hud.bigText('להילחם!', 'FIGHT', 'fight', 900);
        void announcer.say('fight');
        A.sfx('bell');
        this.r.flash('#ffffff', 0.25, 200);
        break;
      case 'swing':
        A.sfx((e.a ?? 0) >= 70 ? 'swingH' : 'swingL', pan(m.f[e.p!].x), 0.8);
        break;
      case 'cooldown':
        this.hud.cooldownDenied(e.p!, e.a ?? 0);
        if (this.opts.sources[e.p!]?.kind !== 'cpu') A.sfx('ui_back', pan(m.f[e.p!].x), 0.5);
        break;
      case 'stale':
        if (e.a === 2 && Math.random() < 0.5) this.hud.react('spam');
        break;
      case 'hit': {
        const heavy = e.b ?? 0;
        const x = (e.x ?? 0) / 1000, y = Math.max(0.4, (e.y ?? 1000) / 1000);
        this.vfx.hitSpark(x, y, heavy, false);
        if (e.s?.startsWith('proj:')) this.propImpact(e.s.slice(5), x, y);
        A.sfx(heavy >= 3 ? 'hitX' : heavy === 2 ? 'hitH' : heavy === 1 ? 'hitM' : 'hitL', pan(e.x));
        this.cam.shake((0.25 + heavy * 0.25) * fx);
        if (heavy >= 2) { this.r.kickChroma(0.006 * fx); this.cam.punch(0.25); this.stage.pulse(0.6); }
        this.views[e.p!].onHit(heavy, (e.y ?? 1000) > 1100);
        this.hud.calloutHit(1 - e.p!);
        this.hud.viewers += 4 + heavy * 10;
        if (heavy >= 2) this.hud.react('bigHit', {}, 1 + (Math.random() < 0.5 ? 1 : 0));
        else if (Math.random() < 0.25) this.hud.react('hit');
        if (this.hitEmoteCd <= this.t && heavy >= 2 && fx > 0.3) { this.hitEmoteCd = this.t + 0.6; this.vfx.emote(x, y + 0.5, ['😂', '💀', '🔥', '😭', '🤣'][Math.floor(Math.random() * 5)]); }
        if (Math.random() < 0.18) void voices.play(ROSTER[m.f[e.p!].char].id, 'hurt', pan(e.x));
        const f = m.f[e.p!];
        if (f.hp > 0 && f.hp < C.MAX_HP * 0.2 && Math.random() < 0.3) this.hud.react('lowHp', { low: ROSTER[f.char].he });
        break;
      }
      case 'block':
        if (e.s) this.propImpact(e.s, (e.x ?? 0) / 1000, Math.max(0.5, (e.y ?? 1000) / 1000));
        this.vfx.hitSpark((e.x ?? 0) / 1000, Math.max(0.5, (e.y ?? 1000) / 1000), e.b ?? 0, true);
        A.sfx('block', pan(e.x));
        this.cam.shake(0.1 * fx);
        if (Math.random() < 0.12) this.hud.react('block');
        break;
      case 'combo': {
        this.hud.combo(e.p!, e.a!, e.b ?? 0);
        if (e.a === 4) this.hud.react('combo', { n: e.a! }, 2);
        if (e.a === 6) { this.hud.alert('sub'); A.sfx('alert'); }
        if (e.a === 9) { this.hud.alert('gift'); A.sfx('alert'); }
        break;
      }
      case 'special': {
        const f = ROSTER[m.f[e.p!].char];
        const idx = spSlot(e.a ?? MV.SP0);
        const sp = f.specials[idx];
        if (sp) this.hud.callout(e.p!, sp.name, FLAVOR[f.id]?.shouts[idx] ?? '', spInput(sp.input));
        A.sfx('special', pan(m.f[e.p!].x));
        if (Math.random() < 0.35) this.hud.react('special');
        // a line cut for this very move is said every time; the general ones only now and then
        const px = pan(m.f[e.p!].x);
        void voices.play(f.id, `sp${idx}`, px).then((own) => { if (!own && Math.random() < 0.35) void voices.play(f.id, 'special', px); });
        break;
      }
      case 'proj':
        A.sfx('proj', pan(m.f[e.p!].x));
        if (e.s === 'car') A.sfx('engine');
        if (e.s === 'creep') A.sfx('guitar', pan(m.f[e.p!].x));
        if (e.s === 'indegear') this.vfx.floatText(m.f[e.p!].x / 1000, 1.95, 'תקנו מוצרים!', '#27a6ff', 0.4);
        break;
      case 'projDie':
        if (!e.b) { this.vfx.dust((e.x ?? 0) / 1000); A.sfx('land', pan(e.x), 0.6); this.propImpact(e.s ?? '', (e.x ?? 0) / 1000, 0.25); }
        break;
      case 'clash':
        this.vfx.hitSpark((e.x ?? 0) / 1000, (e.y ?? 1000) / 1000, 2, false, '#9ad8ff');
        A.sfx('hitM', pan(e.x));
        break;
      case 'reflect':
        this.vfx.hitSpark((e.x ?? 0) / 1000, (e.y ?? 1000) / 1000, 1, true);
        A.sfx('reflect');
        this.hud.bigText('KARMA!', '', 'small', 700);
        break;
      case 'reflectOn': A.sfx('reflect', 0, 0.4); break;
      case 'counter':
        A.sfx('counter');
        this.vfx.hitSpark((e.x ?? 0) / 1000, 1.2, 2, false, '#ffd84d');
        this.hud.bigText('COUNTER!', '', 'small', 800);
        this.hud.react('counter', {}, 2);
        break;
      case 'armor': A.sfx('block', 0, 1.2); this.vfx.hitSpark((e.x ?? 0) / 1000, 1.1, 1, true); break;
      case 'teleport':
        A.sfx('teleport');
        this.vfx.burst((e.x ?? 0) / 1000, 1, '💨', 5, 3, 0.5);
        this.vfx.burst((e.a ?? 0) / 1000, 1, '✨', 5, 3, 0.4);
        break;
      case 'swap': A.sfx('teleport'); this.vfx.burst((e.x ?? 0) / 1000, 1, '🌀', 4, 3, 0.5); this.vfx.burst((e.a ?? 0) / 1000, 1, '🌀', 4, 3, 0.5); break;
      case 'throw': case 'grab':
        A.sfx('throw');
        this.hud.react('throw');
        break;
      case 'tech': A.sfx('block'); this.hud.bigText('TECH!', '', 'small', 600); break;
      case 'hype': {
        const f = ROSTER[m.f[e.p!].char];
        A.sfx('hype');
        this.r.flash(f.accent, 0.35, 400);
        this.hud.callout(e.p!, f.hype.name, 'HYPE!', hypeInput(), true);
        this.hud.react('hype', {}, 3);
        this.hud.alert('raid', { s: f.name });
        void announcer.say('hype');
        break;
      }
      case 'hypeHit':
        this.cine.start('hype', e.s ?? '', e.p!);
        break;
      case 'jump': A.sfx('jump', pan(m.f[e.p!].x), 0.6); if (Math.random() < 0.03) this.hud.react('jump'); break;
      case 'land': A.sfx('land', pan(m.f[e.p!].x), e.a ? 1 : 0.4); if (e.a) { this.vfx.dust(m.f[e.p!].x / 1000); this.cam.shake(0.3); } break;
      case 'dash': A.sfx('dash', pan(m.f[e.p!].x)); this.vfx.dust(m.f[e.p!].x / 1000); break;
      case 'knockdown': A.sfx('knockdown', pan(e.x)); this.vfx.dust((e.x ?? 0) / 1000, true); this.cam.shake(0.45 * fx); break;
      case 'status': this.hud.bigText(e.s === 'reversed' ? 'מבולבל!' : e.s === 'slow' ? 'קפוא!' : '!', '', 'small', 700); break;
      case 'stun': A.sfx('dizzy'); this.vfx.emote(m.f[e.p!].x / 1000, 2.1, '💫', 0.6); break;
      case 'ko': {
        this.hud.hideFinisher();
        if (e.p === -1) { this.hud.bigText('נוקאאוט כפול', 'DOUBLE K.O.', 'ko', 2000); void announcer.sayNow('doubleko'); }
        else { this.hud.bigText('K.O.', '', 'ko', 2000); void announcer.sayNow('ko'); }
        A.sfx('ko');
        music.stinger('ko');
        this.r.flash('#ffffff', 0.85, 450);
        this.r.kickChroma(0.015);
        this.cam.shake(1.2 * fx);
        this.cam.punch(1.4);
        this.hud.react('ko', { win: e.p! >= 0 ? ROSTER[m.f[1 - e.p!].char].he : '', lose: e.p! >= 0 ? ROSTER[m.f[e.p!].char].he : '' }, 4);
        if (e.p! >= 0) void voices.play(ROSTER[m.f[e.p!].char].id, 'ko');
        break;
      }
      case 'finish': {
        this.hud.bigText(e.a ? 'גמרי אותה!' : 'גמור אותו!', e.a ? 'FINISH HER' : 'FINISH HIM', 'finish', 2200);
        void announcer.sayNow(e.a ? 'finish_her' : 'finish_him');
        music.intensity = 0.2;
        this.hud.react('finish', {}, 4);
        const w = 1 - e.p!;
        const human = this.opts.sources[w]?.kind === 'local';
        setTimeout(() => { if (this.driver.state().phase === 'finish') this.hud.showFinisher(m.f[w].char, human, !!ROSTER[m.f[w].char].female); }, 900);
        break;
      }
      case 'banality':
        this.hud.pickFinisher(e.a ?? 0);
        this.cine.start('banality', e.s ?? '', e.p!);
        this.hud.react('banality', {}, 5);
        break;
      case 'banalityEnd': {
        const f = ROSTER[m.f[e.p!].char];
        const b = FLAVOR[f.id]?.banalities[e.a ?? 0];
        if (b) this.hud.banalityStamp(e.a ?? 0, b.name, b.en, b.stamp, b.line, f.he);
        void voices.play(f.id, 'win');
        break;
      }
      case 'roundWin': {
        const f = ROSTER[m.f[e.p!].char];
        const fem = f.female;
        this.hud.bigText(`${f.he} ${fem ? 'מנצחת' : 'מנצח'}`, e.b ? 'FLAWLESS VICTORY' : `${f.name} WINS`, 'wins', 2400);
        void announcer.say('name_' + f.id).then(() => announcer.say(e.b ? 'flawless' : 'wins'));
        if (e.a) { music.stinger('victory'); void voices.play(f.id, 'win'); }
        A.sfx('crowd');
        if (e.b) this.hud.react('perfect', {}, 3);
        this.hud.alert('donate', { win: f.he });
        break;
      }
      case 'timeOver':
        this.hud.bigText('נגמר הזמן', 'TIME', 'ko', 1600);
        void announcer.sayNow('time');
        this.hud.react('timeOver', {}, 2);
        break;
      case 'matchEnd':
        if (!this.ended) {
          this.ended = true;
          const w = e.p!;
          setTimeout(() => this.opts.onEnd(w, m), 400);
        }
        break;
    }
  }

  dispose() {
    this.unsubs.forEach((u) => u());
    this.pauseBtn?.remove();
    this.hidePause();
    this.hud.destroy();
    this.r.scene.remove(this.root);
    for (const v of this.views) v.dispose();
    this.vfx.clear();
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const mm = mesh.material as THREE.Material | THREE.Material[];
        (Array.isArray(mm) ? mm : [mm]).forEach((x) => x?.dispose());
      }
    });
    this.driver.dispose?.();
  }
}
