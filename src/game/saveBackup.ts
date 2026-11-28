/**
 * Save backup (세이브 내보내기 · 가져오기): every localStorage key the game uses goes into one JSON file the rider can
 * download, and a backup file can be loaded back (after a check). Pure logic over a Storage-like object; the
 * settings modal does the file download / upload. Unit tested.
 */

/** Every key the game saves (career, garage, chats, settings, guides, last district / phone app) */
export const SAVE_KEYS = [
  'k_delivery_rider_career_v1',
  'k_delivery_bike_garage_v1',
  'k_delivery_messenger_v1',
  'k_delivery_settings_v1',
  'k_delivery_tutorial_done_v1',
  'k_delivery_shift_guide_done_v1',
  'k_delivery_phone_apps_guide_done_v1',
  'k_delivery_suwon_district_v1',
  'k_delivery_phone_app_v1',
  'k_delivery_notifications_v1',
] as const;

const FORMAT = 'k-delivery-sim-save';
/** Backups bigger than this are refused (a real save is a few hundred KB at most) */
const MAX_BACKUP_CHARS = 5_000_000;

export interface SaveBackup {
  format: typeof FORMAT;
  version: 1;
  /** When it was made (ISO date, shown to the rider) */
  savedAt: string;
  data: Partial<Record<(typeof SAVE_KEYS)[number], string>>;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Builds the backup of the game's saved keys */
export function buildBackup(storage: StorageLike, savedAt: string): SaveBackup {
  const data: SaveBackup['data'] = {};
  for (const k of SAVE_KEYS) {
    const v = storage.getItem(k);
    if (v !== null) data[k] = v;
  }
  return { format: FORMAT, version: 1, savedAt, data };
}

/** Checks a backup file's text: the backup, or a Korean reason it cannot be loaded */
export function parseBackup(text: string): { ok: true; backup: SaveBackup } | { ok: false; reason: string } {
  if (text.length > MAX_BACKUP_CHARS) return { ok: false, reason: '파일이 너무 커요' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'JSON 파일이 아니에요' };
  }
  const r = raw as Partial<SaveBackup>;
  if (!r || typeof r !== 'object' || r.format !== FORMAT)
    return { ok: false, reason: 'K-Delivery Sim 세이브 파일이 아니에요' };
  if (r.version !== 1) return { ok: false, reason: '지원하지 않는 세이브 버전이에요' };
  if (!r.data || typeof r.data !== 'object') return { ok: false, reason: '세이브 데이터가 비어 있어요' };
  const data: SaveBackup['data'] = {};
  for (const k of SAVE_KEYS) {
    const v = (r.data as Record<string, unknown>)[k];
    if (v === undefined) continue;
    if (typeof v !== 'string') return { ok: false, reason: `손상된 항목: ${k}` };
    // JSON saves must still parse; flags are plain strings
    if (v.startsWith('{') || v.startsWith('[')) {
      try {
        JSON.parse(v);
      } catch {
        return { ok: false, reason: `손상된 항목: ${k}` };
      }
    }
    data[k] = v;
  }
  if (!data.k_delivery_rider_career_v1) return { ok: false, reason: '라이더 커리어 기록이 없어요' };
  return {
    ok: true,
    backup: { format: FORMAT, version: 1, savedAt: typeof r.savedAt === 'string' ? r.savedAt : '', data },
  };
}

/** Replaces the game's saved keys with the backup's (keys missing from the backup are cleared) */
export function applyBackup(storage: StorageLike, backup: SaveBackup): void {
  for (const k of SAVE_KEYS) {
    const v = backup.data[k];
    if (v === undefined) storage.removeItem(k);
    else storage.setItem(k, v);
  }
}

/** File name for a backup made at `iso` */
export function backupFileName(iso: string): string {
  return `k-delivery-save-${iso.slice(0, 10)}.json`;
}
