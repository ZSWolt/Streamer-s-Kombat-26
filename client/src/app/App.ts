import * as THREE from 'three';
import { audio } from '../audio/AudioEngine';
import { announcer } from '../audio/announcer';
import { music } from '../audio/music';
import { ROSTER } from '../data/roster';
import { SECRETS } from '../data/secrets';
import { loadChatFiles } from '../data/chat';
import { Battle, type BattleOptions, type InputSource } from '../game/Battle';
import { InputManager } from '../input/InputManager';
import { preloadModels } from '../render/model';
import { preloadProps } from '../render/props';
import { Renderer } from '../render/Renderer';
import { STAGES } from '../render/stages';
import type { MatchConfig, MatchState } from '../sim/types';
import { CharSelect, type SelectResult } from '../ui/CharSelect';
import { Menus } from '../ui/menus';
import { generatePortraits } from '../ui/portraits';
import { IntroCinematic } from '../cinematic/Intro';
import { MenuBackdrop } from '../ui/MenuBackdrop';
import { Lobby } from '../ui/Lobby';
import { setKeyLabels } from '../ui/keys';
import { installStone } from '../ui/stone';
import { loadSave, loadSettings, saveSettings, writeSave, type SaveData, type Settings } from './settings';

export interface Screen { update(dt: number): void; dispose(): void }

type Mode = 'arcade' | 'versus' | 'practice';

export class App {
  renderer: Renderer;
  input = new InputManager();
  settings: Settings;
  save: SaveData;
  uiRoot: HTMLElement;
  menus: Menus;
  screen: Screen | null = null;
  backdrop: MenuBackdrop | null = null;
  private last = performance.now();
  private fpsEl: HTMLDivElement;
  private fpsAcc = 0;
  private fpsN = 0;
  private lastBattle: BattleOptions | null = null;
  private lastMode: Mode = 'arcade';
  battle: Battle | null = null;
  idleT = 0;

  constructor() {
    this.settings = loadSettings();
    this.save = loadSave();
    installStone();
    this.renderer = new Renderer(document.getElementById('gl') as HTMLCanvasElement);
    this.renderer.setQuality(this.settings.quality, this.settings.resScale);
    this.uiRoot = document.getElementById('ui')!;
    this.menus = new Menus(this);
    this.fpsEl = document.createElement('div');
    this.fpsEl.className = 'fps';
    document.body.appendChild(this.fpsEl);
    this.applySettings();
    this.input.onUi(() => { this.idleT = 0; });
  }

  applySettings() {
    const s = this.settings;
    audio.setVolumes(s.music, s.sfx, s.voices);
    announcer.lang = s.announcerLang;
    this.input.setMaps(s.p1Keys, s.p2Keys);
    setKeyLabels(s.p1Keys);
    this.fpsEl.style.display = s.showFps ? '' : 'none';
    saveSettings(s);
  }

  persistSave() { writeSave(this.save); }

  async start() {
    const boot = this.menus.boot();
    this.setScreen(boot.screen);
    requestAnimationFrame(this.loop);
    await document.fonts.ready;
    await loadChatFiles();
    preloadProps();
    await preloadModels((p) => boot.progress(p * 0.4, 0));
    await generatePortraits((p) => boot.progress(0.4 + p * 0.55, Math.round(p * ROSTER.length)));
    boot.progress(1, ROSTER.length);
    boot.ready(() => {
      audio.unlock();
      if (this.settings.fullscreen && !document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => {});
      audio.sfx('ui_start');
      this.goIntro(() => this.goStartCard());
    });
  }

