import { describe, expect, it } from 'vitest';
import { RollbackSession } from '../client/src/net/Rollback';
import { createMatch, hashMatch, step } from '../client/src/sim/match';
import type { MatchConfig } from '../client/src/sim/types';

const cfg: MatchConfig = { chars: [2, 9], skins: [0, 0], stage: 0, roundsToWin: 2, roundTime: 99, seed: 1234, charIntro: false };

class FakeLink {
  other!: FakeLink;
  private listeners = new Set<(m: any) => void>();
  inbox: { at: number; m: any }[] = [];
  constructor(private net: { t: number; latency: number; jitter: number; loss: number; rnd: () => number }) {}
  onMessage(cb: (m: any) => void) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  send(m: unknown) {
    if (this.net.rnd() < this.net.loss) return;
    const delay = this.net.latency + Math.floor(this.net.rnd() * this.net.jitter);
    this.other.inbox.push({ at: this.net.t + delay, m: JSON.parse(JSON.stringify(m)) });
  }
  deliver() {
    const due = this.inbox.filter((x) => x.at <= this.net.t);
    this.inbox = this.inbox.filter((x) => x.at > this.net.t);
    for (const d of due) for (const l of this.listeners) l(d.m);
  }
}

function scriptedInput(player: number, frame: number): number {
  // deterministic pseudo-random but "human-like" (holds inputs for a while)
  const seg = Math.floor(frame / 9);
  let x = (seg * 2654435761 + player * 97) >>> 0;
  x ^= x >>> 13; x = Math.imul(x, 1274126177) >>> 0;
  return x & 0x3ff;
}

describe('rollback netcode', () => {
  for (const [latency, jitter, loss] of [[3, 2, 0], [6, 4, 0.1], [9, 6, 0.25]] as const) {
    it(`stays in sync (latency ${latency}f, jitter ${jitter}f, loss ${loss * 100}%)`, () => {
      let seed = 42;
      const net = { t: 0, latency, jitter, loss, rnd: () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; } };
      const la = new FakeLink(net), lb = new FakeLink(net);
      la.other = lb; lb.other = la;
      const fakeLobby = { send() {} } as any;
      let fa = 0, fb = 0;
      const A = new RollbackSession(cfg, 0, la as any, fakeLobby, () => scriptedInput(0, ++fa + 2), 2);
      const B = new RollbackSession(cfg, 1, lb as any, fakeLobby, () => scriptedInput(1, ++fb + 2), 2);
      for (let tick = 0; tick < 1500; tick++) {
        net.t = tick;
        la.deliver(); lb.deliver();
        A.tick(1 / 60);
        B.tick(1 / 60);
      }
      // straight simulation with the real inputs
      const truth = createMatch(cfg);
      const common = Math.min(Math.max(...A.confirmedHashes.keys()), Math.max(...B.confirmedHashes.keys()));
      expect(common).toBeGreaterThan(1000);
      let mismatches = 0;
      for (let f = 1; f <= common; f++) {
        step(truth, [f <= 2 ? 0 : scriptedInput(0, f), f <= 2 ? 0 : scriptedInput(1, f)]);
        const h = hashMatch(truth);
        if (A.confirmedHashes.get(f) !== h || B.confirmedHashes.get(f) !== h) mismatches++;
      }
      expect(mismatches).toBe(0);
    });
  }
});
