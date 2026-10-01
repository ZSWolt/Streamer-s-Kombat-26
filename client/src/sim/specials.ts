import * as C from './constants';
import { applyDamage, damage } from './match';
import type { MatchState, MoveDef, Projectile, SpecialSpec } from './types';
import { St } from './types';
import { clamp, emit, grounded, hurtbox, overlap, rngRange, setState, sign } from './util';

/** Called every frame of a special move (fr = 1-based frame index) */
export function specialFrame(m: MatchState, p: number, mv: MoveDef, fr: number) {
  const f = m.f[p];
  const o = m.f[1 - p];
  const s = mv.special!.spec;
  const at = fr === s.startup;
  switch (s.kind) {
    case 'projectile': case 'summon': case 'trap': case 'drop':
      if (at) spawnSpecial(m, p, s);
      break;
    case 'rush':
      if (at && s.armor) f.armor = s.armor;
      if (fr > s.startup && fr <= s.startup + (s.active ?? 16)) f.vx = (s.speed ?? 100) * f.facing;
      else if (fr > s.startup + (s.active ?? 16)) { f.vx = (f.vx * 3) >> 2; f.armor = 0; }
      break;
    case 'uppercut':
      if (at) { f.vy = 118; f.vx = 16 * f.facing; f.y = 1; }
      break;
    case 'slam':
      if (at) { f.vy = 92; f.vx = (s.speed ?? 50) * f.facing; f.y = 1; }
      break;
    case 'counter':
      if (at) f.counterFrames = s.active ?? 30;
      break;
    case 'reflect':
      if (at) { f.reflectFrames = s.active ?? 30; emit(m, { type: 'reflectOn', p }); }
      break;
    case 'heal':
      if (at) f.hp = Math.min(C.MAX_HP, f.hp + (s.heal ?? 80));
      break;
    case 'teleport':
      if (fr < s.startup) f.invuln = Math.max(f.invuln, 2);
      if (at) {
        const dir = sign(o.x - f.x) || f.facing;
        let nx = o.x + dir * 650;
        if (Math.abs(nx) > C.STAGE_HALF - 100) nx = o.x - dir * 650;
        const from = f.x;
        f.x = clamp(nx, -C.STAGE_HALF, C.STAGE_HALF);
        f.facing = (sign(o.x - f.x) || f.facing) as 1 | -1;
        emit(m, { type: 'teleport', p, x: from, a: f.x, s: s.vfx });
      }
      break;
    case 'swap':
      if (at && grounded(o) && o.st !== St.Knockdown && o.st !== St.Ko) {
        const t = f.x; f.x = o.x; o.x = t;
        f.facing = (sign(o.x - f.x) || 1) as 1 | -1;
        if (o.st !== St.Attack) o.facing = (-f.facing) as 1 | -1;
        emit(m, { type: 'swap', p, x: f.x, a: o.x, s: s.vfx });
      }
      break;
    case 'grab':
      if (at) {
        const dx = Math.abs(o.x - f.x);
        const ok = grounded(o) && o.invuln <= 0 && dx <= (s.range ?? 850) &&
          o.st !== St.Knockdown && o.st !== St.Getup && o.st !== St.AirHit && o.st !== St.Ko && o.st !== St.Cinematic;
        if (ok) {
          setState(f, St.Throwing); setState(o, St.Thrown);
          f.pendingDamage = s.damage;
          o.x = f.x + f.facing * (C.PUSH_HALF * 2 - 80);
          o.facing = (-f.facing) as 1 | -1;
          emit(m, { type: 'grab', p, s: s.vfx });
        }
      }
      break;
  }
}

