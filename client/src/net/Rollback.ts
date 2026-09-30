import * as C from '../sim/constants';
import { cloneMatch, createMatch, hashMatch, step } from '../sim/match';
import type { MatchConfig, MatchState, SimEvent } from '../sim/types';
import type { Driver } from '../game/Battle';
import type { PeerLink } from './Peer';
import type { LobbyClient } from './LobbyClient';

const MAX_PREDICT = 10;
const MAX_STEPS = 3;

/**
 * GGPO-style rollback session. Both peers run the same deterministic simulation; the local input is applied after a
 * small delay and the remote input is predicted (repeat last) until the real one arrives, at which point we rewind to
 * the first mispredicted frame and re-simulate.
 */
export class RollbackSession implements Driver {
  m: MatchState;
  private p: MatchState;
  private local = new Map<number, number>();
  private remote = new Map<number, number>();
  private used = new Map<number, number>(); // remote input actually used per frame
  private snaps = new Map<number, MatchState>();
  private lastConfirmedRemote = 0; // highest frame f such that all remote inputs <= f are known
  private remoteAck = 0; // highest local frame the peer has acknowledged
  private remoteCur = 0;
  private acc = 0;
  private presented = new Set<string>();
  private pendingRollback = Infinity;
  private offs: (() => void)[] = [];
  private hashes = new Map<number, number>();
  /** hash of the state after each fully-confirmed frame (for tests / desync diagnostics) */
  confirmedHashes = new Map<number, number>();
  private lastHashed = 0;
  private specSent = 0;
  private stallCounter = 0;
  desync = false;
  lastRollback = 0;
  connectionLost = false;
  private lastPacket = performance.now();
  private readLocal: () => number;

  constructor(cfg: MatchConfig, public me: 0 | 1, private link: PeerLink, private lobby: LobbyClient, readLocal: () => number, public delay = 2) {
    this.m = createMatch(cfg);
    this.p = cloneMatch(this.m);
    this.readLocal = readLocal;
    for (let f = 1; f <= delay; f++) this.local.set(f, 0);
    this.offs.push(link.onMessage((msg) => this.onPacket(msg)));
  }

  state() { return this.m; }
  prev() { return this.p; }

  private onPacket(msg: any) {
    this.lastPacket = performance.now();
    if (msg.k === 'in') {
      const from: number = msg.from;
      const bits: number[] = msg.bits;
      for (let i = 0; i < bits.length; i++) {
        const f = from + i;
        if (this.remote.has(f)) continue;
        this.remote.set(f, bits[i]);
        const used = this.used.get(f);
        if (used !== undefined && used !== bits[i] && f <= this.m.frame) this.pendingRollback = Math.min(this.pendingRollback, f);
      }
      while (this.remote.has(this.lastConfirmedRemote + 1)) this.lastConfirmedRemote++;
      this.remoteAck = Math.max(this.remoteAck, msg.ack ?? 0);
      this.remoteCur = Math.max(this.remoteCur, msg.cur ?? 0);
    } else if (msg.k === 'cs') {
      const mine = this.hashes.get(msg.frame);
      if (mine !== undefined && mine !== msg.hash) this.desync = true;
    }
  }

  private inputsFor(f: number): [number, number] {
    const loc = this.local.get(f) ?? 0;
    let rem = this.remote.get(f);
    if (rem === undefined) {
      // prediction: repeat the most recent known remote input
      rem = this.remote.get(this.lastConfirmedRemote) ?? 0;
    }
    this.used.set(f, rem);
    return this.me === 0 ? [loc, rem] : [rem, loc];
  }

  private sendInputs() {
    const from = Math.max(1, this.remoteAck + 1);
    const to = this.m.frame + this.delay;
    const bits: number[] = [];
    for (let f = from; f <= to && bits.length < 40; f++) bits.push(this.local.get(f) ?? 0);
    this.link.send({ k: 'in', from, bits, ack: this.lastConfirmedRemote, cur: this.m.frame });
  }

  private doRollback(events: SimEvent[]) {
    const from = this.pendingRollback;
    this.pendingRollback = Infinity;
    const snap = this.snaps.get(from);
    if (!snap) return;
    const target = this.m.frame;
    const r = cloneMatch(snap);
    for (let f = from; f <= target; f++) {
      this.snaps.set(f, cloneMatch(r));
      if (f === target) this.p = cloneMatch(r);
      step(r, this.inputsFor(f));
      this.collect(r.events, events);
    }
    this.m = r;
    this.lastRollback = target - from + 1;
  }

  private collect(src: SimEvent[], out: SimEvent[]) {
    for (const e of src) {
      const key = `${e.f}:${e.type}:${e.p ?? ''}:${e.a ?? ''}`;
      if (this.presented.has(key)) continue;
      this.presented.add(key);
      out.push(e);
    }
  }

