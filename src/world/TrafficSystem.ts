import * as THREE from 'three';
import { ObstacleBox, clamp, wrapAngle } from '../types';

export type SignalColor = 'green' | 'yellow' | 'red';

export interface SignalStateSnapshot {
  ns: SignalColor;
  ew: SignalColor;
  remainingSec: number;
}

export interface TrafficCarSnapshot {
  x: number;
  z: number;
  heading: number;
  color: string;
}

type CardinalDir = 0 | 1 | 2 | 3; // 0: +Z (N), 1: +X (E), 2: -Z (S), 3: -X (W)

const ROAD_LINES = [-120, -40, 40, 120];
const LANE_OFFSET = 3.5; // right-hand lane center offset from road centerline
const STOP_LINE_DIST = 11.2; // distance from intersection center where cars stop on red
const CYCLE_DURATION = 18.0;

interface AiCar {
  mesh: THREE.Group;
  brakeMat: THREE.MeshStandardMaterial;
  headlightMat: THREE.MeshStandardMaterial;
  x: number;
  z: number;
  heading: number;
  dir: CardinalDir;
  roadIndex: number; // index into ROAD_LINES for the road currently traveling along
  speed: number;
  cruiseSpeed: number;
  braking: boolean;
  turning: boolean;
  turnTargetX: number;
  turnTargetZ: number;
  turnTargetDir: CardinalDir;
  turnTargetRoadIndex: number;
  colorHex: string;
  halfWidth: number;
  halfLength: number;
}

function dirVector(dir: CardinalDir): [number, number] {
  switch (dir) {
    case 0:
      return [0, 1]; // +Z (North)
    case 1:
      return [1, 0]; // +X (East)
    case 2:
      return [0, -1]; // -Z (South)
    case 3:
      return [-1, 0]; // -X (West)
  }
}

function dirHeading(dir: CardinalDir): number {
  switch (dir) {
    case 0:
      return 0;
    case 1:
      return Math.PI / 2;
    case 2:
      return Math.PI;
    case 3:
      return -Math.PI / 2;
  }
}

/** Right-hand lane coordinate perpendicular to travel direction */
function laneCoordForDir(roadCoord: number, dir: CardinalDir): number {
  // forward × up = (-fz, 0, fx)
  // dir 0 (+Z): right is -X -> roadCoord - LANE_OFFSET
  // dir 2 (-Z): right is +X -> roadCoord + LANE_OFFSET
  // dir 1 (+X): right is +Z -> roadCoord + LANE_OFFSET
  // dir 3 (-X): right is -Z -> roadCoord - LANE_OFFSET
  if (dir === 0 || dir === 3) return roadCoord - LANE_OFFSET;
  return roadCoord + LANE_OFFSET;
}

function isAxisNS(dir: CardinalDir): boolean {
  return dir === 0 || dir === 2;
}

export class TrafficSystem {
  public readonly root = new THREE.Group();
  private readonly cars: AiCar[] = [];

  // Shared emissive materials for all 16 intersections (zero per-frame allocations!)
  private readonly nsRedMat: THREE.MeshStandardMaterial;
  private readonly nsYellowMat: THREE.MeshStandardMaterial;
  private readonly nsGreenMat: THREE.MeshStandardMaterial;
  private readonly ewRedMat: THREE.MeshStandardMaterial;
  private readonly ewYellowMat: THREE.MeshStandardMaterial;
  private readonly ewGreenMat: THREE.MeshStandardMaterial;

  public signalState: SignalStateSnapshot = { ns: 'green', ew: 'red', remainingSec: 6.5 };

  // Red-light violation detector state for player scooter
  private prevPlayerX = -62;
  private prevPlayerZ = -34.2;
  private violationCooldown = 0;

