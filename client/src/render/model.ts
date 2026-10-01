import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { GUARD, J, JOINTS } from './pose';

// Real character models (tools/models/build.py output). Each GLB carries a 17-bone skeleton named after the
// procedural rig's joints plus a `skrig` blob describing its bind pose (a fighting stance). The procedural rig
// keeps running invisibly; every frame its joint rotations are retargeted onto the model's bones, so all the
// existing poses and attack animations drive the real models.
//
// The model was sculpted in its own fighting stance, and that is what it should look like when it is not doing
// anything else. Each joint therefore has two candidate orientations every frame:
//   stance   — its sculpted pose, plus whatever small change the animation made to that joint since GUARD;
//   absolute — exactly where the animation's skeleton puts it.
// A joint the animation barely touches stays in the stance (so in GUARD the mesh is not deformed at all); a joint
// it really drives (the punching arm, the kicking leg, a body folding from a hit) goes to the absolute pose.
// Shoulders, hips and the trunk blend in world space, so a punch flies level even though the torso is still
// leaning in its stance; elbows, knees, wrists and ankles blend relative to their parent so they stay hinges.

interface SkRig {
  height: number;
  joints: Record<string, number[]>;
  tips: Record<string, number[]>;
  headTop: number[];
  headYaw: number;
  sole: number;
}
export interface ModelAsset { id: string; scene: THREE.Object3D; rig: SkRig }

const assets = new Map<string, ModelAsset>();

export function getModel(id: string): ModelAsset | null { return assets.get(id) ?? null; }
export function modelIds(): string[] { return [...assets.keys()]; }

/** Load every model listed in assets/models/index.json (missing manifest = no models, the procedural rigs are used). */
export async function preloadModels(onProgress?: (p: number) => void) {
  let manifest: Record<string, { file: string; v?: string }> = {};
  try {
    const r = await fetch('assets/models/index.json', { cache: 'no-cache' });
    if (r.ok) manifest = await r.json();
  } catch { /* offline / no models */ }
  const ids = Object.keys(manifest).filter((id) => !assets.has(id));
  if (!ids.length) { onProgress?.(1); return; }
  const draco = new DRACOLoader();
  draco.setDecoderPath('draco/');
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  let done = 0;
  await Promise.all(ids.map(async (id) => {
    try {
      const m = manifest[id];
      const g = await loader.loadAsync(`assets/models/${m.file}${m.v ? '?v=' + m.v : ''}`);
      let rig: SkRig | null = null;
      g.scene.traverse((o) => {
        if (typeof o.userData.skrig === 'string') rig = JSON.parse(o.userData.skrig);
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry.dispose = () => {}; // shared by every clone: views must not free it
          const mat = mesh.material as THREE.MeshStandardMaterial;
          if (mat.map) mat.map.anisotropy = 4;
        }
      });
      if (rig) assets.set(id, { id, scene: g.scene, rig });
      else console.warn('[models] no skrig in', m.file);
    } catch (e) {
      console.warn('[models] failed to load', id, e);
    }
    onProgress?.(++done / ids.length);
  }));
  draco.dispose();
}

const PARENT: number[] = JOINTS.map((n) => {
  const p: Record<string, string> = {
    spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
    armL: 'chest', foreL: 'armL', handL: 'foreL', armR: 'chest', foreR: 'armR', handR: 'foreR',
    thighL: 'hips', shinL: 'thighL', footL: 'shinL', thighR: 'hips', shinR: 'thighR', footR: 'shinR',
  };
  return n in p ? J[p[n] as keyof typeof J] : -1;
});
const RIG_LEG = 0.62; // procedural rig: thigh 0.32 + shin 0.30
// How far (radians) a joint must turn away from GUARD before the animation's own orientation fully takes over.
// Arms: short — a block or a punch must land where it is aimed. Legs: long — walking is a shuffle inside the stance.
const TAKEOVER: number[] = JOINTS.map((n) => (/^(arm|fore|hand)/.test(n) ? 0.5 : /^(thigh|shin|foot)/.test(n) ? 1.2 : 1.0));
/** joints whose absolute target is a world orientation (ball joints / body); the rest are hinges under their parent */
const WORLD: boolean[] = JOINTS.map((n) => /^(hips|spine|chest|head|arm|thigh)/.test(n));
const GUARD_INV: THREE.Quaternion[] = JOINTS.map((_, j) => new THREE.Quaternion().setFromEuler(new THREE.Euler(GUARD[j * 3], GUARD[j * 3 + 1], GUARD[j * 3 + 2], 'XYZ')).invert());
const RIG_HEIGHT = 1.75;

