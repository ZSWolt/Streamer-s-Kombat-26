// Simulation units: 1000 = 1 meter. Everything in the sim is integer math.
export const FPS = 60;
export const M = 1000;

// Jumps are sized for a person, not a toy: about 1.4 m at the top, 0.63 s in the air.
export const GRAVITY = 8;
export const AIR_HIT_GRAVITY = 8;
export const JUMP_VY = 150;
export const JUMP_VX = 50;
export const JUMP_SQUAT = 4;
export const LAND_RECOVERY = 4;

export const WALK_F = 28;
export const WALK_B = 22;
export const DASH_F_FRAMES = 14;
export const DASH_F_SPEED = 90;
export const DASH_B_FRAMES = 16;
export const DASH_B_SPEED = 70;
export const DASH_WINDOW = 12;
export const RUN_SPEED = 66;

export const STAGE_HALF = 5400;
export const MAX_SEPARATION = 6400;
export const PUSH_HALF = 330; // two bodies never stand closer than 0.66 m: fists up, not chest to chest

export const MAX_METER = 1000;
export const MAX_HP = 1000;

export const KNOCKDOWN_FRAMES = 44;
export const GETUP_FRAMES = 22;
export const THROW_RANGE = 760;
export const THROW_TECH_WINDOW = 8;

export const DIZZY_FRAMES = 60 * 6;
export const BANALITY_RANGE = 1900;
export const BANALITY_FRAMES = 60 * 5;

export const ROUND_INTRO_FRAMES = 100;
export const FIGHT_CALL_FRAMES = 45;
export const KO_FRAMES = 150;
export const ROUND_END_FRAMES = 150;
export const CHAR_INTRO_FRAMES = 60 * 4;

export const INPUT_HISTORY = 32;

// ---- anti-spam
/** Doing a move again within this many frames of its end counts as repeating it. */
export const REPEAT_MEMORY = 80;
/** Damage (%) of a move by how many times in a row it has been repeated. */
export const STALE_DAMAGE = [100, 82, 64, 48, 36, 28];
/** Each repeat adds this much recovery, takes this much hitstun / blockstun off, and pushes this much further. */
export const STALE_RECOVERY = 3;
export const STALE_RECOVERY_MAX = 14;
export const STALE_HITSTUN = 3;
export const STALE_BLOCKSTUN = 2;
export const STALE_PUSH = 8;
/** From this many repeats on, the move no longer cancels into anything. */
export const STALE_NO_CANCEL = 2;
/** Frames after a back-dash before the next one. */
export const BACKDASH_COOLDOWN = 26;

// Input bits (absolute directions; the fighter converts to forward/back by facing)
export const IN_UP = 1 << 0;
export const IN_DOWN = 1 << 1;
export const IN_LEFT = 1 << 2;
export const IN_RIGHT = 1 << 3;
export const IN_LP = 1 << 4; // J
export const IN_HP = 1 << 5; // I
export const IN_LK = 1 << 6; // K
export const IN_HK = 1 << 7; // O
export const IN_BLOCK = 1 << 8; // Shift / L
export const IN_SP = 1 << 9; // U
export const IN_START = 1 << 10; // pause (not used by sim)
export const IN_TAUNT = 1 << 11;

export const BUTTONS = IN_LP | IN_HP | IN_LK | IN_HK | IN_SP;
