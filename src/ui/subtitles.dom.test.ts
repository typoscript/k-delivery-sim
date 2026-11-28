// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { SUBTITLE_SEC, SubtitleBar } from './subtitles';

describe('subtitles (DOM)', () => {
  it('shows spoken lines and sound captions only when on, two at most, fading after a few seconds', () => {
    let t = 0;
    const bar = new SubtitleBar(() => t);
    bar.show('🗣️ 300미터 앞 우회전');
    expect(bar.visible).toEqual([]); // off by default
    bar.enabled = true;
    bar.show('🗣️ 300미터 앞 우회전');
    bar.show('🚨 사이렌', true);
    bar.show('🚨 사이렌', true); // not repeated while on screen
    expect(bar.visible).toEqual(['🗣️ 300미터 앞 우회전', '🚨 사이렌']);
    expect(document.querySelector('.subtitle-line.cue')!.textContent).toBe('[🚨 사이렌]');
    bar.show('📲 콜 알림음', true);
    expect(bar.visible).toEqual(['🚨 사이렌', '📲 콜 알림음']);
    t = SUBTITLE_SEC + 0.1;
    bar.update();
    expect(bar.visible).toEqual([]);
    expect(document.querySelectorAll('.subtitle-line')).toHaveLength(0);
  });
});
