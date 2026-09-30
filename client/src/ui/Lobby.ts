import { audio } from '../audio/AudioEngine';
import { music } from '../audio/music';
import { ROSTER } from '../data/roster';
import { Battle } from '../game/Battle';
import { lobby } from '../net/LobbyClient';
import { PeerLink } from '../net/Peer';
import { RollbackSession, SpectatorDriver } from '../net/Rollback';
import * as C from '../sim/constants';
import type { MatchConfig } from '../sim/types';
import type { App, Screen } from '../app/App';
import { saveSettings } from '../app/settings';
import { CharSelect } from './CharSelect';
import { h, clear } from './dom';

interface RoomView { id: string; name: string; players: ({ id: string; name: string } | null)[]; spectators: string[]; state: string }

export class Lobby implements Screen {
  private el: HTMLElement;
  private body: HTMLElement;
  private offs: (() => void)[] = [];
  private sub: Screen | null = null;
  private room: RoomView | null = null;
  private players: any[] = [];
  private rooms: any[] = [];
  private chatLog: HTMLElement | null = null;
  private select: CharSelect | null = null;
  private battle: Battle | null = null;
  private link: PeerLink | null = null;
  private resultsEl: HTMLElement | null = null;
  private mySide: 0 | 1 = 0;
  private status: HTMLElement | null = null;

  constructor(private app: App) {
    music.play('menu');
    this.body = h('div', { style: 'width:100%;display:flex;flex-direction:column;align-items:center' });
    this.el = h('div', { class: 'screen lobby fade-in' }, [h('h1', { class: 'metal' }, ['אונליין']), this.body]);
    app.uiRoot.append(this.el);
    this.offs.push(app.input.onUi((e) => {
      if (e === 'back' && !(document.activeElement instanceof HTMLInputElement) && !this.sub) this.exit();
    }));
    if (lobby.connected) this.showLobby();
    else if (!app.settings.nickname) this.askName();
    else this.connect();
  }

  private exit() {
    lobby.send({ t: 'leaveRoom' });
    this.app.goMenu(2);
  }

