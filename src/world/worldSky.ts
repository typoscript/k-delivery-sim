import * as THREE from 'three';
import { WeatherMode } from '../types';
import { setStorefrontNightGlow } from './openworld/openWorldMaterials';

/** Day or night look for one weather */
export interface SkyLook {
  bg: number;
  fog: number;
  fogDensity: number;
  dirI: number;
  dirColor: number;
  hemiI: number;
  lampE: number;
  windowE: number;
  buildingE: number;
}

/** Sky, fog, sun & sky light, street lamp / window glow and lit building windows for a weather, day or night */
export function skyLookFor(weather: WeatherMode, night: boolean): SkyLook {
  const isRain = weather === 'rain';
  const isCloudy = weather === 'cloudy';
  if (weather === 'snow') {
    // overcast and white: thick pale fog, flat light; at night the snow reflects the city glow
    return night
      ? { bg: 0x1a2230, fog: 0x2a3444, fogDensity: 0.0048, dirI: 0.22, dirColor: 0x9fb4d0, hemiI: 0.4, lampE: 3.6, windowE: 1.25, buildingE: 0.92 }
      : { bg: 0xc4ccd6, fog: 0xd3d9e0, fogDensity: 0.0044, dirI: 0.72, dirColor: 0xe8eef6, hemiI: 0.95, lampE: 0.9, windowE: 0.35, buildingE: 0 };
  }
  if (night) {
    const bg = isRain ? 0x060b14 : isCloudy ? 0x09101d : 0x0b1220;
    return {
      bg,
      fog: bg,
      fogDensity: isRain ? 0.0046 : isCloudy ? 0.0036 : 0.003,
      dirI: isRain ? 0.16 : isCloudy ? 0.2 : 0.25,
      dirColor: isRain ? 0x6b88b0 : 0x8aa8d6,
      hemiI: isRain ? 0.22 : 0.28,
      lampE: isRain ? 3.8 : 3.2,
      windowE: isRain ? 1.3 : 1.1,
      buildingE: isRain ? 0.96 : 0.84,
    };
  }
  if (isRain) {
    return { bg: 0x5b6d80, fog: 0x5b6d80, fogDensity: 0.0042, dirI: 0.54, dirColor: 0xb8cde0, hemiI: 0.58, lampE: 1.45, windowE: 0.42, buildingE: 0 };
  }
  if (isCloudy) {
    return { bg: 0x889cb0, fog: 0x889cb0, fogDensity: 0.0024, dirI: 0.94, dirColor: 0xdce6f2, hemiI: 0.74, lampE: 0.45, windowE: 0.2, buildingE: 0 };
  }
  return { bg: 0x93c5fd, fog: 0xa5d4fb, fogDensity: 0.00145, dirI: 1.48, dirColor: 0xfff7e6, hemiI: 0.92, lampE: 0.2, windowE: 0.14, buildingE: 0 };
}

/** The scene objects the sky drives */
export interface SkyTargets {
  scene: THREE.Scene;
  dirLight: THREE.DirectionalLight;
  hemiLight: THREE.HemisphereLight;
  lampGlowMat: THREE.MeshStandardMaterial;
  windowGlowMat: THREE.MeshStandardMaterial;
  /** Building wall materials whose emissive window maps light up at night (filled as chunks stream in) */
  buildingNightMats: readonly THREE.MeshStandardMaterial[];
  streetLampPools: THREE.Object3D;
  /** Shopfront materials (signs / windows light up at night) */
  nightGlowMats?: readonly THREE.Material[];
  landmarkBuilders: ReadonlyArray<{ setNightMode(isNight: boolean): void }>;
  /** Map-size dependent fog density */
  fogDensity: (legacyDensity: number) => number;
}

/**
 * Applies weather x time of day to the outdoor scene. `nightness` (0 day .. 1 night, from the game clock)
 * blends the day and night looks so dusk and dawn darken / brighten gradually; street lamp light pools and
 * landmark night lighting switch on in the darker half (isNight).
 */
export class WorldSky {
  /** 0 = day .. 1 = night (-1 until the first setNightness so it always applies once) */
  private nightness = -1;
  private readonly skyColor = new THREE.Color();
  private readonly tmpColor = new THREE.Color();
  private readonly skyFog = new THREE.FogExp2(0xa5d4fb, 0.00145);

  constructor(private readonly t: SkyTargets) {}

  /** Stores a new nightness; returns false when it did not visibly change (unless `force`) */
  public setNightness(n: number, force: boolean): boolean {
    if (!force && Math.abs(n - this.nightness) < 0.01) return false;
    this.nightness = n;
    return true;
  }

  public apply(weather: WeatherMode, isNight: boolean): void {
    const k = Math.max(0, this.nightness);
    const day = skyLookFor(weather, false);
    const night = skyLookFor(weather, true);
    const mix = (a: number, b: number) => a + (b - a) * k;
    const { scene, dirLight, hemiLight } = this.t;
    for (const lb of this.t.landmarkBuilders) lb.setNightMode(isNight);
    this.t.streetLampPools.visible = isNight;
    for (const bm of this.t.buildingNightMats) bm.emissiveIntensity = mix(day.buildingE, night.buildingE);
    for (const m of this.t.nightGlowMats ?? []) setStorefrontNightGlow(m, k);

    this.skyColor.setHex(day.bg).lerp(this.tmpColor.setHex(night.bg), k);
    scene.background = this.skyColor;
    this.skyFog.color.setHex(day.fog).lerp(this.tmpColor.setHex(night.fog), k);
    this.skyFog.density = mix(this.t.fogDensity(day.fogDensity), this.t.fogDensity(night.fogDensity));
    scene.fog = this.skyFog;
    dirLight.intensity = mix(day.dirI, night.dirI);
    dirLight.color.setHex(day.dirColor).lerp(this.tmpColor.setHex(night.dirColor), k);
    hemiLight.intensity = mix(day.hemiI, night.hemiI);
    this.t.lampGlowMat.emissiveIntensity = mix(day.lampE, night.lampE);
    this.t.windowGlowMat.emissiveIntensity = mix(day.windowE, night.windowE);
  }
}
