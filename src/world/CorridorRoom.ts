import * as THREE from 'three';
import { HandheldFoodBag3D } from '../player/HandheldFoodBag3D';
import { ResidenceKind, clamp } from '../types';

export const CORRIDOR_ORIGIN_Y = -500;

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
  unitNumber: string;
}

// Walk-up villa stairwell layout along +Z (monotonically ascending -> unique y(z) with zero overlap!)
const VILLA_STAIR_FLIGHTS = [
  { zStart: -7.2, zEnd: -3.2, yStart: 0.0, yEnd: 2.2 }, // 1F -> 2F
  { zStart: -0.4, zEnd: 3.6, yStart: 2.2, yEnd: 4.4 }, // 2F -> 3F
  { zStart: 6.4, zEnd: 10.4, yStart: 4.4, yEnd: 6.6 }, // 3F -> 4F
] as const;

const VILLA_FLOOR_Y = [0.0, 2.2, 4.4, 6.6] as const; // index 0=1F, 1=2F, 2=3F, 3=4F

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
  public targetDoorIndex = 1;
  public foodPlacedOnMat = false;

  public readonly elevatorSpawn = { x: 0, y: CORRIDOR_ORIGIN_Y, z: -6.1, heading: 0 };
  public readonly elevatorTrigger = { x: 0, z: -7.1, radius: 1.9 };
  public readonly villaSpawn = { x: 0, y: CORRIDOR_ORIGIN_Y, z: -8.6, heading: 0 };
  public readonly villaExitTrigger = { x: 0, z: -9.3, radius: 2.0 };

  constructor(scene: THREE.Scene) {
    this.root.position.set(0, CORRIDOR_ORIGIN_Y, 0);
    this.root.visible = false;

    this.root.add(this.aptGroup);
    this.root.add(this.villaGroup);

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
      const pLight = new THREE.PointLight(0xfff1d6, 9.5, 12, 1.5);
      pLight.position.set(0, height - 0.35, lz);
      this.aptGroup.add(pLight);

      const fixture = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.08, 0.35),
        new THREE.MeshBasicMaterial({ color: 0xfffbeb })
      );
      fixture.position.set(0, height - 0.05, lz);
      this.aptGroup.add(fixture);
    }

    const floorTex = this.createTileTexture('#d6d3cd', 'rgba(100,116,139,0.28)', 4, 12);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(width, length),
      new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.65 })
    );
    floor.rotation.x = -Math.PI / 2;
    this.aptGroup.add(floor);

    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(width, length),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.9 })
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = height;
    this.aptGroup.add(ceiling);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0xedeae4, roughness: 0.85 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.6 });

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

    const elevWall = new THREE.Mesh(new THREE.PlaneGeometry(width, height), wallMat);
    elevWall.position.set(0, height / 2, -length / 2);
    this.aptGroup.add(elevWall);

    for (const side of [-1, 1]) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, length), trimMat);
      base.position.set(side * (width / 2 - 0.03), 0.07, 0);
      this.aptGroup.add(base);
    }

    // Elevator Door at z = -7.95
    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.72,
      roughness: 0.32,
    });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5 });

    const elevFrame = new THREE.Mesh(new THREE.BoxGeometry(2.1, 2.38, 0.16), frameMat);
    elevFrame.position.set(0, 1.19, -length / 2 + 0.06);
    const elevDoorL = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.22, 0.08), steelMat);
    elevDoorL.position.set(-0.46, 1.11, -length / 2 + 0.12);
    const elevDoorR = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.22, 0.08), steelMat);
    elevDoorR.position.set(0.46, 1.11, -length / 2 + 0.12);

    const elevLabel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.75, 0.28),
      new THREE.MeshBasicMaterial({ map: this.createPlaqueTexture('🛗 ELEVATOR', '#0f172a', '#fbbf24') })
    );
    elevLabel.position.set(0, 2.6, -length / 2 + 0.05);

    const callBtn = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.28, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, emissive: 0xf59e0b, emissiveIntensity: 0.6 })
    );
    callBtn.position.set(1.3, 1.15, -length / 2 + 0.06);
    this.aptGroup.add(elevFrame, elevDoorL, elevDoorR, elevLabel, callBtn);

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
    const terrazzoMat = new THREE.MeshStandardMaterial({ map: terrazzoTex, roughness: 0.72 });
    const stairStepMat = new THREE.MeshStandardMaterial({ color: 0xbeb7ac, roughness: 0.78 });
    const nosingMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.55 });
    const upperWallMat = new THREE.MeshStandardMaterial({ color: 0xeae5da, roughness: 0.9 });
    const dadoWallMat = new THREE.MeshStandardMaterial({ color: 0x7a9b8e, roughness: 0.85 });
    const railMat = new THREE.MeshStandardMaterial({ color: 0x1f5c4e, metalness: 0.45, roughness: 0.48 });
    const ceilingMat = new THREE.MeshStandardMaterial({ color: 0xd8dce2, roughness: 0.92 });
    const fixtureMat = new THREE.MeshBasicMaterial({ color: 0xfff7d6 });

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
          new THREE.PlaneGeometry(0.75, 0.42),
          new THREE.MeshBasicMaterial({
            map: this.createPlaqueTexture(`${ld.floor}F 계단`, '#064e3b', '#ecfdf5'),
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
      new THREE.PlaneGeometry(1.25, 0.34),
      new THREE.MeshBasicMaterial({ map: this.createPlaqueTexture('🚪 1F 현관 출구', '#065f46', '#fef08a') })
    );
    exitLabel.position.set(0, 2.58, zMin + 0.08);

    // Classic Korean metal villa mailbox bank on right wall near 1F entrance
    const mailbox = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.82, 1.15),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.55, roughness: 0.4 })
    );
    mailbox.position.set(width / 2 - 0.1, 1.38, -8.6);
    this.villaGroup.add(exitFrame, exitDoor, exitLabel, mailbox);

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

  private createPlaqueTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 104;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 256, 104);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 5;
    ctx.strokeRect(4, 4, 248, 96);
    ctx.fillStyle = fg;
    ctx.font = 'bold 42px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 54);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  /** Configures either the Apartment Corridor or Walk-up Villa Stairwell for the target unit */
  public configureForUnit(targetUnitNumber: string, residenceKind: ResidenceKind = 'apartment'): void {
    this.isVillaMode = residenceKind === 'walkup_villa';
    this.aptGroup.visible = !this.isVillaMode;
    this.villaGroup.visible = this.isVillaMode;

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

  public getSpawnPoint(): { x: number; y: number; z: number; heading: number } {
    return this.isVillaMode ? this.villaSpawn : this.elevatorSpawn;
  }

  /** Returns continuous world Y floor elevation inside the corridor or walk-up villa stairwell */
  public getFloorYAt(_x: number, z: number): number {
    if (!this.isVillaMode) return CORRIDOR_ORIGIN_Y;
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
    return Math.hypot(px - this.elevatorTrigger.x, pz - this.elevatorTrigger.z) <= this.elevatorTrigger.radius;
  }

  public clampPlayerInside(x: number, z: number): [number, number] {
    if (this.isVillaMode) {
      return [clamp(x, -2.15, 2.15), clamp(z, -9.4, 12.85)];
    }
    return [clamp(x, -2.15, 2.15), clamp(z, -7.4, 7.4)];
  }

  public updateVisual(elapsedTime: number, dt = 0.016): void {
    if (!this.root.visible) return;
    const step = Math.min(1, dt * 5.2);

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
