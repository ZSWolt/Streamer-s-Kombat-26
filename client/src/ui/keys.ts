import { keyLabel, type Action, type KeyMap } from '../input/InputManager';

// Human-readable key names for the current P1 bindings, so every hint on screen follows the player's key setup.
let map: KeyMap | null = null;

export function setKeyLabels(p1: KeyMap) { map = p1; }

/** Primary key for an action, e.g. K('sp') -> "L" */
export function K(a: Action): string {
  const c = map?.[a]?.[0];
  return c ? keyLabel(c) : a.toUpperCase();
}

/** All keys bound to an action, e.g. "Space / Shift" */
export function KA(a: Action): string {
  return (map?.[a] ?? []).map(keyLabel).join(' / ') || a.toUpperCase();
}

/** Simplified special input, e.g. "→+L" */
export function spInput(input: 'U' | 'FU' | 'DU'): string {
  const s = K('sp');
  return input === 'U' ? s : input === 'FU' ? `→+${s}` : `↓+${s}`;
}

/** Classic arcade motion for the same special (quarter circles / dragon punch) */
export function motionInput(input: 'U' | 'FU' | 'DU'): string {
  return input === 'U' ? `↓↘→+${K('lp')}` : input === 'FU' ? `↓↙←+${K('hp')}` : `→↓↘+${K('lk')}`;
}

export function hypeInput(): string { return `${K('sp')}+${K('block')}`; }
export function throwInput(): string { return `${K('lp')}+${K('lk')}`; }
export function banalityInputs(): [string, string] { return [`${K('lp')} / ${K('hp')}`, `${K('lk')} / ${K('hk')}`]; }
