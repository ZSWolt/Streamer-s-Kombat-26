import { ROSTER } from '../data/roster';
import type { Box, MoveDef, SpecialDef } from './types';

export const MV = {
  LP: 0, HP: 1, LK: 2, HK: 3,
  cLP: 4, cHP: 5, cLK: 6, cHK: 7,
  jLP: 8, jHP: 9, jLK: 10, jHK: 11,
  fHP: 12, THROW: 13,
  SP0: 14, SP1: 15, SP2: 16, HYPE: 17, fLK: 18,
} as const;

const b = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h });

interface NormalSpec {
  key: string; anim: string; s: number; a: number; r: number; dmg: number; level: MoveDef['level'];
  box: Box; hs: number; bs: number; push: number; stop: number; rank: number;
  cancel?: MoveDef['cancel']; kd?: boolean; launch?: [number, number]; air?: boolean; vx?: [number, number][];
  invuln?: [number, number];
}

const NORMALS: NormalSpec[] = [
  { key: 'LP', anim: 'jab', s: 5, a: 3, r: 9, dmg: 32, level: 'high', box: b(120, 1180, 520, 260), hs: 15, bs: 10, push: 34, stop: 6, rank: 1, cancel: 'chain' },
  { key: 'HP', anim: 'straight', s: 9, a: 3, r: 17, dmg: 72, level: 'high', box: b(120, 1120, 640, 300), hs: 21, bs: 14, push: 52, stop: 10, rank: 3, cancel: 'chain', vx: [[6, 30], [9, 0]] },
  { key: 'LK', anim: 'lowkick', s: 7, a: 3, r: 12, dmg: 46, level: 'mid', box: b(120, 520, 620, 330), hs: 17, bs: 11, push: 40, stop: 7, rank: 2, cancel: 'chain' },
  { key: 'HK', anim: 'roundhouse', s: 12, a: 4, r: 21, dmg: 96, level: 'high', box: b(100, 1050, 760, 380), hs: 24, bs: 15, push: 70, stop: 12, rank: 4, cancel: 'special' },
  { key: 'cLP', anim: 'cjab', s: 5, a: 3, r: 9, dmg: 26, level: 'mid', box: b(120, 620, 500, 260), hs: 14, bs: 9, push: 30, stop: 6, rank: 1, cancel: 'chain' },
  { key: 'cHP', anim: 'uppercut', s: 10, a: 5, r: 24, dmg: 110, level: 'mid', box: b(40, 700, 520, 1250), hs: 30, bs: 16, push: 30, stop: 12, rank: 4, cancel: 'special', launch: [26, 150], invuln: [4, 13] },
  { key: 'cLK', anim: 'clowkick', s: 6, a: 3, r: 11, dmg: 34, level: 'low', box: b(120, 0, 660, 260), hs: 15, bs: 10, push: 36, stop: 6, rank: 2, cancel: 'chain' },
  { key: 'cHK', anim: 'sweep', s: 11, a: 4, r: 25, dmg: 72, level: 'low', box: b(100, 0, 800, 260), hs: 26, bs: 14, push: 40, stop: 10, rank: 4, cancel: 'special', kd: true },
  { key: 'jLP', anim: 'jpunch', s: 5, a: 8, r: 4, dmg: 45, level: 'overhead', box: b(80, 420, 520, 420), hs: 17, bs: 11, push: 30, stop: 7, rank: 1, air: true, cancel: 'none' },
  { key: 'jHP', anim: 'jheavy', s: 8, a: 6, r: 4, dmg: 76, level: 'overhead', box: b(60, 300, 620, 520), hs: 21, bs: 13, push: 40, stop: 10, rank: 3, air: true, cancel: 'none' },
  { key: 'jLK', anim: 'jkick', s: 6, a: 9, r: 4, dmg: 55, level: 'overhead', box: b(60, 200, 620, 460), hs: 18, bs: 12, push: 34, stop: 8, rank: 2, air: true, cancel: 'none' },
  { key: 'jHK', anim: 'jheavykick', s: 9, a: 6, r: 4, dmg: 86, level: 'overhead', box: b(40, 150, 760, 520), hs: 22, bs: 14, push: 44, stop: 11, rank: 4, air: true, cancel: 'none' },
  { key: 'fHP', anim: 'overhead', s: 18, a: 3, r: 18, dmg: 70, level: 'overhead', box: b(80, 900, 640, 700), hs: 22, bs: 12, push: 40, stop: 11, rank: 3, cancel: 'special', vx: [[4, 36], [16, 0]] },
  { key: 'THROW', anim: 'throw', s: 5, a: 2, r: 28, dmg: 120, level: 'unblockable', box: b(0, 400, 760, 1000), hs: 0, bs: 0, push: 0, stop: 0, rank: 9, cancel: 'none' },
];

