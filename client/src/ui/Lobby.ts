import { audio } from '../audio/AudioEngine';
import { music } from '../audio/music';
import { ROSTER } from '../data/roster';
import { Battle } from '../game/Battle';
import { parseRoomCode, type MemberView, type RoomView } from '../net/Hub';
import { PeerLink, autoDelay } from '../net/Peer';
import { RollbackSession, SpectatorDriver } from '../net/Rollback';
import { inviteLink, room, type RoomError } from '../net/Room';
import * as C from '../sim/constants';
import type { MatchConfig } from '../sim/types';
import type { App, Screen } from '../app/App';
import { saveSettings } from '../app/settings';
import { CharSelect } from './CharSelect';
import { h, clear } from './dom';
import { stone } from './stone';

const ERRORS: Record<RoomError, string> = {
  broker: 'שירות החיבור לא זמין כרגע. בדקו את האינטרנט ונסו שוב.',
  noroom: 'לא מצאנו חדר עם הקוד הזה. אולי המארח סגר אותו?',
  full: 'החדר מלא.',
  timeout: 'לא הצלחנו להתחבר למארח. נסו שוב, או מרשת אחרת.',
};

/**
 * Online: one room, hosted by whoever opened it. Open a room -> copy the short link -> friends who open it land
 * straight in this room -> the host presses START when everyone is in.
 */
export class Lobby implements Screen {
  private el: HTMLElement;
  private body: HTMLElement;
  private offs: (() => void)[] = [];
  private sub: Screen | null = null;
  private view: RoomView | null = null;
  private chatLog: HTMLElement | null = null;
  private select: CharSelect | null = null;
  private battle: Battle | null = null;
  private link: PeerLink | null = null;
  private overlay: HTMLElement | null = null;
  private badge: HTMLElement | null = null;
  private mySide: 0 | 1 = 0;
  private busy = false;
  private pingT = 0;
  private grid: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private centreEl: HTMLElement | null = null;

  /** `code`: the room from an invite link, joined straight away. */
  constructor(private app: App, code = '') {
    music.play('menu');
    this.body = h('div', { style: 'width:100%;display:flex;flex-direction:column;align-items:center' });
    this.el = h('div', { class: 'screen lobby fade-in' }, [h('h1', {}, [stone('אונליין')]), this.body]);
    app.uiRoot.append(this.el);
    this.offs.push(app.input.onUi((e) => {
      if (e === 'back' && !(document.activeElement instanceof HTMLInputElement) && !this.sub && !this.busy) this.exit();
    }));
    this.bind();
    if (room.connected) this.renderRoom();
    else if (parseRoomCode(code)) void this.join(parseRoomCode(code));
    else this.renderEntry();
  }

  private name(): string {
    const s = this.app.settings;
    if (!s.nickname.trim()) { s.nickname = 'שחקן' + (10 + Math.floor(Math.random() * 90)); saveSettings(s); }
    return s.nickname.trim();
  }

  private exit() {
    room.close();
    this.app.goMenu(2);
  }

  // ---------------------------------------------------------------- getting into a room

