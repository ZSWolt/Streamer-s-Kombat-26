import { describe, expect, it } from 'vitest';
import { ROSTER } from '../client/src/data/roster';
import * as C from '../client/src/sim/constants';
import { cloneMatch, createMatch, hashMatch, step } from '../client/src/sim/match';
import type { MatchConfig } from '../client/src/sim/types';

const cfg = (over: Partial<MatchConfig> = {}): MatchConfig => ({
  chars: [0, 1], skins: [0, 0], stage: 0, roundsToWin: 2, roundTime: 99, seed: 42, charIntro: false, ...over,
});

function randInputs(seed: number, n: number): [number, number][] {
  let s = seed;
  const r = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s; };
  const out: [number, number][] = [];
  let a = 0, b = 0;
  for (let i = 0; i < n; i++) {
    if (r() % 6 === 0) a = r() & 0x3ff;
    if (r() % 6 === 0) b = r() & 0x3ff;
    out.push([a, b]);
  }
  return out;
}

function toFight(m: ReturnType<typeof createMatch>) {
  while (m.phase !== 'fight') step(m, [0, 0]);
}

describe('simulation', () => {
  it('is deterministic for every fighter pair sample', () => {
    for (let c = 0; c < ROSTER.length; c++) {
      const inputs = randInputs(c + 7, 3000);
      const run = () => {
        const m = createMatch(cfg({ chars: [c, (c + 5) % ROSTER.length] }));
        for (const i of inputs) step(m, i);
        return hashMatch(m);
      };
      expect(run()).toBe(run());
    }
  });

  it('rollback + resimulation equals straight simulation', () => {
    const inputs = randInputs(99, 2400);
    const straight = createMatch(cfg({ chars: [3, 12] }));
    const rolled = createMatch(cfg({ chars: [3, 12] }));
    let snap = cloneMatch(rolled);
    let snapFrame = 0;
    for (let i = 0; i < inputs.length; i++) {
      step(straight, inputs[i]);
      // predicted (wrong) input for p2, then roll back every 7 frames
      step(rolled, [inputs[i][0], 0]);
      if (i % 7 === 6) {
        const r = cloneMatch(snap);
        for (let k = snapFrame; k <= i; k++) step(r, inputs[k]);
        Object.assign(rolled, r);
        snap = cloneMatch(rolled);
        snapFrame = i + 1;
      }
    }
    // finish the last partial window
    const r = cloneMatch(snap);
    for (let k = snapFrame; k < inputs.length; k++) step(r, inputs[k]);
    expect(hashMatch(r)).toBe(hashMatch(straight));
  });

  it('walking forward moves toward the opponent', () => {
    const m = createMatch(cfg());
    toFight(m);
    const x0 = m.f[0].x;
    for (let i = 0; i < 30; i++) step(m, [C.IN_RIGHT, 0]);
    expect(m.f[0].x).toBeGreaterThan(x0 + 500);
  });

  it('a jab in range deals damage and blocking prevents it', () => {
    const m = createMatch(cfg());
    toFight(m);
    m.f[0].x = -300; m.f[1].x = 300;
    step(m, [C.IN_LP, 0]);
    for (let i = 0; i < 20; i++) step(m, [0, 0]);
    expect(m.f[1].hp).toBeLessThan(C.MAX_HP);

    const m2 = createMatch(cfg());
    toFight(m2);
    m2.f[0].x = -300; m2.f[1].x = 300;
    step(m2, [C.IN_LP, C.IN_BLOCK]);
    for (let i = 0; i < 20; i++) step(m2, [0, C.IN_BLOCK]);
    expect(m2.f[1].hp).toBe(C.MAX_HP);
  });

  it('a full match reaches matchEnd', () => {
    const m = createMatch(cfg({ roundTime: 10 }));
    let guard = 0;
    while (m.phase !== 'matchEnd' && guard++ < 60 * 200) {
      const near = Math.abs(m.f[0].x - m.f[1].x) < 700;
      step(m, [near ? (guard % 3 === 0 ? C.IN_HP : 0) : C.IN_RIGHT, 0]);
    }
    expect(m.phase).toBe('matchEnd');
    expect(m.winner).toBe(0);
  });

  it('a move repeated over and over goes stale: less damage, slower recovery', () => {
    const jab = (n: number) => {
      const m = createMatch(cfg({ roundTime: 0 }));
      toFight(m);
      let last = 0, frames = 0;
      for (let k = 0; k < n; k++) {
        m.f[0].x = -400; m.f[1].x = 400; m.f[1].hp = C.MAX_HP; m.f[1].st = 0; m.f[1].hitstun = 0;
        step(m, [C.IN_LP, 0]);
        frames = 1;
        while (m.f[0].st === 9) { step(m, [0, 0]); frames++; }
        last = C.MAX_HP - m.f[1].hp;
      }
      return { last, frames };
    };
    const fresh = jab(1), stale = jab(5);
    expect(fresh.last).toBeGreaterThan(0);
    expect(stale.last).toBeLessThan(fresh.last * 0.6);
    expect(stale.frames).toBeGreaterThan(fresh.frames + 6);
  });

  it('a different move in between, or a pause, makes a move fresh again', () => {
    const m = createMatch(cfg({ roundTime: 0 }));
    toFight(m);
    const press = (b: number) => { step(m, [b, 0]); while (m.f[0].st === 9) step(m, [0, 0]); };
    press(C.IN_LP); press(C.IN_LP); press(C.IN_LP);
    expect(m.f[0].lastN).toBe(2);
    for (let i = 0; i < C.REPEAT_MEMORY + 5; i++) step(m, [0, 0]);
    press(C.IN_LP);
    expect(m.f[0].lastN).toBe(0);
    // three different moves in rotation never go stale
    for (let i = 0; i < 4; i++) { press(C.IN_LP); press(C.IN_LK); press(C.IN_HP); }
    expect(m.f[0].lastN).toBe(0);
    // two alternated moves do
    for (let i = 0; i < 3; i++) { press(C.IN_LP); press(C.IN_LK); }
    expect(m.f[0].lastN).toBeGreaterThanOrEqual(2);
  });

  it('specials have a cooldown', () => {
    const m = createMatch(cfg({ chars: [0, 1], roundTime: 0 }));
    toFight(m);
    m.f[0].x = -2500; m.f[1].x = 2500;
    const tap = () => { step(m, [C.IN_SP, 0]); step(m, [0, 0]); };
    tap();
    expect(m.f[0].st).toBe(9);
    expect(m.f[0].cd0).toBeGreaterThan(0);
    while (m.f[0].st === 9) step(m, [0, 0]);
    tap();
    expect(m.f[0].st).not.toBe(9); // still cooling down (and its own shots are still flying)
    for (let i = 0; i < 200; i++) step(m, [0, 0]);
    tap();
    expect(m.f[0].st).toBe(9);
  });

  it('every special can be performed without errors', () => {
    for (let c = 0; c < ROSTER.length; c++) {
      for (const dir of [0, C.IN_RIGHT, C.IN_DOWN]) {
        const m = createMatch(cfg({ chars: [c, 0] }));
        toFight(m);
        m.f[0].x = -600; m.f[1].x = 600;
        step(m, [dir, 0]);
        step(m, [dir | C.IN_SP, 0]);
        for (let i = 0; i < 180; i++) step(m, [0, 0]);
        expect(Number.isFinite(m.f[0].x)).toBe(true);
      }
    }
  });
});
