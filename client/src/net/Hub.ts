// The room. It lives in the host's browser: no game server anywhere. Friends open the room's short link, their
// browsers connect straight to the host's (net/Room.ts), and everything the old lobby server used to do — who is
// in the room, who sits in the two fighter seats, chat, starting a match, feeding spectators — happens here.
//
// The hub knows nothing about WebRTC: a member is just something it can `send` to, so it runs the same in tests.

export interface HubConn { send(m: unknown): void }
export interface Pick { char: number; skin: number; locked: boolean }
export interface MemberView { id: string; name: string; seat: number; ping: number; host: boolean }
export interface RoomView {
  code: string; state: 'waiting' | 'select' | 'playing'; rounds: number; time: number; rotate: boolean; members: MemberView[];
}

interface Member {
  id: string; name: string; named: boolean; pid: string; host: boolean; conn: HubConn;
  /** 0 / 1 = fighter seat, -1 = watching */
  seat: number;
  ping: number;
  /** when they last sat down to watch: the longest-waiting spectator is next in line for a seat */
  since: number;
  lastSeen: number;
}

export const MAX_MEMBERS = 12;
const clampInt = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d; };

export class Hub {
  state: RoomView['state'] = 'waiting';
  rounds = 2;
  time = 99;
  /** winner stays, the loser goes to the back of the line */
  rotate = true;
  private members = new Map<string, Member>();
  private picks: (Pick | null)[] = [null, null];
  private stage = 0;
  private seed = 0;
  private startMsg: Record<string, unknown> | null = null;
  /** confirmed inputs of the running match, per side, so someone who starts watching late can catch up */
  private specLog: [number[], number[]] = [[], []];
  private clock = 0;
  private nextId = 1;
  private pingDirty = false;

  constructor(public code: string, private now: () => number = () => Date.now(), private random: () => number = Math.random) {}

  get size() { return this.members.size; }

  /** A browser connected. Returns its member id, or '' when the room is full. */
  join(conn: HubConn, pid: string, host = false): string {
    if (this.members.size >= MAX_MEMBERS) { conn.send({ t: 'error', msg: 'החדר מלא' }); return ''; }
    const id = 'm' + this.nextId++;
    this.members.set(id, { id, name: 'אורח', named: false, pid, host, conn, seat: -1, ping: 0, since: ++this.clock, lastSeen: this.now() });
    return id;
  }

  leave(id: string) {
    const c = this.members.get(id);
    if (!c) return;
    this.members.delete(id);
    if (c.seat >= 0 && this.state !== 'waiting') this.abort(`${c.name} עזב`);
    if (c.named) this.sys(`${c.name} יצא`);
    this.pushRoom();
  }

  /** Members that went silent (closed tab, lost network) are dropped. Call every few seconds. */
  sweep(timeoutMs = 12000) {
    const t = this.now();
    for (const m of [...this.members.values()]) if (!m.host && t - m.lastSeen > timeoutMs) this.leave(m.id);
    if (this.pingDirty) { this.pingDirty = false; this.pushRoom(); }
  }

  private seatOf(seat: number): Member | undefined {
    for (const m of this.members.values()) if (m.seat === seat) return m;
    return undefined;
  }
  private send(m: Member | undefined, msg: unknown) { m?.conn.send(msg); }
  private broadcast(msg: unknown, except?: string) { for (const m of this.members.values()) if (m.id !== except) m.conn.send(msg); }
  private sys(text: string) { this.broadcast({ t: 'chat', from: '', text, sys: true }); }

  view(): RoomView {
    return {
      code: this.code, state: this.state, rounds: this.rounds, time: this.time, rotate: this.rotate,
      members: [...this.members.values()].filter((m) => m.named).map((m) => ({ id: m.id, name: m.name, seat: m.seat, ping: m.ping, host: m.host })),
    };
  }
  private pushRoom() { this.broadcast({ t: 'room', room: this.view() }); }

  private abort(reason: string) {
    this.state = 'waiting';
    this.picks = [null, null];
    this.startMsg = null;
    this.broadcast({ t: 'abort', reason });
  }

  /** Start (or restart) a spectator on the running match, with everything that has happened in it so far. */
  private sendWatch(c: Member) {
    if (this.state !== 'playing' || !this.startMsg || c.seat >= 0) return;
    this.send(c, { t: 'spectateStart', ...this.startMsg });
    for (const side of [0, 1] as const) if (this.specLog[side].length) this.send(c, { t: 'spec', side, from: 1, inputs: this.specLog[side] });
  }

  private matchInfo() {
    return { seed: this.seed, picks: this.picks, stage: this.stage, rounds: this.rounds, time: this.time };
  }

