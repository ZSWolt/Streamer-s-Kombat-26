import * as THREE from 'three';
import { ROSTER } from '../data/roster';
import { movesFor } from '../sim/moves';
import type { FighterState } from '../sim/types';
import { St } from '../sim/types';
import * as P from './pose';
import { applyPose, buildRig, type RigParts } from './rig';

const YAW = Math.PI / 2 - 0.42;

export interface FighterVisual {
  root: THREE.Object3D;
  rig: RigParts;
  update(f: FighterState, prev: FighterState, alpha: number, dt: number): void;
  onHit(heavy: number, high: boolean): void;
  setOverride(pose: P.Pose | null): void;
  dispose(): void;
}

const tmp = new Float32Array(P.POSE_LEN);
const tmp2 = new Float32Array(P.POSE_LEN);

export class ProceduralFighterView implements FighterVisual {
  root: THREE.Group;
  rig: RigParts;
  private cur = new Float32Array(P.POSE_LEN);
  private from = new Float32Array(P.POSE_LEN);
  private key = '';
  private blendT = 1;
  private blendDur = 0.1;
  private time = 0;
  private hitHigh = true;
  private headAng = new THREE.Vector2();
  private headVel = new THREE.Vector2();
  private lastVx = 0;
  private blinkT = 2;
  private override: P.Pose | null = null;
  private flip = 0;
  private charIdx: number;
  shadow: THREE.Mesh;
  fx = { tint: new THREE.Color('#000000'), tintAmt: 0, squash: 1, shrink: 1, hidden: false, offsetY: 0, offsetX: 0, spin: 0 };
  private baseScale: number;
  private lastTint = -1;

