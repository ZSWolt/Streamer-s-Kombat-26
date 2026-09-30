import type { KeyMap } from '../input/InputManager';
import { DEFAULT_P1, DEFAULT_P2 } from '../input/InputManager';
import type { Quality } from '../render/Renderer';

export interface Settings {
  difficulty: 0 | 1 | 2 | 3; // קל / רגיל / קשה / סטרימר
  rounds: number; // rounds to win
  roundTime: number; // 0 = infinite
  music: number; // 0..1
  sfx: number;
  voices: number;
  announcerLang: 'he' | 'en';
  battleIntro: boolean;
  hints: boolean;
  quality: Quality;
  resScale: number;
  fullscreen: boolean;
  showFps: boolean;
  shake: number; // 0..1
  effects: number; // 0..1
  streamHud: boolean;
  chatSpeed: number; // 0.5..2
  inputDisplay: boolean;
  nickname: string;
  inputDelay: number; // online
  p1Keys: KeyMap;
  p2Keys: KeyMap;
  keysVersion: number;
}

export const DEFAULT_SETTINGS: Settings = {
  difficulty: 1, rounds: 2, roundTime: 99, music: 0.7, sfx: 0.8, voices: 1, announcerLang: 'he', battleIntro: true,
  hints: true, quality: 'high', resScale: 1, fullscreen: false, showFps: false, shake: 1, effects: 1, streamHud: true,
  chatSpeed: 1, inputDisplay: false, nickname: '', inputDelay: 2,
  p1Keys: structuredClone(DEFAULT_P1), p2Keys: structuredClone(DEFAULT_P2), keysVersion: 2,
};

const KEY = 'sk26.settings';
const SAVE = 'sk26.save';

function safeGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function safeSet(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch { /* storage unavailable */ }
}

export function loadSettings(): Settings {
  const raw = safeGet(KEY);
  if (!raw) return structuredClone(DEFAULT_SETTINGS);
  try {
    const saved = JSON.parse(raw) as Partial<Settings>;
    const s: Settings = { ...structuredClone(DEFAULT_SETTINGS), ...saved };
    if ((saved.keysVersion ?? 1) < 2) {
      // new comfortable default layout (L = special, Space = block)
      s.p1Keys = structuredClone(DEFAULT_P1);
      s.keysVersion = 2;
    }
    return s;
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings) {
  safeSet(KEY, JSON.stringify(s));
}

export interface SaveData {
  unlocked: string[]; // skin unlock keys like "odedsvr:1"
  wins: Record<string, number>;
  arcadeClears: string[];
  seenNews: string[];
}

export function loadSave(): SaveData {
  const raw = safeGet(SAVE);
  const base: SaveData = { unlocked: [], wins: {}, arcadeClears: [], seenNews: [] };
  if (!raw) return base;
  try { return { ...base, ...JSON.parse(raw) }; } catch { return base; }
}

export function writeSave(s: SaveData) {
  safeSet(SAVE, JSON.stringify(s));
}