const V = (a: number[]) => new THREE.Vector3(a[0], a[1], a[2]);
const dir = (a: THREE.Vector3, b: THREE.Vector3) => b.clone().sub(a).normalize();
/** Rotation whose local axes are x (left), y (up) and x × y, after orthogonalising y against x. */
function frameXY(x: THREE.Vector3, yApprox: THREE.Vector3): THREE.Quaternion {
  const xx = x.clone().normalize();
  const z = xx.clone().cross(yApprox).normalize();
  const y = z.clone().cross(xx).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xx, y, z));
}
/** Same, but keeps y exact and orthogonalises x (limbs: y runs along the bone, x is the hinge). */
function frameYX(y: THREE.Vector3, xApprox: THREE.Vector3): THREE.Quaternion {
  const yy = y.clone().normalize();
  const z = xApprox.clone().cross(yy).normalize();
  const x = yy.clone().cross(z).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, yy, z));
}

const tq = new THREE.Quaternion();
const tq2 = new THREE.Quaternion();
const tv = new THREE.Vector3();

export class ModelSkin {
  /** Lives under the rig's `body` group; scaled so the model stands as tall as the procedural fighter. */
  root = new THREE.Group();
  materials: THREE.Material[] = [];
  /** Tracks the centre of the head (portrait framing, effects). */
  faceAnchor = new THREE.Object3D();
  headSize: number;
  /** When true the lower foot is kept on the floor; otherwise the pelvis is only kept above it (lying, airborne). */
  feetOnGround = true;
  /** 0 = the current pose is guard-based (keep the stance where the pose is silent), 1 = it is meant literally */
  absolute = 0;
  private bones: THREE.Object3D[] = [];
  private bindPos: THREE.Vector3[] = [];
  private bindRot: THREE.Quaternion[] = [];
  private starInv: THREE.Quaternion[] = [];
  /** each joint's sculpted orientation relative to its parent */
  private stance: THREE.Quaternion[] = [];
  private f: THREE.Quaternion[] = JOINTS.map(() => new THREE.Quaternion());
  private keep = new Float32Array(JOINTS.length);
  private q: THREE.Quaternion[] = JOINTS.map(() => new THREE.Quaternion());
  private d: THREE.Quaternion[] = JOINTS.map(() => new THREE.Quaternion());
  private p: THREE.Vector3[] = JOINTS.map(() => new THREE.Vector3());
  private legLen: number;
  private ankle: number;
  private bodyMin: number;
  private faceOff: THREE.Vector3;
  private lift = 0;

