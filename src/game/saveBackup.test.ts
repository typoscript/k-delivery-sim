import { describe, expect, it } from 'vitest';
import { SAVE_KEYS, applyBackup, backupFileName, buildBackup, parseBackup } from './saveBackup';

function memoryStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    map: m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe('save backup', () => {
  it('round-trips every saved key through a file and back', () => {
    const src = memoryStorage({
      k_delivery_rider_career_v1: JSON.stringify({ walletBalance: 123456 }),
      k_delivery_messenger_v1: JSON.stringify({ v: 1, threads: [] }),
      k_delivery_tutorial_done_v1: '1',
      unrelated_key: 'x',
    });
    const backup = buildBackup(src, '2026-11-28T10:00:00.000Z');
    expect(Object.keys(backup.data).sort()).toEqual([
      'k_delivery_messenger_v1',
      'k_delivery_rider_career_v1',
      'k_delivery_tutorial_done_v1',
    ]);
    const parsed = parseBackup(JSON.stringify(backup));
    expect(parsed.ok).toBe(true);
    const dst = memoryStorage({ k_delivery_settings_v1: '{"old":true}', unrelated_key: 'keep' });
    if (parsed.ok) applyBackup(dst, parsed.backup);
    expect(dst.getItem('k_delivery_rider_career_v1')).toBe(JSON.stringify({ walletBalance: 123456 }));
    expect(dst.getItem('k_delivery_settings_v1')).toBeNull(); // not in the backup: cleared
    expect(dst.getItem('unrelated_key')).toBe('keep'); // other sites' data untouched
    expect(SAVE_KEYS).toContain('k_delivery_bike_garage_v1');
    expect(backupFileName('2026-11-28T10:00:00.000Z')).toBe('k-delivery-save-2026-11-28.json');
  });

  it('refuses files that are not a valid game save', () => {
    expect(parseBackup('not json')).toMatchObject({ ok: false });
    expect(parseBackup(JSON.stringify({ format: 'other' }))).toMatchObject({ ok: false });
    expect(parseBackup(JSON.stringify({ format: 'k-delivery-sim-save', version: 2, data: {} }))).toMatchObject({
      ok: false,
    });
    expect(parseBackup(JSON.stringify({ format: 'k-delivery-sim-save', version: 1, data: {} }))).toMatchObject({
      ok: false,
      reason: '라이더 커리어 기록이 없어요',
    });
    const broken = { format: 'k-delivery-sim-save', version: 1, data: { k_delivery_rider_career_v1: '{broken' } };
    expect(parseBackup(JSON.stringify(broken))).toMatchObject({ ok: false });
    const wrongType = { format: 'k-delivery-sim-save', version: 1, data: { k_delivery_rider_career_v1: 5 } };
    expect(parseBackup(JSON.stringify(wrongType))).toMatchObject({ ok: false });
    expect(parseBackup('x'.repeat(5_000_001))).toMatchObject({ ok: false });
  });
});
