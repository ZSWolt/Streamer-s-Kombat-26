import * as THREE from 'three';
import { J } from './pose';

// A cape on a real model (tools/models/rig.py rig_cape): a cloth of rows x columns of points, each carrying a bone
// that the cape's vertices follow. The top row is fastened to the body where the cape lies on it; every point below
// hangs from it: it keeps its distance to its neighbours, falls under gravity, lags behind when the fighter moves
// (the points keep their place in the world while the body moves under them), and is pushed out of the trunk, the
// limbs and the floor. Each point's bone is placed at the point and turned the way the cloth around it is turned,
// so the cape's folds go with it.

export interface SkCape {
  rows: number;
  cols: number;
  bones: string[];
  /** how firmly each point is held to its place on the body: 1 = fastened, 0 = free */
  hold: number[];
  /** the body bones each point's place moves with, and how much */
  anchor: [string, number][][];
}

/**
 * A collider: the bone from joint `a` to joint `b` (or on past b by `on` of its length), `r` = radius key in
 * skrig.radii. The trunk pushes the cloth straight out of itself (it lies on the back and wraps the sides); a limb
 * only ever pushes it backwards: a leg kicking up out of the cape behind it, or an arm swinging forward, must not
 * carry the cape up over the head.
 */
const TRUNK_COLLIDERS = 2;
const COLLIDERS: { a: number; b: number; r: string; k?: number; on?: number }[] = [
  { a: J.hips, b: J.chest, r: 'trunk' }, { a: J.chest, b: J.neck, r: 'trunk' },
  { a: J.thighL, b: J.thighR, r: 'thigh', k: 1.05 },
  { a: J.thighL, b: J.shinL, r: 'thigh' }, { a: J.shinL, b: J.footL, r: 'shin' },
  { a: J.thighR, b: J.shinR, r: 'thigh' }, { a: J.shinR, b: J.footR, r: 'shin' },
  { a: J.armL, b: J.foreL, r: 'armL' }, { a: J.foreL, b: J.handL, r: 'foreL' }, { a: J.foreL, b: J.handL, r: 'handL', on: 0.45 },
  { a: J.armR, b: J.foreR, r: 'armR' }, { a: J.foreR, b: J.handR, r: 'foreR' }, { a: J.foreR, b: J.handR, r: 'handR', on: 0.45 },
];

const GRAVITY = 9.81; // m/s² (the world is in metres)
const DAMP = 0.035; // of the speed lost to the air every step
const ITER = 4;

const t1 = new THREE.Vector3();
const t2 = new THREE.Vector3();
const t3 = new THREE.Vector3();
const gv = new THREE.Vector3();
const ex = new THREE.Vector3();
const ey = new THREE.Vector3();
const ez = new THREE.Vector3();
const m4 = new THREE.Matrix4();
const m4b = new THREE.Matrix4();
const m3 = new THREE.Matrix3();
const q1 = new THREE.Quaternion();

export class CapeCloth {
  readonly bones: THREE.Object3D[] = [];
  private readonly R: number;
  private readonly C: number;
  private readonly n: number;
  private readonly x: Float32Array;
  private readonly o: Float32Array;
  private readonly rest: Float32Array;
  private readonly tgt: Float32Array;
  private readonly hold: Float32Array;
  private readonly aj: Int8Array;
  private readonly aw: Float32Array;
  private readonly bindRot: THREE.Quaternion[] = [];
  private readonly restInv: THREE.Quaternion[] = [];
  private readonly cur: THREE.Quaternion[] = [];
  /** neighbours kept at their distance: pairs, rest lengths, stiffness */
  private readonly la: Int16Array;
  private readonly lb: Int16Array;
  private readonly ll: Float32Array;
  private readonly lk: Float32Array;
  /** collider radii, fitted so that the cape as it hangs at rest touches none of them */
  private readonly cr: Float32Array;
  private readonly mPrev = new THREE.Matrix4();
  private hasPrev = false;
  private time = Math.random() * 10;
  private readonly segA: THREE.Vector3[] = COLLIDERS.map(() => new THREE.Vector3());
  private readonly segB: THREE.Vector3[] = COLLIDERS.map(() => new THREE.Vector3());
  /** for each row: the body's front (from the chest's at the top to the hips' at the hem) and a point on its mid-plane */
  private readonly rowFront: THREE.Vector3[];
  private readonly rowAt: THREE.Vector3[];
  /** the chest's up, a point on it, and how high up it the top of the cape is fastened */
  private readonly up = new THREE.Vector3();
  private readonly chestAt = new THREE.Vector3();
  private top = 0;
  /** how far in front of the body's mid-plane a point of the cloth may come (its sides wrap the flanks) */
  private readonly slack: Float32Array;

