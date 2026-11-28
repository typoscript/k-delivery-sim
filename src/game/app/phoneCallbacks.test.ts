import { describe, expect, it } from 'vitest';
import { REPLY_MAX_KMH, phoneCallbacks } from './phoneCallbacks';
import type { AppRefs } from './appRefs';

/** AppRefs stand-in: the rider's mode / speed, the rest recorded */
function refs(mode: 'riding' | 'on_foot', speedMs: number, calls: string[]): AppRefs {
  const sys = (name: string): unknown =>
    new Proxy(() => {}, {
      get: (_t, k) => sys(`${name}.${String(k)}`),
      apply: () => {
        calls.push(name);
        return true;
      },
    });
  return new Proxy({} as AppRefs, {
    get: (_t, k) => {
      if (k === 'playerCtrl') return { state: { mode } };
      if (k === 'scooterPhysics') return { state: { speed: speedMs } };
      return sys(String(k));
    },
  });
}

describe('chat replies', () => {
  it('are sent on foot or stopped, refused while riding', () => {
    for (const [mode, kmh, sent] of [
      ['on_foot', 0, true],
      ['riding', 0, true],
      ['riding', REPLY_MAX_KMH - 1, true],
      ['riding', 30, false],
    ] as const) {
      const calls: string[] = [];
      phoneCallbacks(refs(mode, kmh / 3.6, calls)).onChatReply!('c:1', 'ok');
      expect(calls.includes('delivery.replyToChat')).toBe(sent);
    }
  });
});
