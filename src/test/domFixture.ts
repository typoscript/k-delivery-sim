/**
 * DOM fixture for UI tests (run them with `// @vitest-environment happy-dom`): loads the game page's body from
 * index.html so UI classes find every element they look up, and gives canvases a no-op 2D context.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadGamePageDom(): void {
  const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
  const body = html.slice(html.indexOf('<body'), html.lastIndexOf('</body>'));
  // markup only: no scripts (the game itself) and no external resources
  document.body.innerHTML = body
    .slice(body.indexOf('>') + 1)
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<link[^>]*>/g, '');
  const ctx: unknown = new Proxy(function () {}, {
    get: (_t, key) => (key === 'canvas' ? document.createElement('canvas') : ctx),
    set: () => true,
    apply: () => ctx,
  });
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as HTMLCanvasElement['getContext'];
  window.localStorage.clear();
}
