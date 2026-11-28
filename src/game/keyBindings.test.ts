import { describe, expect, it } from 'vitest';
import { bindKey, buildRemap, codeFor, keyLabel, parseKeyBindings, remapCode } from './keyBindings';

describe('key rebinding', () => {
  it('defaults pass straight through', () => {
    const remap = buildRemap({});
    expect(remap.size).toBe(0);
    expect(remapCode(remap, 'KeyW')).toBe('KeyW');
  });

  it('a new key does the action, the old key stops doing it', () => {
    const b = bindKey({}, 'interact', 'KeyT')!;
    expect(b).toEqual({ interact: 'KeyT' });
    const remap = buildRemap(b);
    expect(remapCode(remap, 'KeyT')).toBe('KeyE');
    expect(remapCode(remap, 'KeyE')).toBeNull();
    expect(remapCode(remap, 'KeyW')).toBe('KeyW');
  });

  it('taking another action key swaps the two', () => {
    const b = bindKey({}, 'forward', 'KeyE')!; // E was interact
    expect(codeFor(b, 'forward')).toBe('KeyE');
    expect(codeFor(b, 'interact')).toBe('KeyW');
    const remap = buildRemap(b);
    expect(remapCode(remap, 'KeyE')).toBe('KeyW');
    expect(remapCode(remap, 'KeyW')).toBe('KeyE');
    // swapping back restores the defaults
    expect(bindKey(b, 'forward', 'KeyW')).toEqual({});
  });

  it('menu / modal keys and odd keys cannot be bound; saves are validated', () => {
    expect(bindKey({}, 'interact', 'Escape')).toBeNull();
    expect(bindKey({}, 'interact', 'KeyO')).toBeNull();
    expect(bindKey({}, 'interact', 'MediaPlayPause')).toBeNull();
    // a key saved twice keeps the first action (in list order); unknown actions and reserved keys are dropped
    expect(parseKeyBindings({ interact: 'KeyT', forward: 'KeyT', jump: 'KeyZ', mount: 'Escape' })).toEqual({ forward: 'KeyT' });
    expect(parseKeyBindings('junk')).toEqual({});
    expect(keyLabel('KeyT')).toBe('T');
    expect(keyLabel('ShiftLeft')).toBe('왼쪽 Shift');
  });
});
