import { describe, expect, it } from 'vitest';
import { fitName } from './canvasText';

// 10px per character
const ctx = { measureText: (t: string) => ({ width: [...t].length * 10 }) };

describe('fitName', () => {
  it('keeps short text as is', () => {
    expect(fitName(ctx, '🍗 ', '치킨집', ' [#A-1]', 500)).toBe('🍗 치킨집 [#A-1]');
  });

  it('shortens only the name, keeping prefix and suffix', () => {
    const out = fitName(ctx, '🍗 ', '죽이야기법원사거리점(수원본메디타워점)', ' [#A-12]', 200);
    expect(out.startsWith('🍗 죽이야기')).toBe(true);
    expect(out.endsWith('… [#A-12]')).toBe(true);
    expect([...out].length * 10).toBeLessThanOrEqual(200);
  });

  it('drops trailing spaces before the ellipsis and never exceeds the width', () => {
    expect(fitName(ctx, '', '탑헤어2F 세바스찬키친(킹크랩)', '', 90)).toBe('탑헤어2F 세바…');
    // cut right after the space: the space is dropped
    expect(fitName(ctx, '', '탑헤어2F 세바스찬키친(킹크랩)', '', 70)).toBe('탑헤어2F…');
    expect(fitName(ctx, 'ab', 'cdefgh', 'ij', 50)).toBe('ab…ij');
  });
});