  private renderEntry(error = '') {
    this.view = null;
    clear(this.body);
    const s = this.app.settings;
    const nameIn = h('input', { placeholder: 'השם שלכם', maxlength: '20', value: s.nickname }) as HTMLInputElement;
    const codeIn = h('input', { placeholder: 'קוד או קישור', maxlength: '120', dir: 'ltr', style: 'text-align:center;letter-spacing:0.12em;text-transform:uppercase' }) as HTMLInputElement;
    const keep = () => { s.nickname = nameIn.value.trim().slice(0, 20); saveSettings(s); };
    const join = () => {
      const code = parseRoomCode(codeIn.value);
      if (!code) { this.app.toast('הדביקו את הקישור או הקלידו את קוד החדר'); codeIn.focus(); return; }
      keep();
      void this.join(code);
    };
    nameIn.addEventListener('keydown', (e) => e.stopPropagation());
    codeIn.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') join(); });
    this.body.append(h('div', { class: 'entry' }, [
      h('label', { class: 'entry-name' }, [h('span', {}, ['השם שלכם']), nameIn]),
      h('div', { class: 'entry-cards' }, [
        h('div', { class: 'panel entry-card' }, [
          h('h3', {}, ['מארחים']),
          h('p', {}, ['פותחים חדר, שולחים לחברים קישור קצר, וכשכולם בפנים לוחצים START.']),
          h('button', { class: 'btn big', onclick: () => { keep(); void this.host(); } }, ['פתיחת חדר']),
        ]),
        h('div', { class: 'panel entry-card' }, [
          h('h3', {}, ['מצטרפים']),
          h('p', {}, ['קיבלתם קישור? פשוט פתחו אותו. יש לכם רק קוד? הקלידו אותו כאן.']),
          codeIn,
          h('button', { class: 'btn big', onclick: join }, ['הצטרפות']),
        ]),
      ]),
      error ? h('div', { class: 'entry-error' }, [error]) : '',
      h('div', { class: 'entry-note' }, ['אין צורך להתקין או להפעיל שרת: החדר רץ בדפדפן של המארח, והקרב עובר ישירות בין השחקנים.']),
      h('button', { class: 'btn ghost', onclick: () => this.app.goMenu(2) }, ['חזרה לתפריט']),
    ]));
  }

  private status(text: string) {
    clear(this.body);
    this.body.append(h('p', { class: 'entry-status' }, [text]));
  }

  private async host() {
    if (this.busy) return;
    this.busy = true;
    this.status('פותח חדר...');
    try {
      await room.host(this.name(), { rounds: this.app.settings.rounds, time: this.app.settings.roundTime });
      audio.sfx('ui_start');
    } catch (e) {
      this.renderEntry(ERRORS[e as RoomError] ?? ERRORS.broker);
    }
    this.busy = false;
  }

  private async join(code: string) {
    if (this.busy) return;
    this.busy = true;
    this.status(`מתחבר לחדר ${code}...`);
    try {
      await room.join(code, this.name());
      audio.sfx('ui_start');
    } catch (e) {
      this.renderEntry(ERRORS[e as RoomError] ?? ERRORS.timeout);
    }
    this.busy = false;
  }

  private bind() {
    const on = (t: string, f: (m: any) => void) => this.offs.push(room.on(t, f));
    on('room', (m) => { this.view = m.room; if (!this.sub) this.renderRoom(); });
    on('chat', (m) => this.addChat(m));
    on('select', () => this.startSelect());
    on('pick', (m) => this.select?.applyRemote(m.side, m.pick, m.stage));
    on('start', (m) => void this.startMatch(m));
    on('spectateStart', (m) => this.startSpectate(m));
    on('matchOver', (m) => this.onMatchOver(m.winner));
    on('abort', (m) => { this.app.toast(m.reason ?? 'הקרב בוטל'); this.endSub(); this.renderRoom(); });
    on('error', (m) => { if (room.connected) this.app.toast(m.msg); });
    on('close', () => { this.endSub(); this.renderEntry('החיבור לחדר נותק (המארח יצא או שהרשת נפלה).'); });
  }

  // ---------------------------------------------------------------- the room

  private addChat(m: any) {
    if (!this.chatLog) this.chatLog = h('div', { class: 'chatlog' });
    this.chatLog.append(h('div', { class: m.sys ? 'sys' : '' }, [m.sys ? m.text : h('span', {}, [h('b', {}, [m.from + ': ']), m.text])]));
    while (this.chatLog.children.length > 120) this.chatLog.firstChild!.remove();
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
    if (!m.sys) audio.sfx('chat');
  }

