import * as THREE from 'three';
import { HandheldFoodBag3D } from '../player/HandheldFoodBag3D';
import { clamp } from '../types';

export const CORRIDOR_ORIGIN_Y = -500;

interface UnitDoorSlot {
  x: number;
  z: number;
  matX: number;
  matZ: number;
  facingX: number; // +1 if on left wall (-X), -1 if on right wall (+X)
  group: THREE.Group;
  doorPivot: THREE.Group;
  bellLedMat: THREE.MeshStandardMaterial;
  plaqueMat: THREE.MeshStandardMaterial;
  unitNumber: string;
}

/**
 * Isolated Underground Modular Apartment Corridor Prefab (y = -500).
 * Supports all 3 customer delivery instructions:
 *  - PHOTO_DOOR: place food on doormat + smartphone photo
 *  - KNOCK_DOOR: knock on door + auto-place food on mat
 *  - MEET_FACE: press intercom bell -> smooth 70° inward door pivot -> 3D low-poly NPC reaches out & receives food!
 */
export class CorridorRoom {
  public readonly root = new THREE.Group();

  private readonly doors: UnitDoorSlot[] = [];
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

  public targetDoorIndex = 1;
  public foodPlacedOnMat = false;
  public readonly elevatorSpawn = { x: 0, y: CORRIDOR_ORIGIN_Y, z: -6.1, heading: 0 };
  public readonly elevatorTrigger = { x: 0, z: -7.1, radius: 1.9 };