  private loop = (now: number) => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.input.pollUi(dt);
    this.screen?.update(dt);
    this.backdrop?.update(dt);
    this.renderer.render(dt);
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 0.5) { this.fpsEl.textContent = `${Math.round(this.fpsN / this.fpsAcc)} FPS`; this.fpsAcc = 0; this.fpsN = 0; }
    this.idleT += dt;
    requestAnimationFrame(this.loop);
  };

  setScreen(s: Screen | null) {
    this.screen?.dispose();
    this.screen = s;
  }

  canvasMode(mode: 'clear' | 'blur' | 'dim') {
    const c = this.renderer.canvas;
    c.classList.toggle('menu-blur', mode === 'blur');
    c.classList.toggle('dim', mode === 'dim');
  }

  ensureBackdrop(show: boolean) {
    if (show && !this.backdrop) this.backdrop = new MenuBackdrop(this.renderer);
    if (!show && this.backdrop) { this.backdrop.dispose(); this.backdrop = null; }
  }

  toast(text: string, ms = 2200) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  // ---------------------------------------------------------------- navigation
  goIntro(then: () => void = () => this.goMenu()) {
    this.ensureBackdrop(false);
    this.canvasMode('clear');
    this.setScreen(new IntroCinematic(this, then));
  }

  goStartCard() {
    this.ensureBackdrop(true);
    this.canvasMode('dim');
    music.play('title');
    void announcer.say('title');
    this.setScreen(this.menus.startScreen(() => { audio.sfx('ui_ok'); this.goMenu(); }));
  }

  goMenu(sel = 0) {
    this.ensureBackdrop(true);
    this.canvasMode('blur');
    music.play('menu');
    this.idleT = 0;
    this.setScreen(this.menus.mainMenu(sel));
  }

  goOptions() {
    this.ensureBackdrop(true);
    this.canvasMode('blur');
    this.setScreen(this.menus.options());
  }

  goCredits() {
    this.ensureBackdrop(true);
    this.canvasMode('dim');
    this.setScreen(this.menus.credits(() => this.goMenu(6)));
  }

  goLobby() {
    this.ensureBackdrop(true);
    this.canvasMode('blur');
    this.setScreen(new Lobby(this));
  }

  goSelect(mode: Mode, preset?: number) {
    this.lastMode = mode;
    this.ensureBackdrop(false);
    this.canvasMode('clear');
    music.play('select');
    void announcer.say('select');
    this.setScreen(new CharSelect(this, mode, (r) => this.onSelected(mode, r), () => this.goMenu(), preset));
  }

  private onSelected(mode: Mode, r: SelectResult) {
    const cfg = this.matchCfg(r.chars, r.skins, r.stage, mode === 'practice');
    const sources: [InputSource, InputSource] = mode === 'practice'
      ? [{ kind: 'local', player: 0 }, { kind: 'none' }]
      : mode === 'arcade'
        ? [{ kind: 'local', player: 0 }, { kind: 'cpu', level: this.settings.difficulty }]
        : [{ kind: 'local', player: 0 }, r.p2cpu ? { kind: 'cpu', level: this.settings.difficulty } : { kind: 'local', player: 1 }];
    this.input.solo = mode !== 'versus' || !!r.p2cpu;
    this.startBattle({ mode, cfg, sources, showStart: true, onEnd: (w, m) => this.onBattleEnd(mode, w, m), onQuit: () => this.goMenu() });
  }

  matchCfg(chars: [number, number], skins: [number, number], stage: number, practice = false): MatchConfig {
    return {
      chars, skins, stage, roundsToWin: practice ? 99 : this.settings.rounds, roundTime: practice ? 0 : this.settings.roundTime,
      seed: (Math.random() * 1e9) | 0, charIntro: this.settings.battleIntro && !practice, practice,
    };
  }

  startBattle(opts: BattleOptions) {
    this.lastBattle = opts;
    this.ensureBackdrop(false);
    this.canvasMode('clear');
    const b = new Battle(this, this.renderer, opts);
    this.battle = b;
    const practicePanel = opts.mode === 'practice' ? this.menus.practicePanel(b) : null;
    if (practicePanel) b.practice = practicePanel;
    this.setScreen({
      update: (dt) => { b.update(dt); practicePanel?.update(); },
      dispose: () => { practicePanel?.dispose(); b.dispose(); },
    });
  }

  restartBattle() {
    if (!this.lastBattle) return;
    const o = this.lastBattle;
    this.startBattle({ ...o, showStart: false, cfg: { ...o.cfg, seed: (Math.random() * 1e9) | 0 } });
  }

  reselect() { this.goSelect(this.lastMode); }

  private recordWin(winnerChar: number, loserChar: number) {
    const id = ROSTER[winnerChar].id;
    const other = ROSTER[loserChar].id;
    this.save.wins[id] = (this.save.wins[id] ?? 0) + 1;
    for (const s of SECRETS) {
      if (s.winWith === id && s.against === other && !this.save.unlocked.includes(s.id)) {
        this.save.unlocked.push(s.id);
        setTimeout(() => this.toast(`🔓 דמות חדשה נפתחה! ${s.name}`, 4000), 1200);
      }
    }
    writeSave(this.save);
  }

  onBattleEnd(mode: BattleOptions['mode'], winner: number, m: MatchState) {
    if ((winner === 0 || winner === 1) && mode !== 'demo' && mode !== 'online') this.recordWin(m.f[winner].char, m.f[1 - winner].char);
    if (mode === 'demo') { this.goMenu(); return; }
    if (mode === 'online') return;
    this.showResults(m, winner, [
      { he: 'משחק חוזר', en: 'REMATCH', go: () => this.restartBattle() },
      { he: 'בחירת לוחם', en: 'CHARACTER SELECT', go: () => this.reselect() },
      { he: 'תפריט ראשי', en: 'MAIN MENU', go: () => this.goMenu() },
    ]);
  }

  private showResults(m: MatchState, winner: number, items: { he: string; en: string; go: () => void }[]) {
    const cur = this.screen;
    const overlay = this.menus.results(m, winner, items, { rematch: () => this.restartBattle(), menu: () => this.goMenu() });
    // keep the battle scene rendering behind the results panel
    this.screen = {
      update: (dt) => cur?.update(dt),
      dispose: () => { overlay.dispose(); cur?.dispose(); },
    };
  }

  startDemo() {
    const a = Math.floor(Math.random() * ROSTER.length);
    let b = Math.floor(Math.random() * ROSTER.length);
    if (b === a) b = (b + 1) % ROSTER.length;
    const cfg = this.matchCfg([a, b], [0, 0], Math.floor(Math.random() * STAGES.length));
    cfg.charIntro = true;
    this.startBattle({
      mode: 'demo', cfg, sources: [{ kind: 'cpu', level: 2 }, { kind: 'cpu', level: 2 }],
      onEnd: () => this.goMenu(), onQuit: () => this.goMenu(),
    });
  }

  resetUnlocks() {
    this.save = { unlocked: [], wins: {}, arcadeClears: [], seenNews: this.save.seenNews };
    writeSave(this.save);
  }

  isUnlocked(charIdx: number, skinIdx: number): boolean {
    const skin = ROSTER[charIdx].skins[skinIdx];
    if (!skin?.secret) return true;
    return this.save.unlocked.includes(skin.secret);
  }

  unlockCount(): [number, number] {
    return [SECRETS.filter((s) => this.save.unlocked.includes(s.id)).length, SECRETS.length];
  }
}

export const tmpVec = new THREE.Vector3();
