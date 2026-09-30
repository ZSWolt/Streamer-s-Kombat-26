import { ROSTER } from '../data/roster';
import { FLAVOR } from '../data/flavor';
import * as C from './constants';
import { MV, movesFor, totalFrames } from './moves';
import { spawnSpecial, specialFrame, updateProjectiles } from './specials';
import type { FighterState, MatchConfig, MatchState, MoveDef } from './types';
import { St } from './types';
import {
  backBit, clamp, countPresses, emit, fwdBit, grounded, hurtbox, isCrouching, motion, newFighter, overlap,
  recentPress, rngNext, setState, sign, swapLR, worldBox,
} from './util';

export function createMatch(cfg: MatchConfig): MatchState {
  const m: MatchState = {
    frame: 0, cfg,
    phase: cfg.charIntro ? 'intro' : 'roundCall', phaseFrame: 0, round: 1,
    timer: cfg.roundTime > 0 ? cfg.roundTime * C.FPS : 0,
    f: [newFighter(cfg.chars[0], cfg.skins[0], 0), newFighter(cfg.chars[1], cfg.skins[1], 1)],
    proj: [], nextProjId: 1, rng: (cfg.seed | 0) || 0x1234567,
    winner: -1, roundWinner: -1, flawless: false, banality: false, banalityIdx: -1,
    superFreeze: 0, superOwner: -1, slowmo: 0, events: [],
  };
  if (cfg.charIntro) { m.f[0].st = St.Intro; m.f[1].st = St.Intro; }
  if (cfg.bossP2) m.f[1].hp = C.MAX_HP; // boss handled via stats in damage()
  return m;
}

export function cloneMatch(m: MatchState): MatchState {
  return {
    ...m,
    cfg: m.cfg,
    f: [cloneFighter(m.f[0]), cloneFighter(m.f[1])],
    proj: m.proj.map((p) => ({ ...p })),
    events: [],
  };
}

function cloneFighter(f: FighterState): FighterState {
  return { ...f, history: f.history.slice() };
}

/** Stable hash of the gameplay state, used for desync detection. */
export function hashMatch(m: MatchState): number {
  let h = 2166136261 >>> 0;
  const mix = (n: number) => { h ^= n | 0; h = Math.imul(h, 16777619) >>> 0; };
  mix(m.frame); mix(m.round); mix(m.timer); mix(m.rng); mix(m.phaseFrame);
  for (const f of m.f) {
    mix(f.x); mix(f.y); mix(f.vx); mix(f.vy); mix(f.hp); mix(f.meter); mix(f.st); mix(f.stFrame);
    mix(f.move); mix(f.moveFrame); mix(f.facing); mix(f.hitstun); mix(f.blockstun); mix(f.roundWins);
  }
  for (const p of m.proj) { mix(p.x); mix(p.y); mix(p.owner); mix(p.life); }
  return h >>> 0;
}

// ---------------------------------------------------------------- step

export function step(m: MatchState, inputs: [number, number]): void {
  m.frame++;
  m.events = [];
  for (let p = 0; p < 2; p++) {
    const f = m.f[p];
    f.history.push(inputs[p]);
    f.history.shift();
  }

  if (m.superFreeze > 0) {
    m.superFreeze--;
    finishInputs(m, inputs);
    return;
  }
  if (m.slowmo > 0) {
    m.slowmo--;
    if (m.slowmo % 2 === 1) { finishInputs(m, inputs); return; }
  }

  m.phaseFrame++;
  switch (m.phase) {
    case 'intro': stepIntro(m, inputs); break;
    case 'roundCall': stepRoundCall(m); break;
    case 'fight': case 'finish': stepFight(m, inputs); break;
    case 'ko': case 'timeOver': stepAfterKo(m); break;
    case 'banality': stepBanality(m); break;
    case 'roundEnd': stepRoundEnd(m); break;
    case 'matchEnd': stepPassive(m); break;
  }
  finishInputs(m, inputs);
}

function finishInputs(m: MatchState, inputs: [number, number]) {
  m.f[0].prevInput = inputs[0];
  m.f[1].prevInput = inputs[1];
}

function stepIntro(m: MatchState, inputs: [number, number]) {
  if (m.phaseFrame === 1) emit(m, { type: 'charIntro', p: 0 });
  if (m.phaseFrame === (C.CHAR_INTRO_FRAMES >> 1)) emit(m, { type: 'charIntro', p: 1 });
  const skip = ((inputs[0] | inputs[1]) & C.BUTTONS) !== 0 && m.phaseFrame > 20;
  if (m.phaseFrame >= C.CHAR_INTRO_FRAMES || skip) beginRound(m);
}

function beginRound(m: MatchState) {
  m.phase = 'roundCall';
  m.phaseFrame = 0;
  m.proj = [];
  m.timer = m.cfg.roundTime > 0 ? m.cfg.roundTime * C.FPS : 0;
  m.roundWinner = -1;
  for (let p = 0; p < 2; p++) {
    const f = m.f[p];
    const keep = { char: f.char, skin: f.skin, meter: f.meter, roundWins: f.roundWins, history: f.history };
    const nf = newFighter(f.char, f.skin, p as 0 | 1);
    Object.assign(f, nf, keep);
  }
}