  tick(dt: number) {
    const events: SimEvent[] = [];
    if (this.pendingRollback !== Infinity) this.doRollback(events);
    this.acc += Math.min(dt, 0.1);
    let steps = 0;
    while (this.acc >= 1 / C.FPS && steps < MAX_STEPS) {
      this.acc -= 1 / C.FPS;
      const next = this.m.frame + 1;
      // don't run too far ahead of the peer
      if (next - this.lastConfirmedRemote > MAX_PREDICT) { this.acc = 0; break; }
      // gentle time sync: if we're ahead of the peer, occasionally skip a frame
      if (this.m.frame - this.remoteCur > 2 && ++this.stallCounter % 8 === 0) continue;
      this.local.set(next + this.delay, this.readLocal());
      this.snaps.set(next, cloneMatch(this.m));
      this.p = cloneMatch(this.m);
      step(this.m, this.inputsFor(next));
      this.collect(this.m.events, events);
      steps++;
    }
    this.sendInputs();
    // bookkeeping on confirmed frames
    const confirmed = Math.min(this.lastConfirmedRemote, this.m.frame);
    for (let f = this.lastHashed + 1; f <= confirmed; f++) {
      const after = f === this.m.frame ? this.m : this.snaps.get(f + 1);
      if (!after) break;
      this.confirmedHashes.set(f, hashMatch(after));
      this.lastHashed = f;
    }
    if (confirmed > 0 && confirmed % 60 === 0 && !this.hashes.has(confirmed) && this.snaps.has(confirmed + 1)) {
      const h = hashMatch(this.snaps.get(confirmed + 1)!);
      this.hashes.set(confirmed, h);
      this.link.send({ k: 'cs', frame: confirmed, hash: h });
    }
    // spectators get confirmed inputs through the server
    if (confirmed - this.specSent >= 10) {
      const inputs: number[] = [];
      for (let f = this.specSent + 1; f <= confirmed; f++) inputs.push(this.local.get(f) ?? 0);
      this.lobby.send({ t: 'spec', from: this.specSent + 1, inputs });
      this.specSent = confirmed;
    }
    for (const k of this.snaps.keys()) if (k < confirmed - 2) this.snaps.delete(k);
    for (const k of this.used.keys()) if (k < confirmed - 2) this.used.delete(k);
    if (this.presented.size > 4000) this.presented.clear();
    this.connectionLost = performance.now() - this.lastPacket > 5000;
    return { events, alpha: Math.min(1, this.acc * C.FPS), inputs: this.inputsPreview() };
  }

  private inputsPreview(): [number, number] {
    const f = this.m.frame;
    const a = this.local.get(f) ?? 0;
    const b = this.used.get(f) ?? 0;
    return this.me === 0 ? [a, b] : [b, a];
  }

  dispose() { this.offs.forEach((o) => o()); }
}

/** Spectator: replays confirmed inputs from both players with a buffer for smoothness. */
export class SpectatorDriver implements Driver {
  m: MatchState;
  private p: MatchState;
  private inputs: [Map<number, number>, Map<number, number>] = [new Map(), new Map()];
  private acc = 0;
  private started = false;
  private off: () => void;

  constructor(cfg: MatchConfig, lobbyClient: LobbyClient) {
    this.m = createMatch(cfg);
    this.p = cloneMatch(this.m);
    this.off = lobbyClient.on('spec', (msg) => {
      const map = this.inputs[msg.side as 0 | 1];
      (msg.inputs as number[]).forEach((b, i) => map.set(msg.from + i, b));
    });
  }
  state() { return this.m; }
  prev() { return this.p; }
  tick(dt: number) {
    const events: SimEvent[] = [];
    const avail = (f: number) => this.inputs[0].has(f) && this.inputs[1].has(f);
    let buffered = 0;
    while (avail(this.m.frame + 1 + buffered)) buffered++;
    if (!this.started && buffered > 90) this.started = true;
    if (!this.started) return { events, alpha: 1, inputs: [0, 0] as [number, number] };
    const speed = buffered > 180 ? 1.25 : buffered < 20 ? 0.8 : 1;
    this.acc += Math.min(dt, 0.1) * speed;
    while (this.acc >= 1 / C.FPS) {
      const f = this.m.frame + 1;
      if (!avail(f)) { this.acc = 0; break; }
      this.acc -= 1 / C.FPS;
      this.p = cloneMatch(this.m);
      step(this.m, [this.inputs[0].get(f)!, this.inputs[1].get(f)!]);
      events.push(...this.m.events);
    }
    return { events, alpha: Math.min(1, this.acc * C.FPS), inputs: [0, 0] as [number, number] };
  }
  dispose() { this.off(); }
}