  constructor(asset: ModelAsset, private joints: THREE.Object3D[], private headBob: THREE.Object3D, private hipsBaseY: number, tint?: string) {
    const sk = asset.rig;
    const inst = cloneSkinned(asset.scene);
    const boneRoot = new THREE.Group();
    this.root.add(inst, boneRoot, this.faceAnchor);

    let skeleton: THREE.Skeleton | null = null;
    const gold = tint === '#d4a531';
    inst.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.frustumCulled = false; // bones move the mesh far from its bind bounds
      if (m.isSkinnedMesh && !skeleton) skeleton = m.skeleton;
      const src = m.material as THREE.MeshStandardMaterial;
      let mat: THREE.MeshStandardMaterial;
      if (gold) mat = new THREE.MeshStandardMaterial({ color: '#d8a93a', metalness: 0.95, roughness: 0.28, normalMap: src.normalMap });
      else {
        mat = src.clone();
        if (tint) { mat.color.lerp(new THREE.Color(tint), 0.35); mat.emissive = new THREE.Color(tint); mat.emissiveIntensity = 0.12; }
      }
      m.material = mat;
      this.materials.push(mat);
    });
    if (!skeleton) throw new Error('model has no skin: ' + asset.id);
    const sks = skeleton as THREE.Skeleton;

    const P = JOINTS.map((n) => V(sk.joints[n]));
    for (let j = 0; j < JOINTS.length; j++) {
      const bone = sks.bones.find((b) => b.name === JOINTS[j]);
      if (!bone) throw new Error(`model ${asset.id} is missing bone ${JOINTS[j]}`);
      const bind = sks.boneInverses[sks.bones.indexOf(bone)].clone().invert();
      const pos = new THREE.Vector3(), rot = new THREE.Quaternion(), scl = new THREE.Vector3();
      bind.decompose(pos, rot, scl);
      this.bindPos.push(P[j]);
      this.bindRot.push(rot);
      boneRoot.add(bone); // flatten: each bone is positioned directly in model space
      this.bones.push(bone);
    }

    // ---- orientation of every rig joint frame in the model's bind pose (see frame conventions in pose.ts)
    const star: THREE.Quaternion[] = [];
    const up = new THREE.Vector3(0, 1, 0);
    const hipsX = dir(P[J.thighR], P[J.thighL]);
    const chestX = dir(P[J.armR], P[J.armL]);
    star[J.hips] = frameXY(hipsX, dir(P[J.hips], P[J.spine]));
    star[J.spine] = frameYX(dir(P[J.spine], P[J.chest]), hipsX.clone().add(chestX));
    star[J.chest] = frameXY(chestX, dir(P[J.chest], P[J.neck]));
    star[J.neck] = frameYX(dir(P[J.neck], P[J.head]), chestX);
    star[J.head] = new THREE.Quaternion().setFromAxisAngle(up, sk.headYaw || 0);
    const limb = (a: number, b: number, c: number, elbow: boolean, fallbackX: THREE.Vector3) => {
      const u1 = dir(P[a], P[b]), u2 = dir(P[b], P[c]);
      let hinge = u1.clone().cross(u2);
      if (hinge.length() < 0.12) hinge = fallbackX.clone(); else hinge.normalize().multiplyScalar(elbow ? -1 : 1);
      star[a] = frameYX(u1.clone().negate(), hinge);
      star[b] = frameYX(u2.clone().negate(), hinge);
      return hinge;
    };
    const hL = limb(J.armL, J.foreL, J.handL, true, chestX);
    const hR = limb(J.armR, J.foreR, J.handR, true, chestX);
    star[J.handL] = frameYX(dir(P[J.handL], V(sk.tips.tipL)).negate(), hL);
    star[J.handR] = frameYX(dir(P[J.handR], V(sk.tips.tipR)).negate(), hR);
    limb(J.thighL, J.shinL, J.footL, false, hipsX);
    limb(J.thighR, J.shinR, J.footR, false, hipsX);
    for (const [foot, toe] of [[J.footL, sk.tips.toeL], [J.footR, sk.tips.toeR]] as const) {
      const fwd = V(toe).sub(P[foot]); fwd.y = 0; fwd.normalize();
      const x = up.clone().cross(fwd).normalize();
      star[foot] = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, fwd));
    }
    this.starInv = star.map((s) => s.clone().invert());
    this.stance = star.map((s, j) => (PARENT[j] < 0 ? s.clone() : this.starInv[PARENT[j]].clone().multiply(s)));

    // ---- proportions
    const len = (a: number, b: number) => P[a].distanceTo(P[b]);
    this.legLen = (len(J.thighL, J.shinL) + len(J.shinL, J.footL) + len(J.thighR, J.shinR) + len(J.shinR, J.footR)) / 2;
    this.ankle = (P[J.footL].y + P[J.footR].y) / 2 - sk.sole;
    this.bodyMin = sk.height * 0.11;
    const headTop = V(sk.headTop);
    const standing = this.legLen + this.ankle + len(J.hips, J.spine) + len(J.spine, J.chest) + len(J.chest, J.neck) + len(J.neck, J.head) + (headTop.y - P[J.head].y);
    const scale = (RIG_HEIGHT * 0.97) / standing;
    this.root.scale.setScalar(scale);
    this.headSize = ((headTop.y - P[J.head].y) * 0.5) * scale;
    this.faceOff = new THREE.Vector3(0, (headTop.y - P[J.head].y) * 0.55, sk.height * 0.08);
    this.update(0);
  }

  /** Retarget the rig's current joint rotations onto the model. Call after the rig pose (and head bob) is set. */
  update(dt = 1 / 60) {
    const { q, f, d, p, joints } = this;
    const rel = 1 - Math.min(1, Math.max(0, this.absolute));
    for (let j = 0; j < joints.length; j++) {
      const par = PARENT[j];
      const local = joints[j].quaternion;
      // the animation skeleton's own world orientation of this joint
      if (par < 0) q[j].copy(local); else q[j].multiplyQuaternions(q[par], local);
      // how far the animation turned this joint away from GUARD -> how much of the stance survives
      tq.multiplyQuaternions(GUARD_INV[j], local);
      const turn = 2 * Math.acos(Math.min(1, Math.abs(tq.w)));
      const t = Math.min(1, turn / TAKEOVER[j]);
      let keep = rel * (1 - t * t * (3 - 2 * t));
      // a hinge can only stay in the stance while the limb it hangs from does (a kicking leg straightens its knee)
      if (!WORLD[j]) keep = Math.min(keep, this.keep[par]);
      this.keep[j] = keep;
      // stance orientation relative to the parent, carrying the animation's local change
      tq2.multiplyQuaternions(this.stance[j], tq);
      if (WORLD[j]) {
        if (par >= 0) tq2.premultiply(f[par]);
        f[j].copy(q[j]).slerp(tq2, keep);
      } else {
        tq.copy(local).slerp(tq2, keep);
        f[j].multiplyQuaternions(f[par], tq);
      }
    }
    for (let j = 0; j < joints.length; j++) {
      // the bobblehead spring only affects the head itself
      if (j === J.head) d[j].multiplyQuaternions(tq.multiplyQuaternions(f[j], this.headBob.quaternion), this.starInv[j]);
      else d[j].multiplyQuaternions(f[j], this.starInv[j]);
    }

    const k = this.legLen / RIG_LEG;
    const hips = joints[J.hips];
    p[J.hips].set(0, this.legLen + this.ankle + (hips.position.y - this.hipsBaseY) * k, hips.position.z * k);
    for (let j = 1; j < joints.length; j++) {
      const par = PARENT[j];
      p[j].copy(this.bindPos[j]).sub(this.bindPos[par]).applyQuaternion(d[par]).add(p[par]);
    }
    // keep the model on the floor (its legs are proportioned differently from the procedural rig's)
    let want = 0;
    if (this.feetOnGround) want = this.ankle - Math.min(p[J.footL].y, p[J.footR].y);
    else {
      let low = Infinity;
      for (const j of [J.hips, J.chest, J.head]) low = Math.min(low, p[j].y);
      if (low < this.bodyMin) want = this.bodyMin - low;
    }
    this.lift += (want - this.lift) * (dt <= 0 ? 1 : Math.min(1, dt * 20));
    for (let j = 0; j < joints.length; j++) {
      const b = this.bones[j];
      b.position.copy(p[j]);
      b.position.y += this.lift;
      b.quaternion.multiplyQuaternions(d[j], this.bindRot[j]);
    }
    this.faceAnchor.position.copy(tv.copy(this.faceOff).applyQuaternion(d[J.head])).add(p[J.head]);
    this.faceAnchor.position.y += this.lift;
  }

  dispose() {
    for (const m of this.materials) m.dispose();
  }
}