function stepRoundCall(m: MatchState) {
  if (m.phaseFrame === 1) emit(m, { type: 'round', a: m.round, b: isFinalRound(m) ? 1 : 0 });
  if (m.phaseFrame === C.ROUND_INTRO_FRAMES) emit(m, { type: 'fight' });
  for (const f of m.f) { tickIdle(f); }
  if (m.phaseFrame >= C.ROUND_INTRO_FRAMES + 10) { m.phase = 'fight'; m.phaseFrame = 0; }
}

function isFinalRound(m: MatchState) {
  const need = m.cfg.roundsToWin - 1;
  return m.f[0].roundWins === need && m.f[1].roundWins === need;
}

function tickIdle(f: FighterState) {
  f.stFrame++;
}

function stepPassive(m: MatchState) {
  for (const f of m.f) {
    f.stFrame++;
    physics(m, f, true);
  }
}

// ---------------------------------------------------------------- fight

function stepFight(m: MatchState, inputs: [number, number]) {
  const fin = m.phase === 'finish';
  for (let p = 0; p < 2; p++) {
    const f = m.f[p];
    if (f.hitstop > 0) { f.hitstop--; bufferInput(f, inputs[p]); continue; }
    control(m, p, inputs[p]);
    advance(m, p);
  }
  for (let p = 0; p < 2; p++) if (m.f[p].hitstop <= 0) physics(m, m.f[p], false);
  resolveFacing(m);
  pushApart(m);
  updateProjectiles(m);
  resolveStrikes(m);
  cinematics(m);

  if (m.cfg.practice) practiceRefill(m);

  if (!fin && m.timer > 0 && !m.cfg.practice) {
    m.timer--;
    if (m.timer === 0) timeOver(m);
  }
  if (m.phase === 'fight') checkKo(m);
  if (m.phase === 'finish') stepFinish(m);
}

function bufferInput(f: FighterState, input: number) {
  const pressed = input & ~f.prevInput & C.BUTTONS;
  if (pressed) { f.buf |= pressed; f.bufT = 8; }
}

function practiceRefill(m: MatchState) {
  for (const f of m.f) {
    const busy = f.st === St.Hitstun || f.st === St.AirHit || f.st === St.Knockdown || f.st === St.Getup || f.st === St.Cinematic;
    if (busy) f.idleFrames = 0; else f.idleFrames++;
    if (f.idleFrames > 70 && f.hp < C.MAX_HP) { f.hp = C.MAX_HP; f.comboCount = 0; }
    if (f.hp <= 0) f.hp = 1;
  }
}

export function actionable(f: FighterState): boolean {
  switch (f.st) {
    case St.Idle: case St.WalkF: case St.WalkB: case St.Crouch: case St.Run: return true;
    case St.BlockStand: case St.BlockCrouch: return f.blockstun <= 0;
    case St.DashF: case St.DashB: return f.stFrame >= 7;
    case St.Land: return f.stFrame >= C.LAND_RECOVERY;
    default: return false;
  }
}

function pickMove(m: MatchState, f: FighterState, btn: number, inp: number, air: boolean): number {
  const down = (inp & C.IN_DOWN) !== 0;
  const fwd = (inp & fwdBit(f)) !== 0;
  if (air) {
    if (btn & C.IN_HK) return MV.jHK;
    if (btn & C.IN_HP) return MV.jHP;
    if (btn & C.IN_LK) return MV.jLK;
    if (btn & C.IN_LP) return MV.jLP;
    return -1;
  }
  // classic arcade motions: ↓↘→+LP, ↓↙←+HP, →↓↘+LK
  if (btn & C.IN_LP && motion(f, [2, 3, 6])) return MV.SP0;
  if (btn & C.IN_HP && motion(f, [2, 1, 4])) return MV.SP1;
  if (btn & C.IN_LK && motion(f, [6, 2, 3])) return MV.SP2;
  const throwCombo = ((btn & C.IN_LP) && (inp & C.IN_LK || recentPress(f, C.IN_LK, 3))) ||
    ((btn & C.IN_LK) && (inp & C.IN_LP || recentPress(f, C.IN_LP, 3)));
  if (throwCombo) return MV.THROW;
  if (btn & C.IN_SP) {
    if (inp & C.IN_BLOCK && f.meter >= C.MAX_METER) return MV.HYPE;
    if (down || recentPress(f, C.IN_DOWN, 8)) return MV.SP2;
    if (fwd || recentPress(f, fwdBit(f), 8)) return MV.SP1;
    return MV.SP0;
  }
  if (btn & C.IN_HK) return down ? MV.cHK : MV.HK;
  if (btn & C.IN_HP) return down ? MV.cHP : fwd ? MV.fHP : MV.HP;
  if (btn & C.IN_LK) return down ? MV.cLK : fwd ? MV.fLK : MV.LK;
  if (btn & C.IN_LP) return down ? MV.cLP : MV.LP;
  return -1;
}

function startMove(m: MatchState, p: number, id: number) {
  const f = m.f[p];
  const mv = movesFor(f.char)[id];
  setState(f, St.Attack);
  f.st = St.Attack;
  f.stFrame = 0;
  f.move = id;
  f.moveFrame = 0;
  f.moveHit = false;
  f.moveHits = 0;
  f.buf = 0; f.bufT = 0;
  if (!mv.air) f.vx = 0;
  if (mv.throw) f.throwTech = C.THROW_TECH_WINDOW;
  if (mv.hype) {
    f.meter = 0;
    m.superFreeze = 50;
    m.superOwner = p;
    emit(m, { type: 'hype', p, s: ROSTER[f.char].hype.vfx });
    const heal = ROSTER[f.char].hype.spec?.heal;
    if (heal) f.hp = Math.min(C.MAX_HP, f.hp + heal);
  } else if (mv.special) {
    emit(m, { type: 'special', p, s: mv.special.spec.vfx, a: id });
  } else {
    emit(m, { type: 'swing', p, s: mv.key, a: mv.damage });
  }
}

