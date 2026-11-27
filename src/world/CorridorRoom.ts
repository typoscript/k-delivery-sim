import * as THREE from 'three';
import { InteriorStyle } from './interiorThemes';
import { HandheldFoodBag3D } from '../player/HandheldFoodBag3D';
import { ResidenceKind, clamp } from '../types';
import {
  UnitDoorSlot,
  VILLA_FLOOR_Y,
  VILLA_STAIR_FLIGHTS,
  buildCustomerNpc,
} from './corridor/corridorParts';
import { buildApartmentCorridor } from './corridor/apartmentCorridor';
import { buildWalkupVillaStairwell } from './corridor/villaStairwell';

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

import {
  applyInteriorStyle as applyInteriorStyleFn,
  configureForUnit as configureForUnitFn,
} from './corridor/unitSetup';
import {
  redrawElevatorLedDisplay as redrawElevatorLedDisplayFn,
  isInsideElevatorCabin as isInsideElevatorCabinFn,
  isElevatorDoorsOpen as isElevatorDoorsOpenFn,
  startElevatorRideUp as startElevatorRideUpFn,
  openElevatorForExit as openElevatorForExitFn,
  startElevatorRideDown as startElevatorRideDownFn,
} from './corridor/elevator';
import {
  placeFoodOnTargetMat as placeFoodOnTargetMatFn,
  triggerIntercomRing as triggerIntercomRingFn,
  openTargetDoorForNpc as openTargetDoorForNpcFn,
  triggerNpcReceiveFood as triggerNpcReceiveFoodFn,
  retreatNpcSlightly as retreatNpcSlightlyFn,
} from './corridor/doorNpc';
import {
  updateVisual as updateVisualFn,
} from './corridor/corridorFrame';

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

  /** @internal corridor/* */
  readonly aptGroup = new THREE.Group();
  /** @internal corridor/* */
  readonly villaGroup = new THREE.Group();

  /** @internal corridor/* */
  readonly aptDoors: UnitDoorSlot[] = [];
  /** @internal corridor/* */
  readonly villaDoors: UnitDoorSlot[] = [];

  /** @internal corridor/* */
  readonly targetHighlightRing: THREE.Mesh;
  /** @internal corridor/* */
  readonly placedFoodBag: THREE.Group;

  // Low-poly 3D Customer NPC for MEET_FACE deliveries
  /** @internal corridor/* */
  readonly npcGroup = new THREE.Group();
  /** @internal corridor/* */
  readonly npcRightArmPivot = new THREE.Group();
  /** @internal corridor/* */
  readonly npcHeldBag: THREE.Group;

  // Door swing & NPC handoff animation state
  /** @internal corridor/* */
  targetDoorOpenAngle = 0; // 0 rad (closed) -> 70° (1.2217 rad open!)
  /** @internal corridor/* */
  currentDoorOpenAngle = 0;
  /** @internal corridor/* */
  npcVisible = false;
  /** @internal corridor/* */
  npcStepTarget = 0; // 0 (inside) -> 1 (doorway)
  /** @internal corridor/* */
  npcStepCur = 0;
  /** @internal corridor/* */
  npcArmReachTarget = 0; // 0 (down) -> 1 (extended toward rider)
  /** @internal corridor/* */
  npcArmReachCur = 0;
  /** @internal corridor/* */
  bellFlashTimer = 0;

  public isVillaMode = false;

  // Per-building interior theme (interiorThemes.ts): shared materials recoloured on each visit
  /** @internal corridor/* */
  readonly aptWallMat = new THREE.MeshStandardMaterial({ color: 0xedeae4, roughness: 0.85 });
  /** @internal corridor/* */
  readonly aptTrimMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.6 });
  /** @internal corridor/* */
  readonly aptFloorMat = new THREE.MeshStandardMaterial({ roughness: 0.65 });
  /** @internal corridor/* */
  readonly aptCeilingMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.9 });
  /** @internal corridor/* */
  readonly aptFixtureMat = new THREE.MeshBasicMaterial({ color: 0xfffbeb });
  /** @internal corridor/* */
  readonly aptLights: THREE.PointLight[] = [];
  /** @internal corridor/* */
  readonly villaWallMat = new THREE.MeshStandardMaterial({ color: 0xeae5da, roughness: 0.9 });
  /** @internal corridor/* */
  readonly villaDadoMat = new THREE.MeshStandardMaterial({ color: 0x7a9b8e, roughness: 0.85 });
  /** @internal corridor/* */
  readonly villaRailMat = new THREE.MeshStandardMaterial({ color: 0x1f5c4e, metalness: 0.45, roughness: 0.48 });
  /** @internal corridor/* */
  readonly villaCeilingMat = new THREE.MeshStandardMaterial({ color: 0xd8dce2, roughness: 0.92 });
  /** @internal corridor/* */
  readonly villaFloorMat = new THREE.MeshStandardMaterial({ roughness: 0.72 });
  /** @internal corridor/* */
  readonly villaFixtureMat = new THREE.MeshBasicMaterial({ color: 0xfff7d6 });
  /** Decorative props + building name sign of the current visit (rebuilt per building) */
  /** @internal corridor/* */
  readonly styleGroup = new THREE.Group();
  /** Theme of the current visit (for tests / debugging) */
  public currentThemeId = '';
  public targetDoorIndex = 1;
  public foodPlacedOnMat = false;

  // Interactive 3D Apartment Elevator Cabin state & meshes!
  public elevatorPhase: ElevatorPhase = 'idle_1f';
  public elevatorCurrentFloor = 1;
  public elevatorTargetFloor = 14;
  /** @internal corridor/* */
  elevatorStepTimer = 0;
  /** @internal corridor/* */
  elevatorSecPerFloor = 0.25;
  /** @internal corridor/* */
  elevDoorOpenCur = 0; // 0 = closed, 1 = fully open
  /** @internal corridor/* */
  elevDoorOpenTarget = 0;
  /** @internal corridor/* */
  elevDoorL!: THREE.Mesh;
  /** @internal corridor/* */
  elevDoorR!: THREE.Mesh;
  /** @internal corridor/* */
  elevBtnGlowMat!: THREE.MeshStandardMaterial;
  /** @internal corridor/* */
  elevCallBtnMat!: THREE.MeshStandardMaterial;
  /** @internal corridor/* */
  elevLedCanvas!: HTMLCanvasElement;
  /** @internal corridor/* */
  elevLedCtx!: CanvasRenderingContext2D;
  /** @internal corridor/* */
  elevLedTex!: THREE.CanvasTexture;
  /** @internal corridor/* */
  elevRideVibeY = 0;

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

    buildApartmentCorridor(this);
    buildWalkupVillaStairwell(this);

    // Build reusable 3D Low-Poly Customer NPC for MEET_FACE handoff
    this.npcHeldBag = buildCustomerNpc(this.npcGroup, this.npcRightArmPivot);

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

  /** @internal corridor/* */
  getActiveDoors(): UnitDoorSlot[] {
    return this.isVillaMode ? this.villaDoors : this.aptDoors;
  }

  /** Recolours walls, floor, ceiling, doors and lights to the building's theme and rebuilds its props + sign */
  /** @internal corridor/* */
  applyInteriorStyle(style: InteriorStyle, buildingName: string | undefined, unitNumber: string): void {
    applyInteriorStyleFn(this, style, buildingName, unitNumber);
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
    configureForUnitFn(this, targetUnitNumber, residenceKind, building);
  }

  /** Redraws the live glowing red/amber LED floor indicator inside & outside the 3D apartment elevator */
  /** @internal corridor/* */
  redrawElevatorLedDisplay(floor: number, dir: 'up' | 'down' | 'idle'): void {
    redrawElevatorLedDisplayFn(this, floor, dir);
  }

  public isInsideElevatorCabin(px: number, pz: number): boolean {
    return isInsideElevatorCabinFn(this, px, pz);
  }

  public isElevatorDoorsOpen(): boolean {
    return isElevatorDoorsOpenFn(this);
  }

  /** Player presses floor button inside the 3D elevator cabin at 1F -> doors close, rides up to target floor! */
  public startElevatorRideUp(): boolean {
    return startElevatorRideUpFn(this);
  }

  /** Player presses corridor call button after delivery -> elevator doors slide open! */
  public openElevatorForExit(): boolean {
    return openElevatorForExitFn(this);
  }

  /** Player presses 1F button inside the 3D elevator cabin -> doors close, rides down to 1F! */
  public startElevatorRideDown(): boolean {
    return startElevatorRideDownFn(this);
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
    placeFoodOnTargetMatFn(this);
  }

  /** Triggered when player presses [E] at intercom doorbell for MEET_FACE delivery */
  public triggerIntercomRing(): void {
    triggerIntercomRingFn(this);
  }

  /** Smoothly pivots target door inward to 70° and brings 3D NPC to doorway */
  public openTargetDoorForNpc(): void {
    openTargetDoorForNpcFn(this);
  }

  /** NPC extends right arm forward and receives the 3D takeout food bag from the rider */
  public triggerNpcReceiveFood(): void {
    triggerNpcReceiveFoodFn(this);
  }

  /** NPC steps slightly back inside after thanking the rider */
  public retreatNpcSlightly(): void {
    retreatNpcSlightlyFn(this);
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
    updateVisualFn(this, elapsedTime, dt, playerZ, events);
  }
}