  private chatPanel(): HTMLElement {
    const log = this.chatLog ?? h('div', { class: 'chatlog' });
    this.chatLog = log;
    const input = h('input', { placeholder: 'כתבו משהו...', maxlength: '200' }) as HTMLInputElement;
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && input.value.trim()) { room.send({ t: 'chat', text: input.value.trim() }); input.value = ''; }
      if (e.key === 'Escape') input.blur();
    });
    return h('div', { class: 'panel' }, [h('h3', {}, ["צ'אט"]), log, h('div', { class: 'row' }, [input])]);
  }

  private pingText(m: MemberView): string {
    if (m.host) return 'מארח 👑';
    return m.ping > 0 ? `${m.ping}ms` : '…';
  }

  private renderRoom() {
    const v = this.view;
    if (!v || !room.connected) { if (!room.connected && !this.busy) this.renderEntry(); return; }
    // the frame of the room is built once; a refresh only redraws the lists, so typing a name or a chat line
    // is never interrupted by someone joining
    if (!this.grid || !this.body.contains(this.grid)) {
      clear(this.body);
      this.listEl = h('div', { class: 'list' });
      this.countEl = h('h3');
      this.centreEl = h('div', { class: 'panel' });
      const nameIn = h('input', { maxlength: '20', value: this.app.settings.nickname }) as HTMLInputElement;
      const rename = () => {
        const n = nameIn.value.trim().slice(0, 20);
        if (!n || n === this.view?.members.find((m) => m.id === room.id)?.name) return;
        this.app.settings.nickname = n;
        saveSettings(this.app.settings);
        room.send({ t: 'hello', name: n });
      };
      nameIn.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') nameIn.blur(); });
      nameIn.addEventListener('blur', rename);
      const people = h('div', { class: 'panel' }, [this.countEl, this.listEl, h('label', { class: 'room-name' }, [h('span', {}, ['השם שלכם']), nameIn])]);
      this.grid = h('div', { class: 'lobby-grid' }, [people, this.centreEl, this.chatPanel()]);
      this.body.append(this.grid);
    }
    const me = v.members.find((m) => m.id === room.id);
    const host = !!me?.host;
    const waiting = v.state === 'waiting';
    const link = inviteLink(v.code);
    const copy = () => { void navigator.clipboard?.writeText(link).then(() => this.app.toast('הקישור הועתק — שלחו אותו לחברים!'), () => this.app.toast(link, 6000)); };

    // ---- who is here
    this.countEl!.textContent = `בחדר (${v.members.length})`;
    clear(this.listEl!);
    for (const m of v.members) {
      this.listEl!.append(h('div', { class: 'pl' + (m.id === room.id ? ' me' : '') }, [
        h('span', {}, [(m.seat >= 0 ? '🥊 ' : '👀 ') + m.name + (m.id === room.id ? ' (אתם)' : '')]),
        h('span', { class: 'st' + (m.ping > 150 ? ' bad' : m.ping > 80 ? ' warn' : '') }, [this.pingText(m)]),
      ]));
    }

    // ---- the two seats, the options and START
    const seat = (i: number) => {
      const m = v.members.find((x) => x.seat === i);
      const mine = m?.id === room.id;
      return h('div', { class: 'seat' + (m ? ' taken' : '') + (mine ? ' mine' : '') }, [
        h('div', { class: 'seat-n' }, [`לוחם ${i + 1}`]),
        h('div', { class: 'seat-who' }, [m ? m.name : 'פנוי']),
        waiting ? (mine ? h('button', { class: 'btn ghost sm', onclick: () => room.send({ t: 'seat', seat: -1 }) }, ['לצפות'])
          : !m ? h('button', { class: 'btn sm', onclick: () => room.send({ t: 'seat', seat: i }) }, ['לשבת כאן'])
          : host ? h('button', { class: 'btn ghost sm', onclick: () => room.send({ t: 'seat', seat: -1, who: m.id }) }, ['לפנות']) : '') : '',
      ]);
    };
    const opt = (label: string, value: string, change: (d: number) => void) => h('div', { class: 'ropt' }, [
      h('span', {}, [label]),
      host && waiting ? h('button', { class: 'btn ghost sm', onclick: () => change(-1) }, ['‹']) : '',
      h('b', {}, [value]),
      host && waiting ? h('button', { class: 'btn ghost sm', onclick: () => change(1) }, ['›']) : '',
    ]);
    const times = [30, 60, 99, 0];
    const sendOpts = (o: Partial<RoomView>) => room.send({ t: 'opts', rounds: v.rounds, time: v.time, rotate: v.rotate, ...o });
    const ready = !!v.members.find((m) => m.seat === 0) && !!v.members.find((m) => m.seat === 1);
    clear(this.centreEl!);
    this.centreEl!.append(
      h('div', { class: 'room-code' }, [
        h('span', {}, ['קישור לחדר']),
        h('div', { class: 'invite', onclick: copy }, [link]),
        h('button', { class: 'btn', onclick: copy }, ['העתקת קישור']),
        h('span', { class: 'st' }, ['או קוד: ']), h('b', {}, [v.code]),
      ]),
      h('div', { class: 'seats' }, [seat(0), h('div', { class: 'seat-vs' }, [stone('VS')]), seat(1)]),
      h('div', { class: 'ropts' }, [
        opt('סבבים לניצחון', String(v.rounds), (d) => sendOpts({ rounds: Math.min(5, Math.max(1, v.rounds + d)) })),
        opt('זמן לסבב', v.time ? String(v.time) : '∞', (d) => sendOpts({ time: times[(times.indexOf(v.time) + d + times.length) % times.length] })),
        opt('מנצח נשאר', v.rotate ? 'כן' : 'לא', () => sendOpts({ rotate: !v.rotate })),
      ]),
      h('div', { class: 'room-go' }, [
        v.state === 'select' ? h('div', { class: 'wait' }, ['בוחרים לוחמים...'])
          : v.state === 'playing' ? h('button', { class: 'btn', onclick: () => room.send({ t: 'watch' }) }, ['קרב בעיצומו — לצפייה 👀'])
          : host ? h('button', { class: 'btn start' + (ready ? '' : ' off'), onclick: () => room.send({ t: 'start' }) }, ['START'])
          : h('div', { class: 'wait' }, [ready ? 'מחכים שהמארח ילחץ START...' : 'מחכים לעוד לוחם...']),
        host && waiting && !ready ? h('div', { class: 'wait' }, ['שלחו את הקישור לחבר — כשיש שני לוחמים אפשר להתחיל']) : '',
      ]),
      h('div', { class: 'row' }, [h('button', { class: 'btn ghost', onclick: () => this.exit() }, [host ? 'סגירת החדר' : 'יציאה מהחדר'])]),
    );
  }

  // ---------------------------------------------------------------- select / fight / watch

  private endSub() {
    this.overlay?.remove();
    this.overlay = null;
    this.badge?.remove();
    this.badge = null;
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
    const side = this.view?.members.find((m) => m.id === room.id)?.seat ?? -1;
    if (side < 0) { this.renderRoom(); return; }
    this.mySide = side as 0 | 1;
    this.el.style.display = 'none';
    this.app.ensureBackdrop(false);
    this.app.canvasMode('clear');
    this.app.input.solo = true;
    music.play('select');
    this.select = new CharSelect(this.app, 'online', () => {}, () => room.send({ t: 'leaveMatch' }), side === 0 ? 0 : 1, {
      side: side as 0 | 1,
      onLocal: (p) => room.send({ t: 'pick', ...p }),
    });
    this.sub = this.select;
    room.send({ t: 'pick', char: side === 0 ? 0 : 1, skin: 0, locked: false, stage: 0 });
  }

  private cfgFrom(m: any): MatchConfig {
    return {
      chars: [m.picks[0].char, m.picks[1].char], skins: [m.picks[0].skin, m.picks[1].skin], stage: m.stage,
      roundsToWin: m.rounds ?? 2, roundTime: m.time ?? 99, seed: m.seed, charIntro: true,
    };
  }

  private async startMatch(m: any) {
    const ids: string[] = m.ids;
    const side = ids.indexOf(room.id) as 0 | 1;
    if (side < 0) return;
    this.endSub();
    this.mySide = side;
    this.el.style.display = 'none';
    this.app.ensureBackdrop(false);
    this.app.canvasMode('dim');
    const wait = h('div', { class: 'screen' }, [h('h1', { style: 'font-size:48px' }, [stone('מתחבר ליריב...')])]);
    this.app.uiRoot.append(wait);
    const link = new PeerLink(room, m.pids[1 - side], side === 0);
    this.link = link;
    const mode = await link.start();
    wait.remove();
    if (this.link !== link) return; // the match was called off while connecting
    const s = this.app.settings;
    const delay = s.inputDelay < 0 ? autoDelay(link.rtt) : s.inputDelay;
    const cfg = this.cfgFrom(m);
    let b: Battle | null = null;
    const session = new RollbackSession(cfg, side, link, room, () => {
      const bits = b?.inMenu ? 0 : this.app.input.read(0) & ~C.IN_START;
      this.app.input.clearTaps();
      return bits;
    }, delay);
    this.app.canvasMode('clear');
    const names = ids.map((id) => this.view?.members.find((p) => p.id === id)?.name ?? '') as [string, string];
    b = new Battle(this.app, this.app.renderer, {
      mode: 'online', cfg, sources: [{ kind: 'remote' }, { kind: 'remote' }], driver: session, labels: names,
      onEnd: (w) => room.send({ t: 'matchEnd', winner: w }),
      onQuit: () => room.send({ t: 'leaveMatch' }),
    });
    this.battle = b;
    const battle = b;
    this.badge = h('div', { class: 'net-badge' });
    this.app.uiRoot.append(this.badge);
    let warned = false;
    this.pingT = 0;
    this.sub = {
      update: (dt) => {
        battle.update(dt);
        if ((this.pingT -= dt) <= 0 && this.badge) {
          this.pingT = 0.5;
          const rtt = Math.round(link.rtt);
          this.badge.textContent = `פינג ${rtt}ms · ${link.mode === 'p2p' ? 'ישיר' : 'דרך המארח'} · השהיה ${delay}f` + (session.rollbackFrames > 0 ? ` · rollback ${session.rollbackFrames}f/s` : '');
          this.badge.className = 'net-badge' + (rtt > 150 ? ' bad' : rtt > 80 ? ' warn' : '');
        }
        if (session.connectionLost && !warned) { warned = true; this.app.toast('היריב לא מגיב...'); }
        if (session.desync && !warned) { warned = true; this.app.toast('⚠ חוסר סנכרון זוהה'); }
      },
      dispose: () => battle.dispose(),
    };
    this.app.toast(mode === 'p2p' ? `חיבור ישיר ✓ פינג ${Math.round(link.rtt)}ms` : 'אין חיבור ישיר — משחקים דרך המארח');
  }

  private startSpectate(m: any) {
    this.endSub();
    this.el.style.display = 'none';
    this.app.ensureBackdrop(false);
    this.app.canvasMode('clear');
    const cfg = this.cfgFrom(m);
    const d = new SpectatorDriver(cfg, room);
    const b = new Battle(this.app, this.app.renderer, {
      mode: 'online', cfg, sources: [{ kind: 'remote' }, { kind: 'remote' }], driver: d,
      onEnd: () => {}, onQuit: () => { this.endSub(); this.renderRoom(); },
    });
    this.battle = b;
    b.hud.bigText('צופים', 'SPECTATING', 'small', 2500);
    this.sub = { update: (dt) => b.update(dt), dispose: () => b.dispose() };
  }

  /** The room says the match is over: show who won over the last frame of the fight, then back to the room. */
  private onMatchOver(winner: number) {
    if (!this.sub || this.overlay) return;
    const st = this.battle?.driver.state();
    const w = st && (winner === 0 || winner === 1) ? ROSTER[st.f[winner].char] : null;
    const name = winner >= 0 ? this.view?.members.find((m) => m.seat === winner)?.name ?? '' : '';
    const fighting = !!this.link;
    const back = () => { this.endSub(); this.renderRoom(); };
    const el = h('div', { class: 'results-overlay fade-in' }, [
      h('div', { class: 'res-title' }, [stone(fighting ? (winner === this.mySide ? 'ניצחתם!' : winner < 0 ? 'תיקו' : 'הפסדתם') : w ? `${name || w.he} ניצח` : 'תיקו')]),
      w ? h('div', { class: 'quote' }, [`${name ? name + ' · ' : ''}${w.he}: "${w.win}"`]) : '',
      h('div', { class: 'row', style: 'display:flex;gap:12px' }, [h('button', { class: 'btn', onclick: back }, ['חזרה לחדר'])]),
      h('div', { class: 'menu-hint' }, [room.isHost ? 'בחדר לוחצים START לקרב הבא' : 'המארח מתחיל את הקרב הבא']),
    ]);
    this.app.uiRoot.append(el);
    this.overlay = el;
    window.setTimeout(() => { if (this.overlay === el) back(); }, 9000);
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