  constructor(spec: SkCape, bones: THREE.Object3D[], bindPos: THREE.Vector3[], bindRot: THREE.Quaternion[], bodyBind: THREE.Vector3[], radii: Record<string, number>, height: number) {
    this.R = spec.rows; this.C = spec.cols; this.n = spec.rows * spec.cols;
    const n = this.n;
    this.bones = bones;
    this.rowFront = Array.from({ length: this.R }, () => new THREE.Vector3());
    this.rowAt = Array.from({ length: this.R }, () => new THREE.Vector3());
    this.slack = new Float32Array(n);
    for (let i = 0; i < n; i++) { const c = i % this.C; this.slack[i] = (c === 0 || c === this.C - 1 ? 0.03 : 0.0) * height; }
    this.x = new Float32Array(n * 3); this.o = new Float32Array(n * 3); this.rest = new Float32Array(n * 3); this.tgt = new Float32Array(n * 3);
    this.hold = new Float32Array(spec.hold);
    this.aj = new Int8Array(n * 4).fill(-1); this.aw = new Float32Array(n * 4);
    const JI = J as Record<string, number>;
    for (let i = 0; i < n; i++) {
      this.rest.set([bindPos[i].x, bindPos[i].y, bindPos[i].z], i * 3);
      this.bindRot.push(bindRot[i].clone());
      spec.anchor[i].slice(0, 4).forEach(([name, w], k) => { this.aj[i * 4 + k] = JI[name] ?? J.chest; this.aw[i * 4 + k] = w; });
      this.cur.push(new THREE.Quaternion());
    }
    for (let i = 0; i < n; i++) this.restInv.push(this.frame(this.rest, i, new THREE.Quaternion()).invert());
    // neighbours: along the rows and down the columns (stiff), across the diagonals (softer, keeps the shape) and two
    // apart down the columns (a little: cloth does not fold on itself at every point)
    const A: number[] = [], B: number[] = [], K: number[] = [];
    const at = (r: number, c: number) => r * this.C + c;
    for (let r = 0; r < this.R; r++) {
      for (let c = 0; c < this.C; c++) {
        if (c + 1 < this.C) { A.push(at(r, c)); B.push(at(r, c + 1)); K.push(1); }
        if (r + 1 < this.R) { A.push(at(r, c)); B.push(at(r + 1, c)); K.push(1); }
        if (r + 1 < this.R && c + 1 < this.C) { A.push(at(r, c)); B.push(at(r + 1, c + 1)); K.push(0.5); A.push(at(r, c + 1)); B.push(at(r + 1, c)); K.push(0.5); }
        // (heavy cloth: it bends in long curves, it does not fold into a wad)
        if (r + 2 < this.R) { A.push(at(r, c)); B.push(at(r + 2, c)); K.push(0.4); }
        if (c + 2 < this.C) { A.push(at(r, c)); B.push(at(r, c + 2)); K.push(0.3); }
      }
    }
    this.la = Int16Array.from(A); this.lb = Int16Array.from(B); this.lk = Float32Array.from(K);
    this.ll = new Float32Array(A.length);
    for (let k = 0; k < A.length; k++) this.ll[k] = this.dist(this.rest, A[k], this.rest, B[k]);
    // the colliders as the body stands at rest, and how big each may be without the hanging cape touching it
    const margin = 0.012 * height;
    this.cr = new Float32Array(COLLIDERS.length);
    COLLIDERS.forEach((c, k) => {
      const a = bodyBind[c.a], b = bodyBind[c.b];
      this.segA[k].copy(a);
      this.segB[k].copy(c.on ? t1.copy(b).sub(a).multiplyScalar(c.on).add(b) : b);
      if (c.on) this.segA[k].copy(b);
      let r = (radii[c.r] ?? 0.05 * height) * (c.k ?? 1) + margin;
      for (let i = 0; i < n; i++) {
        if (this.hold[i] >= 1) continue;
        t2.fromArray(this.rest, i * 3);
        r = Math.min(r, 0.97 * Math.sqrt(segDist2(t2, this.segA[k], this.segB[k])));
      }
      this.cr[k] = Math.max(0, r);
    });
    this.x.set(this.rest); this.o.set(this.rest);
  }

