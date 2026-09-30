import * as THREE from 'three';
import { audio } from '../audio/AudioEngine';
import { announcer } from '../audio/announcer';
import { RIVALS } from '../data/rivals';
import { ROSTER, RANDOM_SLOT } from '../data/roster';
import { ProceduralFighterView } from '../render/FighterView';
import { STAGES } from '../render/stages';
import { newFighter } from '../sim/util';
import { St } from '../sim/types';
import type { App, Screen } from '../app/App';
import { h } from './dom';
import { logoEl } from './logo';
import { portraitUrl } from './portraits';

export interface SelectResult { chars: [number, number]; skins: [number, number]; stage: number; p2cpu?: boolean }
export interface NetPick { char: number; skin: number; locked: boolean; stage?: number }
export interface SelectNet { side: 0 | 1; onLocal: (p: NetPick) => void }

const COLS = 9;

interface Cursor { idx: number; locked: boolean; skin: number; active: boolean }

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
  private phase: 'pick' | 'stage' | 'done' = 'pick';
  private twoHumans: boolean;
  private t = 0;
  private lights: THREE.Light[] = [];

  constructor(private app: App, private mode: 'arcade' | 'versus' | 'practice' | 'online', private onDone: (r: SelectResult) => void, private onBack: () => void, preset?: number, private net?: SelectNet) {
    this.twoHumans = mode === 'versus';
    app.input.solo = !this.twoHumans;
    this.cur = [
      { idx: preset ?? 0, locked: false, skin: 0, active: true },
      { idx: preset !== undefined ? (preset + 1) % ROSTER.length : 6, locked: false, skin: 0, active: this.twoHumans || mode === 'online' },
    ];
    this.stage = ROSTER[this.cur[0].idx].stage;

    const grid = h('div', { class: 'cs-grid' });
    for (let i = 0; i <= RANDOM_SLOT; i++) {
      let card: HTMLElement;
      if (i === RANDOM_SLOT) {
        card = h('div', { class: 'cs-card random' }, [h('div', { class: 'img' }, ['?']), h('div', { class: 'title' }, ['RANDOM']), h('div', { class: 'name' }, ['אקראי']), h('div', { class: 'tag t1' }, ['1P']), h('div', { class: 'tag t2' }, ['2P'])]);
      } else {
        const f = ROSTER[i];
        card = h('div', { class: 'cs-card' }, [
          h('div', { class: 'img', style: `background-image:url(${portraitUrl(i, 'card')})` }),
          h('div', { class: 'plat ' + f.platform }, [f.platform === 'kick' ? 'KICK' : 'YT']),
          h('div', { class: 'title' }, [f.title]),
          h('div', { class: 'name' }, [f.he]),
          h('div', { class: 'tag t1' }, ['1P']), h('div', { class: 'tag t2' }, ['2P']),
        ]);
      }
      card.addEventListener('click', () => { this.cur[0].idx = i; this.confirm(0); });
      card.addEventListener('mouseenter', () => { if (!this.cur[0].locked) { this.cur[0].idx = i; this.onMove(0); } });
      this.cards.push(card);
      grid.append(card);
    }
    for (let p = 0; p < 2; p++) this.info.push(h('div', { class: `cs-info p${p + 1}` }));
    this.stageEl = h('div', { class: 'cs-stage' });
    this.el = h('div', { class: 'screen cselect fade-in' }, [
      logoEl(),
      h('h2', { class: 'metal' }, ['בחר לוחם']),
      grid,
      h('div', { class: 'cs-player-lbl p1' }, ['שחקן 1']),
      h('div', { class: 'cs-player-lbl p2' }, [this.mode === 'practice' ? 'בובה' : this.twoHumans || this.mode === 'online' ? 'שחקן 2' : 'מחשב']),
      this.info[0], this.info[1], this.stageEl,
      h('div', { class: 'cs-bottom' }, ['חצים = בחירה · J/Enter = אישור · I = סקין · K/Esc = חזרה']),
    ]);
    app.uiRoot.append(this.el);

    // 3D side models
    const r = app.renderer;
    r.scene.background = new THREE.Color('#050303');
    r.scene.fog = new THREE.Fog('#050303', 12, 30);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(40, 16), new THREE.MeshBasicMaterial({ color: '#1a0a06' }));
    back.position.set(0, 6, -6);
    this.scene.add(back);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 64), new THREE.MeshStandardMaterial({ color: '#140b08', roughness: 0.35, metalness: 0.3 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const hemi = new THREE.HemisphereLight('#ffffff', '#1a0a04', 0.35);
    this.scene.add(hemi);
    const mkSpot = (x: number, col: string) => {
      const s = new THREE.SpotLight(col, 90, 18, 0.42, 0.55, 1.4);
      s.position.set(x, 9, 3);
      s.target.position.set(x, 0, 0.8);
      s.castShadow = true;
      this.scene.add(s, s.target);
      this.lights.push(s);
      const beam = new THREE.Mesh(new THREE.ConeGeometry(2.4, 9, 32, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.set(x, 4.5, 1);
      this.scene.add(beam);
    };
    mkSpot(-3.6, '#ffd9a0');
    mkSpot(3.6, '#9fc8ff');
    const fill = new THREE.DirectionalLight('#ffe6cc', 1.2);
    fill.position.set(0, 3, 8);
    this.scene.add(fill);
    r.scene.add(this.scene);
    r.camera.position.set(0, 1.4, 8.6);
    r.camera.fov = 32;
    r.camera.updateProjectionMatrix();
    r.camera.lookAt(0, 1.35, 0);

    this.off = app.input.onUi((e, p) => this.onUi(e, p));
    this.onMove(0);
    this.onMove(1);
    this.renderStage();
  }

  private playerFor(p: number): number {
    if (this.net) return this.net.side;
    // in single-human modes, P1 controls the second cursor after locking
    if (!this.twoHumans && this.cur[0].locked) return 1;
    return p;
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
    if (this.phase === 'done') return;
    if (this.phase === 'stage') {
      if (e === 'left' || e === 'right') { this.stage = (this.stage + (e === 'right' ? -1 : 1) + STAGES.length) % STAGES.length; audio.sfx('ui_move'); this.renderStage(); }
      else if (e === 'confirm') this.finish();
      else if (e === 'back') { this.phase = 'pick'; this.cur[1].locked = false; this.cur[0].locked = this.twoHumans ? this.cur[0].locked : true; audio.sfx('ui_back'); this.renderAll(); this.renderStage(); }
      return;
    }
    const p = this.playerFor(rawP);
    const c = this.cur[p];
    if (!c.active && p === 1 && this.mode === 'arcade') return;
    if (c.locked) {
      if (e === 'back') { c.locked = false; audio.sfx('ui_back'); this.renderAll(); this.pushNet(); }
      if (this.net && this.net.side === 0 && (e === 'left' || e === 'right')) {
        this.stage = (this.stage + (e === 'right' ? -1 : 1) + STAGES.length) % STAGES.length; audio.sfx('ui_move'); this.renderStage(); this.pushNet();
      }
      return;
    }
    const col = c.idx % COLS;
    const row = Math.floor(c.idx / COLS);
    const rows = Math.ceil((RANDOM_SLOT + 1) / COLS);
    if (e === 'left') c.idx = row * COLS + ((col + COLS - 1) % COLS);
    else if (e === 'right') c.idx = row * COLS + ((col + 1) % COLS);
    else if (e === 'up' || e === 'down') c.idx = ((row + 1) % rows) * COLS + col;
    else if (e === 'confirm') { this.confirm(p); return; }
    else if (e === 'alt') { this.cycleSkin(p); return; }
    else if (e === 'back') {
      if (p === 1 && !this.twoHumans) { this.cur[0].locked = false; audio.sfx('ui_back'); this.renderAll(); return; }
      audio.sfx('ui_back');
      this.onBack();
      return;
    }
    else return;
    c.idx = Math.min(c.idx, RANDOM_SLOT);
    c.skin = 0;
    audio.sfx('ui_move');
    this.onMove(p);
    this.pushNet();
  }

  private cycleSkin(p: number) {
    const c = this.cur[p];
    if (c.idx >= RANDOM_SLOT) return;
    const n = ROSTER[c.idx].skins.length;
    c.skin = (c.skin + 1) % n;
    audio.sfx('ui_move');
    this.onMove(p);
    this.pushNet();
  }

  private confirm(p: number) {
    const c = this.cur[p];
    if (c.idx === RANDOM_SLOT) { c.idx = Math.floor(Math.random() * ROSTER.length); c.skin = 0; this.onMove(p); }
    if (!this.app.isUnlocked(c.idx, c.skin)) { audio.sfx('ui_back'); this.app.toast('הסקין הזה עדיין נעול 🔒'); return; }
    c.locked = true;
    audio.sfx('select');
    void announcer.sayNow('name_' + ROSTER[c.idx].id);
    const v = this.views[p];
    if (v) v.onHit(1, true);
    this.renderAll();
    if (this.net) {
      if (this.net.side === 0) this.stage = ROSTER[c.idx].stage;
      this.renderStage();
      this.pushNet();
      return;
    }
    const need2 = this.mode !== 'arcade';
    if (!this.cur[0].locked) return;
    if (need2 && !this.cur[1].locked) {
      if (!this.twoHumans) { this.cur[1].active = true; this.renderAll(); }
      return;
    }
    if (this.mode === 'arcade') { this.finish(); return; }
    this.phase = 'stage';
    this.stage = ROSTER[this.cur[1].idx].stage;
    this.renderStage();
  }

  private finish() {
    if (this.phase === 'done') return;
    this.phase = 'done';
    audio.sfx('ui_start');
    const r: SelectResult = { chars: [this.cur[0].idx, this.cur[1].idx], skins: [this.cur[0].skin, this.cur[1].skin], stage: this.stage, p2cpu: false };
    setTimeout(() => this.onDone(r), 450);
  }

  private renderStage() {
    this.stageEl.innerHTML = '';
    if (this.mode === 'arcade') return;
    const st = STAGES[this.stage];
    if (this.net) {
      this.stageEl.append(h('span', {}, [this.net.side === 0 && this.cur[0].locked ? '◀  זירה: ' : 'זירה: ', h('b', {}, [st.he]), this.net.side === 0 && this.cur[0].locked ? '  ▶' : '']));
      return;
    }
    this.stageEl.append(this.phase === 'stage' ? h('span', {}, ['◀  זירה: ', h('b', {}, [st.he]), '  ▶  · Enter להתחלה']) : h('span', {}, ['זירה: ', h('b', {}, [st.he])]));
  }

  private onMove(p: number) {
    this.renderAll();
    const c = this.cur[p];
    const idx = c.idx >= RANDOM_SLOT ? -1 : c.idx;
    const key = idx + ':' + c.skin;
    if (this.viewKeys[p] === key) return;
    this.viewKeys[p] = key;
    const old = this.views[p];
    if (old) { this.scene.remove(old.root, old.shadow); old.dispose(); }
    this.views[p] = null;
    if (idx < 0) return;
    const v = new ProceduralFighterView(idx, c.skin);
    v.root.scale.setScalar(1.55);
    this.scene.add(v.root, v.shadow);
    this.views[p] = v;
    const f = this.fakeF[p];
    f.char = idx;
    f.st = St.Idle;
    f.x = p === 0 ? -3050 : 3050;
    f.facing = p === 0 ? 1 : -1;
  }

  private renderAll() {
    this.cards.forEach((card, i) => {
      card.classList.toggle('p1', this.cur[0].idx === i);
      card.classList.toggle('p2', this.cur[1].active && this.cur[1].idx === i);
    });
    for (let p = 0; p < 2; p++) {
      const c = this.cur[p];
      const el = this.info[p];
      el.innerHTML = '';
      if (!c.active && p === 1) { el.append(h('div', { class: 't' }, [this.mode === 'arcade' ? 'CPU' : ''])); continue; }
      if (c.idx >= RANDOM_SLOT) { el.append(h('div', { class: 't' }, ['RANDOM']), h('div', { class: 'n metal' }, ['?'])); continue; }
      const f = ROSTER[c.idx];
      const skin = f.skins[c.skin];
      const unlocked = this.app.isUnlocked(c.idx, c.skin);
      let skinTxt = `סקין: ${skin.name}${unlocked ? '' : ' 🔒'}`;
      if (!unlocked && skin.unlock === 'win3') skinTxt += ` — נצחו את ${ROSTER.find((x) => x.id === RIVALS[f.id])?.he} עם ${f.he}`;
      if (!unlocked && skin.unlock === 'arcade') skinTxt += ' — סיימו ארקייד';
      el.append(
        h('div', { class: 't' }, [f.title]),
        h('div', { class: 'n metal' }, [f.he]),
        h('div', { class: 'moves' }, f.specials.map((s) => h('div', { class: 'mv' }, [s.name, h('small', {}, [s.input === 'U' ? 'U' : s.input === 'FU' ? '→+U' : '↓+U'])]))),
        h('div', { class: 'skin' }, [skinTxt, f.skins.length > 1 ? '  (I להחלפה)' : '']),
      );
      if (c.locked) el.append(h('div', { class: 'ready' }, ['מוכן!']));
    }
  }

  update(dt: number) {
    this.t += dt;
    for (let p = 0; p < 2; p++) {
      const v = this.views[p];
      if (!v) continue;
      const f = this.fakeF[p];
      f.stFrame++;
      f.st = this.cur[p].locked ? St.Win : St.Idle;
      v.update(f, f, 1, dt);
      v.root.rotation.y += p === 0 ? 0.95 : -0.95;
      v.root.position.z = 0.6;
    }
    const cam = this.app.renderer.camera;
    cam.position.set(Math.sin(this.t * 0.3) * 0.15, 1.45, 8.2);
    cam.lookAt(0, 1.55, 0);
  }

  dispose() {
    this.off();
    this.el.remove();
    for (const v of this.views) v?.dispose();
    this.app.renderer.scene.remove(this.scene);
    this.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose?.(); } });
  }
}
