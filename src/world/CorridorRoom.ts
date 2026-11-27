import * as THREE from 'three';
import { InteriorStyle, pickInteriorStyle } from './interiorThemes';
import { HandheldFoodBag3D } from '../player/HandheldFoodBag3D';
import { ResidenceKind, clamp } from '../types';
import {
  APT_LIGHT_INTENSITY,
  APT_PROP_SLOTS,
  UnitDoorSlot,
  VILLA_FLOOR_Y,
  VILLA_PROP_SLOTS,
  VILLA_STAIR_FLIGHTS,
  buildCustomerNpc,
  buildInteriorProp,
  createPlaqueTexture,
  createTileTexture,
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

  private getActiveDoors(): UnitDoorSlot[] {
    return this.isVillaMode ? this.villaDoors : this.aptDoors;
  }

  /** Recolours walls, floor, ceiling, doors and lights to the building's theme and rebuilds its props + sign */
  private applyInteriorStyle(style: InteriorStyle, buildingName: string | undefined, unitNumber: string): void {
    const t = style.theme;
    this.currentThemeId = t.id;
    const floorTex = createTileTexture(t.floorBase, t.floorGrout, this.isVillaMode ? 3 : 4, this.isVillaMode ? 2 : 12);
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
          map: createPlaqueTexture(
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
        doors[i].plaqueMat.map = createPlaqueTexture(
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
        doors[i].plaqueMat.map = createPlaqueTexture(
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
  /** @internal corridor/* */
  redrawElevatorLedDisplay(floor: number, dir: 'up' | 'down' | 'idle'): void {
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
