import { Peer as PeerJs } from 'peerjs';
import { Hub, newRoomCode } from './Hub';
import { LocalPeer } from './LocalPeer';

// Online play without a game server. The host's browser *is* the room (net/Hub.ts); friends connect to it
// directly over WebRTC data channels. The only outside help is PeerJS's free public broker, which introduces the
// browsers to each other (and relays for the few networks that cannot connect directly). Nothing to install,
// nothing to run: open a room, send the short link.

type Handler = (m: any) => void;

/** The part of a PeerJS data connection / peer this game uses (the dev stand-in in LocalPeer.ts has the same shape). */
export interface DataConnection {
  open: boolean; peer: string; label: string;
  send(m: unknown): unknown; close(): void;
  on(e: 'open' | 'close', f: () => void): unknown; on(e: 'data', f: (d: any) => void): unknown; on(e: 'error', f: (e: any) => void): unknown;
}
export interface Peer {
  id: string; open: boolean; destroyed: boolean; disconnected: boolean;
  connect(id: string, opts: { label: string; reliable: boolean; serialization: string }): DataConnection;
  on(e: 'open', f: (id: string) => void): unknown; on(e: 'connection', f: (c: DataConnection) => void): unknown;
  on(e: 'error', f: (e: { type: string }) => void): unknown; on(e: 'disconnected', f: () => void): unknown;
  reconnect(): void; destroy(): void;
}
const FAKE = import.meta.env.DEV && new URLSearchParams(location.search).has('fakenet');
const makePeer = (id?: string): Peer => (FAKE ? new LocalPeer(id) : id ? new PeerJs(id) : new PeerJs()) as unknown as Peer;

/** PeerJS id of a room: the short code, namespaced so it cannot collide with other apps on the public broker. */
const peerIdOf = (code: string) => 'streamkombat26-' + code.toUpperCase();
const OPEN_TIMEOUT = 12000;

export type RoomError = 'broker' | 'noroom' | 'full' | 'timeout';

export class RoomClient {
  /** my member id in the room */
  id = '';
  isHost = false;
  code = '';
  /** round trip to the host, ms (0 for the host) */
  rtt = 0;
  connected = false;
  peer: Peer | null = null;
  private hub: Hub | null = null;
  private hubId = '';
  private conn: DataConnection | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private timers: number[] = [];
  /** direct game connections other players opened to us, by their peer id, and who is waiting for one */
  private gameConns = new Map<string, DataConnection>();
  private gameWaiters = new Map<string, (c: DataConnection) => void>();

  on(t: string, h: Handler): () => void {
    let s = this.handlers.get(t);
    if (!s) { s = new Set(); this.handlers.set(t, s); }
    s.add(h);
    return () => s!.delete(h);
  }