function control(m: MatchState, p: number, rawInput: number) {
  const f = m.f[p];
  const o = m.f[1 - p];
  let inp = rawInput;
  let prev = f.prevInput;
  if (f.status === 'reversed') { inp = swapLR(inp); prev = swapLR(prev); }
  const pressed = inp & ~prev;
  let btn = pressed & C.BUTTONS;
  if (btn) { f.buf |= btn; f.bufT = 6; }
  else if (f.bufT > 0) { f.bufT--; btn = f.buf; if (f.bufT === 0) f.buf = 0; }

  if (f.throwTech > 0) f.throwTech--;
  if (f.statusFrames > 0 && --f.statusFrames === 0) f.status = '';

  // FINISH: punch = banality 1, kick = banality 2, special = surprise
  if (m.phase === 'finish' && p === m.winner && btn && m.phaseFrame > 30 && grounded(f) &&
    (actionable(f) || f.st === St.Attack || f.st === St.Win)) {
    const idx = btn & (C.IN_LP | C.IN_HP) ? 0 : btn & (C.IN_LK | C.IN_HK) ? 1 : (rngNext(m) & 1);
    startBanality(m, p, idx);
    return;
  }

  const fb = fwdBit(f);
  const bb = backBit(f);

  // Cancels from an attack
  if (f.st === St.Attack && btn) {
    const cur = movesFor(f.char)[f.move];
    const window = f.moveFrame >= cur.startup && f.moveFrame <= cur.startup + cur.active + 10;
    if (f.moveHit && window && cur.cancel !== 'none') {
      const cand = pickMove(m, f, btn, inp, !grounded(f));
      if (cand >= 0) {
        const nm = movesFor(f.char)[cand];
        const isSp = !!nm.special || !!nm.hype;
        const chainOk = cur.cancel === 'chain' && !nm.air && !nm.throw && !isSp && nm.chainRank > cur.chainRank;
        if ((isSp && grounded(f)) || chainOk) { startMove(m, p, cand); return; }
      }
    }
    return;
  }

  // Air normals
  if (f.st === St.Air && btn && !f.airActionUsed) {
    const cand = pickMove(m, f, btn, inp, true);
    if (cand >= 0) { f.airActionUsed = true; startMove(m, p, cand); return; }
  }

  if (!actionable(f)) return;

  if (btn) {
    const cand = pickMove(m, f, btn, inp, false);
    if (cand >= 0) { startMove(m, p, cand); return; }
  }

  // Dash detection
  if (pressed & fb) {
    if (m.frame - f.dashTapFrame <= C.DASH_WINDOW && f.st !== St.DashF) {
      setState(f, St.DashF); f.dashTapFrame = -99; emit(m, { type: 'dash', p }); return;
    }
    f.dashTapFrame = m.frame;
  }
  if (pressed & bb) {
    if (m.frame - f.dashTapBack <= C.DASH_WINDOW && f.st !== St.DashB) {
      setState(f, St.DashB); f.dashTapBack = -99; emit(m, { type: 'dash', p, a: -1 }); return;
    }
    f.dashTapBack = m.frame;
  }
  if ((f.st === St.DashF || f.st === St.DashB) && f.stFrame < (f.st === St.DashF ? C.DASH_F_FRAMES : C.DASH_B_FRAMES)) return;

  if (inp & C.IN_UP) {
    f.jumpDir = inp & fb ? 1 : inp & bb ? -1 : 0;
    setState(f, St.JumpSquat);
    return;
  }
  if (inp & C.IN_BLOCK) {
    setState(f, inp & C.IN_DOWN ? St.BlockCrouch : St.BlockStand);
    return;
  }
  if (inp & C.IN_DOWN) { setState(f, St.Crouch); return; }
  if (inp & fb) { if (f.st !== St.Run) setState(f, St.WalkF); return; }
  if (inp & bb) { setState(f, St.WalkB); return; }
  setState(f, St.Idle);
}

function speedMul(f: FighterState): number {
  let s = 170 + 15 * ROSTER[f.char].stats[0];
  if (f.status === 'slow') s >>= 1;
  return s;
}