  constructor(scene: THREE.Scene) {
    scene.add(this.root);

    this.nsRedMat = new THREE.MeshStandardMaterial({ color: 0x3b0a0a, emissive: 0xef4444, emissiveIntensity: 0 });
    this.nsYellowMat = new THREE.MeshStandardMaterial({ color: 0x3b2c0a, emissive: 0xfacc15, emissiveIntensity: 0 });
    this.nsGreenMat = new THREE.MeshStandardMaterial({ color: 0x0a3b20, emissive: 0x22c55e, emissiveIntensity: 2.5 });

    this.ewRedMat = new THREE.MeshStandardMaterial({ color: 0x3b0a0a, emissive: 0xef4444, emissiveIntensity: 2.5 });
    this.ewYellowMat = new THREE.MeshStandardMaterial({ color: 0x3b2c0a, emissive: 0xfacc15, emissiveIntensity: 0 });
    this.ewGreenMat = new THREE.MeshStandardMaterial({ color: 0x0a3b20, emissive: 0x22c55e, emissiveIntensity: 0 });

    this.buildTrafficSignals();
    this.spawnTrafficCars();
  }

  private buildTrafficSignals(): void {
    const poleMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.45,
      metalness: 0.65,
    });
    const housingMat = new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.6,
    });

    const poleGeo = new THREE.CylinderGeometry(0.11, 0.14, 5.4, 7);
    const armGeo = new THREE.CylinderGeometry(0.08, 0.09, 5.2, 7);
    armGeo.rotateZ(Math.PI / 2);
    const housingGeo = new THREE.BoxGeometry(1.75, 0.56, 0.34);
    const lampGeo = new THREE.SphereGeometry(0.17, 10, 8);

    // Build 2 diagonal overhead signal poles per intersection (4 traffic directions visible!)
    for (const ix of ROAD_LINES) {
      for (const iz of ROAD_LINES) {
        // Place overhead signal arms for NS and EW visibility
        const configs: Array<{
          px: number;
          pz: number;
          rotY: number;
          axis: 'ns' | 'ew';
        }> = [
          // Visible to Northbound (+Z) traffic (far-right corner at ix - 8.2, iz + 8.2)
          { px: ix - 8.2, pz: iz + 8.2, rotY: 0, axis: 'ns' },
          // Visible to Southbound (-Z) traffic (far-right corner at ix + 8.2, iz - 8.2)
          { px: ix + 8.2, pz: iz - 8.2, rotY: Math.PI, axis: 'ns' },
          // Visible to Eastbound (+X) traffic (far-right corner at ix + 8.2, iz + 8.2)
          { px: ix + 8.2, pz: iz + 8.2, rotY: Math.PI / 2, axis: 'ew' },
          // Visible to Westbound (-X) traffic (far-right corner at ix - 8.2, iz - 8.2)
          { px: ix - 8.2, pz: iz - 8.2, rotY: -Math.PI / 2, axis: 'ew' },
        ];

        for (const cfg of configs) {
          const g = new THREE.Group();
          g.position.set(cfg.px, 0, cfg.pz);
          g.rotation.y = cfg.rotY;

          const pole = new THREE.Mesh(poleGeo, poleMat);
          pole.position.y = 2.7;
          g.add(pole);

          // Cantilever arm extending inward over the oncoming right-hand lane (+X local)
          const arm = new THREE.Mesh(armGeo, poleMat);
          arm.position.set(2.5, 5.15, 0);
          g.add(arm);

          const housing = new THREE.Mesh(housingGeo, housingMat);
          housing.position.set(4.1, 5.05, 0);
          g.add(housing);

          const rMat = cfg.axis === 'ns' ? this.nsRedMat : this.ewRedMat;
          const yMat = cfg.axis === 'ns' ? this.nsYellowMat : this.ewYellowMat;
          const gMat = cfg.axis === 'ns' ? this.nsGreenMat : this.ewGreenMat;

          // Korean horizontal traffic light order facing oncoming driver (-Z local): Red | Yellow | Green
          const redLamp = new THREE.Mesh(lampGeo, rMat);
          redLamp.position.set(4.6, 5.05, -0.15);
          const yelLamp = new THREE.Mesh(lampGeo, yMat);
          yelLamp.position.set(4.1, 5.05, -0.15);
          const grnLamp = new THREE.Mesh(lampGeo, gMat);
          grnLamp.position.set(3.6, 5.05, -0.15);

          g.add(redLamp, yelLamp, grnLamp);
          this.root.add(g);
        }
      }
    }
  }

  private createCarMesh(
    bodyColor: number,
    isTaxi: boolean,
    isVan: boolean
  ): {
    group: THREE.Group;
    brakeMat: THREE.MeshStandardMaterial;
    headlightMat: THREE.MeshStandardMaterial;
  } {
    const group = new THREE.Group();

    const paintMat = new THREE.MeshStandardMaterial({
      color: bodyColor,
      roughness: 0.35,
      metalness: 0.25,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.15,
      metalness: 0.5,
    });
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x181c22, roughness: 0.9 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.6, roughness: 0.35 });
    const brakeMat = new THREE.MeshStandardMaterial({
      color: 0x7f1d1d,
      emissive: 0xef4444,
      emissiveIntensity: 0.3,
    });
    const headlightMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      emissive: 0xfffbeb,
      emissiveIntensity: 0.35,
    });

    const length = isVan ? 4.5 : 4.2;
    const width = 1.88;

    // Lower body
    const body = new THREE.Mesh(new THREE.BoxGeometry(width, 0.72, length), paintMat);
    body.position.set(0, 0.66, 0);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Cabin / roof
    const cabinLen = isVan ? 3.2 : 2.15;
    const cabinHeight = isVan ? 0.95 : 0.64;
    const cabinZ = isVan ? -0.35 : -0.18;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(width - 0.16, cabinHeight, cabinLen), paintMat);
    cabin.position.set(0, 1.02 + cabinHeight / 2 - 0.04, cabinZ);
    cabin.castShadow = true;
    group.add(cabin);

    // Windshields
    const frontGlass = new THREE.Mesh(new THREE.BoxGeometry(width - 0.28, cabinHeight * 0.66, 0.06), glassMat);
    frontGlass.position.set(0, 1.0 + cabinHeight * 0.45, cabinZ + cabinLen / 2 + 0.01);
    const rearGlass = new THREE.Mesh(new THREE.BoxGeometry(width - 0.28, cabinHeight * 0.62, 0.06), glassMat);
    rearGlass.position.set(0, 1.0 + cabinHeight * 0.45, cabinZ - cabinLen / 2 - 0.01);
    group.add(frontGlass, rearGlass);

    // Korean Taxi roof cap
    if (isTaxi) {
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.2, 0.24),
        new THREE.MeshStandardMaterial({
          color: 0xfef08a,
          emissive: 0xfacc15,
          emissiveIntensity: 0.85,
        })
      );
      cap.position.set(0, 1.72, -0.05);
      group.add(cap);
    }

    // Headlights (+Z front) & Brake lights (-Z rear)
    for (const side of [-1, 1]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.08), headlightMat);
      hl.position.set(side * 0.64, 0.68, length / 2 + 0.02);
      group.add(hl);

      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.08), brakeMat);
      tl.position.set(side * 0.62, 0.72, -length / 2 - 0.02);
      group.add(tl);
    }

    // 4 wheels
    const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.22, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.24, 10);
    rimGeo.rotateZ(Math.PI / 2);

    for (const wz of [-1.32, 1.32]) {
      for (const side of [-1, 1]) {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.position.set(side * 0.9, 0.34, wz);
        const r = new THREE.Mesh(rimGeo, rimMat);
        r.position.set(side * 0.9, 0.34, wz);
        group.add(w, r);
      }
    }

    return { group, brakeMat, headlightMat };
  }

  private spawnTrafficCars(): void {
    const palette: Array<{ hex: number; css: string; taxi?: boolean; van?: boolean }> = [
      { hex: 0xf8fafc, css: '#f8fafc' }, // White sedan
      { hex: 0xf97316, css: '#f97316', taxi: true }, // Seoul orange taxi
      { hex: 0x94a3b8, css: '#94a3b8' }, // Silver sedan
      { hex: 0x1e3a8a, css: '#3b82f6' }, // Navy sedan
      { hex: 0xe2e8f0, css: '#e2e8f0', van: true }, // Delivery van
      { hex: 0x334155, css: '#64748b' }, // Dark grey sedan
      { hex: 0xfacc15, css: '#facc15', taxi: true }, // Yellow taxi
      { hex: 0x0f766e, css: '#14b8a6' }, // Teal SUV
    ];

    // Pre-placed well-spaced spawn slots across the 4x4 city grid (clear of player spawn at -62, -34.2)
    const spawns: Array<{ dir: CardinalDir; roadIdx: number; along: number }> = [
      { dir: 1, roadIdx: 1, along: -95 }, // z=-40 Eastbound
      { dir: 1, roadIdx: 2, along: -80 }, // z=+40 Eastbound
      { dir: 1, roadIdx: 2, along: 10 },
      { dir: 1, roadIdx: 3, along: -60 }, // z=+120 Eastbound
      { dir: 3, roadIdx: 0, along: 75 }, // z=-120 Westbound
      { dir: 3, roadIdx: 1, along: 65 }, // z=-40 Westbound
      { dir: 3, roadIdx: 2, along: 85 }, // z=+40 Westbound
      { dir: 0, roadIdx: 0, along: -80 }, // x=-120 Northbound
      { dir: 0, roadIdx: 1, along: -10 }, // x=-40 Northbound
      { dir: 0, roadIdx: 2, along: -85 }, // x=+40 Northbound
      { dir: 0, roadIdx: 3, along: 5 }, // x=+120 Northbound
      { dir: 2, roadIdx: 1, along: 85 }, // x=-40 Southbound
      { dir: 2, roadIdx: 2, along: 75 }, // x=+40 Southbound
      { dir: 2, roadIdx: 3, along: -15 }, // x=+120 Southbound
    ];

    spawns.forEach((sp, idx) => {
      const style = palette[idx % palette.length];
      const { group, brakeMat, headlightMat } = this.createCarMesh(
        style.hex,
        Boolean(style.taxi),
        Boolean(style.van)
      );

      const roadCoord = ROAD_LINES[sp.roadIdx];
      const lane = laneCoordForDir(roadCoord, sp.dir);
      const x = isAxisNS(sp.dir) ? lane : sp.along;
      const z = isAxisNS(sp.dir) ? sp.along : lane;
      const heading = dirHeading(sp.dir);

      group.position.set(x, 0, z);
      group.rotation.y = heading;
      this.root.add(group);

      this.cars.push({
        mesh: group,
        brakeMat,
        headlightMat,
        x,
        z,
        heading,
        dir: sp.dir,
        roadIndex: sp.roadIdx,
        speed: 7.5,
        cruiseSpeed: 9.2 + (idx % 4) * 1.1, // ~33 to 45 km/h
        braking: false,
        turning: false,
        turnTargetX: x,
        turnTargetZ: z,
        turnTargetDir: sp.dir,
        turnTargetRoadIndex: sp.roadIdx,
        colorHex: style.css,
        halfWidth: 1.0,
        halfLength: style.van ? 2.3 : 2.15,
      });
    });
  }

  public getCarSnapshots(): TrafficCarSnapshot[] {
    return this.cars.map((c) => ({
      x: c.x,
      z: c.z,
      heading: c.heading,
      color: c.colorHex,
    }));
  }

  /** Returns car obstacle boxes for walking collision & low-speed scooter collision */
  public getCarObstacleBoxes(): ObstacleBox[] {
    return this.cars.map((c) => {
      const ns = Math.abs(Math.cos(c.heading)) > 0.7;
      const rx = ns ? c.halfWidth : c.halfLength;
      const rz = ns ? c.halfLength : c.halfWidth;
      return {
        minX: c.x - rx,
        maxX: c.x + rx,
        minZ: c.z - rz,
        maxZ: c.z + rz,
      };
    });
  }

  public getSignalForDirection(dir: CardinalDir): SignalColor {
    return isAxisNS(dir) ? this.signalState.ns : this.signalState.ew;
  }

  private updateSignals(elapsedTime: number): void {
    const t = elapsedTime % CYCLE_DURATION;
    let ns: SignalColor = 'red';
    let ew: SignalColor = 'red';
    let remaining = 0;

    if (t < 6.5) {
      ns = 'green';
      ew = 'red';
      remaining = 6.5 - t;
    } else if (t < 8.5) {
      ns = 'yellow';
      ew = 'red';
      remaining = 8.5 - t;
    } else if (t < 9.0) {
      ns = 'red';
      ew = 'red';
      remaining = 9.0 - t;
    } else if (t < 15.5) {
      ns = 'red';
      ew = 'green';
      remaining = 15.5 - t;
    } else if (t < 17.5) {
      ns = 'red';
      ew = 'yellow';
      remaining = 17.5 - t;
    } else {
      ns = 'red';
      ew = 'red';
      remaining = 18.0 - t;
    }

    this.signalState = { ns, ew, remainingSec: remaining };

    this.nsRedMat.emissiveIntensity = ns === 'red' ? 3.2 : 0;
    this.nsYellowMat.emissiveIntensity = ns === 'yellow' ? 3.2 : 0;
    this.nsGreenMat.emissiveIntensity = ns === 'green' ? 3.2 : 0;

    this.ewRedMat.emissiveIntensity = ew === 'red' ? 3.2 : 0;
    this.ewYellowMat.emissiveIntensity = ew === 'yellow' ? 3.2 : 0;
    this.ewGreenMat.emissiveIntensity = ew === 'green' ? 3.2 : 0;
  }

  public step(
    dt: number,
    elapsedTime: number,
    isNight: boolean,
    playerX: number,
    playerZ: number,
    playerSpeed: number,
    isRiding: boolean,
    onRedLightViolation: () => void,
    onCarCollisionCrash: (carX: number, carZ: number) => void
  ): void {
    const clampedDt = Math.min(dt, 0.05);
    this.updateSignals(elapsedTime);

    if (this.violationCooldown > 0) {
      this.violationCooldown -= clampedDt;
    }

    // Check player red-light violation when riding across an intersection stop line
    if (isRiding && Math.abs(playerSpeed) > 4.2 && this.violationCooldown <= 0) {
      this.checkPlayerRedLight(playerX, playerZ, onRedLightViolation);
    }
    this.prevPlayerX = playerX;
    this.prevPlayerZ = playerZ;

    // Step every AI car
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      this.stepCar(car, i, clampedDt, isNight, playerX, playerZ, playerSpeed, isRiding, onCarCollisionCrash);
    }
  }

  private checkPlayerRedLight(x: number, z: number, onViolation: () => void): void {
    const dx = x - this.prevPlayerX;
    const dz = z - this.prevPlayerZ;
    if (Math.hypot(dx, dz) < 0.05) return;

    const movingNS = Math.abs(dz) > Math.abs(dx);

    for (const ix of ROAD_LINES) {
      for (const iz of ROAD_LINES) {
        if (movingNS) {
          if (Math.abs(x - ix) > 6.8) continue;
          // Crossing into intersection box [-7.5, +7.5] from outside
          const wasOutside = Math.abs(this.prevPlayerZ - iz) >= 7.5;
          const nowInside = Math.abs(z - iz) < 7.5;
          if (wasOutside && nowInside && this.signalState.ns === 'red') {
            this.violationCooldown = 4.5;
            onViolation();
            return;
          }
        } else {
          if (Math.abs(z - iz) > 6.8) continue;
          const wasOutside = Math.abs(this.prevPlayerX - ix) >= 7.5;
          const nowInside = Math.abs(x - ix) < 7.5;
          if (wasOutside && nowInside && this.signalState.ew === 'red') {
            this.violationCooldown = 4.5;
            onViolation();
            return;
          }
        }
      }
    }
  }

  private stepCar(
    car: AiCar,
    index: number,
    dt: number,
    isNight: boolean,
    playerX: number,
    playerZ: number,
    playerSpeed: number,
    isRiding: boolean,
    onCarCollisionCrash: (carX: number, carZ: number) => void
  ): void {
    const [fx, fz] = dirVector(car.dir);
    let mustStop = false;
    let desiredSpeed = car.cruiseSpeed;

    // 1. Check upcoming intersection traffic signal & decision point
    if (!car.turning) {
      const along = isAxisNS(car.dir) ? car.z : car.x;
      const stepSign = isAxisNS(car.dir) ? fz : fx;

      // Find nearest upcoming road line ahead
      let nextLineIdx = -1;
      let nextDist = Infinity;
      for (let r = 0; r < ROAD_LINES.length; r++) {
        const diff = (ROAD_LINES[r] - along) * stepSign;
        if (diff > -1.0 && diff < nextDist) {
          nextDist = diff;
          nextLineIdx = r;
        }
      }

      if (nextLineIdx !== -1) {
        const sig = this.getSignalForDirection(car.dir);
        // Stop cleanly at stop line if Red or Yellow and not already inside intersection
        if (sig !== 'green' && nextDist > 7.5 && nextDist < STOP_LINE_DIST + 12) {
          if (nextDist <= STOP_LINE_DIST + 1.5) {
            mustStop = true;
          } else {
            desiredSpeed = Math.min(desiredSpeed, (nextDist - STOP_LINE_DIST) * 0.9);
          }
        }

        // Choose turn or straight when entering the intersection (or forced turn at outer edge!)
        const isOuterEdge =
          (stepSign > 0 && nextLineIdx === ROAD_LINES.length - 1) ||
          (stepSign < 0 && nextLineIdx === 0);

        if (nextDist < 7.2 && nextDist > 2.5 && (sig === 'green' || nextDist < 6.0)) {
          const leftDir = ((car.dir + 3) % 4) as CardinalDir;
          const rightDir = ((car.dir + 1) % 4) as CardinalDir;
          const canGoStraight = !isOuterEdge;
          const canTurnDir = (d: CardinalDir) => {
            const [dfx, dfz] = dirVector(d);
            const s = isAxisNS(d) ? dfz : dfx;
            return !((s > 0 && car.roadIndex === ROAD_LINES.length - 1) || (s < 0 && car.roadIndex === 0));
          };

          const options: CardinalDir[] = [];
          if (canGoStraight) options.push(car.dir, car.dir); // prefer going straight
          if (canTurnDir(rightDir)) options.push(rightDir);
          if (canTurnDir(leftDir)) options.push(leftDir);

          const chosen = options[Math.floor(Math.random() * options.length)] ?? rightDir;
          if (chosen !== car.dir) {
            car.turning = true;
            car.turnTargetDir = chosen;
            car.turnTargetRoadIndex = nextLineIdx;
            const targetRoadCoord = ROAD_LINES[nextLineIdx];
            const targetLane = laneCoordForDir(targetRoadCoord, chosen);
            const [tfx, tfz] = dirVector(chosen);
            const exitOffset = 8.2;
            const ix = isAxisNS(car.dir) ? ROAD_LINES[car.roadIndex] : ROAD_LINES[nextLineIdx];
            const iz = isAxisNS(car.dir) ? ROAD_LINES[nextLineIdx] : ROAD_LINES[car.roadIndex];

            car.turnTargetX = isAxisNS(chosen) ? targetLane : ix + tfx * exitOffset;
            car.turnTargetZ = isAxisNS(chosen) ? iz + tfz * exitOffset : targetLane;
          }
        }
      }
    }

    // 2. Check obstacle ahead (other AI cars & Player!)
    const curFx = Math.sin(car.heading);
    const curFz = Math.cos(car.heading);

    for (let j = 0; j < this.cars.length; j++) {
      if (j === index) continue;
      const other = this.cars[j];
      const dx = other.x - car.x;
      const dz = other.z - car.z;
      const forwardDist = dx * curFx + dz * curFz;
      const lateralDist = Math.abs(dx * curFz - dz * curFx);
      if (forwardDist > 0 && forwardDist < 13.5 && lateralDist < 2.2) {
        if (forwardDist < 7.2) {
          mustStop = true;
        } else {
          desiredSpeed = Math.min(desiredSpeed, other.speed * 0.85);
        }
      }
    }

    // Yield / brake for player in front of the car
    const pdx = playerX - car.x;
    const pdz = playerZ - car.z;
    const pForward = pdx * curFx + pdz * curFz;
    const pLateral = Math.abs(pdx * curFz - pdz * curFx);
    if (pForward > 0 && pForward < 12.5 && pLateral < 2.1) {
      if (pForward < 5.5) {
        mustStop = true;
      } else {
        desiredSpeed = Math.min(desiredSpeed, 2.0);
      }
    }

    // 3. Longitudinal speed update
    if (mustStop) {
      car.speed = Math.max(0, car.speed - 12.5 * dt);
      car.braking = true;
    } else if (car.speed < desiredSpeed) {
      car.speed = Math.min(desiredSpeed, car.speed + 5.2 * dt);
      car.braking = false;
    } else {
      car.speed = Math.max(desiredSpeed, car.speed - 6.5 * dt);
      car.braking = car.speed > desiredSpeed + 0.5;
    }

    // 4. Move along lane or smoothly complete intersection turn
    if (car.turning) {
      const toTx = car.turnTargetX - car.x;
      const toTz = car.turnTargetZ - car.z;
      const dist = Math.hypot(toTx, toTz);
      const turnSpeed = Math.min(car.speed, 7.5);
      if (dist < 0.7) {
        car.x = car.turnTargetX;
        car.z = car.turnTargetZ;
        car.dir = car.turnTargetDir;
        car.roadIndex = car.turnTargetRoadIndex;
        car.heading = dirHeading(car.dir);
        car.turning = false;
      } else {
        const targetHeading = Math.atan2(toTx, toTz);
        const hDiff = wrapAngle(targetHeading - car.heading);
        car.heading = wrapAngle(car.heading + hDiff * Math.min(1, dt * 6.5));
        car.x += (toTx / dist) * turnSpeed * dt;
        car.z += (toTz / dist) * turnSpeed * dt;
      }
    } else {
      car.x += fx * car.speed * dt;
      car.z += fz * car.speed * dt;
      // Gently keep centered in right-hand lane
      const idealLane = laneCoordForDir(ROAD_LINES[car.roadIndex], car.dir);
      if (isAxisNS(car.dir)) {
        car.x += (idealLane - car.x) * Math.min(1, dt * 4);
      } else {
        car.z += (idealLane - car.z) * Math.min(1, dt * 4);
      }
      const targetH = dirHeading(car.dir);
      car.heading = wrapAngle(car.heading + wrapAngle(targetH - car.heading) * Math.min(1, dt * 8));
    }

    // Keep within grid bounds safety net
    car.x = clamp(car.x, -145, 145);
    car.z = clamp(car.z, -145, 145);

    // 5. High-speed collision check with riding player scooter!
    if (isRiding && Math.abs(playerSpeed) > 8.5) {
      const distToPlayer = Math.hypot(car.x - playerX, car.z - playerZ);
      if (distToPlayer < 2.25) {
        onCarCollisionCrash(car.x, car.z);
      }
    }

    // 6. Sync mesh & lights
    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.rotation.y = car.heading;
    car.brakeMat.emissiveIntensity = car.braking || car.speed < 0.3 ? 2.8 : isNight ? 0.8 : 0.25;
    car.headlightMat.emissiveIntensity = isNight ? 2.8 : 0.35;
  }
}
