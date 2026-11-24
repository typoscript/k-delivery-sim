import { SuwonDistrictId, SuwonMapDataset } from './suwonTypes';
import { SUWON_INGYE_DATA } from './suwonIngyeData';
import { SUWON_HAENGGUNG_DATA } from './suwonHaenggungData';
import { SUWON_STATION_DATA } from './suwonStationData';
import { SUWON_GWANGGYO_DATA } from './suwonGwanggyoData';

export type { SuwonDistrictId, SuwonMapDataset };

const DISTRICT_STORAGE_KEY = 'k_delivery_suwon_district_v1';

export interface SuwonDistrictMeta {
  id: SuwonDistrictId;
  icon: string;
  shortName: string;
  badgeLabel: string;
  fullTitle: string;
  description: string;
  highlights: string[];
  data: SuwonMapDataset;
}

export const SUWON_DISTRICTS: SuwonDistrictMeta[] = [
  {
    id: 'ingye',
    icon: '📍',
    shortName: '수원 인계동 · 수원시청역',
    badgeLabel: '📍 수원 인계동 ▾',
    fullTitle: '팔달구 인계동 (수원시청역 · 나혜석거리)',
    description: '효원로·권광로 대형 상권, 효원공원, 고층 오피스텔과 인계동 아파트 단지가 조화된 대표 배달 상권',
    highlights: ['수원시청역', '나혜석거리', '효원공원', '유치회관·교동짬뽕'],
    data: SUWON_INGYE_DATA,
  },
  {
    id: 'haenggung',
    icon: '🏰',
    shortName: '수원 행궁동 · 통닭거리',
    badgeLabel: '🏰 수원 행궁동 ▾',
    fullTitle: '팔달구 행궁동 (수원 통닭거리 · 화성행궁)',
    description: '정조로·수원천로 옛 골목과 진미·남문·용성통닭이 밀집한 로컬 성지! 엘리베이터 없는 구축 빌라 비중↑',
    highlights: ['화성행궁', '수원 통닭거리', '팔달문', '구축 빌라 6곳'],
    data: SUWON_HAENGGUNG_DATA,
  },
  {
    id: 'suwon_station',
    icon: '🚉',
    shortName: '수원역 · 매산로 로데오',
    badgeLabel: '🚉 수원역 로데오 ▾',
    fullTitle: '팔달구 매산동 (수원역 로데오 · AK/롯데몰)',
    description: '덕영대로·매산로 번화가와 수원역 환승센터, 로데오거리 24시 식당·카페가 몰린 초고밀도 역세권',
    highlights: ['수원역(KTX·1호선)', '로데오거리', 'AK·타임빌라스', '뼈나라감자탕·한신포차'],
    data: SUWON_STATION_DATA,
  },
  {
    id: 'gwanggyo',
    icon: '🌊',
    shortName: '수원 광교 · 호수공원',
    badgeLabel: '🌊 수원 광교 ▾',
    fullTitle: '영통구 광교신도시 (광교중앙역 · 광교호수공원)',
    description: '광교호수공원(원천호수) 수변과 넓은 도청로·센트럴타운로 대로, 갤러리아 백화점과 초고층 신축 아파트 대단지 상권',
    highlights: ['광교중앙역(신분당선)', '광교 호수공원', '갤러리아 광교', '초고층 대단지'],
    data: SUWON_GWANGGYO_DATA,
  },
];

function isValidDistrictId(v: string | null): v is SuwonDistrictId {
  return v === 'ingye' || v === 'haenggung' || v === 'suwon_station' || v === 'gwanggyo';
}

function resolveInitialDistrictId(): SuwonDistrictId {
  if (typeof window !== 'undefined') {
    try {
      const params = new URLSearchParams(window.location.search);
      const q = params.get('district');
      if (isValidDistrictId(q)) {
        window.localStorage.setItem(DISTRICT_STORAGE_KEY, q);
        return q;
      }
      const saved = window.localStorage.getItem(DISTRICT_STORAGE_KEY);
      if (isValidDistrictId(saved)) {
        return saved;
      }
    } catch {
      // ignore storage errors
    }
  }
  return 'ingye';
}

export const ACTIVE_DISTRICT_ID: SuwonDistrictId = resolveInitialDistrictId();
export const ACTIVE_DISTRICT: SuwonDistrictMeta =
  SUWON_DISTRICTS.find((d) => d.id === ACTIVE_DISTRICT_ID) ?? SUWON_DISTRICTS[0];
export const ACTIVE_MAP_DATA: SuwonMapDataset = ACTIVE_DISTRICT.data;

/** Saves the selected Suwon district and cleanly reloads the 3D OSM world into that area */
export function switchSuwonDistrict(nextId: SuwonDistrictId): void {
  if (nextId === ACTIVE_DISTRICT_ID) return;
  try {
    window.localStorage.setItem(DISTRICT_STORAGE_KEY, nextId);
  } catch {
    // ignore
  }
  const url = new URL(window.location.href);
  url.searchParams.set('district', nextId);
  window.location.href = url.toString();
}
