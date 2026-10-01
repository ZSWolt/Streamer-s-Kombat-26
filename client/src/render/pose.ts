// Pose = rotations for each joint of the procedural rig (model faces +z, left side = +x = lead side).
// Convention: rotation.x > 0 bends forward (spine/head) / swings a limb backward; limb forward raise is x < 0.

export const J = {
  hips: 0, spine: 1, chest: 2, neck: 3, head: 4,
  armL: 5, foreL: 6, handL: 7, armR: 8, foreR: 9, handR: 10,
  thighL: 11, shinL: 12, footL: 13, thighR: 14, shinR: 15, footR: 16,
} as const;
export type JointName = keyof typeof J;
export const JOINTS = Object.keys(J) as JointName[];
export const NJ = JOINTS.length;
// extra channels after joint rotations
export const EX_HIPY = NJ * 3; // hips height offset (m)
export const EX_HIPZ = NJ * 3 + 1; // hips forward offset (m)
export const EX_MOUTH = NJ * 3 + 2; // 0 closed .. 1 open
export const EX_EYES = NJ * 3 + 3; // 1 open .. 0 closed
// 0 = the pose was built on top of GUARD (unspecified joints mean "stay in your fighting stance"),
// 1 = authored from scratch (every joint is meant literally). Real models use this to keep their own stance.
export const EX_ABS = NJ * 3 + 4;
export const POSE_LEN = NJ * 3 + 5;

export type Pose = Float32Array;
export type PoseSpec = Partial<Record<JointName, [number, number, number]>> & { hy?: number; hz?: number; mouth?: number; eyes?: number };

export function makePose(spec: PoseSpec, base?: Pose): Pose {
  const p = base ? new Float32Array(base) : new Float32Array(POSE_LEN);
  if (!base) { p[EX_EYES] = 1; p[EX_ABS] = 1; }
  for (const k of JOINTS) {
    const v = spec[k];
    if (v) { const i = J[k] * 3; p[i] = v[0]; p[i + 1] = v[1]; p[i + 2] = v[2]; }
  }
  if (spec.hy !== undefined) p[EX_HIPY] = spec.hy;
  if (spec.hz !== undefined) p[EX_HIPZ] = spec.hz;
  if (spec.mouth !== undefined) p[EX_MOUTH] = spec.mouth;
  if (spec.eyes !== undefined) p[EX_EYES] = spec.eyes;
  return p;
}

