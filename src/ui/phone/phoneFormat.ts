import { CityMapInfo } from '../../world/CityWorld';
import { ACTIVE_DISTRICT, ACTIVE_MAP_DATA, IS_UNIFIED_MAP, SUWON_DISTRICTS } from '../../data/suwonDistricts';
import { nearestLegacyDistrictId } from '../../data/suwonUnified';

/** Pure label/formatting helpers shared by the phone screen renderers & sheet tabs. */
export function getPhaseShortLabel(phase: string, cargoSlot: number | null, cookSec = 0, riverside = false): string {
  if (riverside && phase === 'carrying_to_lobby') return '🌿 산책로 벤치로 걸어가기';
  switch (phase) {
    case 'to_pickup':
      return '픽업 대기 · POS 입력';
    case 'cooking_wait':
      return `🍳 조리 중 (${Math.max(1, Math.ceil(cookSec))}초)`;
    case 'pickup_ready':
      return '🔔 조리 완료 · 수령 대기';
    case 'carrying_to_box':
      return '음식 휴대 · 배달통 적재';
    case 'cargo_loaded':
      return cargoSlot !== null ? `배달통 슬롯 ${cargoSlot + 1} 적재` : '배달통 적재됨';
    case 'carrying_to_lobby':
      return '공동현관 PIN 입력';
    case 'lobby_unlocked':
      return '현관 개방 · 엘리베이터';
    case 'in_corridor':
      return '복도 · 고객 요청 전달';
    case 'photo_mode':
      return '완료 인증 사진 촬영';
    case 'knock_waiting':
      return '노크 완료 · 확인 대기';
    case 'meet_waiting':
      return '대면 수령 진행 중';
    case 'corridor_exit':
      return '완료 · 1층으로 복귀';
    default:
      return '배달 진행 중';
  }
}

export function resolveAreaName(px: number, pz: number, mapInfo: CityMapInfo): string {
  // Unified open world: the base name is the district the rider is in / nearest to
  const districtName = IS_UNIFIED_MAP
    ? (SUWON_DISTRICTS.find((d) => d.id === nearestLegacyDistrictId(px, pz))?.shortName ?? ACTIVE_DISTRICT.shortName)
    : ACTIVE_DISTRICT.shortName;
  const st = ACTIVE_MAP_DATA.meta.station;
  if (Math.hypot(px - st.x, pz - st.z) < 68) return districtName;
  let nearest = districtName;
  let bestDist = 95;
  for (const z of mapInfo.zones) {
    const d = Math.hypot(px - z.x, pz - z.z);
    if (d < bestDist) {
      bestDist = d;
      nearest = z.name;
    }
  }
  return nearest;
}
