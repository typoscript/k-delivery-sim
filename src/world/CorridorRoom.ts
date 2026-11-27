import * as THREE from 'three';
import { InteriorPropKind, InteriorStyle, pickInteriorStyle } from './interiorThemes';
import { HandheldFoodBag3D } from '../player/HandheldFoodBag3D';
import { ResidenceKind, clamp } from '../types';

export const CORRIDOR_ORIGIN_Y = -500;

export type ElevatorPhase =
  | 'idle_1f' // Standing inside 3D elevator cabin at 1F -> press [E] to push target floor button!
  | 'moving_up' // Doors closed, motor humming, LED floor ticking 1F -> targetFloor!
  | 'arrived_floor' // Arrived on target floor, doors slide open -> walk out into corridor!
  | 'doors_open_exit' // Delivery complete, called elevator -> doors open to step back into cabin!
  | 'moving_down'; // Doors closed, riding down targetFloor -> 1F!

export interface ElevatorEvents {
  onFloorTick?: (floor: number) => void;
  onDoorSlide?: (opening: boolean) => void;
  onArrivedTargetFloor?: (floor: number) => void;
  onArrivedGroundFloor?: () => void;
}

interface UnitDoorSlot {
  x: number;
  y: number; // local Y elevation above CORRIDOR_ORIGIN_Y (0 for apt, 2.2/4.4/6.6 for villa floors)
  z: number;
  matX: number;
  matZ: number;
  facingX: number; // +1 if on left wall (-X), -1 if on right wall (+X)
  group: THREE.Group;
  doorPivot: THREE.Group;
  plaqueMesh: THREE.Mesh;
  bellLedMat: THREE.MeshStandardMaterial;
  plaqueMat: THREE.MeshStandardMaterial;
  /** Door leaf and doormat materials (recoloured per building theme) */
  panelMat: THREE.MeshStandardMaterial;
  carpetMat: THREE.MeshStandardMaterial;
  unitNumber: string;
}

// Walk-up villa stairwell layout along +Z (monotonically ascending -> unique y(z) with zero overlap!)
const VILLA_STAIR_FLIGHTS = [
  { zStart: -7.2, zEnd: -3.2, yStart: 0.0, yEnd: 2.2 }, // 1F -> 2F
  { zStart: -0.4, zEnd: 3.6, yStart: 2.2, yEnd: 4.4 }, // 2F -> 3F
  { zStart: 6.4, zEnd: 10.4, yStart: 4.4, yEnd: 6.6 }, // 3F -> 4F
] as const;

const VILLA_FLOOR_Y = [0.0, 2.2, 4.4, 6.6] as const; // index 0=1F, 1=2F, 2=3F, 3=4F
const APT_LIGHT_INTENSITY = 9.5;

/** Spots where decorative props may stand (against walls, clear of doors, elevator and stairs) */
const APT_PROP_SLOTS = [
  { x: -2.3, y: 0, z: 7.3, rotY: 0 },
  { x: 2.3, y: 0, z: 1.2, rotY: Math.PI },
] as const;
const VILLA_PROP_SLOTS = [
  { x: 1.85, y: 0, z: -9.6, rotY: Math.PI },
  { x: -1.85, y: 2.2, z: -0.65, rotY: 0 },
] as const;

/**
 * Isolated Underground Modular Indoor Delivery Prefab (y = -500).
 * Supports TWO authentic Korean residential layouts:
 *  1. Modern Apartment / Officetel Corridor (Elevator access, 4 units per floor)
 *  2. Old Korean Walk-up Villa Stairwell (NO elevator! 1F~4F terrazzo stairs to walk up on foot!)
 * Both layouts support all 3 customer delivery instructions:
 *  - PHOTO_DOOR: place food on doormat + smartphone photo (60% framing check)
 *  - KNOCK_DOOR: knock on door + auto-place food on mat
 *  - MEET_FACE: press intercom bell -> smooth 70° inward door pivot -> 3D low-poly NPC reaches out & receives food!
 */
export class CorridorRoom {
  public readonly root = new THREE.Group();

  private readonly aptGroup = new THREE.Group();
  private readonly villaGroup = new THREE.Group();

  private readonly aptDoors: UnitDoorSlot[] = [];
  private readonly villaDoors: UnitDoorSlot[] = [];

  private readonly targetHighlightRing: THREE.Mesh;
  private readonly placedFoodBag: THREE.Group;

  // Low-poly 3D Customer NPC for MEET_FACE deliveries
  private readonly npcGroup = new THREE.Group();
  private readonly npcRightArmPivot = new THREE.Group();
  private readonly npcHeldBag: THREE.Group;

  // Door swing & NPC handoff animation state
  private targetDoorOpenAngle = 0; // 0 rad (closed) -> 70° (1.2217 rad open!)
  private currentDoorOpenAngle = 0;
  private npcVisible = false;
  private npcStepTarget = 0; // 0 (inside) -> 1 (doorway)
  private npcStepCur = 0;
  private npcArmReachTarget = 0; // 0 (down) -> 1 (extended toward rider)
  private npcArmReachCur = 0;
  private bellFlashTimer = 0;

  public isVillaMode = false;