function advance(m: MatchState, p: number) {
  const f = m.f[p];
  f.stFrame++;
  if (f.invuln > 0) f.invuln--;
  if (f.counterFrames > 0) f.counterFrames--;
  if (f.reflectFrames > 0) f.reflectFrames--;

  switch (f.st) {
    case St.Idle: case St.Crouch: case St.BlockStand: case St.BlockCrouch:
      if (f.blockstun > 0) { f.blockstun--; f.vx = (f.vx * 13 / 16) | 0; }
      else f.vx = 0;
      if ((f.st === St.BlockStand || f.st === St.BlockCrouch) && f.blockstun <= 0 && !(f.history[f.history.length - 1] & C.IN_BLOCK)) setState(f, St.Idle);
      break;
    case St.WalkF: f.vx = ((C.WALK_F * speedMul(f)) / 200 | 0) * f.facing; break;
    case St.WalkB: f.vx = -((C.WALK_B * speedMul(f)) / 200 | 0) * f.facing; break;
    case St.DashF:
      f.vx = f.stFrame < C.DASH_F_FRAMES - 3 ? ((C.DASH_F_SPEED * speedMul(f)) / 200 | 0) * f.facing : (f.vx / 2) | 0;
      if (f.stFrame >= C.DASH_F_FRAMES) setState(f, f.history[f.history.length - 1] & fwdBit(f) ? St.Run : St.Idle);
      break;
    case St.Run:
      f.vx = ((C.RUN_SPEED * speedMul(f)) / 200 | 0) * f.facing;
      if (!(f.history[f.history.length - 1] & fwdBit(f))) setState(f, St.Idle);
      break;
    case St.DashB:
      f.vx = f.stFrame < C.DASH_B_FRAMES - 4 ? -C.DASH_B_SPEED * f.facing : (f.vx / 2) | 0;
      if (f.stFrame < 8) f.invuln = Math.max(f.invuln, 1);
      if (f.stFrame >= C.DASH_B_FRAMES) setState(f, St.Idle);
      break;
    case St.JumpSquat:
      f.vx = 0;
      if (f.stFrame >= C.JUMP_SQUAT) {
        setState(f, St.Air);
        f.vy = C.JUMP_VY;
        f.vx = f.jumpDir * C.JUMP_VX * f.facing;
        f.y = 1;
        f.airActionUsed = false;
        emit(m, { type: 'jump', p });
      }
      break;
    case St.Air:
      break;
    case St.Land:
      f.vx = 0;
      if (f.stFrame >= C.LAND_RECOVERY + 2) setState(f, St.Idle);
      break;
    case St.Attack: advanceAttack(m, p); break;
    case St.Hitstun:
      f.vx = (f.vx * 13 / 16) | 0;
      if (--f.hitstun <= 0) { setState(f, f.crouched ? St.Crouch : St.Idle); f.comboCount = 0; f.juggle = 0; f.crouched = false; }
      break;
    case St.Stunned:
      f.vx = 0;
      if (--f.hitstun <= 0) { setState(f, St.Idle); f.comboCount = 0; }
      break;
    case St.AirHit:
      break;
    case St.Knockdown:
      f.vx = (f.vx * 12 / 16) | 0;
      if (f.stFrame >= C.KNOCKDOWN_FRAMES) {
        if (f.hp <= 0) setState(f, St.Ko);
        else if (m.phase === 'finish' && p !== m.winner) { setState(f, St.Dizzy); }
        else { setState(f, St.Getup); f.invuln = C.GETUP_FRAMES + 4; emit(m, { type: 'getup', p }); }
        f.comboCount = 0; f.juggle = 0;
      }
      break;
    case St.Getup:
      if (f.stFrame >= C.GETUP_FRAMES) setState(f, St.Idle);
      break;
    case St.Throwing: {
      const o = m.f[1 - p];
      if (f.stFrame === 26) {
        const dmg = damage(m, f, o, f.pendingDamage || 120, 100);
        applyDamage(m, 1 - p, dmg);
        o.st = St.AirHit; o.stFrame = 0; o.vy = 70; o.vx = 40 * f.facing; o.y = 200;
        emit(m, { type: 'hit', p: 1 - p, a: dmg, x: o.x, y: 900, b: 2, s: 'throw' });
        f.pendingDamage = 0;
      }
      if (f.stFrame >= 34) setState(f, St.Idle);
      break;
    }
    case St.Thrown:
      f.vx = 0;
      break;
    default:
      break;
  }
}

function advanceAttack(m: MatchState, p: number) {
  const f = m.f[p];
  const mv = movesFor(f.char)[f.move];
  f.moveFrame++;
  const fr = f.moveFrame;
  if (mv.invuln && fr >= mv.invuln[0] && fr <= mv.invuln[1]) f.invuln = Math.max(f.invuln, 1);
  if (mv.vx) {
    let v = 0;
    for (const [fi, vx] of mv.vx) if (fr >= fi) v = vx;
    if (grounded(f)) f.vx = v * f.facing;
  } else if (!mv.air && !mv.special && grounded(f)) {
    f.vx = 0;
  }
  if (mv.special) specialFrame(m, p, mv, fr);
  if (mv.throw && fr === mv.startup) tryThrow(m, p);
  if (mv.hype && fr === 1) f.invuln = 30;

  const total = totalFrames(mv);
  if (mv.air) {
    if (grounded(f) && fr > 1) { setState(f, St.Land); f.move = -1; return; }
    if (fr > total) { f.st = St.Air; f.move = -1; }
    return;
  }
  if (fr > total && grounded(f)) {
    f.move = -1;
    f.armor = 0;
    setState(f, mv.key.startsWith('c') ? St.Crouch : St.Idle);
  }
}