export function spawnSpecial(m: MatchState, p: number, s: SpecialSpec) {
  const f = m.f[p];
  const o = m.f[1 - p];
  const [w, h] = s.size ?? [360, 360];
  const base = (): Projectile => ({
    id: m.nextProjId++, owner: p as 0 | 1, x: f.x + f.facing * 480, y: 1150, vx: (s.speed ?? 70) * f.facing, vy: s.vy ?? 0,
    w, h, gravity: s.gravity ?? 0, life: s.life ?? 120, age: 0, damage: s.damage, hitstun: s.hitstun ?? 22,
    level: s.level ?? 'mid', knockdown: !!s.knockdown, boomerang: !!s.boomerang, pierce: !!s.pierce,
    status: s.status ?? '', statusFrames: s.statusFrames ?? 0, stun: s.stun ?? 0, vfx: s.vfx,
    hitsLeft: s.hits ?? 1, kind: 'shot', reflected: false, dead: false, cool: 0,
  });
  switch (s.kind) {
    case 'projectile': {
      const n = s.count ?? 1;
      for (let k = 0; k < n; k++) {
        const pr = base();
        pr.vy = (s.vy ?? 0) + (((2 * k - (n - 1)) * (s.spread ?? 0)) >> 2);
        if (pr.level === 'low') pr.y = h >> 1;
        if (s.randomDamage) pr.damage = rngRange(m, 1, 6) * ((s.randomDamage[1] / 6) | 0);
        if (s.randomDamage) pr.vfx = s.vfx + ':' + ((pr.damage / ((s.randomDamage[1] / 6) | 0)) | 0);
        if (s.vy) pr.y = 1300;
        m.proj.push(pr);
        emit(m, { type: 'proj', p, a: pr.id, s: pr.vfx });
      }
      break;
    }
    case 'summon': {
      const pr = base();
      pr.kind = 'summon';
      pr.x = f.x - f.facing * 700;
      pr.y = h >> 1;
      pr.pierce = true;
      m.proj.push(pr);
      emit(m, { type: 'proj', p, a: pr.id, s: pr.vfx });
      break;
    }
    case 'trap': {
      const pr = base();
      pr.kind = 'trap';
      pr.vx = 0;
      pr.x = f.x + f.facing * (s.range ?? 0);
      pr.y = h >> 1;
      m.proj.push(pr);
      emit(m, { type: 'proj', p, a: pr.id, s: pr.vfx });
      break;
    }
    case 'drop': {
      const pr = base();
      pr.kind = 'drop';
      pr.x = o.x;
      pr.y = 3800;
      pr.vx = 0;
      pr.vy = -30;
      pr.gravity = 4;
      pr.life = 200;
      if (s.chance !== undefined && rngRange(m, 0, 99) >= s.chance) {
        pr.damage = 0;
        pr.vfx = s.vfx + ':miss';
      }
      m.proj.push(pr);
      emit(m, { type: 'proj', p, a: pr.id, s: pr.vfx });
      break;
    }
  }
}

export function updateProjectiles(m: MatchState) {
  for (const pr of m.proj) {
    if (pr.dead) continue;
    pr.age++;
    if (pr.boomerang && pr.age === (pr.life >> 1)) { pr.vx = -pr.vx; emit(m, { type: 'boomerang', a: pr.id }); }
    pr.vy -= pr.gravity;
    pr.x += pr.vx;
    pr.y += pr.vy;
    if (pr.kind === 'shot' && pr.gravity > 0 && pr.y <= pr.h >> 1) { pr.dead = true; emit(m, { type: 'projDie', a: pr.id, x: pr.x, y: 200, s: pr.vfx }); continue; }
    if (pr.kind === 'drop' && pr.y <= pr.h >> 1) { pr.dead = true; emit(m, { type: 'projDie', a: pr.id, x: pr.x, y: 0, s: pr.vfx }); continue; }
    if (--pr.life <= 0 || Math.abs(pr.x) > C.STAGE_HALF + 1500) { pr.dead = true; emit(m, { type: 'projDie', a: pr.id, x: pr.x, y: pr.y, s: pr.vfx, b: 1 }); continue; }
    if (pr.boomerang && pr.age > (pr.life >> 1)) {
      const owner = m.f[pr.owner];
      if (Math.abs(owner.x - pr.x) < 300) { pr.dead = true; emit(m, { type: 'projDie', a: pr.id, x: pr.x, y: pr.y, s: pr.vfx, b: 1 }); continue; }
    }
  }
  // projectile clashes
  for (let i = 0; i < m.proj.length; i++) {
    const a = m.proj[i];
    if (a.dead || a.kind !== 'shot') continue;
    for (let j = i + 1; j < m.proj.length; j++) {
      const b = m.proj[j];
      if (b.dead || b.kind !== 'shot' || b.owner === a.owner) continue;
      if (overlap(box(a), box(b))) {
        a.dead = true; b.dead = true;
        emit(m, { type: 'clash', x: (a.x + b.x) >> 1, y: (a.y + b.y) >> 1 });
      }
    }
  }
  // hits
  for (const pr of m.proj) {
    if (pr.dead || (pr.damage <= 0 && pr.kind !== 'drop')) continue;
    if (pr.cool > 0) { pr.cool--; continue; }
    const t = 1 - pr.owner;
    const d = m.f[t];
    if (m.phase !== 'fight' && m.phase !== 'finish') continue;
    const hb = hurtbox(d);
    if (!hb || d.invuln > 0) continue;
    if (pr.kind === 'drop' && pr.y > 2100) continue;
    if (pr.kind === 'trap' && !grounded(d)) continue;
    if (!overlap(box(pr), hb)) continue;
    if (pr.damage <= 0) { pr.dead = true; emit(m, { type: 'projDie', a: pr.id, x: pr.x, y: pr.y, s: pr.vfx }); continue; }
    // reflect
    if (d.reflectFrames > 0 && pr.kind === 'shot') {
      pr.owner = t as 0 | 1;
      pr.vx = -pr.vx + sign(-pr.vx) * 20;
      pr.reflected = true;
      pr.life = 120;
      pr.boomerang = false;
      emit(m, { type: 'reflect', p: t, x: pr.x, y: pr.y, a: pr.id });
      continue;
    }
    projHit(m, pr, t);
  }
  m.proj = m.proj.filter((p) => !p.dead);
}