  // Per-building interior theme (interiorThemes.ts): shared materials recoloured on each visit
  private readonly aptWallMat = new THREE.MeshStandardMaterial({ color: 0xedeae4, roughness: 0.85 });
  private readonly aptTrimMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.6 });
  private readonly aptFloorMat = new THREE.MeshStandardMaterial({ roughness: 0.65 });
  private readonly aptCeilingMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.9 });
  private readonly aptFixtureMat = new THREE.MeshBasicMaterial({ color: 0xfffbeb });
  private readonly aptLights: THREE.PointLight[] = [];
  private readonly villaWallMat = new THREE.MeshStandardMaterial({ color: 0xeae5da, roughness: 0.9 });
  private readonly villaDadoMat = new THREE.MeshStandardMaterial({ color: 0x7a9b8e, roughness: 0.85 });
  private readonly villaRailMat = new THREE.MeshStandardMaterial({ color: 0x1f5c4e, metalness: 0.45, roughness: 0.48 });
  private readonly villaCeilingMat = new THREE.MeshStandardMaterial({ color: 0xd8dce2, roughness: 0.92 });
  private readonly villaFloorMat = new THREE.MeshStandardMaterial({ roughness: 0.72 });
  private readonly villaFixtureMat = new THREE.MeshBasicMaterial({ color: 0xfff7d6 });
  /** Decorative props + building name sign of the current visit (rebuilt per building) */
  private readonly styleGroup = new THREE.Group();
  /** Theme of the current visit (for tests / debugging) */
  public currentThemeId = '';
  public targetDoorIndex = 1;
  public foodPlacedOnMat = false;

  // Interactive 3D Apartment Elevator Cabin state & meshes!
  public elevatorPhase: ElevatorPhase = 'idle_1f';
  public elevatorCurrentFloor = 1;
  public elevatorTargetFloor = 14;
  private elevatorStepTimer = 0;
  private elevatorSecPerFloor = 0.25;
  private elevDoorOpenCur = 0; // 0 = closed, 1 = fully open
  private elevDoorOpenTarget = 0;
  private elevDoorL!: THREE.Mesh;
  private elevDoorR!: THREE.Mesh;
  private elevBtnGlowMat!: THREE.MeshStandardMaterial;
  private elevCallBtnMat!: THREE.MeshStandardMaterial;
  private elevLedCanvas!: HTMLCanvasElement;
  private elevLedCtx!: CanvasRenderingContext2D;
  private elevLedTex!: THREE.CanvasTexture;
  private elevRideVibeY = 0;

  // Player spawns INSIDE the 3D apartment elevator cabin at 1F (facing doors & button panel!)
  public readonly elevatorSpawn = { x: 0, y: CORRIDOR_ORIGIN_Y, z: -9.2, heading: 0 };
  public readonly elevatorTrigger = { x: 0, z: -7.1, radius: 1.9 };
  public readonly villaSpawn = { x: 0, y: CORRIDOR_ORIGIN_Y, z: -8.6, heading: 0 };
  public readonly villaExitTrigger = { x: 0, z: -9.3, radius: 2.0 };

  constructor(scene: THREE.Scene) {
    this.root.position.set(0, CORRIDOR_ORIGIN_Y, 0);
    this.root.visible = false;

    this.root.add(this.aptGroup);
    this.root.add(this.villaGroup);
    this.root.add(this.styleGroup);

    this.buildApartmentCorridor();
    this.buildWalkupVillaStairwell();

    // Build reusable 3D Low-Poly Customer NPC for MEET_FACE handoff
    this.npcHeldBag = this.buildCustomerNpc();

    // Subtle glow ring marker around the active delivery doormat
    this.targetHighlightRing = new THREE.Mesh(
      new THREE.RingGeometry(0.48, 0.58, 24),
      new THREE.MeshBasicMaterial({
        color: 0x10b981,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
      })
    );
    this.targetHighlightRing.rotation.x = -Math.PI / 2;
    this.targetHighlightRing.position.set(0, 0.032, 0);
    this.root.add(this.targetHighlightRing);

    // 3D Food bag placed onto the doormat when the player drops off the delivery!
    this.placedFoodBag = HandheldFoodBag3D.createFoodBagMesh();
    this.placedFoodBag.scale.set(1.25, 1.25, 1.25);
    this.placedFoodBag.visible = false;
    this.root.add(this.placedFoodBag);

    this.villaGroup.visible = false;
    scene.add(this.root);
  }

  private getActiveDoors(): UnitDoorSlot[] {
    return this.isVillaMode ? this.villaDoors : this.aptDoors;
  }

  private buildApartmentCorridor(): void {
    const width = 5.4;
    const length = 16.0;
    const height = 3.1;

    // Dedicated interior corridor lighting (independent of outdoor sun!)
    const ambient = new THREE.AmbientLight(0xfff7ed, 0.95);
    this.aptGroup.add(ambient);

    for (const lz of [-5.2, 0.0, 5.2]) {
      const pLight = new THREE.PointLight(0xfff1d6, APT_LIGHT_INTENSITY, 12, 1.5);
      pLight.position.set(0, height - 0.35, lz);
      this.aptGroup.add(pLight);
      this.aptLights.push(pLight);

      const fixture = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.35), this.aptFixtureMat);
      fixture.position.set(0, height - 0.05, lz);
      this.aptGroup.add(fixture);
    }

    const floorTex = this.createTileTexture('#d6d3cd', 'rgba(100,116,139,0.28)', 4, 12);
    this.aptFloorMat.map = floorTex;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, length), this.aptFloorMat);
    floor.rotation.x = -Math.PI / 2;
    this.aptGroup.add(floor);

    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(width, length), this.aptCeilingMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = height;
    this.aptGroup.add(ceiling);

    const wallMat = this.aptWallMat;
    const trimMat = this.aptTrimMat;

    const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(length, height), wallMat);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.set(-width / 2, height / 2, 0);
    this.aptGroup.add(leftWall);

    const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(length, height), wallMat);
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.position.set(width / 2, height / 2, 0);
    this.aptGroup.add(rightWall);

    const farWall = new THREE.Mesh(new THREE.PlaneGeometry(width, height), wallMat);
    farWall.rotation.y = Math.PI;
    farWall.position.set(0, height / 2, length / 2);
    this.aptGroup.add(farWall);

    // End wall at z = -8.0 with doorway opening (x in [-0.92, 0.92], y in [0, 2.28]) leading into the 3D Elevator Cabin!
    const elevWallL = new THREE.Mesh(new THREE.PlaneGeometry(1.78, height), wallMat);
    elevWallL.position.set(-1.81, height / 2, -length / 2);
    const elevWallR = new THREE.Mesh(new THREE.PlaneGeometry(1.78, height), wallMat);
    elevWallR.position.set(1.81, height / 2, -length / 2);
    const elevWallTop = new THREE.Mesh(new THREE.PlaneGeometry(1.84, height - 2.28), wallMat);
    elevWallTop.position.set(0, 2.28 + (height - 2.28) * 0.5, -length / 2);
    this.aptGroup.add(elevWallL, elevWallR, elevWallTop);

    for (const side of [-1, 1]) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, length), trimMat);
      base.position.set(side * (width / 2 - 0.03), 0.07, 0);
      this.aptGroup.add(base);
    }

    // --- Interactive 3D Korean Apartment Elevator Cabin (z = -10.4 .. -8.0) & Sliding Steel Doors! ---
    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.72,
      roughness: 0.3,
    });
    const cabinWallMat = new THREE.MeshStandardMaterial({
      color: 0xb8c2cc,
      metalness: 0.62,
      roughness: 0.32,
    });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.45, metalness: 0.4 });
    const mirrorMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.92,
      roughness: 0.08,
    });

    // Corridor-side elevator doorframe (left/right jambs + header so opening stays clear!)
    const frameL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.38, 0.2), frameMat);
    frameL.position.set(-0.98, 1.19, -length / 2 + 0.04);
    const frameR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.38, 0.2), frameMat);
    frameR.position.set(0.98, 1.19, -length / 2 + 0.04);
    const frameTop = new THREE.Mesh(new THREE.BoxGeometry(2.12, 0.18, 0.2), frameMat);
    frameTop.position.set(0, 2.34, -length / 2 + 0.04);

    // Animated Sliding Stainless-Steel Elevator Doors
    this.elevDoorL = new THREE.Mesh(new THREE.BoxGeometry(0.92, 2.24, 0.08), steelMat);
    this.elevDoorL.position.set(-0.46, 1.12, -length / 2 + 0.04);
    this.elevDoorR = new THREE.Mesh(new THREE.BoxGeometry(0.92, 2.24, 0.08), steelMat);
    this.elevDoorR.position.set(0.46, 1.12, -length / 2 + 0.04);

    // Live Dynamic LED Floor Display Texture (shared by corridor header + inside-cabin header!)
    this.elevLedCanvas = document.createElement('canvas');
    this.elevLedCanvas.width = 256;
    this.elevLedCanvas.height = 96;
    this.elevLedCtx = this.elevLedCanvas.getContext('2d')!;
    this.elevLedTex = new THREE.CanvasTexture(this.elevLedCanvas);
    this.elevLedTex.colorSpace = THREE.SRGBColorSpace;
    this.redrawElevatorLedDisplay(1, 'idle');

    const ledMat = new THREE.MeshBasicMaterial({ map: this.elevLedTex });
    const elevCorridorLed = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.32), ledMat);
    elevCorridorLed.position.set(0, 2.66, -length / 2 + 0.06);

    // Corridor-side elevator call button
    this.elevCallBtnMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.7,
    });
    const callBtn = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.32, 0.06), this.elevCallBtnMat);
    callBtn.position.set(1.32, 1.15, -length / 2 + 0.05);
    this.aptGroup.add(frameL, frameR, frameTop, this.elevDoorL, this.elevDoorR, elevCorridorLed, callBtn);

    // Walkable 3D Elevator Cabin Enclosure (x in [-1.14, 1.14], z in [-10.4, -8.0], h = 2.62)
    const cabinW = 2.28;
    const cabinD = 2.4;
    const cabinH = 2.62;
    const cabinCz = -length / 2 - cabinD * 0.5; // -9.2

    const cabinFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(cabinW, cabinD),
      new THREE.MeshStandardMaterial({
        map: this.createTileTexture('#475569', 'rgba(226,232,240,0.35)', 2, 2),
        roughness: 0.42,
        metalness: 0.15,
      })
    );
    cabinFloor.rotation.x = -Math.PI / 2;
    cabinFloor.position.set(0, 0.005, cabinCz);

    const cabinCeil = new THREE.Mesh(
      new THREE.PlaneGeometry(cabinW, cabinD),
      new THREE.MeshBasicMaterial({ color: 0xfefce8 })
    );
    cabinCeil.rotation.x = Math.PI / 2;
    cabinCeil.position.set(0, cabinH, cabinCz);

    const cabinLight = new THREE.PointLight(0xfffbeb, 8.5, 6.5, 1.4);
    cabinLight.position.set(0, cabinH - 0.2, cabinCz);

    const cabBack = new THREE.Mesh(new THREE.PlaneGeometry(cabinW, cabinH), cabinWallMat);
    cabBack.position.set(0, cabinH / 2, cabinCz - cabinD / 2);

    const cabLeft = new THREE.Mesh(new THREE.PlaneGeometry(cabinD, cabinH), cabinWallMat);
    cabLeft.rotation.y = Math.PI / 2;
    cabLeft.position.set(-cabinW / 2, cabinH / 2, cabinCz);

    const cabRight = new THREE.Mesh(new THREE.PlaneGeometry(cabinD, cabinH), cabinWallMat);
    cabRight.rotation.y = -Math.PI / 2;
    cabRight.position.set(cabinW / 2, cabinH / 2, cabinCz);

    // Interior front transom above cabin door + live LED floor display facing inside cabin!
    const cabFrontTop = new THREE.Mesh(new THREE.PlaneGeometry(cabinW, cabinH - 2.24), cabinWallMat);
    cabFrontTop.rotation.y = Math.PI;
    cabFrontTop.position.set(0, 2.24 + (cabinH - 2.24) * 0.5, -length / 2 - 0.02);

    const cabLed = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.3), ledMat);
    cabLed.rotation.y = Math.PI;
    cabLed.position.set(0, 2.42, -length / 2 - 0.04);

    // Rear wall mirror & stainless handrail (classic Korean apartment elevator!)
    const cabMirror = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.25), mirrorMat);
    cabMirror.position.set(0, 1.52, cabinCz - cabinD / 2 + 0.02);
    const cabRailBack = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 1.9, 8), steelMat);
    cabRailBack.rotation.z = Math.PI / 2;
    cabRailBack.position.set(0, 0.92, cabinCz - cabinD / 2 + 0.1);

    // Left wall apartment elevator notice board
    const cabNotice = new THREE.Mesh(
      new THREE.PlaneGeometry(0.75, 0.95),
      new THREE.MeshBasicMaterial({
        map: this.createPlaqueTexture('아파트 안내\n금연 · CCTV', '#1e3a8a', '#e0f2fe'),
      })
    );
    cabNotice.rotation.y = Math.PI / 2;
    cabNotice.position.set(-cabinW / 2 + 0.02, 1.5, cabinCz);

    // Right wall Interactive Floor Button Panel (층수 조작반)
    const panelBack = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.15, 0.42), frameMat);
    panelBack.position.set(cabinW / 2 - 0.04, 1.25, -length / 2 - 0.55);

    this.elevBtnGlowMat = new THREE.MeshStandardMaterial({
      color: 0xfef08a,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.25,
    });
    const inactiveBtnMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4 });
    // Mini 2x6 floor button matrix + glowing highlighted target button!
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 2; col++) {
        const isLit = row === 4 && col === 1;
        const b = new THREE.Mesh(
          new THREE.BoxGeometry(0.025, 0.065, 0.065),
          isLit ? this.elevBtnGlowMat : inactiveBtnMat
        );
        b.position.set(
          cabinW / 2 - 0.075,
          0.92 + row * 0.11,
          -length / 2 - 0.46 - col * 0.16
        );
        this.aptGroup.add(b);
      }
    }

    this.aptGroup.add(
      cabinFloor,
      cabinCeil,
      cabinLight,
      cabBack,
      cabLeft,
      cabRight,
      cabFrontTop,
      cabLed,
      cabMirror,
      cabRailBack,
      cabNotice,
      panelBack
    );

    const doorConfigs: Array<{ x: number; y: number; z: number; facingX: number; defaultUnit: string }> = [
      { x: -width / 2 + 0.04, y: 0, z: -1.6, facingX: 1, defaultUnit: '1401호' },
      { x: width / 2 - 0.04, y: 0, z: -1.6, facingX: -1, defaultUnit: '1402호' },
      { x: -width / 2 + 0.04, y: 0, z: 4.0, facingX: 1, defaultUnit: '1403호' },
      { x: width / 2 - 0.04, y: 0, z: 4.0, facingX: -1, defaultUnit: '1404호' },
    ];

    for (const cfg of doorConfigs) {
      const slot = this.createDoorSlot(cfg.x, cfg.y, cfg.z, cfg.facingX, cfg.defaultUnit, 0x3b4859);
      this.aptGroup.add(slot.group);
      this.aptDoors.push(slot);
    }
  }

  /**
   * Builds a realistic 4-story Korean Walk-up Villa (구축 빌라 계단실, 엘리베이터 없음):
   * - 1F entrance (z=-10..-7.2, y=0) with metal exit door + mailboxes
   * - 3 terrazzo stair flights (1F->2F, 2F->3F, 3F->4F) with green iron handrails
   * - 2F, 3F, 4F landings with 2 hinged doors each (201/202, 301/302, 401/402) + painted floor markers
   */
  private buildWalkupVillaStairwell(): void {
    const width = 5.4;
    const zMin = -10.0;
    const zMax = 13.4;
    const totalLen = zMax - zMin;
    const zCenter = (zMin + zMax) * 0.5;
    const maxWallH = 10.4;

    const ambient = new THREE.AmbientLight(0xfff5e4, 0.88);
    this.villaGroup.add(ambient);

    // Classic Korean villa stairwell materials: terrazzo floor, cream plaster + jade green wainscot
    const terrazzoTex = this.createTileTexture('#c8c2b8', 'rgba(71,85,105,0.34)', 3, 2);
    const terrazzoMat = this.villaFloorMat;
    terrazzoMat.map = terrazzoTex;
    const stairStepMat = new THREE.MeshStandardMaterial({ color: 0xbeb7ac, roughness: 0.78 });
    const nosingMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.55 });
    const upperWallMat = this.villaWallMat;
    const dadoWallMat = this.villaDadoMat;
    const railMat = this.villaRailMat;
    const ceilingMat = this.villaCeilingMat;
    const fixtureMat = this.villaFixtureMat;

    // Enclosing side walls & end walls
    const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(totalLen, maxWallH), upperWallMat);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.set(-width / 2, maxWallH / 2, zCenter);
    this.villaGroup.add(leftWall);

    const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(totalLen, maxWallH), upperWallMat);
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.position.set(width / 2, maxWallH / 2, zCenter);
    this.villaGroup.add(rightWall);

    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(width, 4.0), upperWallMat);
    backWall.position.set(0, 2.0, zMin);
    this.villaGroup.add(backWall);

    const topFarWall = new THREE.Mesh(new THREE.PlaneGeometry(width, 4.2), upperWallMat);
    topFarWall.rotation.y = Math.PI;
    topFarWall.position.set(0, 6.6 + 2.1, zMax);
    this.villaGroup.add(topFarWall);

    // 4 Horizontal Landings (1F..4F) + ceilings + stairwell lights + floor signs
    const landings = [
      { floor: 1, zStart: -10.0, zEnd: -7.2, y: 0.0 },
      { floor: 2, zStart: -3.2, zEnd: -0.4, y: 2.2 },
      { floor: 3, zStart: 3.6, zEnd: 6.4, y: 4.4 },
      { floor: 4, zStart: 10.4, zEnd: 13.4, y: 6.6 },
    ];

    for (const ld of landings) {
      const len = ld.zEnd - ld.zStart;
      const cz = (ld.zStart + ld.zEnd) * 0.5;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(width, 0.24, len), terrazzoMat);
      slab.position.set(0, ld.y - 0.12, cz);
      this.villaGroup.add(slab);

      const ceil = new THREE.Mesh(new THREE.PlaneGeometry(width, len), ceilingMat);
      ceil.rotation.x = Math.PI / 2;
      ceil.position.set(0, ld.y + 3.1, cz);
      this.villaGroup.add(ceil);

      // Jade dado accent stripes on landing walls
      for (const side of [-1, 1]) {
        const dado = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.05, len), dadoWallMat);
        dado.position.set(side * (width / 2 - 0.025), ld.y + 0.52, cz);
        this.villaGroup.add(dado);
      }

      // Warm stairwell sensor light per floor
      const light = new THREE.PointLight(0xffefc8, 10.5, 11, 1.45);
      light.position.set(0, ld.y + 2.75, cz);
      this.villaGroup.add(light);

      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.26), fixtureMat);
      lamp.position.set(0, ld.y + 3.04, cz);
      this.villaGroup.add(lamp);

      // Painted Floor Number Badge on left wall (2F, 3F, 4F)
      if (ld.floor >= 2) {
        const floorSign = new THREE.Mesh(
          new THREE.PlaneGeometry(0.95, 0.44),
          new THREE.MeshBasicMaterial({
            map: this.createPlaqueTexture(`${ld.floor}F 원룸·빌라`, '#064e3b', '#ecfdf5'),
          })
        );
        floorSign.rotation.y = Math.PI / 2;
        floorSign.position.set(-width / 2 + 0.03, ld.y + 2.25, ld.zStart + 0.55);
        this.villaGroup.add(floorSign);
      }
    }

    // 3 Stepped Terrazzo Stair Flights with Iron Handrails & Sloped Ceilings
    const stepsPerFlight = 11;
    for (const fl of VILLA_STAIR_FLIGHTS) {
      const flightLen = fl.zEnd - fl.zStart;
      const flightRise = fl.yEnd - fl.yStart;
      const stepDepth = flightLen / stepsPerFlight;
      const stepHeight = flightRise / stepsPerFlight;

      for (let s = 0; s < stepsPerFlight; s++) {
        const sy = fl.yStart + (s + 1) * stepHeight;
        const sz = fl.zStart + (s + 0.5) * stepDepth;
        const stepMesh = new THREE.Mesh(
          new THREE.BoxGeometry(width - 0.08, stepHeight + 0.12, stepDepth + 0.04),
          stairStepMat
        );
        stepMesh.position.set(0, sy - (stepHeight + 0.12) * 0.5, sz);
        this.villaGroup.add(stepMesh);

        // Dark anti-slip rubber stair nosing strip on each step edge
        const nose = new THREE.Mesh(new THREE.BoxGeometry(width - 0.16, 0.025, 0.06), nosingMat);
        nose.position.set(0, sy + 0.008, sz - stepDepth * 0.45);
        this.villaGroup.add(nose);
      }

      // Sloped ceiling above stair flight
      const slopeLen = Math.hypot(flightLen, flightRise) + 0.3;
      const slopeAngle = Math.atan2(flightRise, flightLen);
      const midZ = (fl.zStart + fl.zEnd) * 0.5;
      const midY = (fl.yStart + fl.yEnd) * 0.5;
      const sCeil = new THREE.Mesh(new THREE.PlaneGeometry(width, slopeLen), ceilingMat);
      sCeil.rotation.x = Math.PI / 2 - slopeAngle;
      sCeil.position.set(0, midY + 3.15, midZ);
      this.villaGroup.add(sCeil);

      // Left & Right Green Iron Handrails along the stairs
      for (const side of [-1, 1]) {
        const railX = side * (width / 2 - 0.18);
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, slopeLen), railMat);
        rail.rotation.x = -slopeAngle;
        rail.position.set(railX, midY + 0.96, midZ);
        this.villaGroup.add(rail);

        for (const frac of [0.15, 0.5, 0.85]) {
          const pz = fl.zStart + flightLen * frac;
          const py = fl.yStart + flightRise * frac;
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.95, 0.05), railMat);
          post.position.set(railX, py + 0.48, pz);
          this.villaGroup.add(post);
        }
      }
    }

    // 1F Ground-Floor Villa Exit Door at z = -9.95 (+ Mailboxes!)
    const exitFrameMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.55 });
    const exitDoorMat = new THREE.MeshStandardMaterial({
      color: 0x0f766e,
      metalness: 0.4,
      roughness: 0.42,
    });
    const exitFrame = new THREE.Mesh(new THREE.BoxGeometry(1.9, 2.32, 0.16), exitFrameMat);
    exitFrame.position.set(0, 1.16, zMin + 0.08);
    const exitDoor = new THREE.Mesh(new THREE.BoxGeometry(1.58, 2.16, 0.09), exitDoorMat);
    exitDoor.position.set(0, 1.08, zMin + 0.14);
    const exitLabel = new THREE.Mesh(
      new THREE.PlaneGeometry(1.55, 0.36),
      new THREE.MeshBasicMaterial({ map: this.createPlaqueTexture('🚪 1F 원룸·빌라 출구', '#065f46', '#fef08a') })
    );
    exitLabel.position.set(0, 2.58, zMin + 0.08);

    // Classic Korean metal oneroom/villa mailbox bank & parcel shelf on right wall near 1F entrance
    const mailbox = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.88, 1.2),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.55, roughness: 0.4 })
    );
    mailbox.position.set(width / 2 - 0.1, 1.4, -8.6);
    const stairNotice = new THREE.Mesh(
      new THREE.PlaneGeometry(1.35, 0.48),
      new THREE.MeshBasicMaterial({
        map: this.createPlaqueTexture('🪜 원룸 계단실 (E/V없음)', '#0f172a', '#fde68a'),
      })
    );
    stairNotice.rotation.y = Math.PI / 2;
    stairNotice.position.set(-width / 2 + 0.03, 1.95, -8.4);
    this.villaGroup.add(exitFrame, exitDoor, exitLabel, mailbox, stairNotice);

    // 6 Hinged Villa Unit Doors (201/202 on 2F, 301/302 on 3F, 401/402 on 4F)
    const villaDoorConfigs = [
      { x: -width / 2 + 0.04, y: 2.2, z: -1.8, facingX: 1, unit: '201호' },
      { x: width / 2 - 0.04, y: 2.2, z: -1.8, facingX: -1, unit: '202호' },
      { x: -width / 2 + 0.04, y: 4.4, z: 5.0, facingX: 1, unit: '301호' },
      { x: width / 2 - 0.04, y: 4.4, z: 5.0, facingX: -1, unit: '302호' },
      { x: -width / 2 + 0.04, y: 6.6, z: 11.8, facingX: 1, unit: '401호' },
      { x: width / 2 - 0.04, y: 6.6, z: 11.8, facingX: -1, unit: '402호' },
    ];

    for (const cfg of villaDoorConfigs) {
      const slot = this.createDoorSlot(cfg.x, cfg.y, cfg.z, cfg.facingX, cfg.unit, 0x5c4338);
      this.villaGroup.add(slot.group);
      this.villaDoors.push(slot);
    }
  }

  private createDoorSlot(
    x: number,
    y: number,
    z: number,
    facingX: number,
    defaultUnit: string,
    doorHex: number
  ): UnitDoorSlot {
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5 });
    const doorPanelMat = new THREE.MeshStandardMaterial({
      color: doorHex,
      roughness: 0.58,
      metalness: 0.22,
    });
    const lockMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.35, metalness: 0.6 });
    const matCarpet = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.95 });
    const foyerWallMat = new THREE.MeshStandardMaterial({
      color: 0xfff3df,
      roughness: 0.85,
      side: THREE.BackSide,
    });
    const intercomBodyMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4 });

    const doorGroup = new THREE.Group();
    doorGroup.position.set(x, y, z);
    doorGroup.rotation.y = facingX > 0 ? Math.PI / 2 : -Math.PI / 2;

    const frameL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.22, 0.14), frameMat);
    frameL.position.set(-0.6, 1.11, 0.02);
    const frameR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.22, 0.14), frameMat);
    frameR.position.set(0.6, 1.11, 0.02);
    const frameTop = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.1, 0.14), frameMat);
    frameTop.position.set(0, 2.18, 0.02);

    const foyerBox = new THREE.Mesh(new THREE.BoxGeometry(1.38, 2.28, 1.35), foyerWallMat);
    foyerBox.position.set(0, 1.14, -0.68);
    const foyerFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(1.35, 1.35),
      new THREE.MeshStandardMaterial({ color: 0xc8a986, roughness: 0.75 })
    );
    foyerFloor.rotation.x = -Math.PI / 2;
    foyerFloor.position.set(0, 0.02, -0.68);

    const doorPivot = new THREE.Group();
    doorPivot.position.set(-0.56, 0, 0.05);

    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.12, 2.12, 0.07), doorPanelMat);
    panel.position.set(0.56, 1.06, 0);

    const smartLock = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.28, 0.06), lockMat);
    smartLock.position.set(0.96, 1.05, 0.055);

    const plaqueMat = new THREE.MeshStandardMaterial({
      map: this.createPlaqueTexture(defaultUnit, '#1e293b', '#f8fafc'),
      roughness: 0.4,
    });
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.18), plaqueMat);
    plaque.position.set(0.56, 1.72, 0.045);

    doorPivot.add(panel, smartLock, plaque);

    const intercom = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.24, 0.05), intercomBodyMat);
    intercom.position.set(0.82, 1.32, 0.04);
    const bellLedMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.45,
    });
    const bellBtn = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.065, 0.025), bellLedMat);
    bellBtn.position.set(0.82, 1.26, 0.07);

    const doormat = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.025, 0.58), matCarpet);
    doormat.position.set(0, 0.012, 0.52);

    doorGroup.add(frameL, frameR, frameTop, foyerBox, foyerFloor, doorPivot, intercom, bellBtn, doormat);

    return {
      x,
      y,
      z,
      matX: x + facingX * 0.54,
      matZ: z,
      facingX,
      group: doorGroup,
      doorPivot,
      plaqueMesh: plaque,
      bellLedMat,
      plaqueMat,
      panelMat: doorPanelMat,
      carpetMat: matCarpet,
      unitNumber: defaultUnit,
    };
  }

  /** Builds a stylized low-poly Korean resident NPC with articulated right arm + food bag */
  private buildCustomerNpc(): THREE.Group {
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xf6c9a5, roughness: 0.72 });
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x1e2028, roughness: 0.85 });
    const shirtMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.78 });
    const pantsMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.85 });

    for (const sx of [-0.11, 0.11]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.74, 0.16), pantsMat);
      leg.position.set(sx, 0.37, 0);
      this.npcGroup.add(leg);
    }

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.58, 0.24), shirtMat);
    torso.position.set(0, 1.03, 0);
    this.npcGroup.add(torso);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.26), skinMat);
    head.position.set(0, 1.48, 0);
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.28), hairMat);
    hair.position.set(0, 1.6, -0.01);
    this.npcGroup.add(head, hair);

    const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.48, 0.12), shirtMat);
    leftArm.position.set(-0.28, 1.04, 0);
    this.npcGroup.add(leftArm);

    this.npcRightArmPivot.position.set(0.28, 1.24, 0);
    const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.48, 0.12), shirtMat);
    rightArm.position.set(0, -0.22, 0);
    const rightHand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), skinMat);
    rightHand.position.set(0, -0.47, 0);

    const heldBag = HandheldFoodBag3D.createFoodBagMesh();
    heldBag.position.set(0, -0.63, 0.04);
    heldBag.visible = false;

    this.npcRightArmPivot.add(rightArm, rightHand, heldBag);
    this.npcGroup.add(this.npcRightArmPivot);

    this.npcGroup.visible = false;
    return heldBag;
  }

  private createTileTexture(bg: string, lineColor: string, rx: number, ry: number): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, 128, 128);
    ctx.strokeRect(128, 0, 128, 128);
    ctx.strokeRect(0, 128, 128, 128);
    ctx.strokeRect(128, 128, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(rx, ry);
    return tex;
  }

  /** Text plaque texture; the font shrinks so long names (building signs) fit the width */
  private createPlaqueTexture(text: string, bg: string, fg: string, width = 256): THREE.CanvasTexture {
    const h = 104;
    const c = document.createElement('canvas');
    c.width = width;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 5;
    ctx.strokeRect(4, 4, width - 8, h - 8);
    ctx.fillStyle = fg;
    ctx.font = 'bold 42px sans-serif';
    const measured = ctx.measureText(text).width;
    const size = measured > 0 ? Math.max(18, Math.min(42, (42 * (width - 28)) / measured)) : 42;
    ctx.font = `bold ${Math.floor(size)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width / 2, 54);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  /** Recolours walls, floor, ceiling, doors and lights to the building's theme and rebuilds its props + sign */
  private applyInteriorStyle(style: InteriorStyle, buildingName: string | undefined, unitNumber: string): void {
    const t = style.theme;
    this.currentThemeId = t.id;
    const floorTex = this.createTileTexture(t.floorBase, t.floorGrout, this.isVillaMode ? 3 : 4, this.isVillaMode ? 2 : 12);
    if (this.isVillaMode) {
      this.villaWallMat.color.setHex(t.wall);
      this.villaCeilingMat.color.setHex(t.ceiling);
      this.villaDadoMat.color.setHex(t.dado ?? t.trim);
      this.villaRailMat.color.setHex(t.rail ?? t.trim);
      this.villaFixtureMat.color.setHex(t.lightColor);
      this.villaFloorMat.map?.dispose();
      this.villaFloorMat.map = floorTex;
      this.villaFloorMat.needsUpdate = true;
    } else {
      this.aptWallMat.color.setHex(t.wall);
      this.aptTrimMat.color.setHex(t.trim);
      this.aptCeilingMat.color.setHex(t.ceiling);
      this.aptFixtureMat.color.setHex(t.lightColor);
      for (const l of this.aptLights) {
        l.color.setHex(t.lightColor);
        l.intensity = APT_LIGHT_INTENSITY * t.lightMul;
      }
      this.aptFloorMat.map?.dispose();
      this.aptFloorMat.map = floorTex;
      this.aptFloorMat.needsUpdate = true;
    }
    for (const d of this.getActiveDoors()) {
      d.panelMat.color.setHex(t.door);
      d.carpetMat.color.setHex(t.carpet);
    }

    // Rebuild props and the building name sign for this visit
    this.styleGroup.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        (mat as THREE.MeshBasicMaterial).map?.dispose();
        mat.dispose();
      }
    });
    this.styleGroup.clear();
    const slots = this.isVillaMode ? VILLA_PROP_SLOTS : APT_PROP_SLOTS;
    style.props.forEach((kind, i) => {
      const slot = slots[i % slots.length];
      const prop = buildInteriorProp(kind);
      prop.position.set(slot.x, slot.y, slot.z);
      prop.rotation.y = slot.rotY;
      this.styleGroup.add(prop);
    });
    if (buildingName) {
      const floorNo = Math.floor(parseInt(unitNumber.match(/(\d+)/)?.[1] ?? '0', 10) / 100);
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(2.2, 0.5),
        new THREE.MeshBasicMaterial({
          map: this.createPlaqueTexture(
            this.isVillaMode ? `🏠 ${buildingName}` : `${buildingName} · ${floorNo}F`,
            '#0f172a',
            '#f8fafc',
            460
          ),
        })
      );
      if (this.isVillaMode) {
        // 1F landing, right wall beside the entrance (the left wall has the mailbox and stair notice)
        sign.rotation.y = -Math.PI / 2;
        sign.position.set(2.17, 2.05, -8.6);
      } else {
        // Far end of the corridor, facing the rider stepping out of the elevator
        sign.rotation.y = Math.PI;
        sign.position.set(0, 2.45, 7.97);
      }
      this.styleGroup.add(sign);
    }
  }

  /**
   * Sets up the shared interior for one delivery: layout (apartment / officetel corridor or villa stairwell),
   * the building's own theme and props (by its id), its name sign, and the target unit door.
   */
  public configureForUnit(
    targetUnitNumber: string,
    residenceKind: ResidenceKind = 'apartment',
    building?: { id: string; name: string }
  ): void {
    this.isVillaMode = residenceKind === 'walkup_villa';
    this.aptGroup.visible = !this.isVillaMode;
    this.villaGroup.visible = this.isVillaMode;
    this.applyInteriorStyle(pickInteriorStyle(residenceKind, building?.id ?? targetUnitNumber), building?.name, targetUnitNumber);

    const numMatch = targetUnitNumber.match(/(\d+)/);
    const num = numMatch ? parseInt(numMatch[1], 10) : this.isVillaMode ? 302 : 1402;
    const floor = Math.floor(num / 100);
    const unitNum = num % 100;

    this.foodPlacedOnMat = false;
    this.placedFoodBag.visible = false;

    // Reset all doors closed and NPC state
    this.targetDoorOpenAngle = 0;
    this.currentDoorOpenAngle = 0;
    this.npcVisible = false;
    this.npcStepTarget = 0;
    this.npcStepCur = 0;
    this.npcArmReachTarget = 0;
    this.npcArmReachCur = 0;
    this.bellFlashTimer = 0;
    this.npcGroup.visible = false;
    this.npcHeldBag.visible = false;
    this.npcRightArmPivot.rotation.x = 0;

    const doors = this.getActiveDoors();

    if (this.isVillaMode) {
      // Villa has 6 fixed doors: index 0..1 = 2F (201/202), 2..3 = 3F (301/302), 4..5 = 4F (401/402)
      const clampedFloor = clamp(floor, 2, 4);
      const sideIdx = unitNum % 2 === 0 ? 1 : 0;
      this.targetDoorIndex = (clampedFloor - 2) * 2 + sideIdx;

      for (let i = 0; i < doors.length; i++) {
        doors[i].doorPivot.rotation.y = 0;
        const f = 2 + Math.floor(i / 2);
        const u = (i % 2) + 1;
        const label = `${f}0${u}호`;
        doors[i].unitNumber = label;
        const isTarget = i === this.targetDoorIndex;
        doors[i].bellLedMat.emissive.setHex(isTarget ? 0x22c55e : 0x38bdf8);
        doors[i].bellLedMat.emissiveIntensity = isTarget ? 1.5 : 0.35;

        const oldMap = doors[i].plaqueMat.map;
        doors[i].plaqueMat.map = this.createPlaqueTexture(
          label,
          isTarget ? '#065f46' : '#1e293b',
          isTarget ? '#a7f3d0' : '#f8fafc'
        );
        doors[i].plaqueMat.needsUpdate = true;
        if (oldMap) oldMap.dispose();
      }
    } else {
      const unitIdx = clamp(unitNum - 1, 0, 3);
      this.targetDoorIndex = unitIdx;

      // Reset real 3D Apartment Elevator Cabin at 1F ready to ride up to target floor!
      this.elevatorTargetFloor = clamp(floor, 2, 20);
      this.elevatorCurrentFloor = 1;
      this.elevatorPhase = 'idle_1f';
      this.elevatorStepTimer = 0;
      const floorsDelta = Math.max(1, this.elevatorTargetFloor - 1);
      // Total ride time smoothly scaled between ~2.0s (low floors) and ~3.4s (high floors)
      this.elevatorSecPerFloor = clamp(2.8 / floorsDelta, 0.18, 0.55);
      this.elevDoorOpenCur = 0;
      this.elevDoorOpenTarget = 0;
      this.elevRideVibeY = 0;
      this.elevDoorL.position.x = -0.46;
      this.elevDoorR.position.x = 0.46;
      this.elevBtnGlowMat.emissiveIntensity = 0.3;
      this.elevCallBtnMat.emissiveIntensity = 0.4;
      this.redrawElevatorLedDisplay(1, 'idle');

      for (let i = 0; i < doors.length; i++) {
        doors[i].doorPivot.rotation.y = 0;
        const label = `${floor}0${i + 1}호`;
        doors[i].unitNumber = label;
        const isTarget = i === this.targetDoorIndex;
        doors[i].bellLedMat.emissive.setHex(isTarget ? 0x22c55e : 0x38bdf8);
        doors[i].bellLedMat.emissiveIntensity = isTarget ? 1.4 : 0.35;

        const oldMap = doors[i].plaqueMat.map;
        doors[i].plaqueMat.map = this.createPlaqueTexture(
          label,
          isTarget ? '#065f46' : '#1e293b',
          isTarget ? '#a7f3d0' : '#f8fafc'
        );
        doors[i].plaqueMat.needsUpdate = true;
        if (oldMap) oldMap.dispose();
      }
    }

    const target = doors[this.targetDoorIndex];
    target.group.add(this.npcGroup);
    this.npcGroup.position.set(0.05, 0, -0.78);
    this.npcGroup.rotation.set(0, 0, 0);

    this.targetHighlightRing.position.set(target.matX, target.y + 0.032, target.matZ);
    this.targetHighlightRing.visible = true;
  }

  /** Redraws the live glowing red/amber LED floor indicator inside & outside the 3D apartment elevator */
  private redrawElevatorLedDisplay(floor: number, dir: 'up' | 'down' | 'idle'): void {
    const ctx = this.elevLedCtx;
    ctx.fillStyle = '#070b14';
    ctx.fillRect(0, 0, 256, 96);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, 250, 90);

    const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '●';
    ctx.fillStyle = dir === 'up' ? '#22c55e' : dir === 'down' ? '#f97316' : '#f59e0b';
    ctx.font = '900 44px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(arrow, 22, 49);

    ctx.fillStyle = '#ef4444';
    ctx.font = '900 54px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${floor}F`, 234, 51);
    this.elevLedTex.needsUpdate = true;
  }

  public isInsideElevatorCabin(px: number, pz: number): boolean {
    if (this.isVillaMode) return false;
    return pz < -8.0 && Math.abs(px) <= 1.18;
  }

  public isElevatorDoorsOpen(): boolean {
    return this.elevDoorOpenCur > 0.65;
  }

  /** Player presses floor button inside the 3D elevator cabin at 1F -> doors close, rides up to target floor! */
  public startElevatorRideUp(): boolean {
    if (this.isVillaMode || this.elevatorPhase !== 'idle_1f') return false;
    this.elevatorPhase = 'moving_up';
    this.elevatorStepTimer = 0;
    this.elevDoorOpenTarget = 0;
    this.elevBtnGlowMat.emissiveIntensity = 3.2;
    this.redrawElevatorLedDisplay(this.elevatorCurrentFloor, 'up');
    return true;
  }

  /** Player presses corridor call button after delivery -> elevator doors slide open! */
  public openElevatorForExit(): boolean {
    if (this.isVillaMode) return false;
    if (this.elevatorPhase === 'doors_open_exit' && this.elevDoorOpenTarget > 0.5) return false;
    this.elevatorPhase = 'doors_open_exit';
    this.elevDoorOpenTarget = 1;
    this.elevCallBtnMat.emissiveIntensity = 2.8;
    return true;
  }

  /** Player presses 1F button inside the 3D elevator cabin -> doors close, rides down to 1F! */
  public startElevatorRideDown(): boolean {
    if (this.isVillaMode) return false;
    if (this.elevatorPhase === 'moving_down') return false;
    this.elevatorPhase = 'moving_down';
    this.elevatorStepTimer = 0;
    this.elevDoorOpenTarget = 0;
    this.elevBtnGlowMat.emissiveIntensity = 3.2;
    this.elevCallBtnMat.emissiveIntensity = 0.35;
    this.redrawElevatorLedDisplay(this.elevatorCurrentFloor, 'down');
    return true;
  }

  public getSpawnPoint(): { x: number; y: number; z: number; heading: number } {
    return this.isVillaMode ? this.villaSpawn : this.elevatorSpawn;
  }

  /**
   * [Backspace] rescue point. After arriving on the target floor the elevator doors auto-close
   * behind the player, so respawning inside the cabin would trap them -> drop them in the corridor instead.
   */
  public getRescuePoint(): { x: number; y: number; z: number; heading: number } {
    if (!this.isVillaMode && this.elevatorPhase === 'arrived_floor') {
      return { x: 0, y: CORRIDOR_ORIGIN_Y, z: -4.6, heading: 0 };
    }
    return this.getSpawnPoint();
  }

  /** Returns continuous world Y floor elevation inside the corridor, moving elevator cabin, or walk-up villa stairwell */
  public getFloorYAt(_x: number, z: number): number {
    if (!this.isVillaMode) {
      return CORRIDOR_ORIGIN_Y + (z < -8.0 ? this.elevRideVibeY : 0);
    }
    for (const fl of VILLA_STAIR_FLIGHTS) {
      if (z >= fl.zStart && z <= fl.zEnd) {
        const t = (z - fl.zStart) / (fl.zEnd - fl.zStart);
        return CORRIDOR_ORIGIN_Y + fl.yStart + (fl.yEnd - fl.yStart) * t;
      }
    }
    if (z < -7.2) return CORRIDOR_ORIGIN_Y + VILLA_FLOOR_Y[0];
    if (z < -0.4) return CORRIDOR_ORIGIN_Y + VILLA_FLOOR_Y[1];
    if (z < 6.4) return CORRIDOR_ORIGIN_Y + VILLA_FLOOR_Y[2];
    return CORRIDOR_ORIGIN_Y + VILLA_FLOOR_Y[3];
  }

  /** Returns current floor label (1F..4F) when walking inside a walk-up villa stairwell */
  public getCurrentVillaFloor(playerWorldY: number): number {
    const localY = playerWorldY - CORRIDOR_ORIGIN_Y;
    if (localY < 1.1) return 1;
    if (localY < 3.3) return 2;
    if (localY < 5.5) return 3;
    return 4;
  }

  public placeFoodOnTargetMat(): void {
    const target = this.getActiveDoors()[this.targetDoorIndex];
    this.foodPlacedOnMat = true;
    this.placedFoodBag.position.set(target.matX, target.y + 0.18, target.matZ);
    this.placedFoodBag.rotation.y = target.facingX > 0 ? Math.PI / 2 : -Math.PI / 2;
    this.placedFoodBag.visible = true;
    this.targetHighlightRing.visible = false;
  }

  /** Triggered when player presses [E] at intercom doorbell for MEET_FACE delivery */
  public triggerIntercomRing(): void {
    this.bellFlashTimer = 1.6;
    this.targetHighlightRing.visible = false;
  }

  /** Smoothly pivots target door inward to 70° and brings 3D NPC to doorway */
  public openTargetDoorForNpc(): void {
    this.targetDoorOpenAngle = (70 * Math.PI) / 180;
    this.npcVisible = true;
    this.npcGroup.visible = true;
    this.npcStepTarget = 1;
  }

  /** NPC extends right arm forward and receives the 3D takeout food bag from the rider */
  public triggerNpcReceiveFood(): void {
    this.npcArmReachTarget = 1;
    this.npcHeldBag.visible = true;
  }

  /** NPC steps slightly back inside after thanking the rider */
  public retreatNpcSlightly(): void {
    this.npcArmReachTarget = 0.25;
    this.npcStepTarget = 0.45;
  }

  public getTargetDoorMat(): { x: number; y: number; z: number; unitNumber: string } {
    const d = this.getActiveDoors()[this.targetDoorIndex];
    return { x: d.matX, y: CORRIDOR_ORIGIN_Y + d.y, z: d.matZ, unitNumber: d.unitNumber };
  }

  /** Returns the two required 3D proof-photo targets (placed food bag + door unit plaque) */
  public getProofTargets(): { foodBagMesh: THREE.Object3D; doorPlateMesh: THREE.Object3D } {
    const d = this.getActiveDoors()[this.targetDoorIndex];
    return {
      foodBagMesh: this.placedFoodBag,
      doorPlateMesh: d.plaqueMesh,
    };
  }

  public isNearTargetDoor(px: number, pz: number, py = CORRIDOR_ORIGIN_Y): boolean {
    const d = this.getActiveDoors()[this.targetDoorIndex];
    const targetWorldY = CORRIDOR_ORIGIN_Y + d.y;
    if (Math.abs(py - targetWorldY) > 0.85) return false;
    return Math.hypot(px - d.matX, pz - d.matZ) <= 2.25;
  }

  public isNearElevator(px: number, pz: number, py = CORRIDOR_ORIGIN_Y): boolean {
    if (this.isVillaMode) {
      if (Math.abs(py - CORRIDOR_ORIGIN_Y) > 0.9) return false;
      return Math.hypot(px - this.villaExitTrigger.x, pz - this.villaExitTrigger.z) <= this.villaExitTrigger.radius;
    }
    if (this.isInsideElevatorCabin(px, pz)) return true;
    return Math.hypot(px - this.elevatorTrigger.x, pz - this.elevatorTrigger.z) <= this.elevatorTrigger.radius;
  }

  public clampPlayerInside(x: number, z: number): [number, number] {
    if (this.isVillaMode) {
      return [clamp(x, -2.15, 2.15), clamp(z, -9.4, 12.85)];
    }
    const doorsOpen = this.elevDoorOpenCur > 0.65;
    if (doorsOpen) {
      if (z < -7.45) {
        return [clamp(x, -0.78, 0.78), clamp(z, -9.95, 7.4)];
      }
      return [clamp(x, -2.15, 2.15), clamp(z, -9.95, 7.4)];
    }
    // Doors closed: keep player cleanly inside cabin OR inside corridor (no walking through closed steel doors!)
    if (z < -7.95) {
      return [clamp(x, -0.78, 0.78), clamp(z, -9.95, -8.35)];
    }
    return [clamp(x, -2.15, 2.15), clamp(z, -7.4, 7.4)];
  }

  public updateVisual(
    elapsedTime: number,
    dt = 0.016,
    playerZ = 0,
    events?: ElevatorEvents
  ): void {
    if (!this.root.visible) return;
    const step = Math.min(1, dt * 5.2);

    // 1. Live 3D Apartment Elevator Ride & Sliding Steel Doors
    if (!this.isVillaMode) {
      if (this.elevatorPhase === 'moving_up') {
        this.elevRideVibeY = Math.sin(elapsedTime * 34) * 0.0045;
        this.elevatorStepTimer += dt;
        if (this.elevatorStepTimer >= this.elevatorSecPerFloor) {
          this.elevatorStepTimer -= this.elevatorSecPerFloor;
          this.elevatorCurrentFloor = Math.min(this.elevatorTargetFloor, this.elevatorCurrentFloor + 1);
          if (this.elevatorCurrentFloor >= this.elevatorTargetFloor) {
            this.elevatorPhase = 'arrived_floor';
            this.elevRideVibeY = 0;
            this.elevDoorOpenTarget = 1;
            this.elevBtnGlowMat.emissiveIntensity = 0.25;
            this.redrawElevatorLedDisplay(this.elevatorCurrentFloor, 'idle');
            events?.onDoorSlide?.(true);
            events?.onArrivedTargetFloor?.(this.elevatorCurrentFloor);
          } else {
            this.redrawElevatorLedDisplay(this.elevatorCurrentFloor, 'up');
            events?.onFloorTick?.(this.elevatorCurrentFloor);
          }
        }
      } else if (this.elevatorPhase === 'moving_down') {
        this.elevRideVibeY = Math.sin(elapsedTime * 34) * 0.0045;
        this.elevatorStepTimer += dt;
        if (this.elevatorStepTimer >= this.elevatorSecPerFloor) {
          this.elevatorStepTimer -= this.elevatorSecPerFloor;
          this.elevatorCurrentFloor = Math.max(1, this.elevatorCurrentFloor - 1);
          if (this.elevatorCurrentFloor <= 1) {
            this.elevatorPhase = 'idle_1f';
            this.elevRideVibeY = 0;
            this.elevBtnGlowMat.emissiveIntensity = 0.25;
            this.redrawElevatorLedDisplay(1, 'idle');
            events?.onArrivedGroundFloor?.();
          } else {
            this.redrawElevatorLedDisplay(this.elevatorCurrentFloor, 'down');
            events?.onFloorTick?.(this.elevatorCurrentFloor);
          }
        }
      } else {
        this.elevRideVibeY = 0;
        // Gently auto-close elevator doors behind the player once they walk out into the corridor!
        if (this.elevatorPhase === 'arrived_floor' && this.elevDoorOpenTarget > 0.5 && playerZ > -5.2) {
          this.elevDoorOpenTarget = 0;
          events?.onDoorSlide?.(false);
        }
      }

      // Smoothly animate double stainless-steel sliding elevator doors
      const doorStep = Math.min(1, dt * 3.6);
      this.elevDoorOpenCur += (this.elevDoorOpenTarget - this.elevDoorOpenCur) * doorStep;
      const slideOffset = 0.46 + this.elevDoorOpenCur * 0.84;
      this.elevDoorL.position.x = -slideOffset;
      this.elevDoorR.position.x = slideOffset;
    }

    if (this.targetHighlightRing.visible) {
      const s = 1 + Math.sin(elapsedTime * 4.5) * 0.08;
      this.targetHighlightRing.scale.set(s, s, 1);
    }

    const targetDoor = this.getActiveDoors()[this.targetDoorIndex];
    if (targetDoor) {
      this.currentDoorOpenAngle += (this.targetDoorOpenAngle - this.currentDoorOpenAngle) * step;
      targetDoor.doorPivot.rotation.y = this.currentDoorOpenAngle;

      if (this.bellFlashTimer > 0) {
        this.bellFlashTimer = Math.max(0, this.bellFlashTimer - dt);
        const blink = Math.floor(elapsedTime * 10) % 2 === 0;
        targetDoor.bellLedMat.emissive.setHex(blink ? 0xfacc15 : 0x22c55e);
        targetDoor.bellLedMat.emissiveIntensity = blink ? 3.5 : 1.0;
      }
    }

    if (this.npcVisible) {
      this.npcStepCur += (this.npcStepTarget - this.npcStepCur) * Math.min(1, dt * 4.5);
      this.npcArmReachCur += (this.npcArmReachTarget - this.npcArmReachCur) * Math.min(1, dt * 7.0);

      this.npcGroup.position.z = -0.82 + this.npcStepCur * 0.66;
      this.npcRightArmPivot.rotation.x = -this.npcArmReachCur * 1.18;
    }
  }
}