function tryThrow(m: MatchState, p: number) {
  const f = m.f[p];
  const o = m.f[1 - p];
  const dx = Math.abs(o.x - f.x);
  const throwable = grounded(o) && o.invuln <= 0 && dx <= C.THROW_RANGE &&
    o.st !== St.Hitstun && o.st !== St.Knockdown && o.st !== St.Getup && o.st !== St.AirHit &&
    o.st !== St.Thrown && o.st !== St.Throwing && o.st !== St.Ko && o.st !== St.Cinematic &&
    !(o.st === St.BlockStand && o.blockstun > 0);
  if (!throwable) return;
  if (o.throwTech > 0 || (o.st === St.Attack && movesFor(o.char)[o.move]?.throw)) {
    // throw tech
    f.vx = -60 * f.facing; o.vx = -60 * o.facing;
    setState(f, St.Hitstun); f.hitstun = 16;
    setState(o, St.Hitstun); o.hitstun = 16;
    emit(m, { type: 'tech', p, x: (f.x + o.x) >> 1 });
    return;
  }
  setState(f, St.Throwing);
  setState(o, St.Thrown);
  o.facing = (-f.facing) as 1 | -1;
  o.x = f.x + f.facing * 420;
  f.pendingDamage = 120;
  emit(m, { type: 'throw', p });
}

function physics(m: MatchState, f: FighterState, passive: boolean) {
  const airborne = f.y > 0 || f.vy > 0;
  if (airborne) {
    f.vy -= f.st === St.AirHit ? C.GRAVITY + 1 : C.GRAVITY;
  }
  f.x += f.vx;
  f.y += f.vy;
  if (f.y <= 0 && airborne) {
    f.y = 0;
    f.vy = 0;
    land(m, f);
  } else if (f.y < 0) f.y = 0;
  f.x = clamp(f.x, -C.STAGE_HALF, C.STAGE_HALF);
}

function land(m: MatchState, f: FighterState) {
  const p = m.f.indexOf(f);
  switch (f.st) {
    case St.Air: setState(f, St.Land); f.vx = 0; emit(m, { type: 'land', p }); break;
    case St.Attack: {
      const mv = movesFor(f.char)[f.move];
      if (mv.air) { setState(f, St.Land); f.move = -1; f.vx = 0; }
      else if (mv.special && (mv.special.spec.kind === 'uppercut' || mv.special.spec.kind === 'slam')) {
        f.vx = 0;
        emit(m, { type: 'land', p, a: 1 });
      }
      break;
    }
    case St.AirHit:
      setState(f, St.Knockdown);
      emit(m, { type: 'knockdown', p, x: f.x });
      break;
    case St.Ko:
      emit(m, { type: 'knockdown', p, x: f.x });
      break;
    default:
      if (f.st !== St.Knockdown && f.st !== St.Thrown) setState(f, St.Land);
  }
}

function resolveFacing(m: MatchState) {
  const [a, b] = m.f;
  const canTurn = (f: FighterState) => grounded(f) && (actionable(f) || f.st === St.JumpSquat || f.st === St.Getup || f.st === St.Stunned || f.st === St.Dizzy);
  const dir = sign(b.x - a.x);
  if (dir !== 0) {
    if (canTurn(a)) a.facing = dir as 1 | -1;
    if (canTurn(b)) b.facing = (-dir) as 1 | -1;
  }
}

function pushApart(m: MatchState) {
  const [a, b] = m.f;
  // max separation (camera)
  const sep = b.x - a.x;
  if (Math.abs(sep) > C.MAX_SEPARATION) {
    const excess = Math.abs(sep) - C.MAX_SEPARATION;
    const s = sign(sep);
    // pull back whichever moved outward more
    if (Math.abs(a.vx) >= Math.abs(b.vx)) a.x += s * excess; else b.x -= s * excess;
  }
  const noPush = (f: FighterState) => f.st === St.Thrown || f.st === St.Throwing || f.st === St.Cinematic || f.st === St.Knockdown || f.st === St.Ko;
  if (noPush(a) || noPush(b)) return;
  const verticalOverlap = Math.abs(a.y - b.y) < 1300;
  const dx = b.x - a.x;
  const minD = C.PUSH_HALF * 2;
  if (verticalOverlap && Math.abs(dx) < minD) {
    const push = (minD - Math.abs(dx)) >> 1;
    const s = dx === 0 ? (a.facing === 1 ? 1 : -1) : sign(dx);
    a.x -= s * push;
    b.x += s * push;
    const wall = C.STAGE_HALF;
    if (a.x < -wall) { b.x += -wall - a.x; a.x = -wall; }
    if (a.x > wall) { b.x -= a.x - wall; a.x = wall; }
    if (b.x < -wall) { a.x += -wall - b.x; b.x = -wall; }
    if (b.x > wall) { a.x -= b.x - wall; b.x = wall; }
  }
}

// ---------------------------------------------------------------- combat

export function damage(m: MatchState, att: FighterState, def: FighterState, base: number, scale: number): number {
  const pw = ROSTER[att.char].stats[1];
  const df = ROSTER[def.char].stats[2];
  let d = (base * (170 + 15 * pw) * (230 - 15 * df) * scale) / (200 * 200 * 100);
  if (m.cfg.bossP2 && m.f[1] === att) d = (d * 125) / 100;
  if (m.cfg.bossP2 && m.f[1] === def) d = (d * 80) / 100;
  return Math.max(1, d | 0);
}

export function applyDamage(m: MatchState, target: number, dmg: number) {
  const f = m.f[target];
  f.hp = Math.max(0, f.hp - dmg);
  f.damageTaken += dmg;
  f.perfectRun = false;
  const a = m.f[1 - target];
  a.meter = Math.min(C.MAX_METER, a.meter + (dmg >> 1));
  f.meter = Math.min(C.MAX_METER, f.meter + (dmg >> 2));
}

