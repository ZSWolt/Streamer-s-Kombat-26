import * as THREE from 'three';
import { audio } from '../audio/AudioEngine';
import { music } from '../audio/music';
import { ROSTER, fighterIndex } from '../data/roster';
import { CameraDirector } from '../render/CameraDirector';
import { ProceduralFighterView } from '../render/FighterView';
import { buildStage, type StageScene } from '../render/stages';
import { Vfx } from '../render/vfx';
import * as C from '../sim/constants';
import { cloneMatch, createMatch, step } from '../sim/match';
import type { MatchState } from '../sim/types';
import type { App, Screen } from '../app/App';
import { h } from '../ui/dom';
import { logoEl } from '../ui/logo';
import { portraitUrl } from '../ui/portraits';

const ORDER = ['odedsvr', 'ronengg', 'inde', 'nave', 'shoval', 'paz', 'ori', 'igz', 'liorslife', 'psyqr', 'maorameleh', 'masterohad', 'pedrofederer', 'k0nkamc', 'devidtur', 'sasivetheboiz', 'shotist'];
const SHOT = 2.35;
const SHOWCASE = ['projectile', 'summon', 'drop', 'rush', 'uppercut', 'slam', 'trap'];

/** Opening cinematic: every fighter gets a short hero shot performing a signature move. */
export class IntroCinematic implements Screen {
  private group = new THREE.Group();
  private stages = new Map<number, StageScene>();
  private cam: CameraDirector;
  private vfx = new Vfx('#ffb347');
  private t = 0;
  private shot = -1;
  private m!: MatchState;
  private prev!: MatchState;
  private view: ProceduralFighterView | null = null;
  private card: HTMLElement | null = null;
  private ui: HTMLElement;
  private acc = 0;
  private timeScale = 1;
  private plan: { at: number; bits: number; dur: number; slow?: boolean }[] = [];
  private off: () => void;
  private ending = false;
  private finished = false;
  private curStage = -1;

  constructor(private app: App, private then: () => void) {
    const r = app.renderer;
    r.scene.add(this.group);
    this.group.add(this.vfx.group);
    this.cam = new CameraDirector(r.camera);
    this.ui = h('div', { class: 'screen letterbox', style: 'pointer-events:none' }, [h('div', { class: 'intro-skip' }, ['לחצו על מקש כדי לדלג'])]);
    app.uiRoot.append(this.ui);
    music.play('title', 0.3);
    this.off = app.input.onUi((e) => { if (e === 'any' || e === 'confirm' || e === 'start') this.finish(); });
    this.nextShot();
  }

  private stageFor(idx: number): StageScene {
    let s = this.stages.get(idx);
    if (!s) { s = buildStage(idx); this.stages.set(idx, s); this.group.add(s.group); }
    return s;
  }

  private nextShot() {
    this.shot++;
    if (this.shot >= ORDER.length) { this.logo(); return; }
    const ci = fighterIndex(ORDER[this.shot]);
    const f = ROSTER[ci];
    const r = this.app.renderer;
    // stage
    const st = this.stageFor(f.stage);
    for (const [k, s] of this.stages) s.group.visible = k === f.stage;
    this.curStage = f.stage;
    r.scene.fog = st.fog;
    r.scene.background = st.bg;
    // sim
    this.m = createMatch({ chars: [ci, ci === 0 ? 1 : 0], skins: [0, 0], stage: f.stage, roundsToWin: 9, roundTime: 0, seed: 7 + this.shot, charIntro: false, practice: true });
    this.m.phase = 'fight';
    this.m.f[0].x = -1400;
    this.m.f[1].x = 5300;
    this.prev = cloneMatch(this.m);
    // pick showcase special
    let sIdx = f.specials.findIndex((s) => s.spec.kind === 'projectile' || s.spec.kind === 'summon');
    if (sIdx < 0) sIdx = f.specials.findIndex((s) => SHOWCASE.includes(s.spec.kind));
    if (sIdx < 0) sIdx = 0;
    const dir = [0, C.IN_RIGHT, C.IN_DOWN][sIdx];
    const other = f.specials.findIndex((s, i) => i !== sIdx && SHOWCASE.includes(s.spec.kind));
    this.plan = [
      { at: 0.45, bits: dir, dur: 0.05 },
      { at: 0.5, bits: dir | C.IN_SP, dur: 0.05, slow: true },
    ];
    if (other >= 0) {
      const d2 = [0, C.IN_RIGHT, C.IN_DOWN][other];
      this.plan.push({ at: 1.45, bits: d2, dur: 0.05 }, { at: 1.5, bits: d2 | C.IN_SP, dur: 0.05 });
    } else {
      this.plan.push({ at: 1.5, bits: C.IN_HK, dur: 0.05 });
    }
    // view
    if (this.view) { this.group.remove(this.view.root, this.view.shadow); this.view.dispose(); }
    this.view = new ProceduralFighterView(ci, 0);
    this.group.add(this.view.root, this.view.shadow);
    this.vfx.clear();
    this.t = 0;
    this.timeScale = 1;
    // camera
    this.cam.mode = 'focus';
    this.cam.focusTarget.set(-1.4, 1.55, 0);
    this.cam.focusDist = 1.6;
    this.cam.focusSide = this.shot % 2 ? -1 : 1;
    this.cam.lerpSpeed = 20;
    this.cam.update(0.1, new THREE.Vector3(), new THREE.Vector3());
    this.cam.snap();
    this.cam.lerpSpeed = 2.2;
    r.flash('#ffffff', 0.55, 260);
    audio.sfx('swingH', 0, 0.6);
    // name card
    this.card?.remove();
    this.card = null;
  }