  constructor(charIdx: number, skin = 0) {
    this.charIdx = charIdx;
    this.rig = buildRig(ROSTER[charIdx], skin);
    this.root = this.rig.root;
    this.baseScale = this.rig.body.scale.y;
    this.cur.set(P.GUARD);
    const tex = blobTexture();
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.55 }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 1;
  }

  setOverride(pose: P.Pose | null) { this.override = pose; }

  onHit(heavy: number, high: boolean) {
    this.hitHigh = high;
    this.headVel.x -= (0.8 + heavy * 0.9) * (high ? 1.4 : 0.6);
    this.headVel.y += (Math.random() - 0.5) * (1 + heavy);
  }

  private target(f: FighterState, t: number, out: P.Pose): string {
    const sf = f.stFrame;
    switch (f.st) {
      case St.Idle: case St.Intro: {
        out.set(P.GUARD);
        const b = Math.sin(t * 4.2);
        out[P.EX_HIPY] += b * 0.018;
        out[P.J.chest * 3] += Math.sin(t * 2.1) * 0.035;
        out[P.J.armL * 3] += b * 0.04;
        out[P.J.armR * 3] -= b * 0.04;
        out[P.J.head * 3 + 1] += Math.sin(t * 0.9) * 0.08;
        if (f.st === St.Intro) {
          P.lerpPose(P.GUARD, P.TAUNT, 0.5 + 0.5 * Math.sin(t * 3), out);
          return 'intro';
        }
        return 'idle';
      }
      case St.WalkF: case St.WalkB: {
        out.set(P.GUARD);
        const dir = f.st === St.WalkF ? 1 : -1;
        const ph = t * 8.5 * dir;
        const s = Math.sin(ph);
        out[P.J.thighL * 3] += s * 0.38;
        out[P.J.thighR * 3] -= s * 0.38;
        out[P.J.shinL * 3] += Math.max(0, -Math.cos(ph)) * 0.55;
        out[P.J.shinR * 3] += Math.max(0, Math.cos(ph)) * 0.55;
        out[P.EX_HIPY] += Math.abs(Math.cos(ph)) * 0.03 - 0.02;
        out[P.J.spine * 3] += dir * 0.06;
        out[P.J.spine * 3 + 1] += s * 0.06;
        return 'walk';
      }
      case St.Run: {
        out.set(P.GUARD);
        const ph = t * 15;
        const sn = Math.sin(ph);
        out[P.J.spine * 3] += 0.32;
        out[P.J.head * 3] -= 0.2;
        out[P.J.thighL * 3] += sn * 0.75 - 0.2;
        out[P.J.thighR * 3] -= sn * 0.75 + 0.2;
        out[P.J.shinL * 3] += Math.max(0, -Math.cos(ph)) * 1.2 + 0.2;
        out[P.J.shinR * 3] += Math.max(0, Math.cos(ph)) * 1.2 + 0.2;
        out[P.J.armL * 3] = -0.4 - sn * 0.7;
        out[P.J.armR * 3] = -0.4 + sn * 0.7;
        out[P.J.foreL * 3] = -1.6;
        out[P.J.foreR * 3] = -1.6;
        out[P.EX_HIPY] += Math.abs(Math.cos(ph)) * 0.05 - 0.05;
        return 'run';
      }
      case St.DashF: {
        const k = Math.min(1, sf / 4);
        P.lerpPose(P.GUARD, P.makePose({ spine: [0.45, 0.1, 0], head: [-0.2, 0, 0], thighL: [-1.1, 0, 0.1], shinL: [0.6, 0, 0], thighR: [0.9, 0, -0.1], shinR: [0.9, 0, 0], hy: -0.14 }, P.GUARD), k, out);
        return 'dashF';
      }
      case St.DashB: {
        P.lerpPose(P.GUARD, P.makePose({ spine: [-0.25, 0, 0], thighL: [-0.5, 0, 0.1], shinL: [1.2, 0, 0], thighR: [-0.3, 0, -0.1], shinR: [1.1, 0, 0], hy: 0.05 }, P.GUARD), Math.min(1, sf / 3), out);
        return 'dashB';
      }
      case St.Crouch: out.set(P.CROUCH); out[P.EX_HIPY] += Math.sin(t * 3) * 0.01; return 'crouch';
      case St.JumpSquat: P.lerpPose(P.GUARD, P.CROUCH, 0.5, out); return 'jsquat';
      case St.Air: {
        out.set(P.JUMP);
        if (f.jumpDir !== 0) {
          const prog = THREE.MathUtils.clamp(sf / 42, 0, 1);
          out[P.J.hips * 3] += f.jumpDir * P.ease.inOut(prog) * Math.PI * 2;
        } else {
          P.lerpPose(P.JUMP, P.GUARD, THREE.MathUtils.clamp(-f.vy / 120, 0, 0.6), out);
        }
        return 'air';
      }
      case St.Land: P.lerpPose(P.CROUCH, P.GUARD, Math.min(1, sf / 6), out); return 'land';
      case St.BlockStand: out.set(P.BLOCK); if (f.blockstun > 0) out[P.J.spine * 3] -= 0.08; return 'block';
      case St.BlockCrouch: out.set(P.BLOCK_CROUCH); return 'blockc';
      case St.Hitstun: {
        const base = f.crouched ? P.BLOCK_CROUCH : this.hitHigh ? P.HIT_HIGH : P.HIT_MID;
        const k = Math.min(1, f.hitstun / 10);
        P.lerpPose(P.GUARD, base, k, out);
        return 'hit';
      }
      case St.Stunned: case St.Dizzy: {
        out.set(P.DIZZY);
        out[P.J.spine * 3 + 2] += Math.sin(t * 3.2) * 0.14;
        out[P.J.head * 3 + 2] += Math.sin(t * 3.2 + 1) * 0.22;
        out[P.J.head * 3] += Math.cos(t * 3.2) * 0.12;
        out[P.EX_HIPY] += Math.sin(t * 6.4) * 0.02;
        return 'dizzy';
      }
      case St.AirHit: {
        out.set(P.AIR_HIT);
        out[P.J.hips * 3] -= Math.min(0.9, sf * 0.035);
        return 'airhit';
      }
      case St.Knockdown: case St.Ko:
        out.set(P.LYING);
        if (f.st === St.Ko) out[P.EX_EYES] = 0;
        return 'lying';
      case St.Getup: P.lerpPose(P.GETUP, P.GUARD, P.ease.inOut(Math.min(1, sf / 20)), out); return 'getup';
      case St.Throwing: {
        const a = P.ATTACKS.throw;
        if (sf < 8) P.lerpPose(P.GUARD, a.wind, P.ease.out(sf / 8), out);
        else if (sf < 26) P.lerpPose(a.wind, a.hit, P.ease.inOut((sf - 8) / 18), out);
        else P.lerpPose(a.hit, P.GUARD, (sf - 26) / 8, out);
        return 'throwing';
      }
      case St.Thrown: {
        P.lerpPose(P.HIT_MID, P.AIR_HIT, Math.min(1, sf / 20), out);
        return 'thrown';
      }
      case St.Win: {
        const alt = Math.floor(t * 1.2) % 2 === 0;
        P.lerpPose(alt ? P.WIN : P.WIN2, alt ? P.WIN2 : P.WIN, 0.5 + 0.5 * Math.sin(t * 5) * 0.2, out);
        out[P.EX_HIPY] += Math.abs(Math.sin(t * 5)) * 0.03;
        return 'win';
      }
      case St.Taunt: out.set(P.TAUNT); return 'taunt';
      case St.Cinematic: {
        out.set(P.GUARD);
        return 'cine';
      }
      case St.Attack: return this.attackPose(f, out);
    }
    out.set(P.GUARD);
    return 'idle';
  }

  private attackPose(f: FighterState, out: P.Pose): string {
    const mv = movesFor(f.char)[f.move];
    if (!mv) { out.set(P.GUARD); return 'idle'; }
    let animKey = mv.anim;
    if (mv.special && animKey === 'throw') animKey = 'toss';
    const a = P.ATTACKS[animKey] ?? P.ATTACKS.jab;
    const base = a.air ? P.JUMP : a.crouch ? P.CROUCH : P.GUARD;
    const fr = f.moveFrame;
    const s = Math.max(1, mv.startup);
    const act = mv.active;
    const rec = mv.recovery;
    const windEnd = Math.max(1, s * 0.62);
    if (fr < windEnd) P.lerpPose(base, a.wind, P.ease.out(fr / windEnd), out);
    else if (fr < s) P.lerpPose(a.wind, a.hit, P.ease.back(Math.min(1, (fr - windEnd) / (s - windEnd))), out);
    else if (fr < s + act) {
      if (a.follow) {
        const k = (fr - s) / Math.max(1, act);
        const cyc = mv.special?.spec.hits && mv.special.spec.hits > 1 ? (Math.sin(k * Math.PI * mv.special.spec.hits) * 0.5 + 0.5) : k;
        P.lerpPose(a.hit, a.follow, cyc, out);
      } else out.set(a.hit);
    } else {
      const k = Math.min(1, (fr - s - act) / Math.max(1, rec));
      const end = a.follow && !(mv.special?.spec.hits) ? a.follow : a.hit;
      P.lerpPose(end, base, P.ease.inOut(k), out);
    }
    if (mv.special?.spec.kind === 'rush' && (mv.anim === 'turtle' || mv.anim === 'roll') && fr >= s && fr < s + act) {
      out[P.J.hips * 3] += (fr - s) * 0.6;
    }
    return 'atk' + f.move + ':' + (f.moveHits > 0 ? 1 : 0);
  }

  update(f: FighterState, prev: FighterState, alpha: number, dt: number) {
    this.time += dt;
    const t = this.time;
    const key = this.override ? 'override' : this.target(f, t, tmp);
    if (this.override) tmp.set(this.override);
    if (key !== this.key) {
      const atk = key.startsWith('atk');
      const wasAtk = this.key.startsWith('atk');
      this.from.set(this.cur);
      this.blendT = 0;
      this.blendDur = atk ? (wasAtk ? 0.03 : 0.045) : key === 'hit' || key === 'airhit' ? 0.03 : key === 'lying' ? 0.12 : 0.1;
      this.key = key;
    }
    if (this.blendT < 1) {
      this.blendT = Math.min(1, this.blendT + dt / this.blendDur);
      P.lerpPose(this.from, tmp, P.ease.out(this.blendT), this.cur);
    } else {
      this.cur.set(tmp);
    }

    // blink
    this.blinkT -= dt;
    tmp2.set(this.cur);
    if (this.rig.wheelchair) {
      const down = this.key === 'lying' || this.key === 'airhit' || this.key === 'getup';
      for (const j of ['thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'] as const) {
        const i = P.J[j] * 3;
        tmp2[i] = P.SEATED[i]; tmp2[i + 1] = P.SEATED[i + 1]; tmp2[i + 2] = P.SEATED[i + 2];
      }
      tmp2[P.J.hips * 3] = 0; tmp2[P.J.hips * 3 + 1] = 0; tmp2[P.J.hips * 3 + 2] = 0;
      tmp2[P.EX_HIPY] = P.SEATED[P.EX_HIPY];
      tmp2[P.EX_HIPZ] = 0;
      if (down) { tmp2[P.J.spine * 3] = 0.75; tmp2[P.J.head * 3] = 0.45; tmp2[P.EX_EYES] = 0.1; }
      const vx = (f.x - prev.x) / 1000;
      for (const w of this.rig.wheels) w.rotation.x += (vx / 0.29) * f.facing;
    }
    if (this.blinkT < 0.12) tmp2[P.EX_EYES] = Math.min(tmp2[P.EX_EYES], Math.abs(this.blinkT - 0.06) / 0.06);
    if (this.blinkT < 0) this.blinkT = 2 + Math.random() * 3;
    applyPose(this.rig, tmp2);

    // placement
    const x = (prev.x + (f.x - prev.x) * alpha) / 1000;
    const y = (prev.y + (f.y - prev.y) * alpha) / 1000;
    const fx = this.fx;
    this.root.position.set(x + fx.offsetX, y + fx.offsetY, 0);
    this.root.rotation.y = (f.facing === 1 ? YAW : -YAW) + fx.spin;
    this.root.visible = !fx.hidden;
    this.shadow.visible = !fx.hidden;
    const bs = this.baseScale * fx.shrink;
    this.rig.body.scale.set((f.facing === 1 ? 1 : -1) * bs * (fx.squash < 1 ? 1 + (1 - fx.squash) * 0.6 : 1), bs * fx.squash, bs);
    if (fx.tintAmt !== this.lastTint) {
      this.lastTint = fx.tintAmt;
      for (const m of this.rig.materials) {
        const pm = m as THREE.MeshPhysicalMaterial;
        if (!pm.emissive) continue;
        if (pm.userData.baseEmissive === undefined) pm.userData.baseEmissive = pm.emissive.clone();
        pm.emissive.copy(pm.userData.baseEmissive).lerp(fx.tint, fx.tintAmt);
        if (pm.userData.baseColor === undefined) pm.userData.baseColor = pm.color.clone();
        pm.color.copy(pm.userData.baseColor).lerp(new THREE.Color('#111111'), fx.tint.getHex() === 0 ? fx.tintAmt * 0.9 : 0);
      }
    }
    this.shadow.position.set(x + fx.offsetX, 0.012, 0.05);
    const sh = Math.max(0.35, 1 - y * 0.35);
    this.shadow.scale.set(sh, sh, sh);

    // bobblehead spring
    const vx = (f.x - prev.x) / 1000;
    const acc = (vx - this.lastVx) / Math.max(dt, 1e-3);
    this.lastVx = vx;
    const k = 140, c = 9;
    this.headVel.x += (-k * this.headAng.x - c * this.headVel.x - acc * 0.02 * f.facing) * dt;
    this.headVel.y += (-k * this.headAng.y - c * this.headVel.y) * dt;
    this.headAng.x += this.headVel.x * dt;
    this.headAng.y += this.headVel.y * dt;
    this.headAng.x = THREE.MathUtils.clamp(this.headAng.x, -0.5, 0.5);
    this.headAng.y = THREE.MathUtils.clamp(this.headAng.y, -0.5, 0.5);
    this.rig.headBob.rotation.x = this.headAng.x;
    this.rig.headBob.rotation.z = this.headAng.y;
  }

  dispose() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.geometry.dispose(); }
    });
    for (const m of this.rig.materials) m.dispose();
  }
}

let blobTex: THREE.Texture | null = null;
function blobTexture() {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grd.addColorStop(0, 'rgba(0,0,0,0.9)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  blobTex = new THREE.CanvasTexture(c);
  return blobTex;
}