function comboScale(count: number): number {
  return count <= 2 ? 100 : Math.max(30, 100 - (count - 2) * 10);
}

interface PendingHit { a: number; mv: MoveDef }

function resolveStrikes(m: MatchState) {
  const hits: PendingHit[] = [];
  for (let p = 0; p < 2; p++) {
    const f = m.f[p];
    if (f.st !== St.Attack || f.hitstop > 0) continue;
    const mv = movesFor(f.char)[f.move];
    if (mv.throw || mv.hitbox.w === 0) continue;
    const s = mv.special?.spec;
    const multi = s?.hits ?? 1;
    const fr = f.moveFrame;
    if (fr <= mv.startup || fr > mv.startup + mv.active) continue;
    if (f.moveHits >= multi) continue;
    if (f.moveHit && multi > 1) {
      const interval = Math.max(3, (mv.active / multi) | 0);
      if ((fr - mv.startup) < f.moveHits * interval) continue;
    } else if (f.moveHit) continue;
    if (s && s.kind === 'uppercut' && f.vy < -40) continue;
    const o = m.f[1 - p];
    const hb = hurtbox(o, o.st === St.Attack ? movesFor(o.char)[o.move]?.key : undefined);
    if (!hb) continue;
    if (!overlap(worldBox(f, mv.hitbox), hb)) continue;
    if (o.invuln > 0) continue;
    hits.push({ a: p, mv });
  }
  for (const h of hits) applyStrike(m, h.a, h.mv);
}

function isBlocking(m: MatchState, d: FighterState): { blocking: boolean; crouch: boolean } {
  const held = (d.history[d.history.length - 1] & C.IN_BLOCK) !== 0;
  const down = (d.history[d.history.length - 1] & C.IN_DOWN) !== 0;
  if (d.st === St.BlockStand || d.st === St.BlockCrouch) return { blocking: true, crouch: d.st === St.BlockCrouch };
  if (held && actionable(d) && grounded(d)) return { blocking: true, crouch: down };
  return { blocking: false, crouch: false };
}

export function applyStrike(m: MatchState, a: number, mv: MoveDef) {
  const att = m.f[a];
  const d = a === 0 ? 1 : 0;
  const def = m.f[d];
  att.moveHit = true;
  att.moveHits++;

  // Counter stance
  if (def.counterFrames > 0 && def.st === St.Attack) {
    const cmv = movesFor(def.char)[def.move];
    const cs = cmv.special?.spec;
    if (cs && cs.kind === 'counter') {
      def.counterFrames = 0;
      def.moveFrame = cmv.startup + cmv.active; // jump to recovery
      const dmg = damage(m, def, att, cs.damage, 100);
      applyDamage(m, a, dmg);
      att.move = -1;
      launch(att, cs.knockdown ? [-30 * att.facing * -1, 90] : null);
      if (!cs.knockdown) { setState(att, St.Hitstun); att.hitstun = cs.hitstun ?? 26; }
      att.hitstop = 14; def.hitstop = 14;
      emit(m, { type: 'counter', p: d, a: dmg, x: att.x, y: 1100, s: cs.vfx });
      return;
    }
  }

  // Armor
  if (def.armor > 0 && !mv.hype) {
    def.armor--;
    const dmg = damage(m, att, def, mv.damage >> 1, 100);
    applyDamage(m, d, dmg);
    att.hitstop = mv.hitstop; def.hitstop = mv.hitstop;
    emit(m, { type: 'armor', p: d, a: dmg, x: def.x, y: 1100 });
    return;
  }

  const blk = isBlocking(m, def);
  const lvl = mv.level;
  const canBlock = lvl !== 'unblockable' &&
    ((blk.blocking && !blk.crouch && lvl !== 'low') || (blk.blocking && blk.crouch && lvl !== 'overhead'));
  const hitY = att.y + mv.hitbox.y + (mv.hitbox.h >> 1);
  const hitX = def.x - def.facing * 120;

  if (canBlock) {
    setState(def, blk.crouch ? St.BlockCrouch : St.BlockStand);
    def.blockstun = mv.blockstun;
    def.vx = -mv.pushback * def.facing;
    def.wasBlocking = true;
    if (mv.special || mv.hype) {
      const chip = Math.max(1, (mv.damage / 8) | 0);
      def.hp = Math.max(1, def.hp - chip);
    }
    att.meter = Math.min(C.MAX_METER, att.meter + 8);
    def.meter = Math.min(C.MAX_METER, def.meter + 12);
    att.hitstop = mv.hitstop - 2; def.hitstop = mv.hitstop - 2;
    wallPush(att, def, mv.pushback);
    emit(m, { type: 'block', p: d, x: hitX, y: hitY, b: mv.damage >= 90 ? 2 : mv.damage >= 55 ? 1 : 0 });
    return;
  }

  const inCombo = def.st === St.Hitstun || def.st === St.AirHit || def.st === St.Stunned || def.st === St.Dizzy;
  def.comboCount = inCombo ? def.comboCount + 1 : 1;
  if (!inCombo) def.comboDamage = 0;
  const base = mv.hype ? 280 : mv.damage;
  const dmg = damage(m, att, def, base, mv.hype ? 100 : comboScale(def.comboCount));
  def.comboDamage += dmg;
  const heavy = mv.damage >= 90 ? 2 : mv.damage >= 55 ? 1 : 0;

  if (mv.hype) {
    // cinematic super
    setState(att, St.Cinematic); setState(def, St.Cinematic);
    const kind = ROSTER[att.char].hype.vfx;
    att.cinematicKind = kind; def.cinematicKind = kind;
    att.cinematicFrames = 140; def.cinematicFrames = 140;
    def.pendingDamage = dmg;
    att.vx = 0; def.vx = 0;
    emit(m, { type: 'hypeHit', p: a, s: kind, x: def.x, y: 1000 });
    return;
  }

  applyDamage(m, d, dmg);
  att.hitstop = mv.hitstop; def.hitstop = mv.hitstop;
  def.crouched = isCrouching(def, def.st === St.Attack ? movesFor(def.char)[def.move]?.key : undefined);
  if (def.st === St.Attack) { def.move = -1; def.counterFrames = 0; def.reflectFrames = 0; def.armor = 0; }
  def.lastHitFrame = m.frame;
  def.wasBlocking = false;

  const airborne = !grounded(def) || def.st === St.AirHit;
  if (mv.launch) {
    launch(def, [mv.launch[0] * att.facing, mv.launch[1] - def.juggle * 20]);
  } else if (airborne) {
    def.juggle++;
    launch(def, [30 * att.facing, Math.max(30, 80 - def.juggle * 15)]);
  } else if (mv.knockdown) {
    launch(def, [45 * att.facing, 70]);
  } else if (def.st === St.Dizzy) {
    launch(def, [40 * att.facing, 80]);
  } else {
    setState(def, St.Hitstun);
    def.st = St.Hitstun;
    def.hitstun = mv.hitstun;
    def.vx = mv.pushback * att.facing;
    wallPush(att, def, mv.pushback);
  }
  emit(m, { type: 'hit', p: d, a: dmg, x: hitX, y: hitY, b: heavy, s: mv.key });
  if (def.comboCount >= 2) emit(m, { type: 'combo', p: a, a: def.comboCount, b: def.comboDamage });
}

