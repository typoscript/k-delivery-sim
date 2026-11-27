import * as THREE from 'three';
import { SuwonDistrictId, SuwonMapDataset, OsmBuildingData } from '../data/suwonTypes';

/** What the landmarks need from a district map: its station and (named) buildings, in district-local coordinates */
export interface LandmarkMapSource {
  meta: { station: SuwonMapDataset['meta']['station'] };
  buildings: OsmBuildingData[];
}
import { CityZoneMarker, LandmarkMarker } from '../types';
import { buildHaenggungLandmarks } from './landmarks/haenggung';
import { buildIngyeLandmarks } from './landmarks/ingye';
import { buildSuwonStationLandmarks } from './landmarks/suwonStation';
import { buildGwanggyoLandmarks } from './landmarks/gwanggyo';


export interface SuwonLandmarksContext {
  root: THREE.Group;
  districtId: SuwonDistrictId;
  mapData: LandmarkMapSource;
  zones: CityZoneMarker[];
  landmarks: LandmarkMarker[];
  createSignTexture: (title: string, bg: string, fg?: string) => THREE.CanvasTexture;
}

/**
 * Builds iconic, low-poly 3D Suwon signature landmarks tailored to each real OSM district:
 * - haenggung: 팔달문 (남문) 2층 성곽 누각·홍예문·옹성, 화성행궁 신풍루/봉수당/화령전 기와지붕,
 *              여민각 종각(범종), 수원 통닭거리 전통 아치 게이트, 수원천 물길 & 전통 석교
 * - ingye: 수원시청역(수인분당선) 지하철 출입구 캐노피 & 폴사인, 나혜석거리 문화 아치 & 야간 페스툰 조명,
 *          효원공원(인계 근린공원) 전통 팔각정 정자, 수원시청역 사거리 대형 LED 미디어 전광판
 * - suwon_station: 수원역(KTX·1호선·분당선) 대형 유리 역사 캐노피 & 시계탑 파사드,
 *                  수원역 로데오거리 대형 네온 아치 게이트, AK&·타임빌라스·롯데백화점 LED 스카이라인 & 유리 스카이브릿지
 */
export class SuwonLandmarksBuilder {
  private readonly glowEntries: Array<{
    mat: THREE.MeshStandardMaterial;
    dayIntensity: number;
    nightIntensity: number;
  }> = [];

  /** @internal landmarks/* */
  readonly ctx: SuwonLandmarksContext;

  constructor(ctx: SuwonLandmarksContext) {
    this.ctx = ctx;
    if (ctx.districtId === 'haenggung') {
      buildHaenggungLandmarks(this);
    } else if (ctx.districtId === 'ingye') {
      buildIngyeLandmarks(this);
    } else if (ctx.districtId === 'gwanggyo') {
      buildGwanggyoLandmarks(this);
    } else {
      buildSuwonStationLandmarks(this);
    }
  }

  public setNightMode(isNight: boolean): void {
    for (const entry of this.glowEntries) {
      entry.mat.emissiveIntensity = isNight ? entry.nightIntensity : entry.dayIntensity;
    }
  }

  /** @internal landmarks/* */
  createGlowMat(
    color: number,
    emissive: number,
    dayIntensity: number,
    nightIntensity: number,
    roughness = 0.25
  ): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive,
      emissiveIntensity: dayIntensity,
      roughness,
    });
    this.glowEntries.push({ mat, dayIntensity, nightIntensity });
    return mat;
  }

  /** @internal landmarks/* */
  registerLandmark(
    name: string,
    shortLabel: string,
    icon: string,
    x: number,
    z: number,
    color: string
  ): void {
    this.ctx.landmarks.push({ name, shortLabel, icon, x, z, color });
    this.ctx.zones.push({ name, x, z, type: 'shop' });
  }

  /** @internal landmarks/* */
  findBuilding(keyword: string): OsmBuildingData | undefined {
    return this.ctx.mapData.buildings.find((b) => b.name && b.name.includes(keyword));
  }

}

