/** Outdoor visibility, weather visuals and the day / night sky theme */
import type { CityWorld } from './CityWorld';
import * as THREE from 'three';
import { WeatherMode } from '../types';

export function setOutdoorVisible(host: CityWorld, visible: boolean): void {
  host.root.visible = visible;
  if (!visible) {
    host.scene.background = new THREE.Color(0x11151c);
    host.scene.fog = null;
  } else {
    host.applySkyTheme();
  }
}

export function setWeather(host: CityWorld, mode: WeatherMode): void {
  host.weatherMode = mode;
  if (host.root.visible) {
    host.applySkyTheme();
  }
}

export function updateWeatherVisuals(host: CityWorld, rainIntensity: number, elapsedTime: number): void {
  host.roadShaderUniforms.uRainWetness.value = rainIntensity;
  host.roadShaderUniforms.uTime.value = elapsedTime;

  const wetMetal = 0.04 + rainIntensity * 0.34;
  const wetTint = 1.0 - rainIntensity * 0.32;
  host.asphaltMat.metalness = wetMetal;
  host.asphaltMat.color.setRGB(wetTint * 0.95, wetTint * 0.98, wetTint * 1.05);

  host.crosswalkPaintMat.roughness = 0.78 - rainIntensity * 0.62;
  host.crosswalkPaintMat.metalness = 0.05 + rainIntensity * 0.25;

  host.manholeMat.roughness = 0.55 - rainIntensity * 0.43;
  host.manholeMat.metalness = 0.78 + rainIntensity * 0.16;
}

/** Re-applies sky, fog, lights and night glow for the current weather and time of day */
export function applySkyTheme(host: CityWorld): void {
  host.sky.apply(host.weatherMode, host.isNight);
}

/**
 * Time of day from the game clock: 0 = day, 1 = night (fractions during dusk / dawn).
 * Re-applies the sky only when it visibly changed. Returns isNight (the darker half).
 */
export function setNightness(host: CityWorld, nightness: number): boolean {
  const n = Math.max(0, Math.min(1, nightness));
  const wasNight = host.isNight;
  host.isNight = n >= 0.5;
  if (!host.sky.setNightness(n, wasNight !== host.isNight)) return host.isNight;
  if (host.root.visible) host.applySkyTheme();
  return host.isNight;
}
