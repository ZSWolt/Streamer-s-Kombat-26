import type { DataConnection, RoomClient } from './Room';

const P2P_WAIT = 7000;

/**
 * Game data link between the two players of a match: a direct WebRTC data channel (unordered, so one late packet
 * never holds up the ones behind it). If the two browsers cannot reach each other within a few seconds the packets
 * go through the room (the host) instead. Also measures the round trip, which sets the input delay and the ping
 * shown on screen.
 */
export class PeerLink {
  private dc: DataConnection | null = null;
  private offs: (() => void)[] = [];
  private listeners = new Set<(m: any) => void>();
  private timer = 0;
  private samples = 0;
  mode: 'connecting' | 'p2p' | 'relay' = 'connecting';
  /** smoothed round trip to the other player, ms */
  rtt = 0;

  constructor(private room: RoomClient, private peerPid: string, private initiator: boolean) {}

  start(): Promise<'p2p' | 'relay'> {
    return new Promise((resolve) => {
      const done = (mode: 'p2p' | 'relay') => {
        if (this.mode !== 'connecting') return;
        this.mode = mode;
        clearTimeout(fallback);
        // a short burst of pings so the match starts with a real measurement
        let n = 0;
        const burst = window.setInterval(() => { this.ping(); if (++n >= 5) clearInterval(burst); }, 70);
        window.setTimeout(() => {
          this.timer = window.setInterval(() => this.ping(), 1000);
          resolve(mode);
        }, 520);
      };
      // packets that came through the room are always accepted: each side picks its own way to send
      this.offs.push(this.room.on('relay', (m) => this.onData(m.data)));
      const fallback = window.setTimeout(() => done('relay'), P2P_WAIT);
      const setup = (dc: DataConnection) => {
        this.dc = dc;
        const opened = () => done('p2p');
        if (dc.open) opened(); else dc.on('open', opened);
        dc.on('data', (d) => this.onData(d));
        dc.on('close', () => { if (this.dc === dc) this.dc = null; if (this.mode === 'p2p') this.mode = 'relay'; });
        dc.on('error', () => { /* falls back to the room */ });
      };
      try {
        if (this.initiator) {
          // give the other side a moment to start listening
          window.setTimeout(() => {
            const peer = this.room.peer;
            if (!peer || this.mode !== 'connecting') return;
            setup(peer.connect(this.peerPid, { label: 'game', reliable: false, serialization: 'json' }));
          }, 300);
        } else this.offs.push(this.room.awaitGameConn(this.peerPid, setup));
      } catch { done('relay'); }
    });
  }

  private ping() { this.send({ k: 'pg', t: performance.now() }); }

  private onData(m: any) {
    if (!m) return;
    if (m.k === 'pg') { this.send({ k: 'po', t: m.t }); return; }
    if (m.k === 'po') {
      const r = performance.now() - m.t;
      this.rtt = this.samples++ === 0 ? r : this.samples < 6 ? Math.min(this.rtt, r) : this.rtt + (r - this.rtt) * 0.2;
      return;
    }
    for (const l of this.listeners) l(m);
  }

  onMessage(cb: (m: any) => void) { this.listeners.add(cb); return () => this.listeners.delete(cb); }

  send(m: unknown) {
    if (this.dc?.open) void this.dc.send(m);
    else this.room.send({ t: 'relay', data: m });
  }

  close() {
    clearInterval(this.timer);
    this.offs.forEach((o) => o());
    this.dc?.close();
    this.dc = null;
    this.listeners.clear();
  }
}

/** Frames of input delay that hide this much round trip (ms) without making the controls feel heavy. */
export function autoDelay(rtt: number): number {
  return rtt < 28 ? 1 : rtt < 75 ? 2 : rtt < 125 ? 3 : 4;
}
