import * as THREE from 'three';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import { SUWON_OPEN_WORLD } from '../data/suwonUnified';
import { OsmServiceSpot } from '../data/suwonTypes';
import { CITY_WORLD_LIMIT, ObstacleBox, ServiceStationInfo } from '../types';

/** What the station builder needs from CityWorld */
export interface WorldPropHost {
  addProp(obj: THREE.Object3D, x: number, z: number, radiusChunks?: number, keep?: (o: THREE.Object3D) => boolean): void;
  createSignTexture(title: string, bg: string, fg?: string): THREE.CanvasTexture;
}

/**
 * Roadside service stations: K-오일 self-service gas station (fuel), 번개 오토바이 센터 (repair / garage) and the
 * K-24 convenience store, one set per district (unified open world) or one set (legacy map), plus the
 * "is the player / scooter at it" checks used by the [E] interaction.
 */
export class ServiceStations {
  constructor(
    private readonly host: WorldPropHost,
    private readonly stations: ServiceStationInfo[],
    private readonly obstacles: ObstacleBox[],
    private readonly unified: boolean
  ) {}

  /** Builds K-Oil Self-Service Gas Station & Lightning Motorcycle Repair Center in open roadside bays */
  public build(): void {
    if (!this.unified || !ACTIVE_MAP_DATA.serviceSpotList) {
      this.buildSet(ACTIVE_MAP_DATA.serviceSpots.gas, ACTIVE_MAP_DATA.serviceSpots.repair, '인계', ACTIVE_MAP_DATA.meta.scooterSpawn, this.obstacles);
      return;
    }
    const labels: Record<string, string> = { ingye: '인계', haenggung: '행궁', suwon_station: '수원역', gwanggyo: '광교' };
    for (const set of ACTIVE_MAP_DATA.serviceSpotList) {
      const d = SUWON_OPEN_WORLD.legacyDistricts.find((x) => x.id === set.districtId)!;
      // Buildings stream in later, so keep the convenience store clear of the district's known footprints
      const legacyBoxes: ObstacleBox[] = d.buildingBoxes.map(([minX, maxX, minZ, maxZ]) => ({
        minX: minX + d.origin.x,
        maxX: maxX + d.origin.x,
        minZ: minZ + d.origin.z,
        maxZ: maxZ + d.origin.z,
      }));
      this.buildSet(set.gas, set.repair, labels[set.districtId] ?? '수원', d.scooterSpawn, legacyBoxes);
    }
  }

