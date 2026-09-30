// Simulation units: 1000 = 1 meter. Everything in the sim is integer math.
export const FPS = 60;
export const M = 1000;

export const GRAVITY = 7;
export const JUMP_VY = 152;
export const JUMP_VX = 46;
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
export const PUSH_HALF = 260;

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
