/** Extruded OSM buildings (legacy maps) and the station / landmark sets */
import * as THREE from 'three';
import { createBuildingMaterials, createSignTexture } from './cityTextures';
import { CityZoneMarker, LandmarkMarker } from '../types';
import { ACTIVE_DISTRICT, ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import { SUWON_OPEN_WORLD } from '../data/suwonUnified';
import { SuwonDistrictId } from '../data/suwonTypes';
import { SuwonLandmarksBuilder } from './SuwonLandmarks';
import type { CityWorld } from './CityWorld';

/** Extrudes all 322 real OpenStreetMap Suwon Ingye-dong building polygons with Korean facades */
export function buildSuwonOsmBuildings(host: CityWorld): void {
  const { shopWallMat, aptWallMat, villaWallMat, publicWallMat, roofMat } = createBuildingMaterials();
  host.buildingNightMats.push(shopWallMat, aptWallMat, villaWallMat, publicWallMat);

  for (const b of ACTIVE_MAP_DATA.buildings) {
    if (b.pts.length < 3) continue;

    const shape = new THREE.Shape();
    shape.moveTo(b.pts[0][0], -b.pts[0][1]);
    for (let i = 1; i < b.pts.length; i++) {
      shape.lineTo(b.pts[i][0], -b.pts[i][1]);
    }
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: b.height,
      bevelEnabled: false,
    });
    // Rotate so extruded +Z becomes +Y upward, and shape -Z becomes world +Z!
    geo.rotateX(-Math.PI / 2);

    const sideMat =
      b.kind === 'shop'
        ? shopWallMat
        : b.kind === 'residential'
          ? b.height <= 16
            ? villaWallMat
            : aptWallMat
          : publicWallMat;

    const mesh = new THREE.Mesh(geo, [roofMat, sideMat]);
    mesh.castShadow = b.height >= 18;
    mesh.receiveShadow = true;
    host.root.add(mesh);

    // Exact rotated/L-shaped 2D polygon collider (with AABB broadphase!) so diagonal Suwon roads stay 100% clear!
    host.obstacles.push({
      minX: b.minX,
      maxX: b.maxX,
      minZ: b.minZ,
      maxZ: b.maxZ,
      pts: b.pts,
    });

    host.buildings.push({
      x: b.cx,
      z: b.cz,
      w: b.w,
      d: b.d,
      pts: b.pts,
      label: b.name ? b.name.slice(0, 12) : undefined,
      kind: b.kind,
    });

    // Add high-visibility Korean rooftop/landmark billboard on famous named Suwon buildings!
    if (
      b.name &&
      (b.name.includes('롯데시네마') ||
        b.name.includes('뉴코아') ||
        b.name.includes('CGV') ||
        b.name.includes('Homeplus') ||
        b.name.includes('한화꿈에그린') ||
        b.name.includes('한라비발디') ||
        b.name.includes('수원프라자') ||
        b.name.includes('삼성화재') ||
        b.name.includes('국민연금') ||
        b.name.includes('신풍루') ||
        b.name.includes('봉수당') ||
        b.name.includes('수원화성박물관') ||
        b.name.includes('아이파크미술관') ||
        b.name.includes('팔달구청') ||
        b.name.includes('타임빌라스') ||
        b.name.includes('롯데백화점') ||
        b.name.includes('AK') ||
        b.name.includes('노보텔') ||
        b.name.includes('수원역') ||
        b.name.includes('갤러리아') ||
        b.name.includes('코트야드') ||
        b.name.includes('경기도서관') ||
        b.name.includes('광교엘포트'))
    ) {
      const bgHex =
        b.kind === 'residential' ? '#1e3a8a' : b.name.includes('CGV') ? '#b91c1c' : '#0f172a';
      const sign = new THREE.Mesh(
        new THREE.BoxGeometry(Math.min(12, Math.max(5.5, b.w * 0.6)), 2.2, 0.35),
        new THREE.MeshBasicMaterial({ map: createSignTexture(b.name.slice(0, 14), bgHex, '#f8fafc') })
      );
      sign.position.set(b.cx, b.height + 1.3, b.cz);
      host.root.add(sign);
      host.zones.push({
        name: b.name.slice(0, 14),
        x: b.cx,
        z: b.cz,
        type: b.kind === 'residential' ? 'residential' : 'shop',
      });
    }
  }
}

/** Builds the iconic district 3D signature landmarks (팔달문·화성행궁·통닭거리 / 수원시청역·나혜석거리·효원공원 / 수원역·로데오거리) */
export function buildSuwonStationLandmark(host: CityWorld): void {
  if (!host.unified) {
    host.landmarkBuilders.push(
      new SuwonLandmarksBuilder({
        root: host.root,
        districtId: ACTIVE_DISTRICT.id,
        mapData: ACTIVE_MAP_DATA,
        zones: host.zones,
        landmarks: host.landmarks,
        createSignTexture: (title, bg, fg) => createSignTexture(title, bg, fg),
      })
    );
    return;
  }
  // Unified city: every district's hand-built landmarks, authored in that district's local coordinates,
  // placed under a group offset to the district origin (and culled when the player is far away)
  for (const d of SUWON_OPEN_WORLD.legacyDistricts) {
    const group = new THREE.Group();
    group.position.set(d.origin.x, 0, d.origin.z);
    const zones: CityZoneMarker[] = [];
    const landmarks: LandmarkMarker[] = [];
    host.landmarkBuilders.push(
      new SuwonLandmarksBuilder({
        root: group,
        districtId: d.id as SuwonDistrictId,
        mapData: { meta: { station: d.localStation }, buildings: d.namedBuildings },
        zones,
        landmarks,
        createSignTexture: (title, bg, fg) => createSignTexture(title, bg, fg),
      })
    );
    for (const z of zones) host.zones.push({ ...z, x: z.x + d.origin.x, z: z.z + d.origin.z });
    for (const l of landmarks) host.landmarks.push({ ...l, x: l.x + d.origin.x, z: l.z + d.origin.z });
    // Landmarks span the whole 820m district: keep them visible within ~5 chunks (1km) of its centre
    host.addProp(group, d.origin.x, d.origin.z, 5);
  }
}
