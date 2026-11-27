import { PerfMonitor } from './PerfMonitor';
import { SuwonDistrictId } from '../data/suwonTypes';
import { WeatherMode } from '../types';

/**
 * Worst-case benchmark suite (`?bench=suite` or `__benchSuite()` in the console).
 *
 * Runs fixed scenarios one after another - densest district, riding with mirrors, a scripted drive
 * that streams chunks, night lighting, rain - and records frame / CPU / GPU / draw-call stats for
 * each, so optimizations can be compared on the same footing and on any machine.
 */

export interface BenchmarkDeps {
  perf: PerfMonitor;
  teleport: (id: SuwonDistrictId) => void;
  isRiding: () => boolean;
  toggleMount: () => void;
  setNight: (on: boolean) => void;
  setWeather: (mode: WeatherMode) => void;
  /** Rotate the on-foot view (rad) */
  turnView: (deltaYaw: number) => void;
  /** Road path from the rider toward (x, z) */
  pathTo: (x: number, z: number) => Array<{ x: number; z: number }>;
  /** Place the mounted scooter (and rider) at a pose */
  placeScooter: (x: number, z: number, heading: number) => void;
  districtSpawn: (id: SuwonDistrictId) => { x: number; z: number };
  graphicsInfo: () => { pixelRatio: number; antialias: boolean };
}

export interface SuiteRow {
  scenario: string;
  fps: number;
  frameP95: number;
  worstFrame: number;
  cpuMs: number;
  cpuWorst: number;
  gpuMs: number | null;
  drawCalls: number;
  triangles: number;
  pixelRatio: number;
}

interface Scenario {
  name: string;
  district: SuwonDistrictId;
  riding: boolean;
  night: boolean;
  weather: WeatherMode;
  /** 'look' = spin the on-foot view, 'still' = idle, 'drive' = scripted 12 m/s drive */
  motion: 'look' | 'still' | 'drive';
}

const SCENARIOS: Scenario[] = [
  { name: '인계동 도보', district: 'ingye', riding: false, night: false, weather: 'clear', motion: 'look' },
  { name: '수원역 도보 (최고 밀도)', district: 'suwon_station', riding: false, night: false, weather: 'clear', motion: 'look' },
  { name: '수원역 주행 정지', district: 'suwon_station', riding: true, night: false, weather: 'clear', motion: 'still' },
  { name: '수원역 주행 이동', district: 'suwon_station', riding: true, night: false, weather: 'clear', motion: 'drive' },
  { name: '수원역 밤 도보', district: 'suwon_station', riding: false, night: true, weather: 'clear', motion: 'look' },
  { name: '수원역 비 도보', district: 'suwon_station', riding: false, night: false, weather: 'rain', motion: 'look' },
  { name: '수원역 밤+비 주행 이동', district: 'suwon_station', riding: true, night: true, weather: 'rain', motion: 'drive' },
  { name: '광교 도보 (저밀도)', district: 'gwanggyo', riding: false, night: false, weather: 'clear', motion: 'look' },
];

const SETTLE_MS = 2500;
const MEASURE_MS = 6000;
const DRIVE_SPEED = 12; // m/s (~43 km/h)

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runBenchmarkSuite(d: BenchmarkDeps, onProgress?: (msg: string) => void): Promise<SuiteRow[]> {
  const rows: SuiteRow[] = [];
  d.perf.setCollecting(true);
  try {
    for (const sc of SCENARIOS) {
      onProgress?.(`벤치마크: ${sc.name} (${rows.length + 1}/${SCENARIOS.length})`);
      if (d.isRiding()) d.toggleMount();
      await wait(150);
      d.setNight(sc.night);
      d.setWeather(sc.weather);
      d.teleport(sc.district);
      await wait(300);
      if (sc.riding && !d.isRiding()) d.toggleMount();

      // Scripted drive toward the next district along real roads (streams new chunks on the way)
      let drive: { pts: Array<{ x: number; z: number }>; seg: number; t: number } | null = null;
      if (sc.motion === 'drive') {
        const target = d.districtSpawn(sc.district === 'suwon_station' ? 'haenggung' : 'ingye');
        drive = { pts: d.pathTo(target.x, target.z), seg: 0, t: 0 };
      }
      let last = performance.now();
      let running = true;
      const tick = () => {
        if (!running) return;
        const now = performance.now();
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        if (sc.motion === 'look') d.turnView(dt * 0.9);
        if (drive && drive.seg < drive.pts.length - 1) {
          let move = DRIVE_SPEED * dt;
          while (move > 0 && drive.seg < drive.pts.length - 1) {
            const a = drive.pts[drive.seg];
            const b = drive.pts[drive.seg + 1];
            const len = Math.hypot(b.x - a.x, b.z - a.z) || 0.001;
            const left = len * (1 - drive.t);
            if (move < left) {
              drive.t += move / len;
              move = 0;
            } else {
              move -= left;
              drive.seg++;
              drive.t = 0;
            }
          }
          const a = drive.pts[drive.seg];
          const b = drive.pts[Math.min(drive.pts.length - 1, drive.seg + 1)];
          d.placeScooter(a.x + (b.x - a.x) * drive.t, a.z + (b.z - a.z) * drive.t, Math.atan2(b.x - a.x, b.z - a.z));
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);

      await wait(SETTLE_MS);
      d.perf.resetStats();
      await wait(MEASURE_MS);
      running = false;
      const r = d.perf.report() as {
        fps: number;
        frameP95: number;
        frameWorst: number;
        cpuMs: number;
        cpuWorst: number;
        gpu: Record<string, number>;
        drawCalls: number;
        triangles: number;
      };
      const gpuVals = Object.values(r.gpu);
      rows.push({
        scenario: sc.name,
        fps: r.fps,
        frameP95: r.frameP95,
        worstFrame: r.frameWorst,
        cpuMs: r.cpuMs,
        cpuWorst: r.cpuWorst,
        gpuMs: gpuVals.length > 0 ? +gpuVals.reduce((a, b) => a + b, 0).toFixed(2) : null,
        drawCalls: r.drawCalls,
        triangles: r.triangles,
        pixelRatio: +d.graphicsInfo().pixelRatio.toFixed(2),
      });
    }
  } finally {
    if (d.isRiding()) d.toggleMount();
    d.setNight(false);
    d.setWeather('clear');
    d.teleport('ingye');
    d.perf.setCollecting(false);
  }
  const info = d.graphicsInfo();
  console.log(`[bench] antialias=${info.antialias} dpr=${window.devicePixelRatio}`);
  console.table(rows);
  onProgress?.('벤치마크 완료');
  return rows;
}