  private emit(m: any) {
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'welcome') { this.id = m.id; this.code = m.code; }
    if (m.t === 'pong') this.rtt = performance.now() - m.ct;
    this.handlers.get(m.t)?.forEach((h) => h(m));
  }

  send(m: unknown) {
    if (this.hub) { const hub = this.hub, id = this.hubId; queueMicrotask(() => hub.handle(id, m)); }
    else if (this.conn?.open) void this.conn.send(m);
  }

  private openPeer(id?: string): Promise<Peer> {
    return new Promise((resolve, reject) => {
      const peer = makePeer(id);
      const to = window.setTimeout(() => { peer.destroy(); reject('broker' satisfies RoomError); }, OPEN_TIMEOUT);
      peer.on('open', () => { clearTimeout(to); resolve(peer); });
      peer.on('error', (e) => {
        if (peer.open) return; // later errors are handled by whoever is using the peer
        clearTimeout(to);
        peer.destroy();
        reject(e.type === 'unavailable-id' ? 'taken' : ('broker' satisfies RoomError));
      });
    });
  }

  private watchGameConns(peer: Peer) {
    peer.on('connection', (c) => {
      if (c.label === 'game') {
        const w = this.gameWaiters.get(c.peer);
        if (w) { this.gameWaiters.delete(c.peer); w(c); } else this.gameConns.set(c.peer, c);
      } else if (c.label === 'lobby' && this.hub) this.attachGuest(c);
      else c.close();
    });
    // the broker socket may drop while the room is fine; quietly get it back so new friends can still join
    peer.on('disconnected', () => { if (!peer.destroyed) window.setTimeout(() => { if (!peer.destroyed && peer.disconnected) peer.reconnect(); }, 1500); });
  }

  /** The other player's direct connection to us (they open it; see PeerLink). */
  awaitGameConn(pid: string, cb: (c: DataConnection) => void): () => void {
    const have = this.gameConns.get(pid);
    if (have) { this.gameConns.delete(pid); cb(have); return () => {}; }
    this.gameWaiters.set(pid, cb);
    return () => { if (this.gameWaiters.get(pid) === cb) this.gameWaiters.delete(pid); };
  }

  private attachGuest(c: DataConnection) {
    const hub = this.hub!;
    let id = '';
    c.on('open', () => { id = hub.join({ send: (m) => { if (c.open) void c.send(m); } }, c.peer); if (!id) window.setTimeout(() => c.close(), 500); });
    c.on('data', (d) => { if (id) hub.handle(id, d); });
    c.on('close', () => { if (id) hub.leave(id); });
    c.on('error', () => { if (id) hub.leave(id); });
  }

  /** Open a room on this browser. Resolves once it is reachable through the broker. */
  async host(name: string, opts: { rounds: number; time: number }): Promise<void> {
    this.close();
    let peer: Peer | null = null, code = '';
    for (let tries = 0; !peer; tries++) {
      code = newRoomCode();
      try { peer = await this.openPeer(peerIdOf(code)); } catch (e) { if (e !== 'taken' || tries >= 4) throw 'broker' satisfies RoomError; }
    }
    this.peer = peer;
    this.isHost = true;
    const hub = new Hub(code);
    hub.rounds = opts.rounds;
    hub.time = opts.time;
    this.hub = hub;
    this.hubId = hub.join({ send: (m) => queueMicrotask(() => this.emit(m)) }, peer.id, true);
    this.watchGameConns(peer);
    this.timers.push(window.setInterval(() => hub.sweep(), 4000));
    this.connected = true;
    this.code = code;
    this.send({ t: 'hello', name });
  }

  /** Join the room with this code. Rejects with a RoomError. */
  async join(code: string, name: string): Promise<void> {
    this.close();
    const peer = await this.openPeer();
    this.peer = peer;
    this.isHost = false;
    this.watchGameConns(peer);
    await new Promise<void>((resolve, reject) => {
      let done = false;
      const fail = (e: RoomError) => { if (done) return; done = true; clearTimeout(to); off(); this.close(); reject(e); };
      const to = window.setTimeout(() => fail('timeout'), OPEN_TIMEOUT);
      peer.on('error', (e) => { if (e.type === 'peer-unavailable') fail('noroom'); });
      const conn = peer.connect(peerIdOf(code), { label: 'lobby', reliable: true, serialization: 'json' });
      this.conn = conn;
      const off = this.on('welcome', () => { if (done) return; done = true; clearTimeout(to); off(); this.connected = true; resolve(); });
      const offErr = this.on('error', (m) => { if (!this.connected) { offErr(); fail(m.msg === 'החדר מלא' ? 'full' : 'noroom'); } });
      conn.on('open', () => { void conn.send({ t: 'hello', name }); });
      conn.on('data', (d) => this.emit(d));
      conn.on('close', () => { if (!done) { fail('noroom'); return; } if (this.conn === conn) this.dropped(); });
      conn.on('error', () => { if (!done) fail('noroom'); });
    });
    this.timers.push(window.setInterval(() => this.send({ t: 'ping', ct: performance.now(), rtt: this.rtt }), 2000));
    this.send({ t: 'ping', ct: performance.now(), rtt: 0 });
  }

  private dropped() {
    const was = this.connected;
    this.close();
    if (was) this.handlers.get('close')?.forEach((h) => h({}));
  }

  close() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.gameConns.clear();
    this.gameWaiters.clear();
    this.conn = null;
    this.hub = null;
    this.peer?.destroy();
    this.peer = null;
    this.connected = false;
    this.isHost = false;
    this.id = '';
    this.code = '';
    this.rtt = 0;
  }
}

export const room = new RoomClient();

/** The link a friend opens to land in this room. */
export function inviteLink(code: string): string {
  const u = new URL(location.href);
  u.search = FAKE ? '?fakenet=' + (new URLSearchParams(location.search).get('fakenet') ?? '1') : '';
  u.hash = '';
  u.searchParams.set('r', code);
  return u.toString();
}
