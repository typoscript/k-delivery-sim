// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { weekSummary, DayRecord } from '../../delivery/careerHistory';
import { pastWeeksHtml } from './sheetEarningsTabs';

const day = (d: number, deliveries: number, net: number): DayRecord => ({
  day: d,
  deliveries,
  income: net,
  expenses: 0,
  net,
  avgStars: null,
  accidents: 0,
  goalsMet: 0,
  goalsTotal: 0,
});

describe('bank app: past weeks', () => {
  it('one line per week with the change against the week before; the line opens the statement', () => {
    const history = [day(1, 4, 30_000), day(8, 6, 50_000)];
    const weeks = [weekSummary(history, 14), weekSummary(history, 7)];
    document.body.innerHTML = pastWeeksHtml(weeks);
    const items = [...document.querySelectorAll<HTMLDetailsElement>('details.past-week')];
    expect(items.map((d) => d.dataset.week)).toEqual(['2', '1']);
    expect(items[0].querySelector('summary')!.textContent).toContain('▲ ₩20,000');
    expect(items[1].querySelector('.pw-delta')).toBeNull(); // nothing before week 1
    expect(items[0].querySelector('.weekly-statement')!.textContent).toContain('2주차 주간 정산');
    expect(pastWeeksHtml([])).toBe('');
  });
});
