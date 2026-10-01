// Dev-only stand-in for PeerJS (add ?fakenet=1 to the URL): tabs of the same browser talk over a BroadcastChannel
// instead of WebRTC. It exists so the whole online flow — room, seats, START, match, spectators — can be driven
// with two tabs on one machine, where real peer-to-peer connections often cannot form (no hairpin NAT, no mDNS).
// Only the few PeerJS calls net/Room.ts and net/Peer.ts make are implemented.

type Fn = (...a: any[]) => void;

class Emitter {
  private ls = new Map<string, Set<Fn>>();
  on(e: string, f: Fn) { let s = this.ls.get(e); if (!s) { s = new Set(); this.ls.set(e, s); } s.add(f); return this; }
  emit(e: string, ...a: unknown[]) { this.ls.get(e)?.forEach((f) => f(...a)); }
}

interface Wire { to: string; from: string; kind: 'connect' | 'accept' | 'data' | 'close'; cid: string; label?: string; payload?: unknown }

export class LocalConn extends Emitter {
  open = false;
  constructor(private owner: LocalPeer, public peer: string, public label: string, public cid: string) { super(); }
  send(m: unknown) { if (this.open) this.owner.post({ to: this.peer, from: this.owner.id, kind: 'data', cid: this.cid, payload: m }); }
  close() {
    if (!this.open) return;
    this.open = false;
    this.owner.post({ to: this.peer, from: this.owner.id, kind: 'close', cid: this.cid });
    this.owner.conns.delete(this.cid);
    this.emit('close');
  }
  /** the other side closed (or went away) */
  ended() { if (!this.open) return; this.open = false; this.owner.conns.delete(this.cid); this.emit('close'); }
  opened() { this.open = true; this.emit('open'); }
}

export class LocalPeer extends Emitter {
  id: string;
  open = false;
  destroyed = false;
  disconnected = false;
  conns = new Map<string, LocalConn>();
  private ch = new BroadcastChannel('sk-fakenet');
  /** artificial one-way delay in ms (?fakenet=80), to try the netcode with lag */
  private lag = Number(new URLSearchParams(location.search).get('fakenet')) > 1 ? Number(new URLSearchParams(location.search).get('fakenet')) : 0;

  constructor(id?: string) {
    super();
    this.id = id ?? 'local-' + Math.random().toString(36).slice(2, 10);
    this.ch.onmessage = (e) => { const w = e.data as Wire; if (w.to === this.id) this.receive(w); };
    setTimeout(() => { this.open = true; this.emit('open', this.id); }, 30);
    addEventListener('pagehide', () => this.destroy());
  }

  post(w: Wire) {
    if (this.destroyed) return;
    if (this.lag) setTimeout(() => { if (!this.destroyed) this.ch.postMessage(w); }, this.lag);
    else this.ch.postMessage(w);
  }

  private receive(w: Wire) {
    if (w.kind === 'connect') {
      const c = new LocalConn(this, w.from, w.label ?? '', w.cid);
      this.conns.set(w.cid, c);
      this.emit('connection', c);
      this.post({ to: w.from, from: this.id, kind: 'accept', cid: w.cid });
      setTimeout(() => c.opened(), 0);
      return;
    }
    const c = this.conns.get(w.cid);
    if (!c) return;
    if (w.kind === 'accept') c.opened();
    else if (w.kind === 'data') c.emit('data', w.payload);
    else if (w.kind === 'close') c.ended();
  }

  connect(dst: string, opts: { label?: string } = {}): LocalConn {
    const c = new LocalConn(this, dst, opts.label ?? '', Math.random().toString(36).slice(2, 12));
    this.conns.set(c.cid, c);
    this.post({ to: dst, from: this.id, kind: 'connect', cid: c.cid, label: c.label });
    setTimeout(() => { if (!c.open && this.conns.has(c.cid)) { this.conns.delete(c.cid); this.emit('error', { type: 'peer-unavailable' }); } }, 1500 + this.lag * 2);
    return c;
  }

  reconnect() { /* never disconnected */ }

  destroy() {
    if (this.destroyed) return;
    for (const c of [...this.conns.values()]) c.close();
    this.destroyed = true;
    this.open = false;
    this.ch.close();
  }
}
