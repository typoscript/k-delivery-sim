import * as THREE from 'three';
import { WeatherMode } from '../types';

const RAIN_DROP_COUNT = 760;
const RAIN_AREA_XZ = 34; // meters wide box centered around camera/player
const RAIN_HEIGHT_Y = 18;
const RAIN_HALF_XZ = RAIN_AREA_XZ * 0.5;

export interface WeatherLabelInfo {
  mode: WeatherMode;
  icon: string;
  label: string;
  shortLabel: string;
}

/**
 * Manages dynamic weather states ('clear' | 'cloudy' | 'rain') and a single-DrawCall
 * camera-local InstancedMesh rain particle system with zero per-frame allocations.
 * Automatically suspends & hides rain immediately upon entering underground corridors.
 */
export class WeatherManager {
  public mode: WeatherMode = 'clear';
  public rainIntensity = 0; // smoothly approaches 1 when raining, 0 otherwise

  private readonly rainMesh: THREE.InstancedMesh;
  private readonly rainMat: THREE.MeshBasicMaterial;
  private readonly dropX = new Float32Array(RAIN_DROP_COUNT);
  private readonly dropY = new Float32Array(RAIN_DROP_COUNT);
  private readonly dropZ = new Float32Array(RAIN_DROP_COUNT);
  private readonly dropSpeed = new Float32Array(RAIN_DROP_COUNT);

  constructor(scene: THREE.Scene) {
    // Thin slender 3-sided prism streaks -> 1 DrawCall for all 760 raindrops!
    const dropGeo = new THREE.CylinderGeometry(0.006, 0.011, 0.78, 3, 1, true);
    // Slight wind slant baked directly into geometry so instance matrices only update translation!
    dropGeo.rotateZ(0.08);

    this.rainMat = new THREE.MeshBasicMaterial({
      color: 0xcbe8ff,
      transparent: true,
      opacity: 0.44,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.rainMesh = new THREE.InstancedMesh(dropGeo, this.rainMat, RAIN_DROP_COUNT);
    this.rainMesh.frustumCulled = false;
    this.rainMesh.renderOrder = 6;
    this.rainMesh.visible = false;

    const dummy = new THREE.Object3D();
    for (let i = 0; i < RAIN_DROP_COUNT; i++) {
      const rx = (Math.random() - 0.5) * RAIN_AREA_XZ;
      const ry = Math.random() * RAIN_HEIGHT_Y;
      const rz = (Math.random() - 0.5) * RAIN_AREA_XZ;
      this.dropX[i] = rx;
      this.dropY[i] = ry;
      this.dropZ[i] = rz;
      this.dropSpeed[i] = 17.5 + Math.random() * 6.5;

      dummy.position.set(rx, ry, rz);
      dummy.scale.set(1, 0.8 + Math.random() * 0.45, 1);
      dummy.updateMatrix();
      this.rainMesh.setMatrixAt(i, dummy.matrix);
    }
    this.rainMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rainMesh.instanceMatrix.needsUpdate = true;

    scene.add(this.rainMesh);
  }

  public get isRaining(): boolean {
    return this.mode === 'rain';
  }

  public setMode(next: WeatherMode): WeatherMode {
    this.mode = next;
    return this.mode;
  }

  public cycleMode(): WeatherMode {
    if (this.mode === 'clear') this.mode = 'cloudy';
    else if (this.mode === 'cloudy') this.mode = 'rain';
    else this.mode = 'clear';
    return this.mode;
  }

  public getLabelInfo(): WeatherLabelInfo {
    switch (this.mode) {
      case 'cloudy':
        return { mode: 'cloudy', icon: '☁️', label: '흐림', shortLabel: '☁️ 흐림' };
      case 'rain':
        return {
          mode: 'rain',
          icon: '🌧️',
          label: '비 (우천 할증 +₩1,500)',
          shortLabel: '🌧️ 비 · 할증',
        };
      default:
        return { mode: 'clear', icon: '☀️', label: '맑음', shortLabel: '☀️ 맑음' };
    }
  }

  /**
   * Updates camera-local rain particles in-place via direct Float32Array matrix writes.
   * Immediately hides and halts particle updates when inside the underground corridor!
   */
  public update(
    dt: number,
    camX: number,
    camY: number,
    camZ: number,
    inCorridor: boolean,
    isNight: boolean
  ): void {
    const targetIntensity = !inCorridor && this.mode === 'rain' ? 1 : 0;

    if (inCorridor) {
      // Instant stop & hide indoors (y = -500)
      this.rainIntensity = 0;
      this.rainMesh.visible = false;
      return;
    }

    this.rainIntensity += (targetIntensity - this.rainIntensity) * Math.min(1, dt * 3.8);
    if (this.rainIntensity < 0.02 && this.mode !== 'rain') {
      this.rainIntensity = 0;
      this.rainMesh.visible = false;
      return;
    }

    this.rainMesh.visible = true;
    this.rainMat.opacity = (isNight ? 0.34 : 0.46) * this.rainIntensity;
    this.rainMat.color.setHex(isNight ? 0x94b8d8 : 0xdbeeff);

    const arr = this.rainMesh.instanceMatrix.array as Float32Array;
    const minY = Math.max(0.1, camY - 2.0);
    const maxY = camY + RAIN_HEIGHT_Y - 2.0;
    const windDx = -1.6 * dt;

    for (let i = 0; i < RAIN_DROP_COUNT; i++) {
      let x = this.dropX[i] + windDx;
      let y = this.dropY[i] - this.dropSpeed[i] * dt;
      let z = this.dropZ[i];

      if (y < minY) {
        y = maxY - Math.random() * 2.2;
        x = camX + (Math.random() - 0.5) * RAIN_AREA_XZ;
        z = camZ + (Math.random() - 0.5) * RAIN_AREA_XZ;
      } else {
        // Wrap around camera horizontally so rain density stays uniform at high speed
        const dx = x - camX;
        if (dx > RAIN_HALF_XZ) x -= RAIN_AREA_XZ;
        else if (dx < -RAIN_HALF_XZ) x += RAIN_AREA_XZ;

        const dz = z - camZ;
        if (dz > RAIN_HALF_XZ) z -= RAIN_AREA_XZ;
        else if (dz < -RAIN_HALF_XZ) z += RAIN_AREA_XZ;
      }

      this.dropX[i] = x;
      this.dropY[i] = y;
      this.dropZ[i] = z;

      // Direct translation overwrite into column-major 4x4 matrix (indices 12, 13, 14)
      const base = i * 16;
      arr[base + 12] = x;
      arr[base + 13] = y;
      arr[base + 14] = z;
    }

    this.rainMesh.instanceMatrix.needsUpdate = true;
  }
}
