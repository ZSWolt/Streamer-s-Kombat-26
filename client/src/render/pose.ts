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
export const POSE_LEN = NJ * 3 + 4;

export type Pose = Float32Array;
export type PoseSpec = Partial<Record<JointName, [number, number, number]>> & { hy?: number; hz?: number; mouth?: number; eyes?: number };

export function makePose(spec: PoseSpec, base?: Pose): Pose {
  const p = base ? new Float32Array(base) : new Float32Array(POSE_LEN);
  if (!base) p[EX_EYES] = 1;
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

// ----------------------------------------------------------------- pose libraries
// Everything above was drawn for the vinyl toy: stubby limbs and a huge head, so it twists and hunches far more
// than a body can and throws its arms straight overhead. The real models (render/model.ts) get their own set,
// HUMAN: the same poses with the stance changed everywhere the toy's guard shows through, and the moves that
// only read on a toy drawn again for a person.

export interface PoseLib {
  GUARD: Pose; CROUCH: Pose; BLOCK: Pose; BLOCK_CROUCH: Pose; JUMP: Pose; HIT_HIGH: Pose; HIT_MID: Pose; AIR_HIT: Pose;
  LYING: Pose; GETUP: Pose; DIZZY: Pose; WIN: Pose; WIN2: Pose; TAUNT: Pose;
  /** standing for the camera (character select) */
  STAND: Pose; DASH_F: Pose; DASH_B: Pose;
  ATTACKS: Record<string, AttackAnim>;
}

export const CLASSIC: PoseLib = {
  GUARD, CROUCH, BLOCK, BLOCK_CROUCH, JUMP, HIT_HIGH, HIT_MID, AIR_HIT, LYING, GETUP, DIZZY, WIN, WIN2, TAUNT,
  STAND: GUARD,
  DASH_F: g({ spine: [0.45, 0.1, 0], head: [-0.2, 0, 0], thighL: [-1.1, 0, 0.1], shinL: [0.6, 0, 0], thighR: [0.9, 0, -0.1], shinR: [0.9, 0, 0], hy: -0.14 }),
  DASH_B: g({ spine: [-0.25, 0, 0], thighL: [-0.5, 0, 0.1], shinL: [1.2, 0, 0], thighR: [-0.3, 0, -0.1], shinR: [1.1, 0, 0], hy: 0.05 }),
  ATTACKS,
};

/** A boxer's stance: upright, weight on the balls of the feet, lead hand out, rear hand by the chin. */
const H_GUARD = makePose({
  spine: [0.07, 0.12, 0], chest: [0.03, 0.08, 0], neck: [0, -0.08, 0], head: [-0.04, -0.12, 0],
  armL: [-1.0, 0, 0.3], foreL: [-1.85, 0, 0],
  armR: [-0.7, 0, -0.36], foreR: [-2.15, 0, 0],
  thighL: [-0.36, 0, 0.1], shinL: [0.42, 0, 0], footL: [-0.06, 0, 0],
  thighR: [0.24, 0, -0.12], shinR: [0.4, 0, 0], footR: [-0.16, 0, 0],
  hy: -0.04,
});
const hg = (spec: PoseSpec) => makePose(spec, H_GUARD);

/** The toy's pose with the human stance wherever the toy's own guard was showing through. */
function humanize(p: Pose): Pose {
  const out = new Float32Array(p);
  for (let j = 0; j < NJ; j++) {
    const i = j * 3;
    if (p[i] === GUARD[i] && p[i + 1] === GUARD[i + 1] && p[i + 2] === GUARD[i + 2]) { out[i] = H_GUARD[i]; out[i + 1] = H_GUARD[i + 1]; out[i + 2] = H_GUARD[i + 2]; }
  }
  if (p[EX_HIPY] === GUARD[EX_HIPY]) out[EX_HIPY] = H_GUARD[EX_HIPY];
  return out;
}
const humanAttack = (a: AttackAnim): AttackAnim => ({ ...a, wind: humanize(a.wind), hit: humanize(a.hit), follow: a.follow && humanize(a.follow) });

const H_ATTACKS: Record<string, AttackAnim> = {};
for (const k of Object.keys(ATTACKS)) H_ATTACKS[k] = humanAttack(ATTACKS[k]);
Object.assign(H_ATTACKS, {
  // lead hand snaps out, lead shoulder behind it
  jab: {
    wind: hg({ armL: [-1.2, 0, 0.28], foreL: [-2.1, 0, 0], spine: [0.06, 0.02, 0] }),
    hit: hg({ armL: [-1.78, 0, 0.02], foreL: [-0.05, 0, 0], spine: [0.1, -0.28, 0], chest: [0.04, -0.14, 0], head: [-0.04, 0.2, 0], mouth: 0.3 }),
  },
  // the cross: rear hip and shoulder turn through, rear heel comes up
  straight: {
    wind: hg({ armR: [-0.6, 0, -0.42], foreR: [-2.3, 0, 0], spine: [0.07, -0.25, 0], chest: [0.03, -0.1, 0] }),
    hit: hg({ armR: [-1.8, 0, -0.08], foreR: [-0.04, 0, 0], spine: [0.14, 0.58, 0], chest: [0.06, 0.3, 0], head: [-0.06, -0.6, 0], armL: [-0.85, 0, 0.3], foreL: [-2.15, 0, 0], thighR: [0.42, 0, -0.12], shinR: [0.55, 0, 0], mouth: 0.6 }),
  },
  // lead leg whips out at thigh height, body leans away
  lowkick: {
    wind: hg({ thighL: [-1.05, 0, 0.1], shinL: [1.75, 0, 0], spine: [0.0, 0.1, 0], thighR: [0.12, 0, -0.1], shinR: [0.25, 0, 0] }),
    hit: hg({ thighL: [-1.28, 0, 0.04], shinL: [0.1, 0, 0], footL: [0.5, 0, 0], spine: [-0.2, 0.2, 0], thighR: [0.1, 0, -0.1], shinR: [0.2, 0, 0], armL: [-0.5, 0, 0.5], foreL: [-1.4, 0, 0], mouth: 0.4 }),
  },
  // rear leg comes round with the hips, torso leans back off the line, rear arm swings down for balance
  roundhouse: {
    wind: hg({ hips: [0, 0.5, 0], thighR: [-1.25, 0, -0.5], shinR: [2.1, 0, 0], spine: [0.02, -0.3, 0], chest: [0, -0.1, 0], thighL: [-0.08, 0, 0.08], shinL: [0.25, 0, 0], head: [-0.04, -0.2, 0] }),
    hit: hg({ hips: [0, 1.05, 0], spine: [-0.16, -0.3, -0.28], chest: [0, -0.2, 0], head: [0.05, -0.5, 0.2], thighR: [-1.9, 0, -1.0], shinR: [0.06, 0, 0], footR: [0.55, 0, 0], thighL: [-0.02, 0, 0.04], shinL: [0.14, 0, 0], footL: [0, 0, 0], armR: [0.55, 0, -0.5], foreR: [-0.5, 0, 0], armL: [-1.0, 0, 0.35], foreL: [-2.0, 0, 0], mouth: 0.7, hy: 0.03 }),
  },
  // overhand throw (cards, chips, coins): hand cocked behind the ear, then whipped forward and down
  throw_: {
    wind: hg({ armR: [-2.0, 0.3, -1.4], foreR: [-1.9, 0, 0], spine: [-0.05, -0.45, 0], chest: [0, -0.15, 0], head: [-0.04, 0.4, 0], armL: [-1.35, 0, 0.2], foreL: [-0.8, 0, 0], thighL: [-0.5, 0, 0.1] }),
    hit: hg({ armR: [-1.72, 0, -0.1], foreR: [-0.1, 0, 0], spine: [0.2, 0.55, 0], chest: [0.08, 0.25, 0], head: [-0.1, -0.6, 0], armL: [-0.45, 0, 0.4], foreL: [-1.8, 0, 0], thighR: [0.45, 0, -0.1], shinR: [0.5, 0, 0], mouth: 0.7 }),
  },
  // pushing front kick
  kickball: {
    wind: hg({ thighL: [-1.5, 0, 0.08], shinL: [2.0, 0, 0], spine: [-0.05, 0, 0], thighR: [0.1, 0, -0.1], shinR: [0.2, 0, 0] }),
    hit: hg({ thighL: [-1.62, 0, 0.05], shinL: [0.05, 0, 0], footL: [0.2, 0, 0], spine: [-0.3, 0.15, 0], thighR: [0.12, 0, -0.1], shinR: [0.18, 0, 0], armR: [-0.4, 0, -0.6], foreR: [-1.2, 0, 0], armL: [-0.3, 0, 0.55], foreL: [-1.0, 0, 0], mouth: 0.9 }),
  },
  // rising uppercut: legs drive up, fist finishes above the head
  uppercut: {
    crouch: true,
    wind: humanize(ATTACKS.uppercut.wind),
    hit: hg({ armR: [-2.5, 0, -0.25], foreR: [-0.9, 0, 0], spine: [-0.15, 0.4, 0], chest: [0, 0.2, 0], head: [-0.3, -0.4, 0], thighR: [0.15, 0, -0.1], shinR: [0.12, 0, 0], thighL: [-0.2, 0, 0.1], shinL: [0.22, 0, 0], hy: 0.04, mouth: 0.9 }),
  },
  // drops onto the lead leg and scythes the rear one along the floor
  sweep: {
    crouch: true,
    wind: humanize(ATTACKS.sweep.wind),
    hit: makePose({ thighR: [-1.42, 0, -0.05], shinR: [0.08, 0, 0], footR: [0.35, 0, 0], thighL: [-1.5, 0, 0.35], shinL: [2.3, 0, 0], footL: [-0.8, 0, 0], spine: [0.5, 0.6, 0], armL: [0.3, 0, 0.9], foreL: [-0.2, 0, 0], hy: -0.5, mouth: 0.5 }, humanize(CROUCH)),
  },
  // hammering overhead blow
  overhead: {
    wind: hg({ armR: [-2.3, 0.2, -1.1], foreR: [-1.5, 0, 0], spine: [-0.15, -0.25, 0], head: [-0.1, 0.2, 0] }),
    hit: hg({ armR: [-1.25, 0, -0.1], foreR: [-0.2, 0, 0], spine: [0.38, 0.4, 0], chest: [0.1, 0.15, 0], head: [-0.15, -0.4, 0], thighL: [-0.6, 0, 0.1], shinL: [0.75, 0, 0], mouth: 0.8, hy: -0.08 }),
  },
} satisfies Record<string, AttackAnim>);
H_ATTACKS.toss = H_ATTACKS.throw_;
H_ATTACKS.straightSp = H_ATTACKS.straight;

export const HUMAN: PoseLib = {
  GUARD: H_GUARD,
  CROUCH: humanize(CROUCH), BLOCK: humanize(BLOCK), BLOCK_CROUCH: humanize(BLOCK_CROUCH), JUMP: humanize(JUMP),
  HIT_HIGH: humanize(HIT_HIGH), HIT_MID: humanize(HIT_MID), AIR_HIT, LYING, GETUP,
  DIZZY: humanize(DIZZY),
  // both fists up in a V
  WIN: makePose({
    spine: [-0.08, 0, 0], chest: [-0.08, 0, 0], head: [-0.18, 0, 0],
    armL: [-0.25, 0, 2.35], foreL: [-0.45, 0, 0], armR: [-0.25, 0, -2.35], foreR: [-0.45, 0, 0],
    thighL: [-0.03, 0, 0.12], shinL: [0.06, 0, 0], thighR: [0.03, 0, -0.12], shinR: [0.06, 0, 0], mouth: 0.8,
  }),
  // ... and pumped: elbows drop, fists by the ears
  WIN2: makePose({
    spine: [0.02, 0, 0], chest: [-0.04, 0, 0], head: [-0.1, 0, 0],
    armL: [-0.3, 0, 1.75], foreL: [-1.5, 0, 0], armR: [-0.3, 0, -1.75], foreR: [-1.5, 0, 0],
    thighL: [-0.1, 0, 0.14], shinL: [0.22, 0, 0], thighR: [0.02, 0, -0.14], shinR: [0.22, 0, 0], mouth: 0.6, hy: -0.03,
  }),
  // "come on": lead hand out, palm up, the other on the hip
  TAUNT: makePose({
    spine: [-0.04, 0.2, 0], head: [-0.06, -0.25, 0.06],
    armL: [-1.25, 0, 0.15], foreL: [-0.75, 0, 0], armR: [0.25, 0, -0.55], foreR: [-1.5, 0, 0],
    thighL: [-0.16, 0, 0.12], shinL: [0.12, 0, 0], thighR: [0.1, 0, -0.14], shinR: [0.14, 0, 0], mouth: 0.6,
  }),
  // relaxed, squared up to the camera, arms loose and a little away from the body (hanging straight down, a
  // sleeve modelled with the arm raised bunches up into a shoulder pad)
  STAND: makePose({
    spine: [-0.02, 0, 0], chest: [-0.04, 0, 0], head: [-0.02, 0, 0],
    armL: [0.06, 0, 0.44], foreL: [-0.3, 0, 0], armR: [0.06, 0, -0.44], foreR: [-0.3, 0, 0],
    thighL: [-0.02, 0, 0.09], shinL: [0.04, 0, 0], thighR: [0.02, 0, -0.09], shinR: [0.04, 0, 0],
  }),
  DASH_F: hg({ spine: [0.3, 0.1, 0], head: [-0.2, 0, 0], thighL: [-1.0, 0, 0.1], shinL: [0.6, 0, 0], thighR: [0.8, 0, -0.1], shinR: [0.9, 0, 0], hy: -0.1 }),
  DASH_B: hg({ spine: [-0.15, 0, 0], thighL: [-0.5, 0, 0.1], shinL: [1.1, 0, 0], thighR: [-0.2, 0, -0.1], shinR: [0.9, 0, 0], hy: 0.03 }),
  ATTACKS: H_ATTACKS,
};