function launch(f: FighterState, v: [number, number] | null) {
  setState(f, St.AirHit);
  f.st = St.AirHit;
  f.stFrame = 0;
  if (v) { f.vx = v[0]; f.vy = v[1]; }
  else { f.vx = 0; f.vy = 60; }
  if (f.y <= 0) f.y = 1;
}

function wallPush(att: FighterState, def: FighterState, push: number) {
  if (Math.abs(def.x) >= C.STAGE_HALF - 40 && grounded(att)) att.vx = -((push * 3) >> 2) * att.facing;
}

function cinematics(m: MatchState) {
  const [a, b] = m.f;
  if (a.st !== St.Cinematic && b.st !== St.Cinematic) return;
  for (let p = 0; p < 2; p++) {
    const f = m.f[p];
    if (f.st !== St.Cinematic || m.phase === 'banality') continue;
    if (--f.cinematicFrames <= 0) {
      if (f.pendingDamage > 0) {
        applyDamage(m, p, f.pendingDamage);
        emit(m, { type: 'hit', p, a: f.pendingDamage, x: f.x, y: 1000, b: 3, s: 'hype' });
        f.pendingDamage = 0;
        launch(f, [-40 * f.facing, 110]);
      } else {
        setState(f, St.Idle);
        f.move = -1;
      }
    }
  }
}

// ---------------------------------------------------------------- round flow

function checkKo(m: MatchState) {
  const [a, b] = m.f;
  if (a.hp > 0 && b.hp > 0) return;
  if (a.st === St.Cinematic || b.st === St.Cinematic) return;
  let w: 0 | 1 | 2;
  if (a.hp <= 0 && b.hp <= 0) w = 2;
  else w = a.hp <= 0 ? 1 : 0;
  m.roundWinner = w;
  if (w !== 2) {
    const winner = m.f[w];
    const loser = m.f[1 - w];
    m.flawless = winner.hp >= C.MAX_HP;
    if (winner.roundWins + 1 >= m.cfg.roundsToWin) {
      // finish him
      m.phase = 'finish';
      m.phaseFrame = 0;
      m.winner = w;
      winner.roundWins++;
      loser.hp = 0;
      if (grounded(loser) && loser.st !== St.AirHit && loser.st !== St.Knockdown) setState(loser, St.Dizzy);
      emit(m, { type: 'finish', p: 1 - w, a: ROSTER[loser.char].female ? 1 : 0 });
      m.slowmo = 30;
      return;
    }
  }
  m.phase = 'ko';
  m.phaseFrame = 0;
  m.slowmo = 60;
  if (w === 2) { emit(m, { type: 'ko', p: -1 }); return; }
  m.f[w].roundWins++;
  const loser = m.f[1 - w];
  if (loser.st !== St.AirHit) launch(loser, [-30 * loser.facing, 80]);
  loser.st = St.AirHit;
  emit(m, { type: 'ko', p: 1 - w, b: m.flawless ? 1 : 0 });
}

