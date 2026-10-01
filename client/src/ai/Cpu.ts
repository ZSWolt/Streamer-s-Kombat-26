import { ROSTER } from '../data/roster';
import * as C from '../sim/constants';
import { specialWait } from '../sim/match';
import { movesFor } from '../sim/moves';
import type { MatchState } from '../sim/types';
import { St } from '../sim/types';

interface Step { bits: number; frames: number }

const DIFF = [
  { react: 26, block: 0.18, aa: 0.1, combo: 0.15, aggression: 0.35, special: 0.15, banality: 0 },
  { react: 16, block: 0.45, aa: 0.35, combo: 0.45, aggression: 0.5, special: 0.3, banality: 0.3 },
  { react: 9, block: 0.72, aa: 0.65, combo: 0.75, aggression: 0.62, special: 0.45, banality: 0.7 },
  { react: 5, block: 0.9, aa: 0.85, combo: 0.95, aggression: 0.72, special: 0.55, banality: 1 },
];

export class Cpu {
  private q: Step[] = [];
  private think = 0;
  private reactWait = 0;
  private lastSeenAttack = -1;
  constructor(public p: number, public level: number) {}

  reset() { this.q = []; this.think = 0; }

  private push(bits: number, frames: number) { this.q.push({ bits, frames }); }

  private fwd(m: MatchState) { return m.f[this.p].facing === 1 ? C.IN_RIGHT : C.IN_LEFT; }
  private back(m: MatchState) { return m.f[this.p].facing === 1 ? C.IN_LEFT : C.IN_RIGHT; }

  input(m: MatchState): number {
    const d = DIFF[Math.max(0, Math.min(3, this.level))];
    const me = m.f[this.p];
    const op = m.f[1 - this.p];
    if (m.phase !== 'fight' && m.phase !== 'finish') { this.q = []; return 0; }

    // defensive reactions interrupt plans
    const dist = Math.abs(op.x - me.x);
    const opMove = op.st === St.Attack ? movesFor(op.char)[op.move] : null;
    if (opMove && op.move !== this.lastSeenAttack) {
      this.lastSeenAttack = op.move;
      this.reactWait = d.react;
    }
    if (op.st !== St.Attack) this.lastSeenAttack = -1;

    if (this.reactWait > 0) {
      this.reactWait--;
      if (this.reactWait === 0 && opMove && dist < 2400 && Math.random() < d.block && me.st !== St.Attack) {
        const low = opMove.level === 'low';
        this.q = [];
        this.push(C.IN_BLOCK | (low ? C.IN_DOWN : 0), Math.max(8, opMove.active + opMove.recovery));
      }
    }
    // projectile incoming
    for (const pr of m.proj) {
      if (pr.owner === this.p) continue;
      const dx = me.x - pr.x;
      if (Math.sign(dx) === Math.sign(pr.vx) && Math.abs(dx) < 1500 && this.q.length === 0) {
        const r = Math.random();
        if (r < d.block) this.push(C.IN_BLOCK | (pr.level === 'low' ? C.IN_DOWN : 0), 16);
        else if (r < d.block + 0.2) { this.push(C.IN_UP | this.fwd(m), 3); this.push(0, 30); }
      }
    }
    // anti-air
    if (op.st === St.Air && op.vy < 40 && dist < 1500 && this.q.length === 0 && Math.random() < d.aa * 0.2) {
      this.push(C.IN_DOWN, 2); this.push(C.IN_DOWN | C.IN_HP, 2); this.push(0, 20);
    }

    if (this.q.length) {
      const s = this.q[0];
      s.frames--;
      if (s.frames <= 0) this.q.shift();
      return s.bits;
    }

    if (--this.think > 0) return 0;
    this.think = 4 + Math.floor(Math.random() * (30 - this.level * 6));
    this.plan(m, d, dist);
    return 0;
  }

  private plan(m: MatchState, d: (typeof DIFF)[number], dist: number) {
    const me = m.f[this.p];
    const op = m.f[1 - this.p];
    const F = this.fwd(m);
    const B = this.back(m);
    const sp = ROSTER[me.char].specials;
    const ready = (i: number) => specialWait(m, this.p, i) === 0;
    const hasShot = sp.findIndex((s, i) => (s.spec.kind === 'projectile' || s.spec.kind === 'summon') && ready(i));
    const dirFor = (i: number) => (i === 0 ? 0 : i === 1 ? F : i === 2 ? C.IN_DOWN : B);

    if (m.phase === 'finish' && m.winner === this.p) {
      // pick a finisher: punch = banality 1, kick = banality 2, special = surprise
      this.push(0, 30 + Math.floor(Math.random() * 40));
      this.push([C.IN_LP, C.IN_LK, C.IN_SP][Math.floor(Math.random() * 3)], 3);
      this.push(0, 60);
      return;
    }
    if (op.st === St.Knockdown || op.st === St.Getup) {
      if (dist > 1600) this.push(F, 12); else this.push(B, 8);
      return;
    }
    if (me.meter >= C.MAX_METER && dist < 2600 && Math.random() < 0.5 + this.level * 0.1) {
      this.push(C.IN_BLOCK | C.IN_SP, 3); this.push(0, 50);
      return;
    }
    const r = Math.random();
    if (dist > 2600) {
      if (hasShot >= 0 && r < d.special) { this.push(dirFor(hasShot), 3); this.push(dirFor(hasShot) | C.IN_SP, 2); this.push(0, 25); }
      else if (r < 0.75) { this.push(F, 1); this.push(0, 2); this.push(F, 1); this.push(F, 12); }
      else this.push(F, 20 + Math.random() * 20);
      return;
    }
    if (dist > 1100) {
      if (r < d.aggression * 0.5) { this.push(F, 1); this.push(0, 2); this.push(F, 1); this.push(F, 10); }
      else if (r < d.aggression * 0.5 + d.special * 0.6) {
        const i = Math.floor(Math.random() * sp.length);
        if (ready(i)) { this.push(dirFor(i), 3); this.push(dirFor(i) | C.IN_SP, 2); this.push(0, 30); }
        else this.push(F, 10);
      } else if (r < 0.8) this.push(F, 14);
      else { this.push(C.IN_UP | F, 3); this.push(0, 12); this.push(C.IN_HK, 2); this.push(0, 30); }
      return;
    }
    // close range
    if (r < d.combo) {
      const combos = [
        [C.IN_LP, C.IN_LK, C.IN_HP], [C.IN_LP, C.IN_HP], [C.IN_LK, C.IN_HK], [C.IN_DOWN | C.IN_LK, C.IN_DOWN | C.IN_HK],
      ];
      const c = combos[Math.floor(Math.random() * combos.length)];
      for (const b of c) { this.push(b, 2); this.push(b & C.IN_DOWN, 7); }
      if (Math.random() < d.special) { const i = Math.floor(Math.random() * sp.length); if (ready(i)) { this.push(dirFor(i), 2); this.push(dirFor(i) | C.IN_SP, 2); } }
      this.push(0, 20);
    } else if (r < d.combo + 0.12) {
      this.push(C.IN_LP | C.IN_LK, 3); this.push(0, 30);
    } else if (r < d.combo + 0.25) {
      this.push(C.IN_DOWN | C.IN_HK, 3); this.push(C.IN_DOWN, 20);
    } else if (r < d.combo + 0.4) {
      this.push(B, 12);
    } else {
      this.push(C.IN_BLOCK, 14);
    }
  }
}