function box(pr: Projectile) {
  return { x: pr.x - (pr.w >> 1), y: pr.y - (pr.h >> 1), w: pr.w, h: pr.h };
}

function projHit(m: MatchState, pr: Projectile, t: number) {
  const d = m.f[t];
  const att = m.f[pr.owner];
  const held = (d.history[d.history.length - 1] & C.IN_BLOCK) !== 0;
  const down = (d.history[d.history.length - 1] & C.IN_DOWN) !== 0;
  const blocking = (d.st === St.BlockStand || d.st === St.BlockCrouch) ||
    (held && grounded(d) && (d.st === St.Idle || d.st === St.WalkF || d.st === St.WalkB || d.st === St.Crouch));
  const crouch = d.st === St.BlockCrouch || (blocking && down);
  const canBlock = blocking && !(pr.level === 'low' && !crouch) && !(pr.level === 'overhead' && crouch) && pr.kind !== 'drop';
  const dir = sign(pr.vx) || att.facing;
  const baseDamage = pr.damage;
  if (pr.kind === 'summon') pr.damage = 0;
  else if (--pr.hitsLeft <= 0) pr.dead = true;
  else pr.cool = 12;

  if (canBlock) {
    setState(d, crouch ? St.BlockCrouch : St.BlockStand);
    d.blockstun = 14;
    d.vx = 30 * dir;
    d.hp = Math.max(1, d.hp - Math.max(1, (baseDamage / 8) | 0));
    d.hitstop = 6;
    emit(m, { type: 'block', p: t, x: d.x, y: pr.y, b: 1, s: pr.vfx });
    return;
  }
  const inCombo = d.st === St.Hitstun || d.st === St.AirHit || d.st === St.Stunned;
  d.comboCount = inCombo ? d.comboCount + 1 : 1;
  if (!inCombo) d.comboDamage = 0;
  const scale = d.comboCount <= 2 ? 100 : Math.max(30, 100 - (d.comboCount - 2) * 10);
  const dmg = damage(m, att, d, baseDamage, scale);
  d.comboDamage += dmg;
  applyDamage(m, t, dmg);
  if (d.st === St.Attack) { d.move = -1; d.counterFrames = 0; d.armor = 0; }
  d.hitstop = 8;
  if (pr.status) { d.status = pr.status; d.statusFrames = pr.statusFrames; emit(m, { type: 'status', p: t, s: pr.status }); }
  if (pr.knockdown || !grounded(d)) {
    setState(d, St.AirHit); d.st = St.AirHit; d.vx = 40 * dir; d.vy = 75; if (d.y <= 0) d.y = 1;
  } else if (pr.stun) {
    setState(d, St.Stunned); d.st = St.Stunned; d.hitstun = pr.stun; d.vx = 0;
    emit(m, { type: 'stun', p: t, a: pr.stun });
  } else {
    setState(d, St.Hitstun); d.st = St.Hitstun; d.hitstun = pr.hitstun; d.vx = 36 * dir;
  }
  emit(m, { type: 'hit', p: t, a: dmg, x: d.x, y: Math.min(pr.y, 1400), b: baseDamage >= 90 ? 2 : 1, s: 'proj:' + pr.vfx });
  if (d.comboCount >= 2) emit(m, { type: 'combo', p: pr.owner, a: d.comboCount, b: d.comboDamage });
}