  private buildSet(
    gas: OsmServiceSpot,
    rep: OsmServiceSpot,
    label: string,
    spawn: { x: number; z: number },
    buildingBoxes: ObstacleBox[]
  ): void {

    // 1. 인계 K-오일 셀프주유소
    const gasGroup = new THREE.Group();
    gasGroup.position.set(gas.x, 0, gas.z);
    gasGroup.rotation.y = gas.facingHeading;

    const padMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.7 });
    const gasPad = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.06, 4.4), padMat);
    gasPad.position.set(0, 0.04, 1.4);
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.45 });
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.5, 4.8), canopyMat);
    canopy.position.set(0, 3.85, 0.6);
    const gasSign = new THREE.Mesh(
      new THREE.BoxGeometry(6.2, 0.85, 0.18),
      new THREE.MeshBasicMaterial({ map: this.host.createSignTexture('⛽ 인계 K-오일 셀프주유소', '#eab308', '#0f172a') })
    );
    gasSign.position.set(0, 4.45, 2.95);

    const pillarMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.4, roughness: 0.4 });
    for (const px of [-2.8, 2.8]) {
      const pil = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.8, 0.35), pillarMat);
      pil.position.set(px, 1.9, -1.2);
      gasGroup.add(pil);
    }
    const pump = new THREE.Mesh(
      new THREE.BoxGeometry(0.85, 1.65, 0.65),
      new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.35 })
    );
    pump.position.set(0, 0.84, -0.7);
    gasGroup.add(gasPad, canopy, gasSign, pump);
    this.host.addProp(gasGroup, gas.x, gas.z, 3);

    this.stations.push({
      name: `${label} K-오일 셀프주유소`,
      kind: 'gas',
      padMinX: gas.x - 5.2,
      padMaxX: gas.x + 5.2,
      padMinZ: gas.z - 5.2,
      padMaxZ: gas.z + 5.2,
      interactX: gas.x,
      interactZ: gas.z,
      interactRadius: 5.5,
    });

    // 2. 인계 번개 오토바이 센터
    const repGroup = new THREE.Group();
    repGroup.position.set(rep.x, 0, rep.z);
    repGroup.rotation.y = rep.facingHeading;

    const repPad = new THREE.Mesh(
      new THREE.BoxGeometry(5.6, 0.06, 4.4),
      new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.72 })
    );
    repPad.position.set(0, 0.04, 1.4);
    const garage = new THREE.Mesh(
      new THREE.BoxGeometry(6.2, 3.6, 2.4),
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.65 })
    );
    garage.position.set(0, 1.8, -1.5);
    const repSign = new THREE.Mesh(
      new THREE.BoxGeometry(6.0, 0.9, 0.2),
      new THREE.MeshBasicMaterial({ map: this.host.createSignTexture('🔧 인계 번개 오토바이 센터', '#ea580c', '#ffffff') })
    );
    repSign.position.set(0, 3.9, -0.25);
    repGroup.add(repPad, garage, repSign);
    this.host.addProp(repGroup, rep.x, rep.z, 3);

    this.stations.push({
      name: '번개 오토바이 센터',
      kind: 'repair',
      padMinX: rep.x - 5.2,
      padMaxX: rep.x + 5.2,
      padMinZ: rep.z - 5.2,
      padMaxZ: rep.z + 5.2,
      interactX: rep.x,
      interactZ: rep.z,
      interactRadius: 5.5,
    });

    // 3. 24시 한국 편의점 (K-24 편의점 — 스태미나 음료 & 보조배터리 급속 충전!)
    const nodes = ACTIVE_MAP_DATA.nodes;
    let cvsX = spawn.x + 32;
    let cvsZ = spawn.z + 18;
    let cvsHeading = 0;
    let bestScore = Infinity;

    for (const e of ACTIVE_MAP_DATA.edges) {
      if (e.dist < 16) continue;
      const na = nodes[e.a];
      const nb = nodes[e.b];
      const mx = (na.x + nb.x) * 0.5;
      const mz = (na.z + nb.z) * 0.5;
      const dx = nb.x - na.x;
      const dz = nb.z - na.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len;
      const nz = dx / len;
      for (const side of [1, -1]) {
        const px = mx + nx * side * (e.width * 0.5 + 2.4);
        const pz = mz + nz * side * (e.width * 0.5 + 2.4);
        if (Math.abs(px) > CITY_WORLD_LIMIT - 35 || Math.abs(pz) > CITY_WORLD_LIMIT - 35) continue;
        const dSpawn = Math.hypot(px - spawn.x, pz - spawn.z);
        if (dSpawn < 24 || dSpawn > 135) continue;
        if (Math.hypot(px - gas.x, pz - gas.z) < 28) continue;
        if (Math.hypot(px - rep.x, pz - rep.z) < 28) continue;
        const hitsBldg = buildingBoxes.some(
          (o) => px + 2.2 > o.minX && px - 2.2 < o.maxX && pz + 2.2 > o.minZ && pz - 2.2 < o.maxZ
        );
        if (hitsBldg) continue;
        const sc = Math.abs(dSpawn - 52);
        if (sc < bestScore) {
          bestScore = sc;
          cvsX = px;
          cvsZ = pz;
          cvsHeading = Math.atan2(mx - px, mz - pz);
        }
      }
    }

    const cvsGroup = new THREE.Group();
    cvsGroup.position.set(cvsX, 0, cvsZ);
    cvsGroup.rotation.y = cvsHeading;

    const cvsPad = new THREE.Mesh(
      new THREE.BoxGeometry(5.2, 0.06, 3.6),
      new THREE.MeshStandardMaterial({ color: 0x10b981, roughness: 0.72 })
    );
    cvsPad.position.set(0, 0.04, 1.3);

    const cvsBody = new THREE.Mesh(
      new THREE.BoxGeometry(5.6, 3.3, 2.5),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 })
    );
    cvsBody.position.set(0, 1.65, -1.4);

    // Brightly lit Korean convenience store showcase window
    const cvsWindow = new THREE.Mesh(
      new THREE.BoxGeometry(4.4, 2.0, 0.08),
      new THREE.MeshStandardMaterial({
        color: 0xe0f2fe,
        emissive: 0xfffbeb,
        emissiveIntensity: 0.95,
        roughness: 0.2,
      })
    );
    cvsWindow.position.set(0, 1.22, -0.14);

    // Signature 3-color Korean convenience store neon fascia stripes (emerald / sky / orange)
    const stripe1 = new THREE.Mesh(
      new THREE.BoxGeometry(5.75, 0.22, 0.24),
      new THREE.MeshStandardMaterial({ color: 0x10b981, emissive: 0x10b981, emissiveIntensity: 1.4 })
    );
    stripe1.position.set(0, 3.36, -0.15);
    const stripe2 = new THREE.Mesh(
      new THREE.BoxGeometry(5.75, 0.14, 0.24),
      new THREE.MeshStandardMaterial({ color: 0x0ea5e9, emissive: 0x0ea5e9, emissiveIntensity: 1.4 })
    );
    stripe2.position.set(0, 3.16, -0.15);
    const stripe3 = new THREE.Mesh(
      new THREE.BoxGeometry(5.75, 0.12, 0.24),
      new THREE.MeshStandardMaterial({ color: 0xf97316, emissive: 0xf97316, emissiveIntensity: 1.4 })
    );
    stripe3.position.set(0, 3.01, -0.15);

    const cvsSign = new THREE.Mesh(
      new THREE.BoxGeometry(5.4, 0.85, 0.2),
      new THREE.MeshBasicMaterial({
        map: this.host.createSignTexture('🏪 K-24 편의점 · 24시간', '#047857', '#ecfdf5'),
      })
    );
    cvsSign.position.set(0, 3.92, -0.15);

    // Outdoor plastic table + blue umbrella parasol (classic Korean CVS!)
    const tblPole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6),
      new THREE.MeshStandardMaterial({ color: 0x64748b })
    );
    tblPole.position.set(2.1, 1.1, 0.75);
    const tblTop = new THREE.Mesh(
      new THREE.CylinderGeometry(0.58, 0.58, 0.07, 10),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc })
    );
    tblTop.position.set(2.1, 0.76, 0.75);
    const parasol = new THREE.Mesh(
      new THREE.ConeGeometry(1.15, 0.45, 8),
      new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.7 })
    );
    parasol.position.set(2.1, 2.25, 0.75);

    cvsGroup.add(cvsPad, cvsBody, cvsWindow, stripe1, stripe2, stripe3, cvsSign, tblPole, tblTop, parasol);
    this.host.addProp(cvsGroup, cvsX, cvsZ, 3);

    this.stations.push({
      name: 'K-24 편의점 (24시)',
      kind: 'convenience',
      padMinX: cvsX - 4.8,
      padMaxX: cvsX + 4.8,
      padMinZ: cvsZ - 4.8,
      padMaxZ: cvsZ + 4.8,
      interactX: cvsX,
      interactZ: cvsZ,
      interactRadius: 5.4,
    });
  }

  public isPlayerNearConvenienceStore(px: number, pz: number): boolean {
    return this.stations.some(
      (st) => st.kind === 'convenience' && Math.hypot(px - st.interactX, pz - st.interactZ) <= st.interactRadius
    );
  }

  public isScooterOnGasPad(sx: number, sz: number): boolean {
    return this.stations.some(
      (st) => st.kind === 'gas' && sx >= st.padMinX && sx <= st.padMaxX && sz >= st.padMinZ && sz <= st.padMaxZ
    );
  }

  public isPlayerNearGasPump(px: number, pz: number): boolean {
    return this.stations.some(
      (st) => st.kind === 'gas' && Math.hypot(px - st.interactX, pz - st.interactZ) <= st.interactRadius
    );
  }

  public isScooterOnRepairPad(sx: number, sz: number): boolean {
    return this.stations.some(
      (st) => st.kind === 'repair' && sx >= st.padMinX && sx <= st.padMaxX && sz >= st.padMinZ && sz <= st.padMaxZ
    );
  }

  public isPlayerNearRepairShop(px: number, pz: number): boolean {
    return this.stations.some(
      (st) => st.kind === 'repair' && Math.hypot(px - st.interactX, pz - st.interactZ) <= st.interactRadius
    );
  }
}