  private showCard() {
    const f = ROSTER[fighterIndex(ORDER[this.shot])];
    this.card = h('div', { class: 'intro-card' }, [
      h('div', { class: 'n metal' }, [f.he]),
      h('div', { class: 't' }, [f.title]),
      h('div', { class: 'p ' + f.platform }, [f.platform === 'kick' ? 'KICK.COM/' + f.name : 'YOUTUBE']),
    ]);
    this.ui.append(this.card);
    audio.sfx('slam', 0, 0.7);
    this.cam.shake(0.5);
  }

  private logo() {
    this.ending = true;
    if (this.view) { this.group.remove(this.view.root, this.view.shadow); this.view.dispose(); this.view = null; }
    this.card?.remove();
    this.app.canvasMode('dim');
    const row = h('div', { class: 'portrait-row', style: 'display:flex;gap:10px;margin-top:3vh;flex-wrap:wrap;justify-content:center;max-width:92vw' },
      ROSTER.map((f, i) => h('div', { class: 'round-portrait', style: `background-image:url(${portraitUrl(i, 'icon')});--acc:${f.platform === 'kick' ? '#53fc18' : '#ff0033'};animation-delay:${0.8 + i * 0.06}s` })));
    const lg = logoEl();
    lg.style.animation = 'slamIn 1s cubic-bezier(.2,1.4,.4,1) both';
    const el = h('div', { class: 'screen', style: 'background:radial-gradient(ellipse at 50% 42%, rgba(90,30,8,.6), #000 70%)' }, [lg, row]);
    this.ui.append(el);
    audio.sfx('ui_start');
    this.app.renderer.flash('#ffffff', 0.9, 700);
    setTimeout(() => this.finish(), 4200);
  }

  private finish() {
    if (this.finished) return;
    this.finished = true;
    this.app.canvasMode('clear');
    this.then();
  }

  update(dt: number) {
    if (this.ending || !this.view) { this.vfx.update(dt, this.t); return; }
    this.t += dt;
    // slow motion window right after the special input
    const slowActive = this.plan.some((p) => p.slow && this.t > p.at + 0.12 && this.t < p.at + 0.62);
    this.timeScale += ((slowActive ? 0.28 : 1) - this.timeScale) * Math.min(1, dt * 10);
    this.acc += dt * this.timeScale;
    while (this.acc >= 1 / C.FPS) {
      this.acc -= 1 / C.FPS;
      let bits = 0;
      for (const p of this.plan) if (this.t >= p.at && this.t < p.at + p.dur) bits |= p.bits;
      this.prev = cloneMatch(this.m);
      step(this.m, [bits, 0]);
      for (const e of this.m.events) {
        if (e.type === 'special') { audio.sfx('special'); this.vfx.burst(this.m.f[0].x / 1000 + 0.6, 1.4, '✨', 8, 5, 0.4); }
        if (e.type === 'proj') audio.sfx('proj');
        if (e.type === 'swing') audio.sfx('swingH');
        if (e.type === 'land' && e.a) { audio.sfx('slam'); this.cam.shake(0.6); this.vfx.dust(this.m.f[0].x / 1000, true); }
      }
      this.m.f[1].x = 5300;
      this.m.f[1].hp = C.MAX_HP;
    }
    const alpha = Math.min(1, this.acc * C.FPS);
    this.view.update(this.m.f[0], this.prev.f[0], alpha, dt * this.timeScale);
    this.vfx.syncProjectiles(this.m.proj, this.t);
    this.vfx.update(dt * this.timeScale, this.t);
    this.stages.get(this.curStage)?.update(this.t, dt);

    const p = this.view.root.position;
    const k = Math.min(1, this.t / SHOT);
    this.cam.focusTarget.set(p.x + 0.6 * k, 1.45 - 0.25 * k, 0);
    this.cam.focusDist = 1.7 + k * 3.2;
    this.cam.update(dt, p, p);
    if (!this.card && this.t > 0.22) this.showCard();
    if (this.t > SHOT) this.nextShot();
  }

  dispose() {
    this.off();
    this.ui.remove();
    this.view?.dispose();
    this.vfx.clear();
    this.app.renderer.scene.remove(this.group);
    this.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
  }
}
