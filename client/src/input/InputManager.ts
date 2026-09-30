import * as C from '../sim/constants';

export type Action = 'up' | 'down' | 'left' | 'right' | 'lp' | 'hp' | 'lk' | 'hk' | 'block' | 'sp' | 'start';
export const ACTIONS: Action[] = ['up', 'down', 'left', 'right', 'lp', 'hp', 'lk', 'hk', 'block', 'sp', 'start'];
export const ACTION_BIT: Record<Action, number> = {
  up: C.IN_UP, down: C.IN_DOWN, left: C.IN_LEFT, right: C.IN_RIGHT, lp: C.IN_LP, hp: C.IN_HP, lk: C.IN_LK,
  hk: C.IN_HK, block: C.IN_BLOCK, sp: C.IN_SP, start: C.IN_START,
};
export const ACTION_HE: Record<Action, string> = {
  up: 'קפיצה', down: 'התכופפות', left: 'שמאלה', right: 'ימינה', lp: 'אגרוף קל', hp: 'אגרוף חזק', lk: 'בעיטה קלה',
  hk: 'בעיטה סיבובית', block: 'הגנה', sp: 'מהלך מיוחד', start: 'הפסקה',
};

export type KeyMap = Record<Action, string[]>;

export const DEFAULT_P1: KeyMap = {
  up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
  lp: ['KeyJ'], hp: ['KeyI'], lk: ['KeyK'], hk: ['KeyO'], block: ['ShiftLeft', 'KeyL'], sp: ['KeyU'], start: ['KeyP', 'Escape'],
};
export const DEFAULT_P2: KeyMap = {
  up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
  lp: ['Numpad4'], hp: ['Numpad8'], lk: ['Numpad5'], hk: ['Numpad9'], block: ['Numpad0', 'ShiftRight'], sp: ['Numpad6'], start: ['NumpadEnter'],
};
const SOLO_EXTRA: Partial<KeyMap> = { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'] };

// Standard gamepad mapping
const PAD: Record<Action, number[]> = {
  up: [12], down: [13], left: [14], right: [15],
  lp: [2], hp: [3], lk: [0], hk: [1], block: [4, 6], sp: [5, 7], start: [9],
};

export type UiEvent = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'start' | 'any' | 'alt';

export class InputManager {
  private keys = new Set<string>();
  maps: [KeyMap, KeyMap] = [structuredClone(DEFAULT_P1), structuredClone(DEFAULT_P2)];
  solo = true; // when true, arrows also drive P1
  /** which gamepad index feeds each player (-1 = none) */
  padFor: [number, number] = [0, 1];
  private uiListeners = new Set<(e: UiEvent, player: number) => void>();
  private uiRepeat = new Map<string, number>();
  private prevPad: boolean[][] = [];
  lastDevice: 'keyboard' | 'pad' = 'keyboard';
  captureNext: ((code: string) => void) | null = null;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (this.captureNext) { e.preventDefault(); const cb = this.captureNext; this.captureNext = null; cb(e.code); return; }
      if (e.target instanceof HTMLInputElement) return;
      if (!e.repeat) this.keyUi(e.code, true);
      this.keys.add(e.code);
      this.lastDevice = 'keyboard';
      if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => this.keys.clear());
  }

  setMaps(p1?: KeyMap, p2?: KeyMap) {
    if (p1) this.maps[0] = p1;
    if (p2) this.maps[1] = p2;
  }

  onUi(cb: (e: UiEvent, player: number) => void) {
    this.uiListeners.add(cb);
    return () => this.uiListeners.delete(cb);
  }

  private emitUi(e: UiEvent, p: number) {
    for (const cb of [...this.uiListeners]) cb(e, p);
  }

  private keyUi(code: string, down: boolean) {
    if (!down) return;
    const has = (p: number, a: Action) => this.maps[p][a].includes(code);
    let player = has(1, 'up') || has(1, 'down') || has(1, 'left') || has(1, 'right') || has(1, 'lp') || has(1, 'sp') ? 1 : 0;
    if (this.solo) player = 0;
    const m0 = (a: Action) => has(0, a) || has(1, a) || (this.solo && SOLO_EXTRA[a]?.includes(code));
    let ev: UiEvent | null = null;
    if (m0('up')) ev = 'up';
    else if (m0('down')) ev = 'down';
    else if (m0('left')) ev = 'left';
    else if (m0('right')) ev = 'right';
    else if (code === 'Enter' || code === 'Space' || code === 'NumpadEnter' || m0('lp')) ev = 'confirm';
    else if (code === 'Escape' || code === 'Backspace' || m0('lk')) ev = 'back';
    else if (m0('hp') || m0('hk')) ev = 'alt';
    if (code === 'Escape' || code === 'KeyP') this.emitUi('start', player);
    if (ev) this.emitUi(ev, player);
    this.emitUi('any', player);
  }

  private padsState(): (Gamepad | null)[] {
    return navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
  }

  /** Poll gamepads for UI navigation (call once per frame) */
  pollUi(dt: number) {
    const pads = this.padsState();
    pads.forEach((pad, i) => {
      if (!pad) return;
      const prev = this.prevPad[i] ?? [];
      const now = pad.buttons.map((b) => b.pressed);
      const ax = pad.axes[0] ?? 0, ay = pad.axes[1] ?? 0;
      const dirs: [UiEvent, boolean][] = [
        ['up', now[12] || ay < -0.6], ['down', now[13] || ay > 0.6], ['left', now[14] || ax < -0.6], ['right', now[15] || ax > 0.6],
      ];
      const player = this.padFor[1] === i && !this.solo ? 1 : 0;
      for (const [ev, on] of dirs) {
        const k = i + ev;
        if (on) {
          const t = (this.uiRepeat.get(k) ?? -1);
          if (t < 0) { this.emitUi(ev, player); this.uiRepeat.set(k, 0.38); this.lastDevice = 'pad'; }
          else { const nt = t - dt; if (nt <= 0) { this.emitUi(ev, player); this.uiRepeat.set(k, 0.09); } else this.uiRepeat.set(k, nt); }
        } else this.uiRepeat.delete(k);
      }
      const edge = (b: number) => now[b] && !prev[b];
      if (edge(0) || edge(2)) { this.emitUi('confirm', player); this.emitUi('any', player); this.lastDevice = 'pad'; }
      if (edge(1)) { this.emitUi('back', player); this.emitUi('any', player); }
      if (edge(3)) this.emitUi('alt', player);
      if (edge(9)) { this.emitUi('start', player); this.emitUi('any', player); }
      this.prevPad[i] = now;
    });
  }

  /** Sim input bitmask for a local player */
  read(player: number): number {
    let bits = 0;
    const map = this.maps[player];
    for (const a of ACTIONS) {
      if (map[a].some((c) => this.keys.has(c))) bits |= ACTION_BIT[a];
      if (player === 0 && this.solo && SOLO_EXTRA[a]?.some((c) => this.keys.has(c))) bits |= ACTION_BIT[a];
    }
    const padIdx = this.padFor[player];
    const pads = this.padsState();
    const usePad = (idx: number) => {
      const pad = pads[idx];
      if (!pad) return;
      for (const a of ACTIONS) if (PAD[a].some((b) => pad.buttons[b]?.pressed)) bits |= ACTION_BIT[a];
      const ax = pad.axes[0] ?? 0, ay = pad.axes[1] ?? 0;
      if (ax < -0.5) bits |= C.IN_LEFT;
      if (ax > 0.5) bits |= C.IN_RIGHT;
      if (ay < -0.55) bits |= C.IN_UP;
      if (ay > 0.55) bits |= C.IN_DOWN;
    };
    if (padIdx >= 0) usePad(padIdx);
    if (player === 0 && this.solo) for (let i = 0; i < pads.length; i++) if (i !== padIdx) usePad(i);
    return bits;
  }

  anyPad(): boolean {
    return this.padsState().some((p) => !!p);
  }
}

export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
  const map: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ShiftLeft: 'Shift', ShiftRight: 'RShift', Escape: 'Esc', Space: 'Space', Enter: 'Enter' };
  return map[code] ?? code;
}
