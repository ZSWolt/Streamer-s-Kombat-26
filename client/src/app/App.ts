import * as THREE from 'three';
import { audio } from '../audio/AudioEngine';
import { announcer } from '../audio/announcer';
import { music } from '../audio/music';
import { ROSTER, fighterIndex } from '../data/roster';
import { Battle, type BattleOptions, type InputSource } from '../game/Battle';
import { InputManager } from '../input/InputManager';
import { Renderer } from '../render/Renderer';
import { STAGES } from '../render/stages';
import type { MatchConfig, MatchState } from '../sim/types';
import { CharSelect, type SelectResult } from '../ui/CharSelect';
import { Menus } from '../ui/menus';
import { generatePortraits } from '../ui/portraits';
import { IntroCinematic } from '../cinematic/Intro';
import { MenuBackdrop } from '../ui/MenuBackdrop';
import { Lobby } from '../ui/Lobby';
import { loadSave, loadSettings, saveSettings, writeSave, type SaveData, type Settings } from './settings';
import { RIVALS } from '../data/rivals';

export interface Screen { update(dt: number): void; dispose(): void }

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
  arcade: { char: number; skin: number; ladder: number[]; idx: number } | null = null;
  idleT = 0;

  constructor() {
    this.settings = loadSettings();
    this.save = loadSave();
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
    this.fpsEl.style.display = s.showFps ? '' : 'none';
    saveSettings(s);
  }

  async start() {
    const boot = this.menus.boot();
    this.setScreen(boot.screen);
    await document.fonts.ready;
    await generatePortraits((p) => boot.progress(p, 'מכין את הלוחמים...'));
    boot.progress(1, '');
    this.goTitle();
    requestAnimationFrame(this.loop);
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
  goTitle() {
    this.ensureBackdrop(true);
    this.canvasMode('dim');
    music.stop();
    this.setScreen(this.menus.title(() => {
      audio.unlock();
      if (this.settings.fullscreen && !document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => {});
      void announcer.say('title');
      audio.sfx('ui_start');
      this.goIntro();
    }));
  }

  goIntro(then: () => void = () => this.goMenu()) {
    this.ensureBackdrop(false);
    this.canvasMode('clear');
    this.setScreen(new IntroCinematic(this, then));
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

  goSelect(mode: 'arcade' | 'versus' | 'practice', preset?: number) {
    this.ensureBackdrop(false);
    this.canvasMode('clear');
    music.play('select');
    void announcer.say('select');
    this.setScreen(new CharSelect(this, mode, (r) => this.onSelected(mode, r), () => this.goMenu(), preset));
  }

  private onSelected(mode: 'arcade' | 'versus' | 'practice', r: SelectResult) {
    if (mode === 'arcade') {
      const boss = fighterIndex('inde') === r.chars[0] ? fighterIndex('ronengg') : fighterIndex('inde');
      const others = ROSTER.map((_, i) => i).filter((i) => i !== r.chars[0] && i !== boss);
      for (let i = others.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [others[i], others[j]] = [others[j], others[i]]; }
      this.arcade = { char: r.chars[0], skin: r.skins[0], ladder: [...others.slice(0, 6), boss], idx: 0 };
      this.nextArcade();
      return;
    }
    const cfg = this.matchCfg(r.chars, r.skins, r.stage, mode === 'practice');
    const sources: [InputSource, InputSource] = mode === 'practice'
      ? [{ kind: 'local', player: 0 }, { kind: 'none' }]
      : [{ kind: 'local', player: 0 }, r.p2cpu ? { kind: 'cpu', level: this.settings.difficulty } : { kind: 'local', player: 1 }];
    this.input.solo = mode !== 'versus' || !!r.p2cpu;
    this.goVs(cfg, () => this.startBattle({ mode, cfg, sources, onEnd: (w, m) => this.onBattleEnd(mode, w, m), onQuit: () => this.goMenu() }));
  }

  matchCfg(chars: [number, number], skins: [number, number], stage: number, practice = false, bossP2 = false): MatchConfig {
    return {
      chars, skins, stage, roundsToWin: practice ? 99 : this.settings.rounds, roundTime: practice ? 0 : this.settings.roundTime,
      seed: (Math.random() * 1e9) | 0, charIntro: this.settings.battleIntro && !practice, practice, bossP2,
    };
  }

  nextArcade() {
    const a = this.arcade!;
    const opp = a.ladder[a.idx];
    const boss = a.idx === a.ladder.length - 1;
    const cfg = this.matchCfg([a.char, opp], [a.skin, boss ? 2 : 0], ROSTER[opp].stage, false, boss);
    this.input.solo = true;
    const level = Math.min(3, this.settings.difficulty + (a.idx >= 4 ? 1 : 0));
    this.goVs(cfg, () => this.startBattle({
      mode: 'arcade', cfg, sources: [{ kind: 'local', player: 0 }, { kind: 'cpu', level }],
      onEnd: (w, m) => this.onBattleEnd('arcade', w, m), onQuit: () => this.goMenu(),
    }), boss ? 'הבוס האחרון' : `קרב ${a.idx + 1} / ${a.ladder.length}`);
  }

  goVs(cfg: MatchConfig, then: () => void, sub?: string) {
    this.ensureBackdrop(false);
    this.canvasMode('dim');
    this.setScreen(this.menus.vs(cfg, then, sub));
  }

  startBattle(opts: BattleOptions) {
    this.lastBattle = opts;
    this.ensureBackdrop(false);
    this.canvasMode('clear');
    const b = new Battle(this, this.renderer, opts);
    const practicePanel = opts.mode === 'practice' ? this.menus.practicePanel(b) : null;
    this.setScreen({
      update: (dt) => { b.update(dt); practicePanel?.update(); },
      dispose: () => { practicePanel?.dispose(); b.dispose(); },
    });
  }

  restartBattle() {
    if (!this.lastBattle) return;
    const o = this.lastBattle;
    this.startBattle({ ...o, cfg: { ...o.cfg, seed: (Math.random() * 1e9) | 0 } });
  }

  private recordWin(winnerChar: number, loserChar: number) {
    const id = ROSTER[winnerChar].id;
    this.save.wins[id] = (this.save.wins[id] ?? 0) + 1;
    const rival = RIVALS[id];
    if (rival && ROSTER[loserChar].id === rival && !this.save.unlocked.includes(id + ':gold')) {
      this.save.unlocked.push(id + ':gold');
      this.toast(`🔓 נפתח סקין זהב ל-${ROSTER[winnerChar].he}!`, 3500);
    }
    writeSave(this.save);
  }

  onBattleEnd(mode: BattleOptions['mode'], winner: number, m: MatchState) {
    if (winner === 0 || winner === 1) this.recordWin(m.f[winner].char, m.f[1 - winner].char);
    if (mode === 'arcade' && this.arcade) {
      const a = this.arcade;
      if (winner === 0) {
        a.idx++;
        if (a.idx >= a.ladder.length) {
          const key = ROSTER[a.char].id + ':neon';
          if (!this.save.unlocked.includes(key)) { this.save.unlocked.push(key); this.save.arcadeClears.push(ROSTER[a.char].id); writeSave(this.save); }
          this.setScreen(this.menus.arcadeEnding(a.char, () => this.goCredits()));
          this.arcade = null;
          return;
        }
        this.showResults(m, winner, [
          { he: 'לקרב הבא', en: 'NEXT FIGHT', go: () => this.nextArcade() },
          { he: 'תפריט ראשי', en: 'MAIN MENU', go: () => this.goMenu() },
        ]);
      } else {
        this.showResults(m, winner, [
          { he: 'להמשיך', en: 'CONTINUE', go: () => this.nextArcade() },
          { he: 'תפריט ראשי', en: 'MAIN MENU', go: () => { this.arcade = null; this.goMenu(); } },
        ]);
      }
      return;
    }
    if (mode === 'demo') { this.goMenu(); return; }
    if (mode === 'online') return;
    this.showResults(m, winner, [
      { he: "ריוואנץ'", en: 'REMATCH', go: () => this.restartBattle() },
      { he: 'בחירת לוחמים', en: 'CHARACTER SELECT', go: () => this.goSelect(mode === 'practice' ? 'practice' : 'versus') },
      { he: 'תפריט ראשי', en: 'MAIN MENU', go: () => this.goMenu() },
    ]);
  }

  private showResults(m: MatchState, winner: number, items: { he: string; en: string; go: () => void }[]) {
    const cur = this.screen;
    const overlay = this.menus.results(m, winner, items);
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
    this.save = { unlocked: [], wins: {}, arcadeClears: [], seenNews: [] };
    writeSave(this.save);
  }

  isUnlocked(charIdx: number, skinIdx: number): boolean {
    const skin = ROSTER[charIdx].skins[skinIdx];
    if (!skin?.unlock) return true;
    const id = ROSTER[charIdx].id;
    if (skin.unlock === 'win3') return this.save.unlocked.includes(id + ':gold');
    if (skin.unlock === 'arcade') return this.save.unlocked.includes(id + ':neon');
    return true;
  }

  unlockCount(): [number, number] {
    let total = 0, got = 0;
    ROSTER.forEach((f, i) => f.skins.forEach((s, j) => { if (s.unlock) { total++; if (this.isUnlocked(i, j)) got++; } }));
    return [got, total];
  }
}

export const tmpVec = new THREE.Vector3();