  constructor(scene: THREE.Scene) {
    this.root.position.set(0, CORRIDOR_ORIGIN_Y, 0);
    this.root.visible = false;

    const width = 5.4;
    const length = 16.0;
    const height = 3.1;

    // Dedicated interior corridor lighting (independent of outdoor sun!)
    const ambient = new THREE.AmbientLight(0xfff7ed, 0.95);
    this.root.add(ambient);

    for (const lz of [-5.2, 0.0, 5.2]) {
      const pLight = new THREE.PointLight(0xfff1d6, 9.5, 12, 1.5);
      pLight.position.set(0, height - 0.35, lz);
      this.root.add(pLight);

      const fixture = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.08, 0.35),
        new THREE.MeshBasicMaterial({ color: 0xfffbeb })
      );
      fixture.position.set(0, height - 0.05, lz);
      this.root.add(fixture);
    }

    // Tile floor
    const floorTex = this.createTileTexture();
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(width, length),
      new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.65 })
    );
    floor.rotation.x = -Math.PI / 2;
    this.root.add(floor);

    // Ceiling
    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(width, length),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.9 })
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = height;
    this.root.add(ceiling);

    // 4 enclosing walls
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xedeae4, roughness: 0.85 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.6 });

    const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(length, height), wallMat);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.set(-width / 2, height / 2, 0);
    this.root.add(leftWall);

    const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(length, height), wallMat);
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.position.set(width / 2, height / 2, 0);
    this.root.add(rightWall);

    const farWall = new THREE.Mesh(new THREE.PlaneGeometry(width, height), wallMat);
    farWall.rotation.y = Math.PI;
    farWall.position.set(0, height / 2, length / 2);
    this.root.add(farWall);

    const elevWall = new THREE.Mesh(new THREE.PlaneGeometry(width, height), wallMat);
    elevWall.position.set(0, height / 2, -length / 2);
    this.root.add(elevWall);

    // Baseboard trim along side walls
    for (const side of [-1, 1]) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, length), trimMat);
      base.position.set(side * (width / 2 - 0.03), 0.07, 0);
      this.root.add(base);
    }

    // --- Elevator Door at z = -7.95 ---
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
    this.root.add(elevFrame, elevDoorL, elevDoorR, elevLabel, callBtn);

    // --- 4 Apartment Unit Doors with Hinged Pivot, Foyer Alcove & Intercom Bell ---
    const doorConfigs: Array<{ x: number; z: number; facingX: number }> = [
      { x: -width / 2 + 0.04, z: -1.6, facingX: 1 },
      { x: width / 2 - 0.04, z: -1.6, facingX: -1 },
      { x: -width / 2 + 0.04, z: 4.0, facingX: 1 },
      { x: width / 2 - 0.04, z: 4.0, facingX: -1 },
    ];

    const doorPanelMat = new THREE.MeshStandardMaterial({
      color: 0x3b4859,
      roughness: 0.55,
      metalness: 0.25,
    });
    const lockMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.35, metalness: 0.6 });
    const matCarpet = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.95 });
    const foyerWallMat = new THREE.MeshStandardMaterial({ color: 0xfff3df, roughness: 0.85, side: THREE.BackSide });
    const intercomBodyMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4 });

    doorConfigs.forEach((cfg, idx) => {
      const doorGroup = new THREE.Group();
      doorGroup.position.set(cfg.x, 0, cfg.z);
      doorGroup.rotation.y = cfg.facingX > 0 ? Math.PI / 2 : -Math.PI / 2;

      // Outer door frame pillars & lintel (hollow center so opened door reveals interior!)
      const frameL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.22, 0.14), frameMat);
      frameL.position.set(-0.6, 1.11, 0.02);
      const frameR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.22, 0.14), frameMat);
      frameR.position.set(0.6, 1.11, 0.02);
      const frameTop = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.1, 0.14), frameMat);
      frameTop.position.set(0, 2.18, 0.02);

      // Warm-lit interior foyer alcove behind the door (visible when door swings open 70°!)
      const foyerBox = new THREE.Mesh(new THREE.BoxGeometry(1.38, 2.28, 1.35), foyerWallMat);
      foyerBox.position.set(0, 1.14, -0.68);
      const foyerFloor = new THREE.Mesh(
        new THREE.PlaneGeometry(1.35, 1.35),
        new THREE.MeshStandardMaterial({ color: 0xc8a986, roughness: 0.75 })
      );
      foyerFloor.rotation.x = -Math.PI / 2;
      foyerFloor.position.set(0, 0.02, -0.68);

      // Hinged Door Pivot on left jamb (x = -0.56): positive Y rotation swings door smoothly INWARD (-Z)!
      const doorPivot = new THREE.Group();
      doorPivot.position.set(-0.56, 0, 0.05);

      const panel = new THREE.Mesh(new THREE.BoxGeometry(1.12, 2.12, 0.07), doorPanelMat);
      panel.position.set(0.56, 1.06, 0);

      const smartLock = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.28, 0.06), lockMat);
      smartLock.position.set(0.96, 1.05, 0.055);

      const plaqueMat = new THREE.MeshStandardMaterial({
        map: this.createPlaqueTexture(`140${idx + 1}호`, '#1e293b', '#f8fafc'),
        roughness: 0.4,
      });
      const plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.18), plaqueMat);
      plaque.position.set(0.56, 1.72, 0.045);

      doorPivot.add(panel, smartLock, plaque);

      // Intercom Doorbell Unit mounted beside the door frame (right side x = +0.82)
      const intercom = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.24, 0.05), intercomBodyMat);
      intercom.position.set(0.82, 1.32, 0.04);
      const bellLedMat = new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        emissive: 0x38bdf8,
        emissiveIntensity: 0.45,
      });
      const bellBtn = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.065, 0.025), bellLedMat);
      bellBtn.position.set(0.82, 1.26, 0.07);

      // Welcome Doormat right in front of the door!
      const doormat = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.025, 0.58), matCarpet);
      doormat.position.set(0, 0.012, 0.52);

      doorGroup.add(frameL, frameR, frameTop, foyerBox, foyerFloor, doorPivot, intercom, bellBtn, doormat);
      this.root.add(doorGroup);

      this.doors.push({
        x: cfg.x,
        z: cfg.z,
        matX: cfg.x + cfg.facingX * 0.54,
        matZ: cfg.z,
        facingX: cfg.facingX,
        group: doorGroup,
        doorPivot,
        bellLedMat,
        plaqueMat,
        unitNumber: `140${idx + 1}호`,
      });
    });

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

    scene.add(this.root);
  }

  /** Builds a stylized low-poly Korean apartment resident NPC with articulated right arm + food bag */
  private buildCustomerNpc(): THREE.Group {
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xf6c9a5, roughness: 0.72 });
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x1e2028, roughness: 0.85 });
    const shirtMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.78 });
    const pantsMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.85 });

    // Legs
    for (const sx of [-0.11, 0.11]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.74, 0.16), pantsMat);
      leg.position.set(sx, 0.37, 0);
      this.npcGroup.add(leg);
    }

    // Cozy homewear torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.58, 0.24), shirtMat);
    torso.position.set(0, 1.03, 0);
    this.npcGroup.add(torso);

    // Head + hair cap
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.26), skinMat);
    head.position.set(0, 1.48, 0);
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.28), hairMat);
    hair.position.set(0, 1.6, -0.01);
    this.npcGroup.add(head, hair);

    // Left arm (relaxed at side)
    const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.48, 0.12), shirtMat);
    leftArm.position.set(-0.28, 1.04, 0);
    this.npcGroup.add(leftArm);

    // Articulated Right Arm Pivot (shoulder) that reaches forward (+Z) to receive the food bag!
    this.npcRightArmPivot.position.set(0.28, 1.24, 0);
    const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.48, 0.12), shirtMat);
    rightArm.position.set(0, -0.22, 0);
    const rightHand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), skinMat);
    rightHand.position.set(0, -0.47, 0);

    // Held takeout food bag (hidden until handoff moment!)
    const heldBag = HandheldFoodBag3D.createFoodBagMesh();
    heldBag.position.set(0, -0.63, 0.04);
    heldBag.visible = false;

    this.npcRightArmPivot.add(rightArm, rightHand, heldBag);
    this.npcGroup.add(this.npcRightArmPivot);

    this.npcGroup.visible = false;
    return heldBag;
  }

  private createTileTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#d6d3cd';
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = 'rgba(100,116,139,0.28)';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, 128, 128);
    ctx.strokeRect(128, 0, 128, 128);
    ctx.strokeRect(0, 128, 128, 128);
    ctx.strokeRect(128, 128, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(4, 12);
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
    ctx.font = 'bold 44px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 54);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  /** Configures the corridor's 4 unit plaques, resets hinged doors & attaches NPC to target foyer */
  public configureForUnit(targetUnitNumber: string): void {
    const numMatch = targetUnitNumber.match(/(\d+)/);
    const num = numMatch ? parseInt(numMatch[1], 10) : 1402;
    const floor = Math.floor(num / 100);
    const unitIdx = clamp((num % 100) - 1, 0, 3);
    this.targetDoorIndex = unitIdx;
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

    for (let i = 0; i < this.doors.length; i++) {
      this.doors[i].doorPivot.rotation.y = 0;
      const label = `${floor}0${i + 1}호`;
      this.doors[i].unitNumber = label;
      const isTarget = i === this.targetDoorIndex;
      this.doors[i].bellLedMat.emissive.setHex(isTarget ? 0x22c55e : 0x38bdf8);
      this.doors[i].bellLedMat.emissiveIntensity = isTarget ? 1.4 : 0.35;

      const oldMap = this.doors[i].plaqueMat.map;
      this.doors[i].plaqueMat.map = this.createPlaqueTexture(
        label,
        isTarget ? '#065f46' : '#1e293b',
        isTarget ? '#a7f3d0' : '#f8fafc'
      );
      this.doors[i].plaqueMat.needsUpdate = true;
      if (oldMap) oldMap.dispose();
    }

    const target = this.doors[this.targetDoorIndex];
    // Mount NPC cleanly inside the target door's local foyer coordinate space!
    target.group.add(this.npcGroup);
    this.npcGroup.position.set(0.05, 0, -0.78);
    this.npcGroup.rotation.set(0, 0, 0);

    this.targetHighlightRing.position.set(target.matX, 0.032, target.matZ);
    this.targetHighlightRing.visible = true;
  }

  public placeFoodOnTargetMat(): void {
    const target = this.doors[this.targetDoorIndex];
    this.foodPlacedOnMat = true;
    this.placedFoodBag.position.set(target.matX, 0.18, target.matZ);
    this.placedFoodBag.rotation.y = target.facingX > 0 ? Math.PI / 2 : -Math.PI / 2;
    this.placedFoodBag.visible = true;
    this.targetHighlightRing.visible = false;
  }

  /** Triggered when player presses [E] at intercom doorbell for MEET_FACE delivery */
  public triggerIntercomRing(): void {
    this.bellFlashTimer = 1.6;
    this.targetHighlightRing.visible = false;
  }

  /** Smoothly pivots target apartment door inward to 70° and brings 3D NPC to doorway */
  public openTargetDoorForNpc(): void {
    this.targetDoorOpenAngle = (70 * Math.PI) / 180; // exactly 70 degrees!
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

  public getTargetDoorMat(): { x: number; z: number; unitNumber: string } {
    const d = this.doors[this.targetDoorIndex];
    return { x: d.matX, z: d.matZ, unitNumber: d.unitNumber };
  }

  public isNearTargetDoor(px: number, pz: number): boolean {
    const d = this.doors[this.targetDoorIndex];
    return Math.hypot(px - d.matX, pz - d.matZ) <= 2.25;
  }

  public isNearElevator(px: number, pz: number): boolean {
    return Math.hypot(px - this.elevatorTrigger.x, pz - this.elevatorTrigger.z) <= this.elevatorTrigger.radius;
  }

  public clampPlayerInside(x: number, z: number): [number, number] {
    return [clamp(x, -2.15, 2.15), clamp(z, -7.4, 7.4)];
  }

  public updateVisual(elapsedTime: number, dt = 0.016): void {
    if (!this.root.visible) return;
    const step = Math.min(1, dt * 5.2);

    if (this.targetHighlightRing.visible) {
      const s = 1 + Math.sin(elapsedTime * 4.5) * 0.08;
      this.targetHighlightRing.scale.set(s, s, 1);
    }

    // Smooth hinged door 70° pivot animation
    const targetDoor = this.doors[this.targetDoorIndex];
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

    // Smooth low-poly NPC doorway step & hand-reach animation
    if (this.npcVisible) {
      this.npcStepCur += (this.npcStepTarget - this.npcStepCur) * Math.min(1, dt * 4.5);
      this.npcArmReachCur += (this.npcArmReachTarget - this.npcArmReachCur) * Math.min(1, dt * 7.0);

      // Step from z=-0.82 (inside foyer) to z=-0.16 (right at open threshold)
      this.npcGroup.position.z = -0.82 + this.npcStepCur * 0.66;
      // Rotate right arm forward (-X rotation raises arm toward +Z toward player!)
      this.npcRightArmPivot.rotation.x = -this.npcArmReachCur * 1.18;
    }
  }
}