  private askName() {
    clear(this.body);
    const input = h('input', { placeholder: 'השם שלכם בלובי', maxlength: '20', value: this.app.settings.nickname }) as HTMLInputElement;
    const go = () => {
      const n = input.value.trim();
      if (!n) return;
      this.app.settings.nickname = n;
      saveSettings(this.app.settings);
      this.connect();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); e.stopPropagation(); });
    this.body.append(h('div', { class: 'panel', style: 'width:min(460px,90vw);background:var(--panel);border:1px solid var(--panel-b);border-radius:10px;padding:20px' }, [
      h('h3', { style: 'font-family:var(--he);margin:0 0 10px' }, ['איך קוראים לכם?']),
      input,
      h('div', { class: 'row', style: 'margin-top:12px;display:flex;gap:8px' }, [h('button', { class: 'btn', onclick: go }, ['כניסה ללובי']), h('button', { class: 'btn ghost', onclick: () => this.app.goMenu(2) }, ['חזרה'])]),
    ]));
    setTimeout(() => input.focus(), 50);
  }

  private async connect() {
    clear(this.body);
    this.body.append(h('p', { style: 'font-size:22px' }, ['מתחבר לשרת...']));
    try {
      await lobby.connect(this.app.settings.nickname);
      this.bindLobby();
      this.showLobby();
    } catch {
      clear(this.body);
      this.body.append(
        h('p', { style: 'font-size:22px;max-width:760px;text-align:center;line-height:1.5' }, ['לא הצלחתי להתחבר לשרת. המארח צריך להפעיל את ', h('b', {}, ['START-SERVER.bat']), ' ולשלוח לכם את הקישור שמופיע אצלו. אם אתם המארחים — הפעילו אותו ופתחו את המשחק מהקישור.']),
        h('div', { style: 'display:flex;gap:10px' }, [h('button', { class: 'btn', onclick: () => this.connect() }, ['לנסות שוב']), h('button', { class: 'btn ghost', onclick: () => this.app.goMenu(2) }, ['חזרה'])]),
      );
    }
  }

  private bindLobby() {
    const on = (t: string, f: (m: any) => void) => this.offs.push(lobby.on(t, f));
    on('lobby', (m) => { this.players = m.players; this.rooms = m.rooms; if (!this.sub && !this.room) this.renderLobby(); else if (!this.sub) this.renderRoom(); });
    on('chat', (m) => this.addChat(m));
    on('room', (m) => { this.room = m.room; if (!this.sub) this.renderRoom(); });
    on('left', () => { this.room = null; this.endSub(); this.showLobby(); });
    on('select', () => this.startSelect());
    on('pick', (m) => this.select?.applyRemote(m.side, m.pick, m.stage));
    on('start', (m) => void this.startMatch(m));
    on('spectateStart', (m) => this.startSpectate(m));
    on('abort', (m) => { this.app.toast(m.reason ?? 'הקרב בוטל'); this.endSub(); this.renderRoom(); });
    on('error', (m) => this.app.toast(m.msg));
    on('close', () => { this.app.toast('החיבור לשרת נותק'); this.endSub(); this.app.goMenu(2); });
  }

  private showLobby() {
    lobby.send({ t: 'hello', name: this.app.settings.nickname });
    this.renderLobby();
  }

  private addChat(m: any) {
    if (!this.chatLog) return;
    this.chatLog.append(h('div', { class: m.sys ? 'sys' : '' }, [m.sys ? m.text : h('span', {}, [h('b', {}, [m.from + ': ']), m.text])]));
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
    if (!m.sys) audio.sfx('chat');
  }

  private chatPanel(): HTMLElement {
    const log = this.chatLog ?? h('div', { class: 'chatlog' });
    this.chatLog = log;
    const input = h('input', { placeholder: 'כתבו משהו...', maxlength: '200' }) as HTMLInputElement;
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && input.value.trim()) { lobby.send({ t: 'chat', text: input.value.trim() }); input.value = ''; }
      if (e.key === 'Escape') input.blur();
    });
    return h('div', { class: 'panel' }, [h('h3', {}, ["צ'אט"]), log, h('div', { class: 'row' }, [input])]);
  }

  private playersPanel(): HTMLElement {
    const list = h('div', { class: 'list' });
    const st: Record<string, string> = { idle: 'בלובי', room: 'בחדר', playing: 'בקרב 🥊', spectating: 'צופה 👀' };
    for (const p of this.players) {
      list.append(h('div', { class: 'pl' + (p.id === lobby.id ? ' me' : '') }, [h('span', {}, [(p.host ? '👑 ' : '') + p.name]), h('span', { class: 'st' }, [st[p.status] ?? ''])]));
    }
    const invite = lobby.invite;
    return h('div', { class: 'panel' }, [
      h('h3', {}, [`שחקנים (${this.players.length})`]), list,
      lobby.host ? h('div', {}, [
        h('div', { style: 'margin-top:8px;font-weight:700' }, ['הקישור לחברים:']),
        h('div', { class: 'invite' }, [invite || 'אין קישור ציבורי (חסר cloudflared) — חברים ברשת הביתית יכולים להיכנס לכתובת ה-LAN']),
        invite ? h('button', { class: 'btn', onclick: () => { void navigator.clipboard.writeText(invite); this.app.toast('הקישור הועתק!'); } }, ['העתקת קישור']) : '',
      ]) : h('div', { class: 'st', style: 'margin-top:8px;color:var(--muted)' }, [`פינג לשרת: ${Math.round(lobby.rtt)}ms`]),
    ]);
  }

  private renderLobby() {
    clear(this.body);
    const rooms = h('div', { class: 'list' });
    for (const r of this.rooms) {
      const full = r.players.every((p: string | null) => p);
      rooms.append(h('div', { class: 'room' }, [
        h('div', { class: 'n' }, [r.name]),
        h('div', { class: 'p' }, [`${r.players.filter((p: string | null) => p).join(' נגד ') || '—'} · צופים: ${r.spectators} · ${r.state === 'playing' ? 'בקרב' : full ? 'מלא' : 'מחכה ליריב'}`]),
        h('div', { class: 'row' }, [
          !full ? h('button', { class: 'btn', onclick: () => lobby.send({ t: 'joinRoom', id: r.id }) }, ['הצטרפות']) : '',
          h('button', { class: 'btn ghost', onclick: () => lobby.send({ t: 'joinRoom', id: r.id, spectate: true }) }, ['צפייה']),
        ]),
      ]));
    }
    if (!this.rooms.length) rooms.append(h('div', { style: 'color:var(--muted)' }, ['אין חדרים עדיין. תפתחו אחד!']));
    const center = h('div', { class: 'panel' }, [
      h('h3', {}, ['חדרים']), rooms,
      h('div', { class: 'row' }, [
        h('button', { class: 'btn', onclick: () => lobby.send({ t: 'createRoom', rounds: this.app.settings.rounds, time: this.app.settings.roundTime || 99 }) }, ['פתיחת חדר']),
        h('button', { class: 'btn ghost', onclick: () => this.exit() }, ['חזרה לתפריט']),
      ]),
    ]);
    this.body.append(h('div', { class: 'lobby-grid' }, [this.playersPanel(), center, this.chatPanel()]));
  }

  private renderRoom() {
    if (!this.room) { this.renderLobby(); return; }
    clear(this.body);
    const r = this.room;
    const slot = (i: number) => h('div', { class: 'pl' }, [h('span', {}, [`שחקן ${i + 1}: ` + (r.players[i]?.name ?? 'מחכה...')]), h('span', { class: 'st' }, [r.players[i]?.id === lobby.id ? 'אתם' : ''])]);
    const center = h('div', { class: 'panel' }, [
      h('h3', {}, [r.name]),
      h('div', { class: 'list' }, [
        slot(0), slot(1),
        h('div', { class: 'st', style: 'margin-top:8px;color:var(--muted)' }, [`צופים: ${r.spectators.join(', ') || '—'}`]),
        h('div', { style: 'margin-top:16px;color:var(--muted);line-height:1.5' }, ['כששני שחקנים בחדר — עוברים לבחירת לוחמים. בזמן הקרב אנשים יכולים להיכנס לצפות.']),
      ]),
      h('div', { class: 'row' }, [h('button', { class: 'btn ghost', onclick: () => lobby.send({ t: 'leaveRoom' }) }, ['יציאה מהחדר'])]),
    ]);
    this.body.append(h('div', { class: 'lobby-grid' }, [this.playersPanel(), center, this.chatPanel()]));
  }

  private endSub() {
    this.resultsEl?.remove();
    this.resultsEl = null;
    this.sub?.dispose();
    this.sub = null;
    this.select = null;
    this.battle = null;
    this.link?.close();
    this.link = null;
    this.el.style.display = '';
    this.app.canvasMode('blur');
    this.app.ensureBackdrop(true);
  }

  private startSelect() {
    this.endSub();
    if (!this.room) return;
    const side = this.room.players.findIndex((p) => p?.id === lobby.id);
    if (side < 0) return;
    this.mySide = side as 0 | 1;
    this.el.style.display = 'none';
    this.app.ensureBackdrop(false);
    this.app.canvasMode('clear');
    this.app.input.solo = true;
    music.play('select');
    this.select = new CharSelect(this.app, 'online', () => {}, () => lobby.send({ t: 'leaveRoom' }), side === 0 ? 0 : 1, {
      side: side as 0 | 1,
      onLocal: (p) => lobby.send({ t: 'pick', ...p }),
    });
    this.sub = this.select;
    lobby.send({ t: 'pick', char: side === 0 ? 0 : 1, skin: 0, locked: false, stage: 0 });
  }

  private cfgFrom(m: any): MatchConfig {
    return {
      chars: [m.picks[0].char, m.picks[1].char], skins: [m.picks[0].skin, m.picks[1].skin], stage: m.stage,
      roundsToWin: m.rounds ?? 2, roundTime: m.time ?? 99, seed: m.seed, charIntro: true,
    };
  }

  private async startMatch(m: any) {
    const ids: string[] = m.ids;
    const side = ids.indexOf(lobby.id) as 0 | 1;
    if (side < 0) return;
    this.endSub();
    this.el.style.display = 'none';
    this.app.ensureBackdrop(false);
    this.app.canvasMode('dim');
    const wait = h('div', { class: 'screen' }, [h('h1', { class: 'metal', style: 'font-family:var(--he);font-size:48px' }, ['מתחבר ליריב...'])]);
    this.app.uiRoot.append(wait);
    const link = new PeerLink(lobby, ids[1 - side], side === 0);
    this.link = link;
    const mode = await link.start();
    wait.remove();
    this.app.toast(mode === 'p2p' ? 'חיבור ישיר (P2P) ✓' : 'חיבור דרך השרת');
    const cfg = this.cfgFrom(m);
    const session = new RollbackSession(cfg, side, link, lobby, () => this.app.input.read(0) & ~C.IN_START, this.app.settings.inputDelay);
    this.app.canvasMode('clear');
    const labels = ids.map((id) => this.players.find((p) => p.id === id)?.name ?? '') as [string, string];
    const b = new Battle(this.app, this.app.renderer, {
      mode: 'online', cfg, sources: [{ kind: 'remote' }, { kind: 'remote' }], driver: session, labels,
      onEnd: (w) => this.onMatchEnd(w),
      onQuit: () => lobby.send({ t: 'leaveRoom' }),
    });
    this.battle = b;
    let warned = false;
    this.sub = {
      update: (dt) => {
        b.update(dt);
        if (session.connectionLost && !warned) { warned = true; this.app.toast('היריב לא מגיב...'); }
        if (session.desync && !warned) { warned = true; this.app.toast('⚠ חוסר סנכרון זוהה'); }
      },
      dispose: () => b.dispose(),
    };
  }

  private startSpectate(m: any) {
    this.endSub();
    this.el.style.display = 'none';
    this.app.ensureBackdrop(false);
    this.app.canvasMode('clear');
    const cfg = this.cfgFrom(m);
    const d = new SpectatorDriver(cfg, lobby);
    const b = new Battle(this.app, this.app.renderer, {
      mode: 'online', cfg, sources: [{ kind: 'remote' }, { kind: 'remote' }], driver: d,
      onEnd: () => { this.endSub(); this.renderRoom(); }, onQuit: () => { this.endSub(); lobby.send({ t: 'leaveRoom' }); },
    });
    b.hud.bigText('צופים', 'SPECTATING', 'small', 2500);
    this.sub = { update: (dt) => b.update(dt), dispose: () => b.dispose() };
  }

  private onMatchEnd(winner: number) {
    lobby.send({ t: 'matchEnd', winner });
    const w = this.battle ? ROSTER[this.battle.driver.state().f[winner === 1 ? 1 : 0].char] : null;
    const el = h('div', { class: 'overlay results fade-in' }, [
      h('h1', { class: 'metal' }, [winner === this.mySide ? 'ניצחתם! 🏆' : w ? `${w.he} ניצח` : 'תיקו']),
      h('div', { class: 'row', style: 'display:flex;gap:12px' }, [
        h('button', { class: 'btn', onclick: () => { lobby.send({ t: 'rematch' }); } }, ["ריוואנץ'"]),
        h('button', { class: 'btn ghost', onclick: () => { lobby.send({ t: 'leaveRoom' }); } }, ['חזרה ללובי']),
      ]),
    ]);
    this.app.uiRoot.append(el);
    this.resultsEl = el;
  }

  update(dt: number) {
    this.sub?.update(dt);
  }

  dispose() {
    this.offs.forEach((o) => o());
    this.endSub();
    this.el.remove();
  }
}
