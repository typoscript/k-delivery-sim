import { describe, expect, it } from 'vitest';
import { ACTIVE_FPS, IDLE_SECONDS, POWER_SAVE_FPS, PowerSaveInputs, targetFps } from './PowerSaver';

const base: PowerSaveInputs = {
  enabled: true,
  photoMode: false,
  menuOpen: false,
  phoneZoomed: false,
  moving: false,
  secondsSinceInput: 0,
};

describe('power saving frame rate', () => {
  it('runs at 60fps while the player is active', () => {
    expect(targetFps(base)).toBe(ACTIVE_FPS);
    expect(targetFps({ ...base, moving: true, secondsSinceInput: 100 })).toBe(ACTIVE_FPS);
  });

  it('drops to 30fps after a few idle seconds without movement', () => {
    expect(targetFps({ ...base, secondsSinceInput: IDLE_SECONDS - 0.1 })).toBe(ACTIVE_FPS);
    expect(targetFps({ ...base, secondsSinceInput: IDLE_SECONDS })).toBe(POWER_SAVE_FPS);
  });

  it('drops to 30fps in menus even right after input', () => {
    expect(targetFps({ ...base, menuOpen: true })).toBe(POWER_SAVE_FPS);
  });

  it('drops to 30fps with the phone zoomed while standing, but not while riding', () => {
    expect(targetFps({ ...base, phoneZoomed: true })).toBe(POWER_SAVE_FPS);
    expect(targetFps({ ...base, phoneZoomed: true, moving: true })).toBe(ACTIVE_FPS);
  });

  it('keeps 60fps in photo mode and when the setting is off', () => {
    expect(targetFps({ ...base, photoMode: true, menuOpen: true, secondsSinceInput: 99 })).toBe(ACTIVE_FPS);
    expect(targetFps({ ...base, enabled: false, menuOpen: true, secondsSinceInput: 99 })).toBe(ACTIVE_FPS);
  });
});
