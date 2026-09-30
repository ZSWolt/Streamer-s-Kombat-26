export type Level = 'high' | 'mid' | 'low' | 'overhead' | 'unblockable';

export interface Box { x: number; y: number; w: number; h: number }

export const St = {
  Idle: 0, WalkF: 1, WalkB: 2, DashF: 3, DashB: 4, Crouch: 5, JumpSquat: 6, Air: 7, Land: 8,
  Attack: 9, BlockStand: 10, BlockCrouch: 11, Hitstun: 12, AirHit: 13, Knockdown: 14, Getup: 15,
  Throwing: 16, Thrown: 17, Dizzy: 18, Ko: 19, Win: 20, Intro: 21, Taunt: 22, Cinematic: 23, Stunned: 24, Run: 25,
} as const;
export type St = (typeof St)[keyof typeof St];

export type StatusKind = 'reversed' | 'slow' | 'frozen';

/** What a special/hype move does. Interpreted by sim/specials.ts */
export interface SpecialSpec {
  kind:
    | 'projectile' | 'rush' | 'uppercut' | 'teleport' | 'counter' | 'reflect'
    | 'grab' | 'trap' | 'slam' | 'swap' | 'summon' | 'drop' | 'heal' | 'beam';
  /** frames before the effect */
  startup: number;
  active?: number;
  recovery: number;
  damage: number;
  level?: Level;
  hitstun?: number;
  knockdown?: boolean;
  launch?: [number, number];
  speed?: number;
  vy?: number;
  gravity?: number;
  count?: number;
  spread?: number;
  life?: number;
  boomerang?: boolean;
  pierce?: boolean;
  size?: [number, number];
  armor?: number;
  invuln?: [number, number];
  range?: number;
  randomDamage?: [number, number];
  status?: StatusKind;
  statusFrames?: number;
  stun?: number;
  heal?: number;
  chance?: number; // 0..100 for effects with luck
  behind?: boolean;
  hits?: number;
  /** visual key the renderer uses for props/projectile meshes */
  vfx: string;
}

export interface SpecialDef {
  input: 'U' | 'FU' | 'DU';
  name: string; // Hebrew
  en: string;
  anim: string;
  spec: SpecialSpec;
}

export interface MoveDef {
  id: number;
  key: string;
  anim: string;
  startup: number;
  active: number;
  recovery: number;
  damage: number;
  level: Level;
  hitbox: Box;
  hitstun: number;
  blockstun: number;
  pushback: number;
  hitstop: number;
  knockdown?: boolean;
  launch?: [number, number];
  air?: boolean;
  cancel: 'chain' | 'special' | 'none';
  chainRank: number; // light=1, heavy=2...
  vx?: [number, number][]; // [frame, vx]
  invuln?: [number, number];
  throw?: boolean;
  special?: SpecialDef;
  hype?: boolean;
}

export interface Projectile {
  id: number;
  owner: 0 | 1;
  x: number; y: number; vx: number; vy: number;
  w: number; h: number;
  gravity: number;
  life: number;
  age: number;
  damage: number;
  hitstun: number;
  level: Level;
  knockdown: boolean;
  boomerang: boolean;
  pierce: boolean;
  status: string;
  statusFrames: number;
  stun: number;
  vfx: string;
  hitsLeft: number;
  kind: 'shot' | 'trap' | 'summon' | 'drop';
  reflected: boolean;
  dead: boolean;
  cool: number;
}

export interface FighterState {
  char: number;
  skin: number;
  x: number; y: number; vx: number; vy: number;
  facing: 1 | -1;
  hp: number;
  meter: number;
  st: St;
  stFrame: number;
  move: number; // -1 none
  moveFrame: number;
  moveHit: boolean;
  moveHits: number;
  hitstun: number;
  blockstun: number;
  hitstop: number;
  comboCount: number;
  comboDamage: number;
  juggle: number;
  airActionUsed: boolean;
  invuln: number;
  armor: number;
  counterFrames: number;
  reflectFrames: number;
  status: string;
  statusFrames: number;
  dashTapFrame: number; // frame last forward tap
  dashTapBack: number;
  lastDirX: number;
  throwTech: number;
  cinematicKind: string;
  cinematicFrames: number;
  damageTaken: number;
  roundWins: number;
  perfectRun: boolean;
  wasBlocking: boolean;
  history: number[]; // input history ring (most recent last)
  prevInput: number;
  pendingDamage: number;
  buf: number; // buffered button presses
  bufT: number;
  jumpDir: number;
  lastHitFrame: number;
  idleFrames: number;
  crouched: boolean; // hit/blocked while crouching
}

export type Phase = 'intro' | 'roundCall' | 'fight' | 'ko' | 'finish' | 'banality' | 'roundEnd' | 'matchEnd' | 'timeOver';

export interface SimEvent {
  f: number;
  type: string;
  p?: number; // player index
  x?: number; y?: number;
  a?: number; b?: number;
  s?: string;
}

export interface MatchConfig {
  chars: [number, number];
  skins: [number, number];
  stage: number;
  roundsToWin: number;
  roundTime: number; // seconds, 0 = infinite
  seed: number;
  charIntro: boolean;
  practice?: boolean;
  bossP2?: boolean;
}

export interface MatchState {
  frame: number;
  cfg: MatchConfig;
  phase: Phase;
  phaseFrame: number;
  round: number;
  timer: number; // frames left
  f: [FighterState, FighterState];
  proj: Projectile[];
  nextProjId: number;
  rng: number;
  winner: -1 | 0 | 1 | 2; // 2 = draw
  roundWinner: -1 | 0 | 1 | 2;
  flawless: boolean;
  banality: boolean;
  banalityIdx: number;
  superFreeze: number;
  superOwner: number;
  slowmo: number;
  events: SimEvent[]; // events produced during the last step (not hashed)
}
