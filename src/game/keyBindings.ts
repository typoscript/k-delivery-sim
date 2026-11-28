/**
 * Key rebinding (설정 `O` → ⌨️ 키 설정): the player assigns another key to an action; the keyboard handler turns the
 * physical key into the action's default code right at the input boundary, so the rest of the game keeps reading
 * the default codes ('KeyW', 'KeyE' ...). Arrow keys, Escape, Space, the number keys and the menu keys (O, P, M)
 * stay fixed. Pure logic, unit tested.
 */

export type BindableAction =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'sprint'
  | 'interact'
  | 'mount'
  | 'phone'
  | 'zoom'
  | 'app'
  | 'horn'
  | 'headlight'
  | 'wipe';

export const BINDABLE_ACTIONS: ReadonlyArray<{ id: BindableAction; label: string; code: string }> = [
  { id: 'forward', label: '앞으로 · 가속', code: 'KeyW' },
  { id: 'back', label: '뒤로 · 브레이크', code: 'KeyS' },
  { id: 'left', label: '왼쪽 · 좌회전', code: 'KeyA' },
  { id: 'right', label: '오른쪽 · 우회전', code: 'KeyD' },
  { id: 'sprint', label: '달리기', code: 'ShiftLeft' },
  { id: 'interact', label: '상호작용 (픽업·배달통·현관)', code: 'KeyE' },
  { id: 'mount', label: '오토바이 타기 / 내리기', code: 'KeyF' },
  { id: 'phone', label: '휴대폰 꺼내기 · 거치', code: 'Tab' },
  { id: 'zoom', label: '휴대폰 확대', code: 'KeyV' },
  { id: 'app', label: '휴대폰 앱 바꾸기', code: 'KeyY' },
  { id: 'horn', label: '경적', code: 'KeyH' },
  { id: 'headlight', label: '헤드라이트', code: 'KeyL' },
  { id: 'wipe', label: '바이저 닦기', code: 'KeyG' },
];

export type KeyBindings = Partial<Record<BindableAction, string>>;

/** Keys that can never be bound (menus, modals, fixed controls) */
export const RESERVED_CODES: ReadonlySet<string> = new Set([
  'Escape',
  'Enter',
  'Space',
  'Backspace',
  'KeyO',
  'KeyP',
  'KeyM',
  'F1',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
]);

const DEFAULT_OF = new Map(BINDABLE_ACTIONS.map((a) => [a.id, a.code]));

/** The key an action is on now */
export function codeFor(bindings: KeyBindings, action: BindableAction): string {
  return bindings[action] ?? DEFAULT_OF.get(action)!;
}

/**
 * Physical key -> the code the game reads (the action's default), or null for a default key that was given away
 * and is not bound to anything else. Keys not in the map pass through unchanged.
 */
export function buildRemap(bindings: KeyBindings): Map<string, string | null> {
  const remap = new Map<string, string | null>();
  for (const a of BINDABLE_ACTIONS) {
    const bound = codeFor(bindings, a.id);
    if (bound !== a.code) remap.set(a.code, null); // the old key no longer does this
  }
  for (const a of BINDABLE_ACTIONS) {
    const bound = codeFor(bindings, a.id);
    if (bound !== a.code) remap.set(bound, a.code);
    else if (remap.get(bound) === null) remap.delete(bound); // still its own action
  }
  // the right Shift keeps sprinting with the left one
  if (codeFor(bindings, 'sprint') !== 'ShiftLeft' && !remap.has('ShiftRight')) remap.set('ShiftRight', null);
  return remap;
}

/** The code the game sees for a physical key */
export function remapCode(remap: ReadonlyMap<string, string | null>, physical: string): string | null {
  return remap.has(physical) ? remap.get(physical)! : physical;
}

/**
 * Binds `action` to `code`: a reserved key is refused (null); a key already used by another action swaps the two.
 * Returns the new bindings (only keys differing from the defaults are kept).
 */
export function bindKey(bindings: KeyBindings, action: BindableAction, code: string): KeyBindings | null {
  if (RESERVED_CODES.has(code) || !/^(Key[A-Z]|Digit[5-9]|Digit0|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|Tab|Backquote|Minus|Equal|Bracket(Left|Right)|Semicolon|Quote|Comma|Period|Slash|Backslash|CapsLock)$/.test(code)) {
    return null;
  }
  const current = codeFor(bindings, action);
  const next: Record<string, string> = {};
  for (const a of BINDABLE_ACTIONS) next[a.id] = codeFor(bindings, a.id);
  const other = BINDABLE_ACTIONS.find((a) => a.id !== action && next[a.id] === code);
  next[action] = code;
  if (other) next[other.id] = current;
  const out: KeyBindings = {};
  for (const a of BINDABLE_ACTIONS) if (next[a.id] !== a.code) out[a.id] = next[a.id];
  return out;
}

/** Validates saved bindings (unknown actions, junk codes and duplicates are dropped) */
export function parseKeyBindings(raw: unknown): KeyBindings {
  if (!raw || typeof raw !== 'object') return {};
  let out: KeyBindings = {};
  for (const a of BINDABLE_ACTIONS) {
    const v = (raw as Record<string, unknown>)[a.id];
    if (typeof v !== 'string') continue;
    const next = bindKey(out, a.id, v);
    if (next && !Object.entries(out).some(([k, c]) => c === v && k !== a.id)) out = next;
  }
  return out;
}

/** "W", "Shift", "Tab", "5" ... for the settings list */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Shift')) return code === 'ShiftLeft' ? '왼쪽 Shift' : '오른쪽 Shift';
  if (code.startsWith('Control')) return 'Ctrl';
  if (code.startsWith('Alt')) return 'Alt';
  return code;
}

let activeBindings: KeyBindings = {};

/** The game sets this from the settings; key hints in UI text read it */
export function setActiveBindings(b: KeyBindings): void {
  activeBindings = b;
}

/** How a default key is written in UI text ('E', 'Tab', 'Shift' ...) */
const HINT_OF: Record<string, string> = Object.fromEntries(
  BINDABLE_ACTIONS.map((a) => [a.code, a.code === 'ShiftLeft' ? 'Shift' : keyLabel(a.code)]),
);

/**
 * Rewrites the key hints in a UI text to the player's keys: `[E]`, `<kbd>E</kbd>` and `(V)` of a rebound action show
 * its new key (one pass, so swapped keys do not chain). Text without rebound keys comes back unchanged.
 */
export function localizeKeyHints(text: string, bindings: KeyBindings = activeBindings): string {
  const map = new Map<string, string>();
  for (const a of BINDABLE_ACTIONS) {
    const bound = bindings[a.id];
    if (bound && bound !== a.code) map.set(HINT_OF[a.code], bound === 'ShiftLeft' ? 'Shift' : keyLabel(bound));
  }
  if (map.size === 0) return text;
  const keys = [...map.keys()].map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`(\\[|<kbd>|\\()(${keys})(\\]|</kbd>|\\))`, 'g');
  return text.replace(re, (all, open: string, key: string, close: string) => {
    const pair = (open === '[' && close === ']') || (open === '<kbd>' && close === '</kbd>') || (open === '(' && close === ')');
    return pair ? `${open}${map.get(key)}${close}` : all;
  });
}