  private dist(a: Float32Array, i: number, b: Float32Array, j: number) {
    return Math.hypot(a[i * 3] - b[j * 3], a[i * 3 + 1] - b[j * 3 + 1], a[i * 3 + 2] - b[j * 3 + 2]);
  }

  /** The orientation of the cloth at point i: across the cloth, down it, and out of it. */
  private frame(p: Float32Array, i: number, out: THREE.Quaternion): THREE.Quaternion {
    const r = Math.floor(i / this.C), c = i % this.C;
    const c0 = Math.max(0, c - 1), c1 = Math.min(this.C - 1, c + 1), r0 = Math.max(0, r - 1), r1 = Math.min(this.R - 1, r + 1);
    const a = (r * this.C + c1) * 3, b = (r * this.C + c0) * 3, d = (r1 * this.C + c) * 3, u = (r0 * this.C + c) * 3;
    ex.set(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2]);
    ey.set(p[u] - p[d], p[u + 1] - p[d + 1], p[u + 2] - p[d + 2]); // up the cloth
    ez.crossVectors(ex, ey);
    if (ex.lengthSq() < 1e-12 || ez.lengthSq() < 1e-12) return out;
    ex.normalize(); ez.normalize(); ey.crossVectors(ez, ex);
    return out.setFromRotationMatrix(m4.makeBasis(ex, ey, ez));
  }

  /**
   * One step. `joints`/`turns`: the body's joint positions and turns from rest this frame (model space, as the body
   * bones are placed); `bodyBind`: the joints at rest; `world`: model space -> world; `dt` 0 = place the cape as it
   * hangs at rest on the body as it is now (portraits, the pose lab).
   */
  update(dt: number, joints: THREE.Vector3[], turns: THREE.Quaternion[], bodyBind: THREE.Vector3[], world: THREE.Matrix4, lift: number) {
    const { n, x, o, tgt, rest, hold, aj, aw } = this;
    // where each point's place on the body is now
    for (let i = 0; i < n; i++) {
      t1.set(0, 0, 0);
      for (let k = 0; k < 4; k++) {
        const j = aj[i * 4 + k];
        if (j < 0) continue;
        t2.fromArray(rest, i * 3).sub(bodyBind[j]).applyQuaternion(turns[j]).add(joints[j]);
        t1.addScaledVector(t2, aw[i * 4 + k]);
      }
      t1.y += lift;
      t1.toArray(tgt, i * 3);
    }
    const det = world.determinant();
    const jump = this.hasPrev ? t1.setFromMatrixPosition(world).distanceTo(t2.setFromMatrixPosition(this.mPrev)) : Infinity;
    if (dt <= 0 || dt > 0.25 || !this.hasPrev || det * this.mPrev.determinant() < 0 || jump > 1.2) {
      // (first sight, a cut, a fighter that turned round to face the other way: the cape starts again as it hangs)
      x.set(tgt); o.set(tgt);
      this.mPrev.copy(world);
      this.hasPrev = dt > 0;
      this.place();
      return;
    }
    this.time += dt;
    // the points stay where they were in the world while the body moves under them
    const back = m4b.copy(world).invert().multiply(this.mPrev);
    for (let i = 0; i < n; i++) {
      if (hold[i] >= 1) continue;
      t1.fromArray(x, i * 3).applyMatrix4(back).toArray(x, i * 3);
      t1.fromArray(o, i * 3).applyMatrix4(back).toArray(o, i * 3);
    }
    this.mPrev.copy(world);
    // gravity and the floor, in model space
    const inv = m4b.copy(world).invert();
    const g = gv.set(0, -GRAVITY, 0).applyMatrix3(m3.setFromMatrix4(inv));
    const floor = t1.setFromMatrixPosition(world).setY(0).applyMatrix4(inv).y + 0.022; // (the folds of the cloth hang below its points)
    const steps = dt > 1 / 45 ? 2 : 1;
    const h = dt / steps;
    const scale = Math.cbrt(Math.abs(det)) || 1; // metres per model unit
    const maxStep = 0.5 / scale * h * 60; // (nothing flies more than half a metre a frame)
    // colliders, as the body is now
    COLLIDERS.forEach((c, k) => {
      const a = joints[c.a], b = joints[c.b];
      if (c.on) { this.segA[k].copy(b); this.segB[k].copy(b).sub(a).multiplyScalar(c.on).add(b); } else { this.segA[k].copy(a); this.segB[k].copy(b); }
      this.segA[k].y += lift; this.segB[k].y += lift;
    });
    // the body's front and its mid-plane, row by row (the cape stays behind it), and the line of the shoulders it
    // hangs from (it never rises over them, onto the head)
    ex.set(0, 0, 1).applyQuaternion(turns[J.chest]);
    ey.set(0, 0, 1).applyQuaternion(turns[J.hips]);
    for (let r = 0; r < this.R; r++) {
      const s = r / (this.R - 1);
      this.rowFront[r].copy(ex).lerp(ey, s).normalize();
      this.rowAt[r].copy(joints[J.chest]).lerp(joints[J.hips], s);
      this.rowAt[r].y += lift;
    }
    this.up.set(0, 1, 0).applyQuaternion(turns[J.chest]);
    this.chestAt.copy(joints[J.chest]);
    this.chestAt.y += lift;
    let top = 0;
    for (let c = 0; c < this.C; c++) top += t1.fromArray(tgt, c * 3).sub(this.chestAt).dot(this.up);
    this.top = top / this.C;
    // A body thrown over on its back, rolling or lying is no place for a cape to flutter: it would wrap itself into a
    // wad. The further the trunk is from upright, the more the cloth keeps to the way it hangs down the back.
    const tilt = 1 - t1.copy(this.up).applyMatrix3(m3.setFromMatrix4(world)).normalize().y; // 0 upright .. 1 lying .. 2 upside down
    const firm = 0.14 * Math.min(1, Math.max(0, (tilt - 0.3) / 0.6));
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        if (hold[i] >= 1) { x[i3] = o[i3] = tgt[i3]; x[i3 + 1] = o[i3 + 1] = tgt[i3 + 1]; x[i3 + 2] = o[i3 + 2] = tgt[i3 + 2]; continue; }
        const r = Math.floor(i / this.C), c = i % this.C;
        // a breath of air from in front: the cape lifts off the back a little and stirs
        const wz = -(0.06 + 0.05 * Math.sin(this.time * 1.7 + r * 0.6 + c * 0.3)) * GRAVITY * (r / (this.R - 1)) / scale;
        const wx = 0.03 * Math.sin(this.time * 2.3 + c * 0.9) * GRAVITY * (r / (this.R - 1)) / scale;
        for (let a = 0; a < 3; a++) {
          let v = (x[i3 + a] - o[i3 + a]) * (1 - DAMP);
          if (v > maxStep) v = maxStep; else if (v < -maxStep) v = -maxStep;
          o[i3 + a] = x[i3 + a];
          x[i3 + a] += v + (a === 0 ? g.x + wx : a === 1 ? g.y : g.z + wz) * h * h;
        }
        // held to its place on the body, as firmly as it is held
        const k = Math.max(hold[i], firm);
        if (k > 0) for (let a = 0; a < 3; a++) x[i3 + a] += (tgt[i3 + a] - x[i3 + a]) * k;
      }
      for (let it = 0; it < ITER; it++) {
        this.links();
        this.collide(floor);
      }
    }
    this.place();
  }

  private links() {
    const { x, hold, la, lb, ll, lk } = this;
    for (let k = 0; k < la.length; k++) {
      const a = la[k] * 3, b = lb[k] * 3;
      const fa = hold[la[k]] >= 1 ? 0 : 1, fb = hold[lb[k]] >= 1 ? 0 : 1;
      if (!fa && !fb) continue;
      const dx = x[b] - x[a], dy = x[b + 1] - x[a + 1], dz = x[b + 2] - x[a + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-9) continue;
      const f = ((d - ll[k]) / d) * lk[k] / (fa + fb);
      x[a] += dx * f * fa; x[a + 1] += dy * f * fa; x[a + 2] += dz * f * fa;
      x[b] -= dx * f * fb; x[b + 1] -= dy * f * fb; x[b + 2] -= dz * f * fb;
    }
  }

  private collide(floor: number) {
    const { x, hold, cr, n } = this;
    for (let i = 0; i < n; i++) {
      if (hold[i] >= 1) continue;
      const i3 = i * 3;
      const row = Math.floor(i / this.C);
      const front = this.rowFront[row];
      t1.set(x[i3], x[i3 + 1], x[i3 + 2]);
      for (let k = 0; k < cr.length; k++) {
        const r = cr[k];
        if (r <= 0) continue;
        const a = this.segA[k], b = this.segB[k];
        t2.subVectors(b, a);
        const L2 = t2.lengthSq();
        const tt = L2 > 1e-12 ? Math.min(1, Math.max(0, t3.subVectors(t1, a).dot(t2) / L2)) : 0;
        t3.copy(a).addScaledVector(t2, tt); // the nearest point of the bone
        t2.subVectors(t1, t3);
        const d = t2.length();
        if (d >= r) continue;
        if (k < TRUNK_COLLIDERS) {
          if (d < 1e-6) t2.copy(front).negate(); else t2.multiplyScalar(1 / d);
          t1.copy(t3).addScaledVector(t2, r);
        } else t1.addScaledVector(front, d - r); // (back, by as much as it is in)
      }
      // never in front of the body, nor up over the shoulders
      const ahead = t2.subVectors(t1, this.rowAt[row]).dot(front) - this.slack[i];
      if (ahead > 0) t1.addScaledVector(front, -ahead);
      const over = t2.subVectors(t1, this.chestAt).dot(this.up) - this.top;
      if (over > 0) t1.addScaledVector(this.up, -over);
      if (t1.y < floor) t1.y = floor;
      x[i3] = t1.x; x[i3 + 1] = t1.y; x[i3 + 2] = t1.z;
    }
  }

  /** Every bone at its point, turned as the cloth there is turned from its rest. */
  private place() {
    for (let i = 0; i < this.n; i++) {
      const b = this.bones[i];
      b.position.fromArray(this.x, i * 3);
      this.frame(this.x, i, this.cur[i]);
      q1.multiplyQuaternions(this.cur[i], this.restInv[i]);
      b.quaternion.multiplyQuaternions(q1, this.bindRot[i]);
    }
  }
}

function segDist2(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const L2 = abx * abx + aby * aby + abz * abz;
  let t = L2 > 1e-12 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / L2 : 0;
  t = Math.min(1, Math.max(0, t));
  const dx = p.x - (a.x + abx * t), dy = p.y - (a.y + aby * t), dz = p.z - (a.z + abz * t);
  return dx * dx + dy * dy + dz * dz;
}
