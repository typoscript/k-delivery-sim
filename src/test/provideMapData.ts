// Vitest setup: the game downloads the legacy (?map=legacy) district maps on demand at startup
// (src/data/mapSources.ts); unit tests import modules directly, so provide them synchronously here.
import { SUWON_INGYE_DATA } from '../data/suwonIngyeData';
import { SUWON_HAENGGUNG_DATA } from '../data/suwonHaenggungData';
import { SUWON_STATION_DATA } from '../data/suwonStationData';
import { SUWON_GWANGGYO_DATA } from '../data/suwonGwanggyoData';
import { provideLegacyDistrict } from '../data/mapSources';

provideLegacyDistrict('ingye', SUWON_INGYE_DATA);
provideLegacyDistrict('haenggung', SUWON_HAENGGUNG_DATA);
provideLegacyDistrict('suwon_station', SUWON_STATION_DATA);
provideLegacyDistrict('gwanggyo', SUWON_GWANGGYO_DATA);
