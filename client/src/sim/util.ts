import { ROSTER } from '../data/roster';
import { INPUT_HISTORY, IN_DOWN, IN_LEFT, IN_RIGHT, IN_UP, MAX_HP } from './constants';
import type { Box, FighterState, MatchState, SimEvent } from './types';
import { St } from './types';

export function rngNext(m: MatchState): number {
  let x = m.rng | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  m.rng = x | 0;
  return x >>> 0;
}

export function rngRange(m: MatchState, lo: number, hi: number): number {
  return lo + (rngNext(m) % (hi - lo + 1));
}

export function emit(m: MatchState, e: Omit<SimEvent, 'f'>): void {
  m.events.push({ f: m.frame, ...e });
}

export function newFighter(char: number, skin: number, side: 0 | 1): FighterState {
  return {
    char, skin,
    x: side === 0 ? -1300 : 1300, y: 0, vx: 0, vy: 0,
    facing: side === 0 ? 1 : -1,
    hp: MAX_HP, meter: 0,
    st: St.Idle, stFrame: 0, move: -1, moveFrame: 0, moveHit: false, moveHits: 0,
    hitstun: 0, blockstun: 0, hitstop: 0, comboCount: 0, comboDamage: 0, juggle: 0,
    airActionUsed: false, invuln: 0, armor: 0, counterFrames: 0, reflectFrames: 0,
    status: '', statusFrames: 0, dashTapFrame: -99, dashTapBack: -99, lastDirX: 0, throwTech: 0,
    cinematicKind: '', cinematicFrames: 0, damageTaken: 0, roundWins: 0, perfectRun: true, wasBlocking: false,
    history: new Array(INPUT_HISTORY).fill(0), prevInput: 0, pendingDamage: 0,
    buf: 0, bufT: 0, jumpDir: 0, lastHitFrame: -999, idleFrames: 0, crouched: false,
  };
}

export function setState(f: FighterState, st: St): void {
  if (f.st !== st) {
    f.st = st;
    f.stFrame = 0;
  }
}

export function grounded(f: FighterState): boolean {
  return f.y <= 0;
}

export function heightMul(f: FighterState): number {
  return Math.round(ROSTER[f.char].look.height * 100);
}

/** Press edge of `bit` within the last `n` frames of history */
export function recentPress(f: FighterState, bit: number, n: number): boolean {
  const h = f.history;
  for (let i = h.length - 1; i > h.length - 1 - n && i > 0; i--) {
    if (h[i] & bit && !(h[i - 1] & bit)) return true;
  }
  return false;
}

export function countPresses(f: FighterState, bit: number, n: number): number {
  const h = f.history;
  let c = 0;
  for (let i = h.length - 1; i > h.length - 1 - n && i > 0; i--) {
    if (h[i] & bit && !(h[i - 1] & bit)) c++;
  }
  return c;
}

export function fwdBit(f: FighterState): number {
  return f.facing === 1 ? IN_RIGHT : IN_LEFT;
}

export function backBit(f: FighterState): number {
  return f.facing === 1 ? IN_LEFT : IN_RIGHT;
}

/** numpad notation relative to facing: 2 = down, 3 = down-forward, 6 = forward, 4 = back, 8 = up ... */
export function dirNum(f: FighterState, input: number): number {
  const h = input & fwdBit(f) ? 1 : input & backBit(f) ? -1 : 0;
  const v = input & IN_UP ? 1 : input & IN_DOWN ? -1 : 0;
  return 5 + h + v * 3;
}

/** true if the direction sequence (numpad notation) appears in order within the last `window` frames */
export function motion(f: FighterState, seq: number[], window = 20): boolean {
  const h = f.history;
  let k = seq.length - 1;
  for (let i = h.length - 1; i >= Math.max(0, h.length - window) && k >= 0; i--) {
    if (dirNum(f, h[i]) === seq[k]) k--;
  }
  return k < 0;
}

export function swapLR(input: number): number {
  const l = input & IN_LEFT;
  const r = input & IN_RIGHT;
  let out = input & ~(IN_LEFT | IN_RIGHT);
  if (l) out |= IN_RIGHT;
  if (r) out |= IN_LEFT;
  return out;
}

export function isCrouching(f: FighterState, moveKey?: string): boolean {
  if (f.st === St.Crouch || f.st === St.BlockCrouch) return true;
  if (f.st === St.Attack && moveKey && moveKey.startsWith('c')) return true;
  if (f.st === St.Hitstun && f.crouched) return true;
  return false;
}

export function hurtbox(f: FighterState, moveKey?: string): Box | null {
  if (f.st === St.Knockdown || f.st === St.Ko || f.st === St.Cinematic || f.st === St.Thrown || f.st === St.Intro) return null;
  const hm = heightMul(f);
  let h = 1750;
  if (isCrouching(f, moveKey)) h = 1050;
  else if (!grounded(f)) h = 1500;
  if (moveKey === 'SP_FU' || moveKey === 'slide') h = Math.min(h, 1300);
  h = ((h * hm) / 100) | 0;
  return { x: f.x - 260, y: f.y, w: 520, h };
}

export function worldBox(f: FighterState, b: Box): Box {
  const x = f.facing === 1 ? f.x + b.x : f.x - b.x - b.w;
  return { x, y: f.y + b.y, w: b.w, h: b.h };
}

export function overlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function sign(n: number): number {
  return n > 0 ? 1 : n < 0 ? -1 : 0;
}

export function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}
