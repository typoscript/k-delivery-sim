/**
 * Subtitles (설정 ♿ 자막): voice guidance and important sounds (siren, horn, call alerts ...) as captions at the
 * bottom of the screen - for playing without sound or hard of hearing. Two lines at most, each for a few seconds;
 * the same caption is not repeated while it is still on screen.
 */

export const SUBTITLE_SEC = 3.6;
const MAX_LINES = 2;

export class SubtitleBar {
  public enabled = false;
  private readonly el: HTMLElement;
  private readonly lines: Array<{ text: string; cue: boolean; until: number }> = [];

  constructor(private readonly now: () => number = () => performance.now() / 1000) {
    this.el = document.createElement('div');
    this.el.className = 'subtitle-bar';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    document.body.appendChild(this.el);
    // captions fade on their own (UI only: not part of the simulation)
    if (typeof window !== 'undefined') window.setInterval(() => this.update(), 300);
  }

  /** A spoken line (`cue` false) or a sound caption like "[🚨 사이렌]" (`cue` true) */
  public show(text: string, cue = false): void {
    if (!this.enabled || !text) return;
    const t = this.now();
    this.prune(t);
    const same = this.lines.find((l) => l.text === text);
    if (same) {
      same.until = t + SUBTITLE_SEC;
    } else {
      this.lines.push({ text, cue, until: t + SUBTITLE_SEC });
      while (this.lines.length > MAX_LINES) this.lines.shift();
    }
    this.render();
  }

  /** Drops expired lines (called every frame) */
  public update(): void {
    if (this.lines.length === 0) return;
    if (this.prune(this.now())) this.render();
  }

  /** Lines on screen (tests) */
  public get visible(): string[] {
    return this.lines.map((l) => l.text);
  }

  private prune(t: number): boolean {
    const before = this.lines.length;
    for (let i = this.lines.length - 1; i >= 0; i--) if (this.lines[i].until <= t) this.lines.splice(i, 1);
    return this.lines.length !== before;
  }

  private render(): void {
    this.el.replaceChildren(
      ...this.lines.map((l) => {
        const d = document.createElement('div');
        d.className = `subtitle-line${l.cue ? ' cue' : ''}`;
        d.textContent = l.cue ? `[${l.text}]` : l.text;
        return d;
      }),
    );
  }
}
