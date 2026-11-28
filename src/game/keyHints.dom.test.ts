// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { localizeCanvasText, localizeStaticKeyHints, setActiveBindings } from './keyBindings';

afterEach(() => setActiveBindings({}));

describe('key hints on canvases and static page parts (DOM)', () => {
  it('a canvas draws [V] / (V) with the player key', () => {
    const drawn: string[] = [];
    const ctx = { fillText: (t: string) => void drawn.push(t) } as unknown as CanvasRenderingContext2D;
    localizeCanvasText(ctx);
    ctx.fillText('[V] 또는 화면 클릭으로 배달앱 확대', 0, 0);
    setActiveBindings({ zoom: 'KeyZ', phone: 'KeyQ' });
    ctx.fillText('휴대폰 확대(V) · 거치대 [Tab]', 0, 0, 100);
    expect(drawn).toEqual(['[V] 또는 화면 클릭으로 배달앱 확대', '휴대폰 확대(Z) · 거치대 [Q]']);
  });

  it('marked page parts are rewritten from their original HTML each time', () => {
    document.body.innerHTML = '<div id="a" data-key-hints>정차 후 <kbd>F</kbd> 하차</div><div id="b">그대로 <kbd>F</kbd></div>';
    setActiveBindings({ mount: 'KeyR' });
    localizeStaticKeyHints();
    expect(document.getElementById('a')!.innerHTML).toBe('정차 후 <kbd>R</kbd> 하차');
    expect(document.getElementById('b')!.innerHTML).toBe('그대로 <kbd>F</kbd>');
    setActiveBindings({});
    localizeStaticKeyHints();
    expect(document.getElementById('a')!.innerHTML).toBe('정차 후 <kbd>F</kbd> 하차');
  });
});
