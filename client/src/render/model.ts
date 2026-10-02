import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { J, JOINTS } from './pose';

// Real character models (tools/models/prep.py + rig.py output). Each GLB carries a 17-bone skeleton named after
// the procedural rig's joints, standing in a neutral A-pose, plus a `skrig` blob with that pose's joints.
//
// The procedural rig keeps running invisibly and plays every pose and attack animation. Its proportions are a
// bobblehead's (short limbs, huge head), so its joint angles are not copied onto the model: a real body doing
// those angles would float, sink or cross its own legs. Instead the model re-enacts what the rig *does*:
//   trunk  — the pelvis and the head take the rig's orientations; the back bends and twists the same way but
//            less (a toy folds at the waist far more than a spine does), and the arms go with the back;
//   hands  — each wrist goes where the rig's wrist is, measured from the shoulder in arm lengths, and the elbow
//            is solved for it (two-bone IK, bending the way the rig's elbow points);
//   feet   — a foot the rig has on the floor is planted flat on the floor at the same place (in leg lengths); a
//            raised foot keeps its position relative to the hip; knees are solved, and only ever bend forward;
//   pelvis — rides at the rig's height (in leg lengths) and sinks just enough for the planted feet to reach;
//   aim    — a limb the rig throws out (a punch, a kick) goes down the fight line at the opponent, whatever
//            the toy rig's twisted torso made of it.
// So a stance is a stance and a kick is a kick on any body, with the feet on the ground and no joint asked to do
// something a human joint cannot.

interface SkRig {
  rest?: string;
  armA?: number;
  height: number;
  joints: Record<string, number[]>;
  tips: Record<string, number[]>;
  headTop: number[];
  sole: number;
  /** the middle of the face in the rest pose and half the head's height (portraits); older builds leave them out */
  face?: number[];
  headR?: number;
  /** finger bones (children of the hand bones): each turns about `axis` (model space, rest pose) by angle x grip */
  fingers?: { bone: string; axis: number[]; angle: number }[];
}
export interface ModelAsset { id: string; scene: THREE.Object3D; rig: SkRig }

// A model is drawn from both sides (a sculpt's parts are open shells), and three lights the back of a face with its
// normal turned round. On these bodies that is wrong far more often than right: what shows from behind is a sliver
// of patch at a seam, or a triangle folded over in the crease of a hip in the middle of a kick, and with its normal
// turned round it is a dark fleck on the cloth. So both sides of a face are lit with the normal the surface was
// given, turned only as far as it takes to face the eye.
const NORMAL_BEGIN = THREE.ShaderChunk.normal_fragment_begin
  .replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;')
  .replace('vec3 normal = normalize( vNormal );', `vec3 normal = normalize( vNormal );
	{
		vec3 skEye = isOrthographic ? vec3( 0.0, 0.0, 1.0 ) : normalize( vViewPosition );
		float skFacing = dot( normal, skEye );
		if ( skFacing < 0.0 ) normal -= 2.0 * skFacing * skEye;
	}`);