function specialMove(id: number, def: SpecialDef): MoveDef {
  const s = def.spec;
  let active = s.active ?? 2;
  let box = b(100, 500, 620, 1000);
  let level = s.level ?? 'mid';
  switch (s.kind) {
    case 'rush': active = s.active ?? 16; box = b(60, 350, 640, 1150); break;
    case 'uppercut': active = s.active ?? 10; box = b(20, 650, 560, 1400); break;
    case 'slam': active = s.active ?? 8; box = b(0, 0, 720, 1100); break;
    case 'counter': case 'reflect': active = s.active ?? 30; box = b(0, 0, 0, 0); break;
    case 'grab': active = s.active ?? 3; box = b(0, 300, s.range ?? 800, 1200); level = 'unblockable'; break;
    default: box = b(0, 0, 0, 0);
  }
  return {
    id, key: 'SP_' + def.input, anim: def.anim, startup: s.startup, active, recovery: s.recovery,
    damage: s.damage, level, hitbox: box, hitstun: s.hitstun ?? 24, blockstun: 16, pushback: 60, hitstop: 11,
    knockdown: s.knockdown, launch: s.launch, cancel: 'none', chainRank: 9, invuln: s.invuln, special: def,
  };
}

const cache = new Map<number, MoveDef[]>();

export function movesFor(charIdx: number): MoveDef[] {
  const hit = cache.get(charIdx);
  if (hit) return hit;
  const f = ROSTER[charIdx];
  const reach = f.stats[3];
  const list: MoveDef[] = NORMALS.map((n, i) => ({
    id: i, key: n.key, anim: n.anim, startup: n.s, active: n.a, recovery: n.r, damage: n.dmg, level: n.level,
    hitbox: { ...n.box, w: n.box.w + (n.key === 'THROW' ? 0 : (reach - 3) * 60) },
    hitstun: n.hs, blockstun: n.bs, pushback: n.push, hitstop: n.stop, knockdown: n.kd, launch: n.launch,
    air: n.air, cancel: n.cancel ?? 'none', chainRank: n.rank, vx: n.vx, invuln: n.invuln, throw: n.key === 'THROW',
  }));
  f.specials.forEach((sp, i) => list.push(specialMove(MV.SP0 + i, sp)));
  list.push({
    id: MV.HYPE, key: 'HYPE', anim: 'hype', startup: 8, active: 12, recovery: 40, damage: 280, level: 'mid',
    hitbox: b(0, 0, 3400, 2200), hitstun: 60, blockstun: 30, pushback: 120, hitstop: 14, cancel: 'none', chainRank: 9,
    invuln: [0, 22], hype: true, knockdown: true,
  });
  // spartan kick (→ + light kick): big push, great for making space
  list.push({
    id: MV.fLK, key: 'fLK', anim: 'kickball', startup: 12, active: 4, recovery: 18, damage: 70, level: 'mid',
    hitbox: b(100, 650, 700 + (reach - 3) * 60, 520), hitstun: 20, blockstun: 14, pushback: 125, hitstop: 11, cancel: 'special', chainRank: 3,
    vx: [[4, 28], [11, 0]],
  });
  cache.set(charIdx, list);
  return list;
}

export function totalFrames(m: MoveDef): number {
  return m.startup + m.active + m.recovery;
}