function stepFinish(m: MatchState) {
  const loser = m.f[1 - (m.winner as number)];
  if (loser.st === St.Dizzy && loser.hp <= 0 && loser.stFrame > C.DIZZY_FRAMES) {
    endFinish(m, false);
    return;
  }
  // Any hit on the dizzy loser finishes the match
  if (loser.st === St.AirHit || loser.st === St.Hitstun || loser.st === St.Knockdown) {
    if (m.phaseFrame > 5) {
      if (loser.st !== St.AirHit && loser.st !== St.Knockdown) launch(loser, [-30 * loser.facing, 80]);
      endFinish(m, false);
    }
  }
}

function endFinish(m: MatchState, banality: boolean) {
  const w = m.winner as 0 | 1;
  const loser = m.f[1 - w];
  m.banality = banality;
  m.phase = 'ko';
  m.phaseFrame = 0;
  m.slowmo = 40;
  if (!banality && loser.st !== St.AirHit && loser.st !== St.Knockdown) launch(loser, [-30 * loser.facing, 80]);
  loser.st = banality ? St.Ko : loser.st === St.Knockdown ? St.Ko : St.AirHit;
  emit(m, { type: 'ko', p: 1 - w, a: 1, b: m.flawless ? 1 : 0 });
}

function startBanality(m: MatchState, p: number, idx: number) {
  const f = m.f[p];
  const o = m.f[1 - p];
  m.phase = 'banality';
  m.phaseFrame = 0;
  m.banalityIdx = idx;
  const key = FLAVOR[ROSTER[f.char].id]?.banalities[idx]?.key ?? 'generic';
  setState(f, St.Cinematic); setState(o, St.Cinematic);
  f.cinematicKind = key; o.cinematicKind = key;
  f.vx = 0; o.vx = 0; f.move = -1;
  o.x = f.x + f.facing * 900;
  o.facing = (-f.facing) as 1 | -1;
  m.proj = [];
  emit(m, { type: 'banality', p, s: key, a: idx });
}

function stepBanality(m: MatchState) {
  for (const f of m.f) f.stFrame++;
  if (m.phaseFrame >= C.BANALITY_FRAMES) {
    const w = m.winner as 0 | 1;
    setState(m.f[1 - w], St.Ko);
    setState(m.f[w], St.Win);
    m.banality = true;
    m.phase = 'roundEnd';
    m.phaseFrame = 0;
    emit(m, { type: 'banalityEnd', p: w, a: m.banalityIdx, s: FLAVOR[ROSTER[m.f[w].char].id]?.banalities[m.banalityIdx]?.en ?? '' });
  }
}

function timeOver(m: MatchState) {
  const [a, b] = m.f;
  emit(m, { type: 'timeOver' });
  if (a.hp === b.hp) { m.roundWinner = 2; }
  else {
    const w = a.hp > b.hp ? 0 : 1;
    m.roundWinner = w;
    m.f[w].roundWins++;
    if (m.f[w].roundWins >= m.cfg.roundsToWin) m.winner = w;
  }
  m.phase = 'timeOver';
  m.phaseFrame = 0;
}

function stepAfterKo(m: MatchState) {
  for (let p = 0; p < 2; p++) {
    const f = m.f[p];
    f.stFrame++;
    if (f.st === St.Attack) advance(m, p);
    physics(m, f, true);
    if (f.st === St.Knockdown && f.hp <= 0) setState(f, St.Ko);
    if (f.st === St.Hitstun || f.st === St.BlockStand || f.st === St.BlockCrouch) { f.hitstun = 0; f.blockstun = 0; setState(f, St.Idle); }
  }
  updateProjectiles(m);
  if (m.phaseFrame === 70) {
    const w = m.roundWinner;
    if (w === 0 || w === 1) {
      const wf = m.f[w];
      if (grounded(wf)) { setState(wf, St.Win); wf.vx = 0; wf.move = -1; }
      const matchOver = wf.roundWins >= m.cfg.roundsToWin || m.winner === w;
      emit(m, { type: 'roundWin', p: w, a: matchOver ? 1 : 0, b: m.flawless ? 1 : 0 });
      if (m.flawless) emit(m, { type: 'perfect', p: w });
    }
  }
  if (m.phaseFrame >= C.KO_FRAMES) {
    m.phase = 'roundEnd';
    m.phaseFrame = 0;
  }
}

function stepRoundEnd(m: MatchState) {
  for (const f of m.f) { f.stFrame++; physics(m, f, true); }
  if (m.phaseFrame === 1 && m.roundWinner === -1 && m.winner >= 0) m.roundWinner = m.winner;
  if (m.cfg.practice && m.phaseFrame >= 60) {
    // practice never ends: reset and keep training
    m.winner = -1; m.banality = false; m.banalityIdx = -1;
    m.f[0].roundWins = 0; m.f[1].roundWins = 0;
    beginRound(m);
    m.phase = 'fight';
    return;
  }
  if (m.phaseFrame >= C.ROUND_END_FRAMES) {
    const w0 = m.f[0].roundWins >= m.cfg.roundsToWin;
    const w1 = m.f[1].roundWins >= m.cfg.roundsToWin;
    if (w0 || w1 || m.winner >= 0) {
      if (m.winner < 0) m.winner = w0 ? 0 : 1;
      m.phase = 'matchEnd';
      m.phaseFrame = 0;
      emit(m, { type: 'matchEnd', p: m.winner as number, a: m.banality ? 1 : 0 });
    } else {
      m.round++;
      if (m.round > 9) { m.winner = 2; m.phase = 'matchEnd'; return; }
      beginRound(m);
    }
  }
}

export { MV };
