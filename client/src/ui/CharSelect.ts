import * as THREE from 'three';
import { audio } from '../audio/AudioEngine';
import { announcer } from '../audio/announcer';
import { ROSTER, RANDOM_SLOT, fighterIndex } from '../data/roster';
import { SECRETS } from '../data/secrets';
import { ProceduralFighterView } from '../render/FighterView';
import { STAGES } from '../render/stages';
import { newFighter } from '../sim/util';
import { St } from '../sim/types';
import type { App, Screen } from '../app/App';
import { clear, h } from './dom';
import { logoEl } from './logo';
import { portraitUrl } from './portraits';
import { K, motionInput, spInput } from './keys';
import { stone } from './stone';

export interface SelectResult { chars: [number, number]; skins: [number, number]; stage: number; p2cpu?: boolean }
export interface NetPick { char: number; skin: number; locked: boolean; stage?: number }
export interface SelectNet { side: 0 | 1; onLocal: (p: NetPick) => void }

// two rows: every fighter + the random card; the secret cards sit centred on a third row
const COLS = Math.ceil((RANDOM_SLOT + 1) / 2);
const SECRET0 = RANDOM_SLOT + 1;
const SECRET_COLS = SECRETS.map((_, k) => (COLS - SECRETS.length) / 2 + k);
const rowLen = (row: number) => Math.min(COLS, RANDOM_SLOT + 1 - row * COLS);
const FACE_YAW = 0.5; // side models: facing the camera, turned this much towards the centre

interface Cursor { idx: number; locked: boolean; skin: number; active: boolean }

/** grid index -> fighter + skin */
function resolve(idx: number, skin: number): { char: number; skin: number } | null {
  if (idx < RANDOM_SLOT) return { char: idx, skin };
  if (idx >= SECRET0) { const s = SECRETS[idx - SECRET0]; return { char: fighterIndex(s.char), skin: s.skin }; }
  return null;
}

export class CharSelect implements Screen {
  private el: HTMLElement;
  private cards: HTMLElement[] = [];
  private cur: [Cursor, Cursor];
  private info: HTMLElement[] = [];
  private scene = new THREE.Group();
  private views: (ProceduralFighterView | null)[] = [null, null];
  private viewKeys = ['', ''];
  private fakeF = [newFighter(0, 0, 0), newFighter(0, 0, 1)];
  private off: () => void;
  private stage = 0;
  private stageEl: HTMLElement;
  private titleEl: HTMLElement;
  private gridEl!: HTMLElement;
  private spots: { light: THREE.SpotLight; beam: THREE.Mesh }[] = [];
  private rightLbl: HTMLElement;
  private rouletteEl: HTMLElement;
  private phase: 'pick' | 'stage' | 'roulette' | 'done' = 'pick';
  private twoHumans: boolean;
  private t = 0;

