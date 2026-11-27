import type { SuwonDistrictId, SuwonMapDataset } from './suwonTypes';

/**
 * Old per-district maps (`?map=legacy`) are not bundled with the game: the entry (`main.ts`) downloads them
 * as separate chunks only in legacy mode, before importing the game, and modules read them synchronously
 * afterwards (`requireLegacyDistrict`). The default unified open world needs none of them.
 * Tests provide them in `src/test/provideMapData.ts`.
 */

const legacyDistricts: Partial<Record<SuwonDistrictId, SuwonMapDataset>> = {};

export function provideLegacyDistrict(id: SuwonDistrictId, data: SuwonMapDataset): void {
  legacyDistricts[id] = data;
}

export function requireLegacyDistrict(id: SuwonDistrictId): SuwonMapDataset {
  const d = legacyDistricts[id];
  if (!d) throw new Error(`Legacy district data "${id}" is only loaded in ?map=legacy mode`);
  return d;
}

/** Downloads the 4 legacy district maps (only for ?map=legacy) */
export async function loadLegacyDistricts(): Promise<void> {
  const [ingye, haenggung, station, gwanggyo] = await Promise.all([
    import('./suwonIngyeData'),
    import('./suwonHaenggungData'),
    import('./suwonStationData'),
    import('./suwonGwanggyoData'),
  ]);
  provideLegacyDistrict('ingye', ingye.SUWON_INGYE_DATA);
  provideLegacyDistrict('haenggung', haenggung.SUWON_HAENGGUNG_DATA);
  provideLegacyDistrict('suwon_station', station.SUWON_STATION_DATA);
  provideLegacyDistrict('gwanggyo', gwanggyo.SUWON_GWANGGYO_DATA);
}