export function lerpPose(a: Pose, b: Pose, t: number, out: Pose): Pose {
  for (let i = 0; i < POSE_LEN; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  return out;
}

export const ease = {
  linear: (t: number) => t,
  out: (t: number) => 1 - (1 - t) * (1 - t),
  in: (t: number) => t * t,
  inOut: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  back: (t: number) => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
};

// ----------------------------------------------------------------- library

export const NEUTRAL = makePose({});

export const GUARD = makePose({
  spine: [0.1, 0.15, 0], chest: [0.05, 0.1, 0], neck: [0, -0.1, 0], head: [-0.06, -0.15, 0],
  armL: [-1.05, 0, 0.32], foreL: [-1.75, 0, 0], handL: [0, 0, 0],
  armR: [-0.75, 0, -0.38], foreR: [-2.05, 0, 0],
  thighL: [-0.42, 0, 0.12], shinL: [0.5, 0, 0], footL: [-0.08, 0, 0],
  thighR: [0.28, 0, -0.14], shinR: [0.45, 0, 0], footR: [-0.2, 0, 0],
  hy: -0.06,
});
GUARD[EX_ABS] = 0;

const g = (spec: PoseSpec) => makePose(spec, GUARD);

export const CROUCH = g({
  spine: [0.35, 0.1, 0], head: [-0.25, -0.1, 0],
  thighL: [-1.35, 0, 0.28], shinL: [2.05, 0, 0], footL: [-0.7, 0, 0],
  thighR: [-0.9, 0, -0.3], shinR: [2.2, 0, 0], footR: [-1.0, 0, 0],
  hy: -0.42,
});

export const BLOCK = g({
  spine: [0.22, 0, 0], head: [0.15, 0, 0],
  armL: [-1.45, 0, 0.05], foreL: [-2.3, 0, 0], armR: [-1.35, 0, -0.08], foreR: [-2.35, 0, 0],
  mouth: 0.1,
});
export const BLOCK_CROUCH = makePose({
  spine: [0.45, 0, 0], head: [0.1, 0, 0],
  armL: [-1.35, 0, 0.05], foreL: [-2.3, 0, 0], armR: [-1.25, 0, -0.08], foreR: [-2.35, 0, 0],
}, CROUCH);

export const JUMP = g({
  spine: [0.25, 0, 0], thighL: [-1.4, 0, 0.2], shinL: [2.0, 0, 0], thighR: [-0.9, 0, -0.2], shinR: [2.1, 0, 0],
  armL: [-1.2, 0, 0.6], foreL: [-1.4, 0, 0], armR: [-0.6, 0, -0.7], foreR: [-1.2, 0, 0],
});

export const HIT_HIGH = g({
  spine: [-0.35, 0.2, 0.1], chest: [-0.2, 0, 0], head: [-0.5, 0.3, 0.2],
  armL: [-0.3, 0, 0.7], foreL: [-0.8, 0, 0], armR: [-0.2, 0, -0.8], foreR: [-0.6, 0, 0],
  mouth: 0.9, eyes: 0.2,
});
export const HIT_MID = g({
  spine: [0.6, 0, 0], chest: [0.35, 0, 0], head: [0.2, 0, 0],
  armL: [-0.5, 0, 0.3], foreL: [-1.6, 0, 0], armR: [-0.4, 0, -0.3], foreR: [-1.8, 0, 0],
  mouth: 1, eyes: 0.1, hy: -0.12, hz: -0.05,
});
export const AIR_HIT = makePose({
  hips: [-0.7, 0, 0], spine: [-0.3, 0, 0], head: [-0.4, 0, 0],
  armL: [-2.4, 0, 0.9], foreL: [-0.5, 0, 0], armR: [-2.2, 0, -1.0], foreR: [-0.6, 0, 0],
  thighL: [-0.9, 0, 0.3], shinL: [1.0, 0, 0], thighR: [-0.4, 0, -0.3], shinR: [0.8, 0, 0],
  mouth: 1, eyes: 0.1,
});
export const LYING = makePose({
  hips: [-1.52, 0, 0], spine: [-0.05, 0, 0], head: [0.25, 0.4, 0],
  armL: [-2.7, 0, 0.5], foreL: [-0.3, 0, 0], armR: [-0.3, 0, -0.9], foreR: [-0.4, 0, 0],
  thighL: [-0.1, 0, 0.15], shinL: [0.3, 0, 0], thighR: [-0.3, 0, -0.1], shinR: [0.7, 0, 0],
  hy: -0.72, hz: -0.1, eyes: 0, mouth: 0.4,
});
export const GETUP = makePose({
  hips: [-0.4, 0, 0], spine: [0.6, 0, 0], armL: [-0.4, 0, 0.8], foreL: [-0.4, 0, 0], armR: [0.2, 0, -0.5],
  thighL: [-1.5, 0, 0.3], shinL: [2.1, 0, 0], thighR: [-0.6, 0, -0.2], shinR: [1.8, 0, 0], hy: -0.55,
});
export const DIZZY = g({
  spine: [0.15, 0, 0.12], head: [0.2, 0.2, 0.3], armL: [0.1, 0, 0.35], foreL: [-0.3, 0, 0], armR: [0.1, 0, -0.3], foreR: [-0.4, 0, 0],
  thighL: [-0.2, 0, 0.12], shinL: [0.3, 0, 0], thighR: [0.1, 0, -0.1], shinR: [0.3, 0, 0], mouth: 0.6, eyes: 0.35,
});
export const WIN = makePose({
  spine: [-0.15, 0, 0], head: [-0.3, 0, 0],
  armL: [-2.9, 0, 0.35], foreL: [-0.4, 0, 0], armR: [-2.7, 0, -0.3], foreR: [-0.6, 0, 0],
  thighL: [-0.05, 0, 0.18], thighR: [0.05, 0, -0.18], mouth: 0.8,
});
export const WIN2 = makePose({
  spine: [0.05, -0.2, 0], head: [-0.15, -0.3, 0],
  armL: [-0.4, 0, 0.55], foreL: [-2.2, 0, 0], armR: [-2.6, 0, -0.5], foreR: [-1.4, 0, 0],
  thighL: [-0.1, 0, 0.2], thighR: [0.1, 0, -0.2], mouth: 0.5,
});
export const TAUNT = makePose({
  spine: [-0.05, 0.4, 0], head: [-0.1, -0.5, 0.1],
  armL: [-0.3, 0, 0.5], foreL: [-2.3, 0, 0], armR: [-1.6, 0, -1.2], foreR: [-0.5, 0, 0],
  thighL: [-0.1, 0, 0.18], thighR: [0.1, 0, -0.18], mouth: 0.6,
});
export const SEATED = makePose({
  thighL: [-1.55, 0, 0.12], shinL: [1.55, 0, 0], thighR: [-1.55, 0, -0.12], shinR: [1.55, 0, 0], hy: -0.36,
});

export interface AttackAnim { wind: Pose; hit: Pose; follow?: Pose; air?: boolean; crouch?: boolean }

const crouchBase = (spec: PoseSpec) => makePose(spec, CROUCH);
const jumpBase = (spec: PoseSpec) => makePose(spec, JUMP);

export const ATTACKS: Record<string, AttackAnim> = {
  jab: {
    wind: g({ armL: [-1.25, 0, 0.3], foreL: [-2.0, 0, 0], spine: [0.1, 0.05, 0] }),
    hit: g({ armL: [-1.55, 0.1, 0.1], foreL: [-0.08, 0, 0], spine: [0.15, 0.35, 0], chest: [0.1, 0.2, 0], mouth: 0.3 }),
  },
  straight: {
    wind: g({ armR: [-0.55, 0, -0.35], foreR: [-2.3, 0, 0], spine: [0.1, -0.35, 0] }),
    hit: g({ armR: [-1.62, 0, -0.05], foreR: [-0.05, 0, 0], spine: [0.22, 0.65, 0], chest: [0.12, 0.3, 0], thighR: [0.45, 0, -0.12], mouth: 0.6 }),
  },
  lowkick: {
    wind: g({ thighL: [-1.1, 0, 0.1], shinL: [1.8, 0, 0], spine: [0.0, 0.1, 0] }),
    hit: g({ thighL: [-1.5, 0, 0.05], shinL: [0.1, 0, 0], footL: [0.4, 0, 0], spine: [-0.2, 0.2, 0], mouth: 0.4 }),
  },
  roundhouse: {
    wind: g({ thighR: [-0.9, 0, -0.5], shinR: [1.9, 0, 0], spine: [0.05, -0.45, 0], chest: [0, -0.2, 0] }),
    hit: g({ thighR: [-1.65, 0, -0.95], shinR: [0.1, 0, 0], footR: [0.3, 0, 0], spine: [-0.35, 0.85, -0.1], chest: [0, 0.3, 0], thighL: [-0.1, 0, 0.1], shinL: [0.2, 0, 0], mouth: 0.7, hy: 0.04 }),
  },
  cjab: {
    crouch: true,
    wind: crouchBase({ armL: [-1.1, 0, 0.3], foreL: [-2.0, 0, 0] }),
    hit: crouchBase({ armL: [-1.45, 0.1, 0.1], foreL: [-0.1, 0, 0], spine: [0.4, 0.35, 0], mouth: 0.3 }),
  },
  uppercut: {
    crouch: true,
    wind: crouchBase({ armR: [0.35, 0, -0.3], foreR: [-1.9, 0, 0], spine: [0.55, -0.3, 0] }),
    hit: g({ armR: [-2.85, 0, -0.1], foreR: [-0.35, 0, 0], spine: [-0.25, 0.45, 0], head: [-0.4, 0, 0], thighR: [0.2, 0, -0.1], shinR: [0.1, 0, 0], hy: 0.08, mouth: 0.9 }),
  },
  clowkick: {
    crouch: true,
    wind: crouchBase({ thighL: [-1.4, 0, 0.3], shinL: [2.2, 0, 0] }),
    hit: crouchBase({ thighL: [-1.15, 0, 0.3], shinL: [0.15, 0, 0], footL: [0.3, 0, 0], spine: [0.2, 0.2, 0], hy: -0.5 }),
  },
  sweep: {
    crouch: true,
    wind: crouchBase({ spine: [0.6, -0.5, 0], armL: [0.2, 0, 0.5], armR: [0.3, 0, -0.5] }),
    hit: crouchBase({ thighR: [-1.4, 0, -1.25], shinR: [0.15, 0, 0], spine: [0.7, 0.9, 0], armL: [0.3, 0, 0.9], foreL: [-0.2, 0, 0], hy: -0.62, mouth: 0.5 }),
  },
  jpunch: {
    air: true,
    wind: jumpBase({ armL: [-1.4, 0, 0.3], foreL: [-2.1, 0, 0] }),
    hit: jumpBase({ armL: [-1.05, 0, 0.1], foreL: [-0.05, 0, 0], spine: [0.45, 0.3, 0], mouth: 0.4 }),
  },
  jheavy: {
    air: true,
    wind: jumpBase({ armL: [-2.7, 0, 0.2], foreL: [-1.2, 0, 0], armR: [-2.7, 0, -0.2], foreR: [-1.2, 0, 0], spine: [-0.3, 0, 0] }),
    hit: jumpBase({ armL: [-0.9, 0, 0.1], foreL: [-0.3, 0, 0], armR: [-0.9, 0, -0.1], foreR: [-0.3, 0, 0], spine: [0.6, 0, 0], mouth: 0.8 }),
  },
  jkick: {
    air: true,
    wind: jumpBase({ thighL: [-1.6, 0, 0.1], shinL: [2.2, 0, 0] }),
    hit: jumpBase({ thighL: [-1.2, 0, 0.1], shinL: [0.1, 0, 0], footL: [0.5, 0, 0], thighR: [0.4, 0, -0.1], shinR: [1.5, 0, 0], spine: [-0.1, 0.2, 0], mouth: 0.5 }),
  },
  jheavykick: {
    air: true,
    wind: jumpBase({ thighR: [-1.4, 0, -0.3], shinR: [2.2, 0, 0], spine: [0.1, -0.4, 0] }),
    hit: jumpBase({ thighR: [-1.1, 0, -0.6], shinR: [0.05, 0, 0], footR: [0.4, 0, 0], thighL: [0.3, 0, 0.1], shinL: [1.4, 0, 0], spine: [-0.3, 0.7, 0], mouth: 0.8 }),
  },
  overhead: {
    wind: g({ armR: [-3.0, 0, -0.3], foreR: [-1.1, 0, 0], spine: [-0.25, -0.2, 0], head: [-0.2, 0, 0] }),
    hit: g({ armR: [-1.05, 0, -0.1], foreR: [-0.15, 0, 0], spine: [0.5, 0.35, 0], head: [0.1, 0, 0], thighL: [-0.7, 0, 0.1], shinL: [0.8, 0, 0], mouth: 0.8, hy: -0.12 }),
  },
  throw: {
    wind: g({ armL: [-1.45, 0, 0.1], foreL: [-0.4, 0, 0], armR: [-1.4, 0, -0.1], foreR: [-0.5, 0, 0], spine: [0.3, 0, 0] }),
    hit: g({ armL: [-1.8, 0, 0.3], foreL: [-1.2, 0, 0], armR: [-1.6, 0, -0.4], foreR: [-1.3, 0, 0], spine: [0.1, 1.2, 0], mouth: 0.7 }),
  },
  // --- special move animations
  shoulder: {
    wind: g({ spine: [0.3, -0.5, 0], armL: [-0.4, 0, 0.2], foreL: [-2.2, 0, 0] }),
    hit: g({ spine: [0.55, 0.2, 0], chest: [0.2, 0, 0], armL: [-0.5, 0, 0.1], foreL: [-2.3, 0, 0], thighR: [0.8, 0, -0.1], shinR: [0.4, 0, 0], thighL: [-0.8, 0, 0.1], hy: -0.12, mouth: 0.8 }),
  },
  counter: {
    wind: g({ armL: [-1.5, 0, -0.1], foreL: [-2.4, 0, 0], armR: [-1.5, 0, 0.1], foreR: [-2.4, 0, 0], spine: [0.05, 0, 0], mouth: 0.2 }),
    hit: g({ armL: [-1.5, 0, -0.1], foreL: [-2.4, 0, 0], armR: [-1.5, 0, 0.1], foreR: [-2.4, 0, 0], spine: [-0.1, 0, 0], head: [-0.2, 0.2, 0], mouth: 0.6 }),
    follow: g({ armR: [-1.62, 0, -0.05], foreR: [-0.05, 0, 0], spine: [0.22, 0.65, 0], mouth: 0.9 }),
  },
  chops: {
    wind: g({ armL: [-2.6, 0, 0.2], foreL: [-0.4, 0, 0], armR: [-2.3, 0, -0.2], foreR: [-0.6, 0, 0] }),
    hit: g({ armL: [-1.2, 0, 0.1], foreL: [-0.1, 0, 0], armR: [-2.6, 0, -0.2], foreR: [-0.5, 0, 0], spine: [0.3, 0.3, 0], mouth: 0.9 }),
    follow: g({ armL: [-2.6, 0, 0.2], foreL: [-0.4, 0, 0], armR: [-1.2, 0, -0.1], foreR: [-0.1, 0, 0], spine: [0.3, -0.2, 0], mouth: 0.9 }),
  },
  turtle: {
    wind: g({ spine: [0.9, 0, 0], head: [0.5, 0, 0], thighL: [-1.8, 0, 0.2], shinL: [2.3, 0, 0], thighR: [-1.8, 0, -0.2], shinR: [2.3, 0, 0], armL: [-0.3, 0, 0.3], foreL: [-2.4, 0, 0], armR: [-0.3, 0, -0.3], foreR: [-2.4, 0, 0], hy: -0.5 }),
    hit: g({ hips: [1.2, 0, 0], spine: [1.0, 0, 0], head: [0.5, 0, 0], thighL: [-2.0, 0, 0.2], shinL: [2.4, 0, 0], thighR: [-2.0, 0, -0.2], shinR: [2.4, 0, 0], armL: [-0.4, 0, 0.2], foreL: [-2.5, 0, 0], armR: [-0.4, 0, -0.2], foreR: [-2.5, 0, 0], hy: -0.62 }),
  },
  meditate: {
    wind: g({ armL: [-1.0, 0, -0.3], foreL: [-1.6, 0, 0], armR: [-1.0, 0, 0.3], foreR: [-1.6, 0, 0], eyes: 0 }),
    hit: g({ armL: [-1.0, 0, -0.35], foreL: [-1.7, 0, 0], armR: [-1.0, 0, 0.35], foreR: [-1.7, 0, 0], spine: [-0.05, 0, 0], head: [-0.05, 0, 0], eyes: 0, hy: -0.18, thighL: [-0.7, 0, 0.4], shinL: [1.3, 0, 0], thighR: [-0.3, 0, -0.4], shinR: [1.2, 0, 0] }),
    follow: g({ armL: [-1.55, 0, 0.1], foreL: [-0.05, 0, 0], spine: [0.2, 0.4, 0], mouth: 0.8 }),
  },
  reflect: {
    wind: g({ armL: [-0.9, 0, 0.2], foreL: [-2.0, 0, 0], armR: [-0.9, 0, -0.2], foreR: [-2.0, 0, 0] }),
    hit: g({ armL: [-1.55, 0, -0.1], foreL: [-0.2, 0, 0], armR: [-1.55, 0, 0.1], foreR: [-0.2, 0, 0], spine: [0.1, 0, 0], mouth: 0.4 }),
  },
  dashpunch: {
    wind: g({ spine: [0.2, -0.4, 0], armL: [-0.8, 0, 0.3], foreL: [-2.2, 0, 0] }),
    hit: g({ spine: [0.5, 0.4, 0], armL: [-1.6, 0, 0.05], foreL: [-0.05, 0, 0], thighR: [0.9, 0, -0.1], shinR: [0.5, 0, 0], thighL: [-0.9, 0, 0.1], shinL: [0.9, 0, 0], hy: -0.14, mouth: 0.9 }),
  },
  slam: {
    wind: jumpBase({ armL: [-2.9, 0, 0.3], foreL: [-0.6, 0, 0], armR: [-2.9, 0, -0.3], foreR: [-0.6, 0, 0], spine: [-0.3, 0, 0] }),
    hit: g({ armL: [-0.7, 0, 0.1], foreL: [-0.2, 0, 0], armR: [-0.7, 0, -0.1], foreR: [-0.2, 0, 0], spine: [0.8, 0, 0], head: [0.2, 0, 0], hy: -0.25, mouth: 1 }),
  },
  yawn: {
    wind: g({ armL: [-2.9, 0, 0.5], foreL: [-0.8, 0, 0], armR: [-2.9, 0, -0.5], foreR: [-0.8, 0, 0], spine: [-0.3, 0, 0], head: [-0.4, 0, 0], mouth: 1, eyes: 0 }),
    hit: g({ armL: [-1.5, 0, 0.1], foreL: [-0.3, 0, 0], armR: [-0.4, 0, -0.3], foreR: [-1.5, 0, 0], spine: [0.2, 0.3, 0], mouth: 0.8, eyes: 0.2 }),
  },
  summon: {
    wind: g({ armL: [-0.4, 0, 0.6], foreL: [-2.4, 0, 0], head: [-0.2, 0.3, 0], mouth: 0.8 }),
    hit: g({ armL: [-1.7, 0, 0.1], foreL: [0, 0, 0], armR: [-0.3, 0, -0.5], foreR: [-1.5, 0, 0], spine: [-0.05, 0.3, 0], mouth: 1 }),
  },
  point: {
    wind: g({ armL: [-2.2, 0, 0.3], foreL: [-1.2, 0, 0], mouth: 0.5 }),
    hit: g({ armL: [-1.8, 0, 0.1], foreL: [-0.05, 0, 0], armR: [-0.2, 0, -0.4], foreR: [-1.9, 0, 0], spine: [-0.1, 0.35, 0], mouth: 0.8 }),
  },
  stomp: {
    wind: g({ thighL: [-1.5, 0, 0.2], shinL: [1.7, 0, 0], spine: [-0.1, 0, 0], armL: [-1.6, 0, 0.8], armR: [-1.6, 0, -0.8], hy: 0.05 }),
    hit: g({ thighL: [-0.5, 0, 0.3], shinL: [0.6, 0, 0], spine: [0.4, 0, 0], armL: [-0.3, 0, 0.9], foreL: [-0.5, 0, 0], armR: [-0.3, 0, -0.9], foreR: [-0.5, 0, 0], hy: -0.25, mouth: 1 }),
  },
  guitar: {
    wind: g({ armL: [-2.8, 0, 0.1], foreL: [-0.9, 0, 0], armR: [-2.8, 0, -0.1], foreR: [-0.9, 0, 0], spine: [-0.35, 0, 0], head: [-0.3, 0, 0], mouth: 1 }),
    hit: g({ armL: [-1.1, 0, 0.1], foreL: [-0.2, 0, 0], armR: [-1.1, 0, -0.1], foreR: [-0.2, 0, 0], spine: [0.7, 0.1, 0], hy: -0.2, mouth: 1 }),
  },
  lob: {
    wind: g({ armR: [0.9, 0, -0.3], foreR: [-0.6, 0, 0], spine: [-0.1, -0.4, 0] }),
    hit: g({ armR: [-2.3, 0, -0.2], foreR: [-0.3, 0, 0], spine: [0.15, 0.4, 0], mouth: 0.7 }),
  },
  throw_: {
    wind: g({ armR: [-2.6, 0, -0.5], foreR: [-1.6, 0, 0], spine: [-0.1, -0.5, 0], thighL: [-0.7, 0, 0.1] }),
    hit: g({ armR: [-1.5, 0, 0], foreR: [-0.1, 0, 0], spine: [0.35, 0.6, 0], thighR: [0.5, 0, -0.1], mouth: 0.7 }),
  },
  hypno: {
    wind: g({ armL: [-1.6, 0, 0.9], foreL: [-2.5, 0, 0], armR: [-1.6, 0, -0.9], foreR: [-2.5, 0, 0], eyes: 1, mouth: 0.2 }),
    hit: g({ armL: [-1.55, 0, 0.2], foreL: [-0.1, 0, 0], armR: [-1.45, 0, -0.2], foreR: [-0.2, 0, 0], spine: [0.15, 0, 0], mouth: 0.5 }),
  },
  swap: {
    wind: g({ armR: [-1.3, 0, -0.4], foreR: [-1.6, 0, 0], head: [-0.1, -0.3, 0] }),
    hit: g({ armR: [-2.0, 0, -0.6], foreR: [-0.8, 0, 0], spine: [-0.1, 0.3, 0], mouth: 0.6 }),
  },
  snipe: {
    wind: g({ armL: [-1.6, 0, 0.05], foreL: [-0.05, 0, 0], armR: [-1.3, 0, 0.35], foreR: [-0.9, 0, 0], head: [0.05, 0.2, 0] }),
    hit: g({ armL: [-1.8, 0, 0.05], foreL: [-0.3, 0, 0], armR: [-1.4, 0, 0.35], foreR: [-1.1, 0, 0], spine: [-0.1, 0, 0], mouth: 0.6 }),
  },
  teleport: {
    wind: g({ spine: [0.5, 0, 0], hy: -0.3, armL: [-0.2, 0, 0.3], armR: [-0.2, 0, -0.3], eyes: 0 }),
    hit: g({ spine: [0.1, 0.3, 0], armL: [-1.4, 0, 0.1], foreL: [-0.2, 0, 0], mouth: 0.6 }),
  },
  lariat: {
    wind: g({ armR: [-0.3, 0, -1.3], foreR: [-0.3, 0, 0], spine: [0.2, -0.6, 0] }),
    hit: g({ armR: [-1.55, 0, -0.9], foreR: [-0.1, 0, 0], spine: [0.3, 0.9, 0], thighR: [0.7, 0, -0.1], hy: -0.1, mouth: 1 }),
  },
  grab: {
    wind: g({ armL: [-1.5, 0, 0.3], foreL: [-0.3, 0, 0], armR: [-1.5, 0, -0.3], foreR: [-0.3, 0, 0], spine: [0.4, 0, 0] }),
    hit: g({ armL: [-2.6, 0, 0.3], foreL: [-0.6, 0, 0], armR: [-2.6, 0, -0.3], foreR: [-0.6, 0, 0], spine: [-0.4, 0, 0], mouth: 1 }),
  },
  glitch: {
    wind: g({ armL: [-1.25, 0.4, 0.3], foreL: [-2.0, 0, 0], head: [0, 0.6, 0.3] }),
    hit: g({ armL: [-1.55, -0.2, 0.1], foreL: [-0.08, 0, 0], spine: [0.15, 0.35, 0.2], head: [0.3, -0.5, -0.2], mouth: 0.5 }),
    follow: g({ armR: [-1.62, 0.3, -0.05], foreR: [-0.05, 0, 0], spine: [0.22, 0.65, -0.2], head: [-0.2, 0.4, 0.3] }),
  },
  kickball: {
    wind: g({ thighL: [0.6, 0, 0.1], shinL: [1.6, 0, 0], armR: [-1.2, 0, -0.6], spine: [-0.1, 0, 0] }),
    hit: g({ thighL: [-1.7, 0, 0.1], shinL: [0.05, 0, 0], footL: [0.5, 0, 0], armR: [-0.6, 0, -0.9], armL: [-0.2, 0, 0.8], spine: [-0.4, 0.2, 0], mouth: 0.9 }),
  },
  club: {
    wind: g({ armL: [-2.95, 0, 0.1], foreL: [-1.3, 0, 0], armR: [-2.95, 0, -0.1], foreR: [-1.3, 0, 0], spine: [-0.4, 0, 0], head: [-0.4, 0, 0], mouth: 1 }),
    hit: g({ armL: [-0.9, 0, 0.05], foreL: [-0.1, 0, 0], armR: [-0.9, 0, -0.05], foreR: [-0.1, 0, 0], spine: [0.8, 0, 0], hy: -0.22, mouth: 1 }),
  },
  roll: {
    wind: g({ spine: [0.9, 0, 0], head: [0.5, 0, 0], thighL: [-1.8, 0, 0.2], shinL: [2.3, 0, 0], thighR: [-1.8, 0, -0.2], shinR: [2.3, 0, 0], hy: -0.5 }),
    hit: g({ hips: [2.5, 0, 0], spine: [1.0, 0, 0], head: [0.5, 0, 0], thighL: [-2.0, 0, 0.2], shinL: [2.4, 0, 0], thighR: [-2.0, 0, -0.2], shinR: [2.4, 0, 0], armL: [-0.4, 0, 0.2], foreL: [-2.5, 0, 0], armR: [-0.4, 0, -0.2], foreR: [-2.5, 0, 0], hy: -0.62 }),
  },
  scream: {
    wind: g({ spine: [0.4, 0, 0], head: [0.3, 0, 0], armL: [-0.3, 0, 0.3], armR: [-0.3, 0, -0.3], mouth: 0.3 }),
    hit: g({ spine: [-0.35, 0, 0], chest: [-0.2, 0, 0], head: [-0.45, 0, 0], armL: [-0.6, 0, 1.3], foreL: [-0.3, 0, 0], armR: [-0.6, 0, -1.3], foreR: [-0.3, 0, 0], mouth: 1, eyes: 0.4 }),
  },
  slide: {
    wind: g({ spine: [0.3, 0, 0], hy: -0.3 }),
    hit: makePose({ hips: [-0.95, 0, 0], spine: [0.25, 0, 0], head: [0.3, 0, 0], armL: [-0.4, 0, 0.9], armR: [0.2, 0, -0.7], thighL: [-0.55, 0, 0.1], shinL: [0.1, 0, 0], thighR: [-0.1, 0, -0.1], shinR: [1.4, 0, 0], hy: -0.62, mouth: 0.8 }),
  },
  scissor: {
    wind: jumpBase({ thighL: [-1.3, 0, 0.8], shinL: [0.3, 0, 0], thighR: [-1.3, 0, -0.8], shinR: [0.3, 0, 0], spine: [-0.3, 0, 0] }),
    hit: jumpBase({ thighL: [-1.4, 0, 0.1], shinL: [0.1, 0, 0], thighR: [-1.2, 0, -0.1], shinR: [0.1, 0, 0], spine: [-0.5, 0, 0], armL: [-0.6, 0, 1.2], armR: [-0.6, 0, -1.2], mouth: 0.9 }),
  },
  hype: {
    wind: g({ armL: [-0.2, 0, 0.8], foreL: [-2.3, 0, 0], armR: [-0.2, 0, -0.8], foreR: [-2.3, 0, 0], spine: [-0.3, 0, 0], head: [-0.5, 0, 0], mouth: 1, hy: -0.15 }),
    hit: g({ armL: [-1.6, 0, 0.05], foreL: [0, 0, 0], armR: [-1.6, 0, -0.05], foreR: [0, 0, 0], spine: [0.4, 0, 0], mouth: 1, hy: -0.1 }),
  },
  clones: {
    wind: g({ spine: [0.2, -0.4, 0], armL: [-0.8, 0, 0.3], foreL: [-2.2, 0, 0] }),
    hit: g({ spine: [0.5, 0.4, 0], armL: [-1.6, 0, 0.05], foreL: [-0.05, 0, 0], thighR: [0.9, 0, -0.1], shinR: [0.5, 0, 0], thighL: [-0.9, 0, 0.1], shinL: [0.9, 0, 0], hy: -0.14, mouth: 0.9 }),
    follow: g({ spine: [0.5, -0.4, 0], armR: [-1.6, 0, -0.05], foreR: [-0.05, 0, 0], hy: -0.14, mouth: 0.9 }),
  },
};
// alias: special "throw" anim (projectile toss) is distinct from the grab-throw normal
ATTACKS.toss = ATTACKS.throw_;
ATTACKS.straightSp = ATTACKS.straight;
