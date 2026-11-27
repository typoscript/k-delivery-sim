import { describe, expect, it } from 'vitest';
import { APARTMENT_THEMES, OFFICETEL_THEMES, VILLA_THEMES, pickInteriorStyle } from './interiorThemes';

describe('interior themes', () => {
  it('the same building always gets the same look', () => {
    expect(pickInteriorStyle('apartment', 'gen-res-w123')).toEqual(pickInteriorStyle('apartment', 'gen-res-w123'));
  });

  it('picks from the themes of the building kind', () => {
    const ids = (list: readonly { id: string }[]) => new Set(list.map((t) => t.id));
    for (let i = 0; i < 50; i++) {
      expect(ids(VILLA_THEMES).has(pickInteriorStyle('walkup_villa', `v${i}`).theme.id)).toBe(true);
      expect(ids(OFFICETEL_THEMES).has(pickInteriorStyle('officetel', `o${i}`).theme.id)).toBe(true);
      expect(ids(APARTMENT_THEMES).has(pickInteriorStyle('apartment', `a${i}`).theme.id)).toBe(true);
    }
    // villa themes carry stairwell accent colours
    for (const t of VILLA_THEMES) expect(t.dado).toBeDefined();
  });

  it('spreads buildings over all themes and gives 1-2 props from the theme list', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const s = pickInteriorStyle('apartment', `gen-res-w${i * 7919}`);
      seen.add(s.theme.id);
      expect(s.props.length).toBeGreaterThanOrEqual(1);
      expect(s.props.length).toBeLessThanOrEqual(2);
      for (const p of s.props) expect(s.theme.props).toContain(p);
    }
    expect(seen.size).toBe(APARTMENT_THEMES.length);
  });
});