/** Small low-poly corridor props (lit by the corridor lights; ~1 draw call per part) */
function buildInteriorProp(kind: InteriorPropKind): THREE.Group {
  const g = new THREE.Group();
  const mat = (color: number, rough = 0.7, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };
  switch (kind) {
    case 'plant': {
      add(new THREE.CylinderGeometry(0.2, 0.16, 0.42, 10), mat(0xb45309), 0, 0.21, 0);
      add(new THREE.SphereGeometry(0.36, 10, 8), mat(0x3f7d3a, 0.85), 0, 0.72, 0);
      add(new THREE.SphereGeometry(0.24, 8, 6), mat(0x4d9447, 0.85), 0.12, 1.02, 0.05);
      break;
    }
    case 'stroller': {
      const frame = mat(0x1f2937, 0.5, 0.4);
      add(new THREE.BoxGeometry(0.42, 0.34, 0.7), mat(0x60a5fa), 0, 0.62, 0);
      add(new THREE.CylinderGeometry(0.22, 0.22, 0.44, 12, 1, false, 0, Math.PI), mat(0x3b82f6), 0, 0.82, -0.2).rotation.z = Math.PI / 2;
      for (const [x, z] of [[-0.2, -0.28], [0.2, -0.28], [-0.2, 0.28], [0.2, 0.28]]) {
        add(new THREE.TorusGeometry(0.09, 0.025, 6, 12), frame, x, 0.11, z).rotation.y = Math.PI / 2;
      }
      add(new THREE.BoxGeometry(0.04, 0.6, 0.04), frame, 0, 0.9, 0.36);
      break;
    }
    case 'bicycle': {
      const frame = mat(0xdc2626, 0.45, 0.3);
      const tire = mat(0x111827, 0.9);
      add(new THREE.TorusGeometry(0.3, 0.035, 6, 18), tire, 0, 0.32, -0.5).rotation.y = Math.PI / 2;
      add(new THREE.TorusGeometry(0.3, 0.035, 6, 18), tire, 0, 0.32, 0.5).rotation.y = Math.PI / 2;
      add(new THREE.BoxGeometry(0.04, 0.04, 0.95), frame, 0, 0.55, 0);
      add(new THREE.BoxGeometry(0.04, 0.42, 0.04), frame, 0, 0.62, -0.2);
      add(new THREE.BoxGeometry(0.16, 0.05, 0.26), mat(0x111827), 0, 0.86, -0.2);
      add(new THREE.BoxGeometry(0.5, 0.04, 0.04), frame, 0, 0.9, 0.45);
      break;
    }
    case 'shoe_rack': {
      add(new THREE.BoxGeometry(0.34, 0.9, 1.0), mat(0xd6b98c, 0.8), 0, 0.45, 0);
      add(new THREE.BoxGeometry(0.18, 0.08, 0.28), mat(0x1f2937), 0.16, 0.05, 0.62);
      add(new THREE.BoxGeometry(0.18, 0.08, 0.28), mat(0xf8fafc), 0.16, 0.05, 0.88);
      break;
    }
    case 'parcels': {
      const box = mat(0xc49a6c, 0.9);
      add(new THREE.BoxGeometry(0.5, 0.36, 0.42), box, 0, 0.18, 0);
      add(new THREE.BoxGeometry(0.38, 0.28, 0.34), box, 0.04, 0.5, 0.02).rotation.y = 0.3;
      add(new THREE.BoxGeometry(0.3, 0.2, 0.3), mat(0xe5d3b3, 0.9), -0.05, 0.1, 0.42);
      break;
    }
    case 'umbrella_stand': {
      add(new THREE.CylinderGeometry(0.16, 0.14, 0.5, 12), mat(0x64748b, 0.4, 0.5), 0, 0.25, 0);
      add(new THREE.CylinderGeometry(0.015, 0.015, 0.9, 6), mat(0x1d4ed8), 0.05, 0.6, 0.02).rotation.z = 0.1;
      add(new THREE.CylinderGeometry(0.015, 0.015, 0.9, 6), mat(0xbe123c), -0.04, 0.6, -0.03).rotation.z = -0.12;
      break;
    }
  }
  return g;
}