  handle(id: string, m: any) {
    const c = this.members.get(id);
    if (!c || !m || typeof m.t !== 'string') return;
    c.lastSeen = this.now();
    switch (m.t) {
      case 'hello': {
        const first = !c.named;
        const name = String(m.name ?? '').trim().slice(0, 20) || 'אורח';
        const renamed = !first && name !== c.name;
        const old = c.name;
        c.name = name;
        c.named = true;
        if (first) {
          // the first two people fight, everyone after that watches until a seat frees up
          if (this.state === 'waiting') c.seat = !this.seatOf(0) ? 0 : !this.seatOf(1) ? 1 : -1;
          this.send(c, { t: 'welcome', id: c.id, host: c.host, code: this.code });
          this.sys(`${c.name} נכנס לחדר`);
          this.sendWatch(c);
        } else if (renamed) this.sys(`${old} שינה שם ל-${name}`);
        this.pushRoom();
        break;
      }
      case 'ping':
        if (typeof m.rtt === 'number' && m.rtt >= 0) {
          const ping = Math.round(Math.min(9999, m.rtt));
          if (Math.abs(ping - c.ping) > 8) this.pingDirty = true;
          c.ping = ping;
        }
        this.send(c, { t: 'pong', ct: m.ct });
        break;
      case 'chat': {
        const text = String(m.text ?? '').slice(0, 200);
        if (text && c.named) this.broadcast({ t: 'chat', from: c.name, text });
        break;
      }
      case 'seat': {
        if (this.state !== 'waiting') break;
        // the host may move anyone; everyone else only themselves
        const who = c.host && typeof m.who === 'string' ? this.members.get(m.who) : c;
        if (!who) break;
        const seat = m.seat === 0 || m.seat === 1 ? m.seat : -1;
        if (seat >= 0) {
          const holder = this.seatOf(seat);
          if (holder && holder !== who) {
            if (!c.host) break; // taken
            holder.seat = who.seat; // the host swaps them
            if (holder.seat < 0) holder.since = ++this.clock;
          }
        } else if (who.seat >= 0) who.since = ++this.clock;
        who.seat = seat;
        this.pushRoom();
        break;
      }
      case 'opts': {
        if (!c.host || this.state !== 'waiting') break;
        this.rounds = clampInt(m.rounds, 1, 5, this.rounds);
        this.time = [0, 30, 60, 99].includes(Number(m.time)) ? Number(m.time) : this.time;
        this.rotate = m.rotate === undefined ? this.rotate : !!m.rotate;
        this.pushRoom();
        break;
      }
      case 'start': {
        if (!c.host || this.state !== 'waiting') break;
        if (!this.seatOf(0) || !this.seatOf(1)) { this.send(c, { t: 'error', msg: 'צריך שני לוחמים בזירה כדי להתחיל' }); break; }
        this.state = 'select';
        this.picks = [null, null];
        this.stage = 0;
        this.broadcast({ t: 'select', ids: [this.seatOf(0)!.id, this.seatOf(1)!.id] });
        this.pushRoom();
        break;
      }
      case 'pick': {
        if (c.seat < 0 || this.state !== 'select') break;
        this.picks[c.seat] = { char: m.char | 0, skin: m.skin | 0, locked: !!m.locked };
        if (c.seat === 0 && typeof m.stage === 'number') this.stage = m.stage | 0;
        this.broadcast({ t: 'pick', side: c.seat, pick: this.picks[c.seat], stage: this.stage }, c.id);
        if (this.picks.every((p) => p?.locked)) {
          const a = this.seatOf(0)!, b = this.seatOf(1)!;
          this.state = 'playing';
          this.seed = (this.random() * 1e9) | 0;
          this.specLog = [[], []];
          this.startMsg = this.matchInfo();
          for (const mem of this.members.values()) {
            if (mem.seat >= 0) this.send(mem, { t: 'start', ...this.startMsg, ids: [a.id, b.id], pids: [a.pid, b.pid] });
            else if (mem.named) this.send(mem, { t: 'spectateStart', ...this.startMsg });
          }
          this.pushRoom();
        }
        break;
      }
      case 'relay': {
        // fallback when the two players cannot reach each other directly: their packets go through the host
        if (c.seat < 0) break;
        this.send(this.seatOf(1 - c.seat), { t: 'relay', data: m.data });
        break;
      }
      case 'spec': {
        if (c.seat < 0 || this.state !== 'playing' || !Array.isArray(m.inputs)) break;
        const log = this.specLog[c.seat as 0 | 1];
        if (m.from !== log.length + 1) break; // the log has no gaps
        for (const b of m.inputs) log.push(b | 0);
        for (const mem of this.members.values()) if (mem.seat < 0) this.send(mem, { t: 'spec', side: c.seat, from: m.from, inputs: m.inputs });
        break;
      }
      case 'matchEnd': {
        if (c.seat < 0 || this.state !== 'playing') break;
        this.state = 'waiting';
        this.picks = [null, null];
        this.startMsg = null;
        const w = m.winner === 0 || m.winner === 1 ? this.seatOf(m.winner) : undefined;
        const l = w ? this.seatOf(1 - w.seat) : undefined;
        if (w) this.sys(`🏆 ${w.name} ניצח`);
        this.broadcast({ t: 'matchOver', winner: w ? w.seat : -1 });
        if (this.rotate && l) {
          // the longest-waiting spectator takes the loser's seat
          let next: Member | undefined;
          for (const mem of this.members.values()) if (mem.seat < 0 && mem.named && (!next || mem.since < next.since)) next = mem;
          if (next) { next.seat = l.seat; l.seat = -1; l.since = ++this.clock; this.sys(`${next.name} עולה לזירה`); }
        }
        this.pushRoom();
        break;
      }
      case 'watch': this.sendWatch(c); break;
      case 'leaveMatch': {
        if (c.seat >= 0 && this.state !== 'waiting') { this.abort(`${c.name} יצא מהקרב`); this.pushRoom(); }
        break;
      }
    }
  }
}

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no look-alikes (0/O, 1/I/L)
export function newRoomCode(random: () => number = Math.random): string {
  let c = '';
  for (let i = 0; i < 5; i++) c += CODE_CHARS[Math.floor(random() * CODE_CHARS.length)];
  return c;
}
/** What people type or paste: a bare code, or a whole invite link. */
export function parseRoomCode(text: string): string {
  const t = text.trim();
  const m = /[?&#]r(?:oom)?=([A-Za-z0-9]{4,8})/.exec(t);
  const code = (m ? m[1] : t).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.length >= 4 && code.length <= 8 ? code : '';
}