function litAlikeFromBothSides(mat: THREE.Material) {
  mat.onBeforeCompile = (shader) => { shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', NORMAL_BEGIN); };
  mat.customProgramCacheKey = () => 'sk-lit-alike';
}

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
      if (rig && (rig as SkRig).rest === 'neutral') assets.set(id, { id, scene: g.scene, rig });
      else console.warn('[models] not a neutral-pose model (rebuild it with tools/models/build_all.py):', m.file);
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
const RIG_HEIGHT = 1.75;
const ARMS = [[J.armL, J.foreL, J.handL], [J.armR, J.foreR, J.handR]] as const;
const LEGS = [[J.thighL, J.shinL, J.footL], [J.thighR, J.shinR, J.footR]] as const;
/** how much of the bobblehead's head wobble a real head shows */
const HEAD_BOB = 0.3;
/** how much of the toy's bending and twisting at the waist and chest a real back does */
const TRUNK = 0.62;

const V = (a: number[]) => new THREE.Vector3(a[0], a[1], a[2]);
const UP = new THREE.Vector3(0, 1, 0);
const IDENTITY = new THREE.Quaternion();
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const tq = new THREE.Quaternion();
const tv = new THREE.Vector3();
const tv2 = new THREE.Vector3();
const vx = new THREE.Vector3();
const vy = new THREE.Vector3();
const vz = new THREE.Vector3();
const tm = new THREE.Matrix4();
const axis = new THREE.Vector3();
const bend = new THREE.Vector3();
const mid = new THREE.Vector3();
const hinge = new THREE.Vector3();
const la = new THREE.Vector3();
const lb = new THREE.Vector3();
const hipAt = new THREE.Vector3();
const onFloor = new THREE.Vector3();
const FEET = [new THREE.Vector3(), new THREE.Vector3()];
const ELBOW_REST = new THREE.Vector3(0, -1, -0.4);
const aimQ = new THREE.Quaternion();
const backQ = new THREE.Quaternion();

/**
 * How far to swing a thrown limb round onto the fight line (+z): the angle (about the vertical) that takes `v`,
 * the limb from its root to its end in rig units, to straight ahead — scaled by how much the limb is thrown at
 * all: stretched out (`reach` 0..1 of its length), level rather than hanging or raised, and already forward-ish.
 */
function aimTurn(v: THREE.Vector3, reach: number, back: number): number {
  const flat = Math.hypot(v.x, v.z), len = v.length();
  if (len < 1e-5 || flat < 1e-5) return 0;
  const w = smooth(0.7, 0.93, reach) * smooth(0.35, 0.7, flat / len) * smooth(back, back + 0.5, v.z / flat);
  return -Math.atan2(v.x, v.z) * w;
}

/** Rotation whose y axis is exactly `y` (up the bone) and whose x axis is `xApprox` made square to it (the hinge). */
function frameYX(y: THREE.Vector3, xApprox: THREE.Vector3, out: THREE.Quaternion) {
  vy.copy(y).normalize();
  vz.copy(xApprox).cross(vy).normalize();
  vx.copy(vy).cross(vz).normalize();
  return out.setFromRotationMatrix(tm.makeBasis(vx, vy, vz));
}

export class ModelSkin {
  /** Lives under the rig's `body` group; scaled so the model stands as tall as the procedural fighter. */
  root = new THREE.Group();
  materials: THREE.Material[] = [];
  /** Tracks the centre of the head (portrait framing, effects). */
  faceAnchor = new THREE.Object3D();
  headSize: number;
  /** When true the feet carry the body (planted, pelvis kept within reach); otherwise it is airborne or lying. */
  feetOnGround = true;
  /** How closed each hand is (left, right): 0 open .. 1 fist. Only models with finger bones show it. */
  grip: [number, number] = [1, 1];
  private fingers: { bone: THREE.Object3D; rest: THREE.Quaternion; axis: THREE.Vector3; angle: number; hand: 0 | 1 }[] = [];
  private bones: THREE.Object3D[] = [];
  private bindPos: THREE.Vector3[] = [];
  private bindRot: THREE.Quaternion[] = [];
  /** inverse of each joint frame's orientation in the model's rest pose */
  private restInv: THREE.Quaternion[] = [];
  /** the procedural rig's skeleton this frame: world orientation and position of every joint (rig units) */
  private cq: THREE.Quaternion[] = JOINTS.map(() => new THREE.Quaternion());
  private cp: THREE.Vector3[] = JOINTS.map(() => new THREE.Vector3());
  /** the model's skeleton this frame: joint frames, bone rotations from rest, joint positions (model units) */
  private f: THREE.Quaternion[] = JOINTS.map(() => new THREE.Quaternion());
  private d: THREE.Quaternion[] = JOINTS.map(() => new THREE.Quaternion());
  private p: THREE.Vector3[] = JOINTS.map(() => new THREE.Vector3());
  private legLen: number;
  private ankle: number;
  private bodyMin: number;
  private faceOff: THREE.Vector3;
  private lift = 0;
  private rigLeg: number;
  private rigArm: number[];
  private rigAnkle: number;
  /** sideways scale from the rig to the model: hip width to hip width */
  private kx: number;
  private plant = [0, 0];
  private legAim = [0, 0];
  /** how far the hip joints sit below the pelvis joint (the rig has them level) */
  private hipDrop: number;

  constructor(asset: ModelAsset, private joints: THREE.Object3D[], private headBob: THREE.Object3D, hipsBaseY: number, tint?: string) {
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
      litAlikeFromBothSides(mat);
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
      // rest pose: everything square to the world, arms lowered `armA` from horizontal-down (an A-pose)
      const arm = /^(arm|fore|hand)/.test(JOINTS[j]);
      const a = arm ? (JOINTS[j].endsWith('L') ? 1 : -1) * (sk.armA ?? 0) : 0;
      this.restInv.push(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a).invert());
    }

    // fingers stay children of their hand bone; closing the hand turns each about its hinge, given in the model's
    // rest pose and brought here into the space of the bone's parent
    for (const fg of sk.fingers ?? []) {
      const bone = sks.bones.find((b) => b.name === fg.bone);
      const parent = bone?.parent as THREE.Bone | undefined;
      const pi = parent ? sks.bones.indexOf(parent) : -1;
      if (!bone || pi < 0) continue;
      const pr = new THREE.Quaternion();
      sks.boneInverses[pi].clone().invert().decompose(new THREE.Vector3(), pr, new THREE.Vector3());
      this.fingers.push({ bone, rest: bone.quaternion.clone(), axis: V(fg.axis).applyQuaternion(pr.invert()).normalize(), angle: fg.angle, hand: /^f[R]/.test(fg.bone) ? 1 : 0 });
    }
    // a hand closed into a fist folds its skin over itself in the creases; drawn from both sides a fold is skin,
    // not a hole to look through
    if (this.fingers.length) {
      const own = new Set(this.fingers.map((f) => sks.bones.indexOf(f.bone as THREE.Bone)));
      inst.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        const idx = m.isSkinnedMesh ? m.geometry.getAttribute('skinIndex') : null;
        if (!idx) return;
        for (let i = 0; i < idx.count; i++) {
          if (own.has(idx.getX(i)) || own.has(idx.getY(i))) { (m.material as THREE.Material).side = THREE.DoubleSide; return; }
        }
      });
    }

    // ---- proportions
    const len = (a: number, b: number) => P[a].distanceTo(P[b]);
    this.legLen = (len(J.thighL, J.shinL) + len(J.shinL, J.footL) + len(J.thighR, J.shinR) + len(J.shinR, J.footR)) / 2;
    this.ankle = (P[J.footL].y + P[J.footR].y) / 2 - sk.sole;
    this.bodyMin = sk.height * 0.09;
    const headTop = V(sk.headTop);
    const scale = (RIG_HEIGHT * 0.97) / (sk.height - sk.sole);
    this.root.scale.setScalar(scale);
    this.headSize = (sk.headR ?? (headTop.y - P[J.head].y) * 0.5) * scale;
    this.faceOff = sk.face ? V(sk.face).sub(P[J.head]) : new THREE.Vector3(0, (headTop.y - P[J.head].y) * 0.55, sk.height * 0.07);
    // the procedural rig's own limb lengths
    const jl = (j: number) => joints[j].position.length();
    this.rigLeg = jl(J.shinL) + jl(J.footL);
    this.rigArm = [jl(J.foreL) + jl(J.handL), jl(J.foreR) + jl(J.handR)];
    this.rigAnkle = hipsBaseY - this.rigLeg;
    this.kx = Math.abs(P[J.thighL].x - P[J.thighR].x) / Math.max(1e-4, Math.abs(joints[J.thighL].position.x - joints[J.thighR].position.x));
    this.hipDrop = P[J.hips].y - (P[J.thighL].y + P[J.thighR].y) / 2;
    this.update(0);
  }

  /**
   * Two-bone limb from `root` to `target`, bending towards `pole`. Writes the two joint frames and returns
   * nothing; `a`, `b` are the bone lengths. Knees hinge the other way round from elbows.
   */
  private limb(root: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3, fallback: THREE.Vector3, a: number, b: number, knee: boolean, upper: number, lower: number) {
    axis.copy(target).sub(root);
    const dist = Math.min((a + b) * 0.9995, Math.max(Math.abs(a - b) + 1e-4, axis.length()));
    axis.normalize();
    bend.copy(pole).addScaledVector(axis, -pole.dot(axis));
    if (bend.lengthSq() < 1e-6) bend.copy(fallback).addScaledVector(axis, -fallback.dot(axis));
    if (bend.lengthSq() < 1e-6) bend.set(axis.y, -axis.x, 0);
    bend.normalize();
    const cosA = Math.min(1, Math.max(-1, (a * a + dist * dist - b * b) / (2 * a * dist)));
    mid.copy(root).addScaledVector(axis, a * cosA).addScaledVector(bend, a * Math.sqrt(1 - cosA * cosA));
    hinge.copy(axis).cross(bend);
    if (knee) hinge.negate();
    frameYX(la.copy(root).sub(mid), hinge, this.f[upper]);
    frameYX(la.copy(mid).sub(lb.copy(root).addScaledVector(axis, dist)), hinge, this.f[lower]);
  }

  /** Re-enact the rig's current pose on the model. Call after the rig pose (and head bob) is set. */
  update(dt = 1 / 60) {
    const { cq, cp, f, d, p, joints, bindPos } = this;
    // ---- what the rig is doing
    for (let j = 0; j < joints.length; j++) {
      const par = PARENT[j];
      if (par < 0) { cq[j].copy(joints[j].quaternion); cp[j].copy(joints[j].position); }
      else { cq[j].multiplyQuaternions(cq[par], joints[j].quaternion); cp[j].copy(joints[j].position).applyQuaternion(cq[par]).add(cp[par]); }
    }
    const k = this.legLen / this.rigLeg;
    const grounded = this.feetOnGround;
    // the rig is not exact about the floor; when the feet carry it, its lower foot is on the floor by definition
    const floor = grounded ? Math.min(cp[J.footL].y, cp[J.footR].y) - this.rigAnkle : 0;

    // ---- trunk
    f[J.hips].copy(cq[J.hips]);
    for (const j of [J.spine, J.chest]) f[j].copy(f[PARENT[j]]).multiply(tq.copy(IDENTITY).slerp(joints[j].quaternion, TRUNK));
    f[J.neck].copy(f[J.chest]).multiply(joints[J.neck].quaternion);
    f[J.head].copy(cq[J.head]).multiply(tq.copy(IDENTITY).slerp(this.headBob.quaternion, HEAD_BOB));
    // what the rig's arms do, they do from its chest: carry that over to the straighter back
    backQ.copy(cq[J.chest]).invert().premultiply(f[J.chest]);
    p[J.hips].set(cp[J.hips].x * k, this.ankle + (cp[J.hips].y - this.rigAnkle - floor) * k + this.hipDrop, cp[J.hips].z * k);

    // ---- feet: where they have to be
    const feet = FEET;
    const plant = this.plant;
    let drop = 0;
    for (let s = 0; s < 2; s++) {
      const [th, sh, ft] = LEGS[s];
      const h = cp[ft].y - floor - this.rigAnkle; // height of the rig's foot above its floor
      plant[s] = grounded ? 1 - smooth(0.02, 0.09, h) : 0;
      // hip joint of the model, before any drop
      hipAt.copy(bindPos[th]).sub(bindPos[J.hips]).applyQuaternion(f[J.hips]).add(p[J.hips]);
      // raised: same place relative to the hip, in leg lengths; planted: same place on the floor (sideways in
      // hip widths, so a wide-hipped body does not stand knock-kneed)
      tv.copy(cp[ft]).sub(cp[th]);
      this.legAim[s] = (1 - plant[s]) * aimTurn(tv, tv.length() / this.rigLeg, -0.35);
      feet[s].copy(tv.applyAxisAngle(UP, this.legAim[s])).multiplyScalar(k).add(hipAt);
      onFloor.set(cp[ft].x * this.kx, this.ankle, cp[ft].z * k);
      feet[s].lerp(onFloor, plant[s]);
      if (plant[s] > 0) {
        const L = (bindPos[th].distanceTo(bindPos[sh]) + bindPos[sh].distanceTo(bindPos[ft])) * 0.995;
        const hd = Math.hypot(feet[s].x - hipAt.x, feet[s].z - hipAt.z);
        const top = feet[s].y + Math.sqrt(Math.max(0, L * L - hd * hd));
        drop = Math.max(drop, (hipAt.y - top) * plant[s]);
      }
    }
    p[J.hips].y -= drop;
    for (let s = 0; s < 2; s++) feet[s].y -= drop * (1 - plant[s]); // a raised foot goes down with its hip

    // ---- bone rotations and joint positions down the trunk (needed for the shoulders and hips)
    // a joint sits where its parent's bone carries it; a bone turns by its joint frame's turn from the rest pose
    const at = (j: number) => { const par = PARENT[j]; p[j].copy(bindPos[j]).sub(bindPos[par]).applyQuaternion(d[par]).add(p[par]); };
    const turn = (j: number) => d[j].multiplyQuaternions(f[j], this.restInv[j]);
    turn(J.hips);
    for (const j of [J.spine, J.chest, J.neck, J.head]) { at(j); turn(j); }

    // ---- legs
    for (let s = 0; s < 2; s++) {
      const [th, sh, ft] = LEGS[s];
      at(th);
      // the knee points where the rig's knee points
      tv.copy(cp[sh]).sub(cp[th]).applyAxisAngle(UP, this.legAim[s]);
      this.limb(p[th], feet[s], tv, tv2.set(0, 0, 1).applyQuaternion(cq[J.hips]), bindPos[th].distanceTo(bindPos[sh]), bindPos[sh].distanceTo(bindPos[ft]), true, th, sh);
      // a planted foot lies flat, turned the way the rig's foot is turned; a raised one does what the rig's does
      tv.set(0, 0, 1).applyQuaternion(cq[ft]);
      tq.setFromAxisAngle(UP, Math.atan2(tv.x, tv.z));
      f[ft].copy(cq[ft]).premultiply(aimQ.setFromAxisAngle(UP, this.legAim[s])).slerp(tq, plant[s]);
      turn(th); at(sh); turn(sh); at(ft); turn(ft);
    }

    // ---- arms
    for (let s = 0; s < 2; s++) {
      const [ar, fo, ha] = ARMS[s];
      at(ar);
      const a = bindPos[ar].distanceTo(bindPos[fo]), b = bindPos[fo].distanceTo(bindPos[ha]);
      tv.copy(cp[ha]).sub(cp[ar]).applyQuaternion(backQ);
      const aim = aimTurn(tv, tv.length() / this.rigArm[s], 0.1);
      tv.applyAxisAngle(UP, aim).multiplyScalar((a + b) / this.rigArm[s]).add(p[ar]);
      tv2.copy(cp[fo]).sub(cp[ar]).applyQuaternion(backQ).applyAxisAngle(UP, aim);
      this.limb(p[ar], tv, tv2, ELBOW_REST, a, b, false, ar, fo);
      f[ha].multiplyQuaternions(f[fo], joints[ha].quaternion);
      turn(ar); at(fo); turn(fo); at(ha); turn(ha);
    }

    // ---- keep the body off the floor when the feet are not carrying it (lying, rolling, airborne)
    let want = 0;
    if (!grounded) {
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
    for (const fg of this.fingers) fg.bone.quaternion.setFromAxisAngle(fg.axis, fg.angle * this.grip[fg.hand]).multiply(fg.rest);
    this.faceAnchor.position.copy(tv.copy(this.faceOff).applyQuaternion(d[J.head])).add(p[J.head]);
    this.faceAnchor.position.y += this.lift;
  }

  dispose() {
    for (const m of this.materials) m.dispose();
  }
}