  constructor(private app: App, private mode: 'arcade' | 'versus' | 'practice' | 'online', private onDone: (r: SelectResult) => void, private onBack: () => void, preset?: number, private net?: SelectNet) {
    this.twoHumans = mode === 'versus';
    app.input.solo = !this.twoHumans;
    this.cur = [
      { idx: preset ?? 0, locked: false, skin: 0, active: true },
      { idx: mode === 'arcade' ? RANDOM_SLOT : preset !== undefined ? (preset + 1) % ROSTER.length : 6, locked: false, skin: 0, active: this.twoHumans || mode === 'online' },
    ];
    this.stage = ROSTER[this.cur[0].idx].stage;

    const grid = h('div', { class: 'cs-grid', style: `--cols:${COLS}` });
    this.gridEl = grid;
    for (let i = 0; i <= RANDOM_SLOT; i++) grid.append(this.makeCard(i));
    const secretRow = h('div', { class: 'cs-secrets' });
    SECRETS.forEach((_, k) => secretRow.append(this.makeCard(SECRET0 + k)));
    for (let p = 0; p < 2; p++) this.info.push(h('div', { class: `cs-info p${p + 1}` }));
    this.stageEl = h('div', { class: 'cs-stage' });
    this.titleEl = h('h2', {}, [stone('בחר לוחם')]);
    this.rightLbl = h('div', { class: 'cs-player-lbl p2' });
    this.rouletteEl = h('div', { class: 'cs-roulette' });
    this.el = h('div', { class: 'screen cselect fade-in' }, [
      logoEl(),
      this.titleEl,
      grid,
      h('div', { class: 'cs-sep' }, ['?']),
      secretRow,
      h('div', { class: 'cs-player-lbl p1' }, ['שחקן 1']),
      this.rightLbl,
      this.info[0], this.info[1], this.stageEl, this.rouletteEl,
      h('div', { class: 'cs-bottom' }, [`←→↑↓ / D-pad לבחירה • ${K('lp')} / Enter / ✕ לאישור • ${K('hp')} = סקין • עכבר: לחיצה • Esc חזרה`]),
    ]);
    app.uiRoot.append(this.el);

    // 3D side models under spotlights
    const r = app.renderer;
    r.scene.background = new THREE.Color('#050303');
    r.scene.fog = new THREE.Fog('#050303', 12, 30);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(40, 16), new THREE.MeshBasicMaterial({ color: '#1a0a06' }));
    back.position.set(0, 6, -6);
    this.scene.add(back);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 64), new THREE.MeshPhongMaterial({ color: '#1a0d08', specular: '#3a2416', shininess: 36 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#1a0a04', 0.35));
    // soft vertical falloff so the beams read as haze, not flat panels
    const bc = document.createElement('canvas');
    bc.width = 4; bc.height = 64;
    const bg = bc.getContext('2d')!;
    const grad = bg.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, '#fff'); grad.addColorStop(0.55, '#6a6a6a'); grad.addColorStop(1, '#101010');
    bg.fillStyle = grad; bg.fillRect(0, 0, 4, 64);
    const beamTex = new THREE.CanvasTexture(bc);
    const mkSpot = (x: number, col: string) => {
      const s = new THREE.SpotLight(col, 48, 18, 0.42, 0.55, 1.4);
      s.position.set(x, 9, 3);
      s.target.position.set(x, 0, 0.8);
      s.castShadow = true;
      this.scene.add(s, s.target);
      const beam = new THREE.Mesh(new THREE.ConeGeometry(2.4, 9, 32, 1, true), new THREE.MeshBasicMaterial({ color: col, alphaMap: beamTex, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.set(x, 4.5, 1);
      this.scene.add(beam);
      this.spots.push({ light: s, beam });
    };
    mkSpot(-3.6, '#ffd9a0');
    mkSpot(3.6, '#9fc8ff');
    const fill = new THREE.DirectionalLight('#ffe6cc', 1.2);
    fill.position.set(0, 3, 8);
    this.scene.add(fill);
    r.scene.add(this.scene);
    r.camera.fov = 32;
    r.camera.updateProjectionMatrix();

    this.off = app.input.onUi((e, p) => this.onUi(e, p));
    this.onMove(0);
    this.onMove(1);
    this.renderStage();
    this.renderTitle();
  }

  private makeCard(i: number): HTMLElement {
    let card: HTMLElement;
    const tags = [h('div', { class: 'tag t1' }, ['1P']), h('div', { class: 'tag t2' }, [this.mode === 'arcade' ? 'CPU' : '2P'])];
    if (i === RANDOM_SLOT) {
      card = h('div', { class: 'cs-card random' }, [h('div', { class: 'img dice' }, ['🎲']), h('div', { class: 'title' }, ['RANDOM']), h('div', { class: 'name' }, ['אקראי']), ...tags]);
    } else if (i >= SECRET0) {
      const s = SECRETS[i - SECRET0];
      const unlocked = this.app.save.unlocked.includes(s.id);
      const ci = fighterIndex(s.char);
      card = h('div', { class: 'cs-card secret' + (unlocked ? ' open' : ''), style: `--glow:${s.glow}` }, [
        unlocked ? h('div', { class: 'img', style: `background-image:url(${portraitUrl(ci, 'card', s.skin)})` }) : h('div', { class: 'img sil' }, [h('span', { class: 'q' }, ['?']), h('span', { class: 'lock' }, ['🔒'])]),
        h('div', { class: 'title' }, [unlocked ? s.title : 'SECRET']),
        h('div', { class: 'name' }, [unlocked ? s.name : '???']),
        ...tags,
      ]);
    } else {
      const f = ROSTER[i];
      card = h('div', { class: 'cs-card' }, [
        h('div', { class: 'img', style: `background-image:url(${portraitUrl(i, 'card')})` }),
        h('div', { class: 'plat ' + f.platform }, [f.platform === 'kick' ? 'KICK' : f.platform === 'youtube' ? 'YT' : 'NEW']),
        h('div', { class: 'title' }, [f.title]),
        h('div', { class: 'name' }, [f.he]),
        ...tags,
      ]);
    }
    card.addEventListener('click', () => { const p = this.playerFor(0); if (!this.cur[p].locked) { this.cur[p].idx = i; this.confirm(p); } });
    card.addEventListener('mouseenter', () => { const p = this.playerFor(0); if (!this.cur[p].locked && this.phase === 'pick') { this.cur[p].idx = i; this.cur[p].skin = 0; this.onMove(p); } });
    this.cards[i] = card;
    return card;
  }

  private playerFor(p: number): number {
    if (this.net) return this.net.side;
    // in single-human modes, P1 controls the second cursor after locking
    if (!this.twoHumans && this.cur[0].locked) return 1;
    return p;
  }

  private renderTitle() {
    const choosingOpp = !this.twoHumans && !this.net && this.cur[0].locked;
    clear(this.titleEl);
    this.titleEl.append(stone(choosingOpp ? (this.mode === 'practice' ? 'בחר בובת אימון' : 'בחר יריב') : 'בחר לוחם'));
    this.rightLbl.textContent = this.mode === 'practice' ? 'בובה' : this.twoHumans || this.mode === 'online' ? 'שחקן 2' : 'CPU';
  }

  /** online: apply the opponent's cursor */
  applyRemote(side: number, pick: NetPick | null, stage?: number) {
    if (!pick) return;
    const c = this.cur[side];
    c.idx = pick.char; c.skin = pick.skin; c.locked = pick.locked; c.active = true;
    if (typeof stage === 'number') { this.stage = stage; this.renderStage(); }
    this.onMove(side);
  }

  private pushNet() {
    if (!this.net) return;
    const c = this.cur[this.net.side];
    this.net.onLocal({ char: c.idx, skin: c.skin, locked: c.locked, stage: this.net.side === 0 ? this.stage : undefined });
  }

  private onUi(e: string, rawP: number) {
    if (this.phase === 'done' || this.phase === 'roulette') return;
    if (this.phase === 'stage') {
      if (e === 'left' || e === 'right') { this.stage = (this.stage + (e === 'right' ? -1 : 1) + STAGES.length) % STAGES.length; audio.sfx('ui_move'); this.renderStage(); }
      else if (e === 'confirm') this.finish();
      else if (e === 'back') { this.phase = 'pick'; this.cur[1].locked = false; audio.sfx('ui_back'); this.renderAll(); this.renderStage(); }
      return;
    }
    const p = this.playerFor(rawP);
    const c = this.cur[p];
    if (c.locked) {
      if (e === 'back') { c.locked = false; audio.sfx('ui_back'); this.renderAll(); this.renderTitle(); this.pushNet(); }
      if (this.net && this.net.side === 0 && (e === 'left' || e === 'right')) {
        this.stage = (this.stage + (e === 'right' ? -1 : 1) + STAGES.length) % STAGES.length; audio.sfx('ui_move'); this.renderStage(); this.pushNet();
      }
      return;
    }
    const inSecret = c.idx >= SECRET0;
    if (e === 'left' || e === 'right') {
      const d = e === 'right' ? 1 : -1;
      if (inSecret) c.idx = SECRET0 + ((c.idx - SECRET0 + d + SECRETS.length) % SECRETS.length);
      else { const row = Math.floor(c.idx / COLS), n = rowLen(row); c.idx = row * COLS + ((c.idx % COLS) + d + n) % n; }
    } else if (e === 'up' || e === 'down') {
      const rows = [0, 1, 2];
      const row = inSecret ? 2 : Math.floor(c.idx / COLS);
      const col = inSecret ? SECRET_COLS[c.idx - SECRET0] : c.idx % COLS;
      const nr = rows[(row + (e === 'down' ? 1 : 2)) % 3];
      if (nr === 2) {
        let best = 0;
        SECRET_COLS.forEach((sc, k) => { if (Math.abs(sc - col) < Math.abs(SECRET_COLS[best] - col)) best = k; });
        c.idx = SECRET0 + best;
      } else c.idx = nr * COLS + Math.min(Math.round(col), rowLen(nr) - 1);
    } else if (e === 'confirm') { this.confirm(p); return; }
    else if (e === 'alt') { this.cycleSkin(p); return; }
    else if (e === 'back') {
      if (p === 1 && !this.twoHumans && !this.net) { this.cur[0].locked = false; audio.sfx('ui_back'); this.renderAll(); this.renderTitle(); return; }
      audio.sfx('ui_back');
      this.onBack();
      return;
    } else return;
    c.idx = Math.min(c.idx, SECRET0 + SECRETS.length - 1);
    c.skin = 0;
    audio.sfx('ui_move');
    this.onMove(p);
    this.pushNet();
  }

  private cycleSkin(p: number) {
    const c = this.cur[p];
    if (c.idx >= RANDOM_SLOT) return;
    const skins = ROSTER[c.idx].skins;
    const open = skins.map((s, i) => (s.secret ? -1 : i)).filter((i) => i >= 0);
    if (open.length < 2) return;
    c.skin = open[(open.indexOf(c.skin) + 1) % open.length];
    audio.sfx('ui_move');
    this.onMove(p);
    this.pushNet();
  }

  private confirm(p: number) {
    const c = this.cur[p];
    if (c.idx >= SECRET0 && !this.app.save.unlocked.includes(SECRETS[c.idx - SECRET0].id)) {
      audio.sfx('ui_back');
      this.app.toast('🔒 דמות סודית — נצחו את היריב הנכון כדי לפתוח');
      return;
    }
    if (c.idx === RANDOM_SLOT) { this.roulette(p); return; }
    this.lock(p);
  }

  private roulette(p: number) {
    this.phase = 'roulette';
    this.rouletteEl.textContent = 'מגרילים...';
    this.rouletteEl.classList.add('show');
    const c = this.cur[p];
    let steps = 14 + Math.floor(Math.random() * 6);
    const tick = () => {
      c.idx = Math.floor(Math.random() * ROSTER.length);
      c.skin = 0;
      audio.sfx('ui_move');
      this.onMove(p);
      if (--steps > 0) setTimeout(tick, 60 + (20 - steps) * 6);
      else { this.rouletteEl.classList.remove('show'); this.phase = 'pick'; this.lock(p); }
    };
    tick();
  }

  private lock(p: number) {
    const c = this.cur[p];
    c.locked = true;
    audio.sfx('select');
    const res = resolve(c.idx, c.skin)!;
    void announcer.sayNow('name_' + ROSTER[res.char].id);
    this.views[p]?.onHit(1, true);
    this.renderAll();
    if (this.net) {
      if (this.net.side === 0) this.stage = ROSTER[res.char].stage;
      this.renderStage();
      this.pushNet();
      return;
    }
    if (!this.cur[0].locked) return;
    if (!this.cur[1].locked) {
      if (!this.twoHumans) { this.cur[1].active = true; this.renderAll(); this.renderTitle(); this.onMove(1); }
      return;
    }
    if (this.mode === 'arcade') { this.stage = ROSTER[resolve(this.cur[1].idx, this.cur[1].skin)!.char].stage; this.finish(); return; }
    this.phase = 'stage';
    this.stage = ROSTER[resolve(this.cur[1].idx, this.cur[1].skin)!.char].stage;
    this.renderStage();
  }

  private finish() {
    if (this.phase === 'done') return;
    this.phase = 'done';
    audio.sfx('ui_start');
    const a = resolve(this.cur[0].idx, this.cur[0].skin)!;
    const b = resolve(this.cur[1].idx, this.cur[1].skin)!;
    const r: SelectResult = { chars: [a.char, b.char], skins: [a.skin, b.skin], stage: this.stage, p2cpu: false };
    setTimeout(() => this.onDone(r), 450);
  }

  private renderStage() {
    clear(this.stageEl);
    if (this.mode === 'arcade') return;
    const st = STAGES[this.stage];
    const arrows = this.phase === 'stage' || (this.net && this.net.side === 0 && this.cur[0].locked);
    this.stageEl.append(h('span', {}, [arrows ? '◀  זירה: ' : 'זירה: ', h('b', {}, [st.he]), arrows ? '  ▶' : '', this.phase === 'stage' ? '  · Enter להתחלה' : '']));
  }

  private onMove(p: number) {
    this.renderAll();
    const c = this.cur[p];
    const res = resolve(c.idx, c.skin);
    const locked = c.idx >= SECRET0 && !this.app.save.unlocked.includes(SECRETS[c.idx - SECRET0].id);
    const key = res && !locked ? res.char + ':' + res.skin : 'none';
    if (this.viewKeys[p] === key) return;
    this.viewKeys[p] = key;
    const old = this.views[p];
    if (old) { this.scene.remove(old.root, old.shadow); old.dispose(); }
    this.views[p] = null;
    if (!res || locked) return;
    if (p === 1 && !this.cur[1].active) return;
    const v = new ProceduralFighterView(res.char, res.skin);
    v.showcase = true;
    v.root.scale.setScalar(1.4);
    this.scene.add(v.root, v.shadow);
    this.views[p] = v;
    const f = this.fakeF[p];
    f.char = res.char;
    f.st = St.Idle;
    f.x = p === 0 ? -3050 : 3050;
    f.facing = p === 0 ? 1 : -1;
  }

  private renderAll() {
    this.cards.forEach((card, i) => {
      if (!card) return;
      card.classList.toggle('p1', this.cur[0].idx === i);
      card.classList.toggle('p2', this.cur[1].active && this.cur[1].idx === i);
    });
    for (let p = 0; p < 2; p++) {
      const c = this.cur[p];
      const el = this.info[p];
      clear(el);
      if (!c.active && p === 1) continue;
      if (c.idx === RANDOM_SLOT) { el.append(h('div', { class: 't' }, ['RANDOM']), stone('אקראי', 'n'), h('div', { class: 'rand-note' }, [p === 1 && !this.twoHumans ? 'הגורל יבחר יריב' : 'הגורל יבחר לוחם'])); continue; }
      if (c.idx >= SECRET0 && !this.app.save.unlocked.includes(SECRETS[c.idx - SECRET0].id)) { el.append(h('div', { class: 't' }, ['SECRET']), stone('???', 'n'), h('div', { class: 'rand-note' }, ['🔒 נעול'])); continue; }
      const res = resolve(c.idx, c.skin)!;
      const f = ROSTER[res.char];
      const secret = c.idx >= SECRET0 ? SECRETS[c.idx - SECRET0] : null;
      const skins = f.skins.filter((s) => !s.secret);
      el.append(
        h('div', { class: 't' }, [secret ? secret.title : f.title]),
        stone(secret ? secret.name : f.he, 'n'),
        h('div', { class: 'moves' }, f.specials.map((s) => h('div', { class: 'mv' }, [s.name, h('small', {}, [spInput(s.input) + ' · ' + motionInput(s.input)])]))),
        skins.length > 1 && !secret ? h('div', { class: 'skin' }, [`סקין: ${f.skins[c.skin]?.name ?? ''}  (${K('hp')} להחלפה)`]) : '',
      );
      if (c.locked) el.append(h('div', { class: 'ready' }, ['מוכן!']));
    }
  }

  update(dt: number) {
    this.t += dt;
    const sx = this.sideX();
    for (let p = 0; p < 2; p++) {
      const v = this.views[p];
      if (!v) continue;
      const f = this.fakeF[p];
      f.stFrame++;
      f.st = this.cur[p].locked ? St.Win : St.Idle;
      f.x = (p === 0 ? -1 : 1) * Math.round(sx * 1000);
      v.update(f, f, 1, dt);
      // show them from the front, turned a little towards the middle of the screen
      v.root.rotation.y = p === 0 ? FACE_YAW : -FACE_YAW;
      v.root.position.z = 0.6;
    }
    this.spots.forEach(({ light, beam }, i) => {
      const x = (i === 0 ? -1 : 1) * sx;
      light.position.x = light.target.position.x = beam.position.x = x;
    });
    const cam = this.app.renderer.camera;
    cam.position.set(Math.sin(this.t * 0.3) * 0.15, 1.45, 8.2);
    cam.lookAt(0, 1.55, 0);
  }

  /** Where the side models stand: the middle of the strip between the card grid and the edge of the screen. */
  private sideX(): number {
    const cam = this.app.renderer.camera;
    const halfW = Math.tan((cam.fov * Math.PI) / 360) * 7.6 * cam.aspect;
    const gridHalf = innerWidth > 0 ? (this.gridEl.getBoundingClientRect().width / innerWidth) * halfW : halfW;
    return Math.max(1.6, Math.min((gridHalf + halfW) / 2 - 0.12, halfW - 0.95));
  }

  dispose() {
    this.off();
    this.el.remove();
    for (const v of this.views) v?.dispose();
    this.app.renderer.scene.remove(this.scene);
    this.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.MeshBasicMaterial).alphaMap?.dispose(); (m.material as THREE.Material).dispose?.(); } });
  }
}
