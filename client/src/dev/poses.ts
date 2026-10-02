// Dev-only: poses by name, for the pose lab and the model check (dev/poselab.ts, dev/qa.ts).
//
//   GUARD, WIN ...            a state pose
//   jab.wind / .hit / .follow one phase of an attack
//   walk.a / walk.b, run.a / run.b   the two extremes of the gait cycles FighterView draws over the guard
//   a+b@0.5                   two of the above blended (more than 1 overshoots, the way an attack's snap does)
import * as P from '../render/pose';

export const STATES = ['NEUTRAL', 'STAND', 'GUARD', 'CROUCH', 'BLOCK', 'BLOCK_CROUCH', 'JUMP', 'HIT_HIGH', 'HIT_MID', 'AIR_HIT', 'LYING', 'GETUP', 'DIZZY', 'WIN', 'WIN2', 'TAUNT', 'DASH_F', 'DASH_B'];
const AIR = new Set(['JUMP', 'AIR_HIT']);

export interface Resolved { pose: P.Pose; air: boolean }

/** the walk and the run of render/FighterView.ts at phase `ph` */
function gait(lib: P.PoseLib, kind: string, ph: number): P.Pose {
  const out = new Float32Array(lib.GUARD);
  const s = Math.sin(ph);
  if (kind === 'walk') {
    out[P.J.thighL * 3] += s * 0.38;
    out[P.J.thighR * 3] -= s * 0.38;
    out[P.J.shinL * 3] += Math.max(0, -Math.cos(ph)) * 0.55;
    out[P.J.shinR * 3] += Math.max(0, Math.cos(ph)) * 0.55;
    out[P.J.spine * 3] += 0.06;
    out[P.J.spine * 3 + 1] += s * 0.06;
  } else {
    out[P.J.spine * 3] += 0.32;
    out[P.J.head * 3] -= 0.2;
    out[P.J.thighL * 3] += s * 0.75 - 0.2;
    out[P.J.thighR * 3] -= s * 0.75 + 0.2;
    out[P.J.shinL * 3] += Math.max(0, -Math.cos(ph)) * 1.2 + 0.2;
    out[P.J.shinR * 3] += Math.max(0, Math.cos(ph)) * 1.2 + 0.2;
    out[P.J.armL * 3] = -0.4 - s * 0.7;
    out[P.J.armR * 3] = -0.4 + s * 0.7;
    out[P.J.foreL * 3] = -1.6;
    out[P.J.foreR * 3] = -1.6;
    out[P.EX_HIPY] -= 0.03;
  }
  return out;
}

function lookup(lib: P.PoseLib, name: string): Resolved {
  const states = { NEUTRAL: P.NEUTRAL, ...lib } as unknown as Record<string, P.Pose>;
  if (name.includes('.')) {
    const [a, ph] = name.split('.');
    if (a === 'walk' || a === 'run') return { pose: gait(lib, a, ph === 'a' ? 0.9 : ph === 'b' ? 0.9 + Math.PI : Number(ph)), air: false };
    const anim = lib.ATTACKS[a];
    if (!anim) throw new Error('no attack ' + a);
    if (ph === 'base') return { pose: anim.air ? lib.JUMP : anim.crouch ? lib.CROUCH : lib.GUARD, air: !!anim.air };
    return { pose: (anim as unknown as Record<string, P.Pose>)[ph] ?? anim.hit, air: !!anim.air };
  }
  if (!states[name]) throw new Error('no pose ' + name);
  return { pose: states[name], air: AIR.has(name) };
}

export function resolve(lib: P.PoseLib, name: string): Resolved {
  const m = /^(.+)\+(.+)@([\d.]+)$/.exec(name);
  if (!m) return lookup(lib, name);
  const a = lookup(lib, m[1]), b = lookup(lib, m[2]);
  return { pose: P.lerpPose(a.pose, b.pose, Number(m[3]), new Float32Array(P.POSE_LEN)), air: a.air && b.air };
}

/** Every pose a fighter passes through: the states, the gaits, and each attack's phases with the ways in and out. */
export function allPoses(lib: P.PoseLib): string[] {
  const out = [...STATES, 'walk.a', 'walk.b', 'run.a', 'run.b', 'GUARD+CROUCH@0.5', 'GUARD+HIT_HIGH@0.5', 'GUARD+HIT_MID@0.5', 'HIT_MID+AIR_HIT@0.5', 'GETUP+GUARD@0.5', 'WIN+WIN2@0.5', 'GUARD+TAUNT@0.5'];
  const seen = new Set<P.Pose>();
  for (const k of Object.keys(lib.ATTACKS)) {
    const a = lib.ATTACKS[k];
    if (seen.has(a.hit)) continue; // an alias of another attack
    seen.add(a.hit);
    out.push(`${k}.base+${k}.wind@0.5`, `${k}.wind`, `${k}.wind+${k}.hit@0.5`, `${k}.hit`, `${k}.wind+${k}.hit@1.1`);
    if (a.follow) out.push(`${k}.hit+${k}.follow@0.5`, `${k}.follow`, `${k}.follow+${k}.base@0.5`);
    else out.push(`${k}.hit+${k}.base@0.5`);
  }
  return out;
}
