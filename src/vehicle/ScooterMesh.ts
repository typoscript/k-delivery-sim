import * as THREE from 'three';
import { SCOOTER_SPECS, ScooterState } from './ScooterPhysics';

export class ScooterMesh {
  public readonly root = new THREE.Group();
  private readonly bodyTiltGroup = new THREE.Group();
  private readonly handlebarGroup = new THREE.Group();
  private readonly frontWheel: THREE.Object3D;
  private readonly rearWheel: THREE.Object3D;
  private readonly kickstandGroup = new THREE.Group();
  private readonly cargoLidPivot = new THREE.Group();
  private readonly cargoSlotLedMats: THREE.MeshStandardMaterial[] = [];
  private readonly cargoSlotBags: THREE.Mesh[] = [];
  private cargoSlotOccupied: [boolean, boolean, boolean] = [false, false, false];
  private cargoLidTimer = 0;
  private readonly mountedPhone3D = new THREE.Group();
  public readonly mountedPhoneHitMesh: THREE.Mesh;
  public readonly riderMountPoint = new THREE.Group();

  // Live Rear-View Side Mirror Render Targets & Cameras
  private readonly leftMirrorRT: THREE.WebGLRenderTarget;
  private readonly rightMirrorRT: THREE.WebGLRenderTarget;
  private readonly leftMirrorCam: THREE.PerspectiveCamera;
  private readonly rightMirrorCam: THREE.PerspectiveCamera;
  private readonly leftMirrorAnchor = new THREE.Object3D();
  private readonly rightMirrorAnchor = new THREE.Object3D();
  private readonly mirrorGlassMeshes: THREE.Mesh[] = [];
  private readonly tmpMirrorPos = new THREE.Vector3();
  private readonly tmpMirrorTarget = new THREE.Vector3();

  private readonly headlightSpot: THREE.SpotLight;
  private readonly headlightMat: THREE.MeshStandardMaterial;
  private readonly brakeLightMat: THREE.MeshStandardMaterial;
  private readonly leftBlinkerMat: THREE.MeshStandardMaterial;
  private readonly rightBlinkerMat: THREE.MeshStandardMaterial;
  private readonly dashLeftLedMat: THREE.MeshStandardMaterial;
  private readonly dashRightLedMat: THREE.MeshStandardMaterial;
  private readonly leftBlinkerGlow: THREE.PointLight;
  private readonly rightBlinkerGlow: THREE.PointLight;

  constructor(scene: THREE.Scene, phoneScreenTexture: THREE.CanvasTexture) {
    this.headlightMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      emissive: 0xfffbeb,
      emissiveIntensity: 0.2,
    });
    this.brakeLightMat = new THREE.MeshStandardMaterial({
      color: 0x7f1d1d,
      emissive: 0xef4444,
      emissiveIntensity: 0.2,
    });
    this.leftBlinkerMat = new THREE.MeshStandardMaterial({
      color: 0x78350f,
      emissive: 0xf59e0b,
      emissiveIntensity: 0,
    });
    this.rightBlinkerMat = new THREE.MeshStandardMaterial({
      color: 0x78350f,
      emissive: 0xf59e0b,
      emissiveIntensity: 0,
    });
    this.dashLeftLedMat = new THREE.MeshStandardMaterial({
      color: 0x14532d,
      emissive: 0x22c55e,
      emissiveIntensity: 0.08,
    });
    this.dashRightLedMat = new THREE.MeshStandardMaterial({
      color: 0x14532d,
      emissive: 0x22c55e,
      emissiveIntensity: 0.08,
    });
    for (let i = 0; i < 3; i++) {
      this.cargoSlotLedMats.push(
        new THREE.MeshStandardMaterial({
          color: 0x0f172a,
          emissive: 0x10b981,
          emissiveIntensity: 0,
        })
      );
    }

    // Setup real-time side mirror render targets (horizontally flipped for true reflection!)
    const mirrorOpts: THREE.RenderTargetOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    };
    this.leftMirrorRT = new THREE.WebGLRenderTarget(256, 160, mirrorOpts);
    this.leftMirrorRT.texture.wrapS = THREE.RepeatWrapping;
    this.leftMirrorRT.texture.repeat.set(-1, 1);
    this.leftMirrorRT.texture.offset.set(1, 0);

    this.rightMirrorRT = new THREE.WebGLRenderTarget(256, 160, mirrorOpts);
    this.rightMirrorRT.texture.wrapS = THREE.RepeatWrapping;
    this.rightMirrorRT.texture.repeat.set(-1, 1);
    this.rightMirrorRT.texture.offset.set(1, 0);

    this.leftMirrorCam = new THREE.PerspectiveCamera(62, 256 / 160, 0.25, 280);
    this.rightMirrorCam = new THREE.PerspectiveCamera(62, 256 / 160, 0.25, 280);

    this.root.add(this.bodyTiltGroup);

    const bodyPaint = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.3,
      metalness: 0.25,
    });
    const accentPaint = new THREE.MeshStandardMaterial({
      color: 0x0ea5e9,
      roughness: 0.35,
      metalness: 0.2,
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x1e242c,
      roughness: 0.72,
      metalness: 0.2,
    });
    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      roughness: 0.22,
      metalness: 0.85,
    });
    const boxMat = new THREE.MeshStandardMaterial({
      color: 0x14b8a6,
      roughness: 0.42,
      metalness: 0.1,
    });

    // --- Rear Wheel (at z = 0) ---
    this.rearWheel = this.createWheel();
    this.rearWheel.position.set(0, SCOOTER_SPECS.wheelRadius, 0);
    this.bodyTiltGroup.add(this.rearWheel);

    // --- Main Scooter Frame & Floorboard ---
    const floorboard = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.12, 1.05), darkMat);
    floorboard.position.set(0, 0.34, 0.65);
    floorboard.castShadow = true;
    this.bodyTiltGroup.add(floorboard);

    const rearBody = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.36, 0.86), bodyPaint);
    rearBody.position.set(0, 0.58, 0.12);
    rearBody.castShadow = true;
    this.bodyTiltGroup.add(rearBody);

    const sideTrim = new THREE.Mesh(new THREE.BoxGeometry(0.49, 0.1, 0.76), accentPaint);
    sideTrim.position.set(0, 0.58, 0.14);
    this.bodyTiltGroup.add(sideTrim);

    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.76), darkMat);
    seat.position.set(0, 0.82, 0.22);
    seat.castShadow = true;
    this.bodyTiltGroup.add(seat);

    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.62, 10), chromeMat);
    exhaust.rotation.x = Math.PI / 2 - 0.16;
    exhaust.position.set(-0.27, 0.36, 0.08);
    this.bodyTiltGroup.add(exhaust);

    // --- Rear Delivery Thermal Box ---
    const rack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.48), darkMat);
    rack.position.set(0, 0.88, -0.34);
    this.bodyTiltGroup.add(rack);

    const deliveryBox = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.48, 0.52), boxMat);
    deliveryBox.position.set(0, 1.14, -0.36);
    deliveryBox.castShadow = true;
    deliveryBox.receiveShadow = true;
    this.bodyTiltGroup.add(deliveryBox);

    // Hinged top lid pivot at front edge of delivery box (z = -0.10, y = 1.38)
    this.cargoLidPivot.position.set(0, 1.38, -0.1);
    const boxLid = new THREE.Mesh(new THREE.BoxGeometry(0.59, 0.07, 0.55), darkMat);
    boxLid.position.set(0, 0.02, -0.26);
    this.cargoLidPivot.add(boxLid);

    // 3-Slot Cargo Status LED Bars on rear lid edge (Slot 1 left -> Slot 3 right)
    const ledSlotGeo = new THREE.BoxGeometry(0.11, 0.036, 0.03);
    for (let i = 0; i < 3; i++) {
      const slotLed = new THREE.Mesh(ledSlotGeo, this.cargoSlotLedMats[i]);
      slotLed.position.set((1 - i) * 0.145, 0.02, -0.54);
      this.cargoLidPivot.add(slotLed);
    }
    this.bodyTiltGroup.add(this.cargoLidPivot);

    // 3 interior cargo slot food bag indicators (visible only while lid is open & slot occupied)
    const bagGeo = new THREE.BoxGeometry(0.135, 0.22, 0.34);
    const bagMat = new THREE.MeshStandardMaterial({ color: 0xd9a96f, roughness: 0.85 });
    for (let i = 0; i < 3; i++) {
      const bag = new THREE.Mesh(bagGeo, bagMat);
      bag.position.set((1 - i) * 0.16, 1.29, -0.36);
      bag.visible = false;
      this.cargoSlotBags.push(bag);
      this.bodyTiltGroup.add(bag);
    }

    const reflectMat = new THREE.MeshStandardMaterial({
      color: 0xfef08a,
      emissive: 0xfacc15,
      emissiveIntensity: 0.4,
    });
    const reflectStrip = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.02), reflectMat);
    reflectStrip.position.set(0, 1.15, -0.63);
    this.bodyTiltGroup.add(reflectStrip);

    // Rear tail/brake light & blinkers
    const tailLight = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, 0.06), this.brakeLightMat);
    tailLight.position.set(0, 0.64, -0.33);
    this.bodyTiltGroup.add(tailLight);

    const rearLeftBlink = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.08, 0.06), this.leftBlinkerMat);
    rearLeftBlink.position.set(0.19, 0.64, -0.33);
    this.bodyTiltGroup.add(rearLeftBlink);

    const rearRightBlink = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.08, 0.06), this.rightBlinkerMat);
    rearRightBlink.position.set(-0.19, 0.64, -0.33);
    this.bodyTiltGroup.add(rearRightBlink);

    // --- Front Fairing & Leg Shield ---
    const frontShield = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.72, 0.34), bodyPaint);
    frontShield.position.set(0, 0.74, 1.18);
    frontShield.rotation.x = -0.22;
    frontShield.castShadow = true;
    this.bodyTiltGroup.add(frontShield);

    const noseAccent = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.34, 0.12), accentPaint);
    noseAccent.position.set(0, 0.8, 1.33);
    noseAccent.rotation.x = -0.22;
    this.bodyTiltGroup.add(noseAccent);

    // Headlight & front blinkers
    const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.13, 0.08), this.headlightMat);
    headlight.position.set(0, 0.78, 1.38);
    this.bodyTiltGroup.add(headlight);

    const frontLeftBlink = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.08, 0.06), this.leftBlinkerMat);
    frontLeftBlink.position.set(0.21, 0.76, 1.36);
    this.bodyTiltGroup.add(frontLeftBlink);

    const frontRightBlink = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.08, 0.06), this.rightBlinkerMat);
    frontRightBlink.position.set(-0.21, 0.76, 1.36);
    this.bodyTiltGroup.add(frontRightBlink);

    this.headlightSpot = new THREE.SpotLight(0xfff7e0, 0, 55, Math.PI / 4, 0.55, 1.2);
    this.headlightSpot.position.set(0, 0.82, 1.44);
    const spotTarget = new THREE.Object3D();
    spotTarget.position.set(0, -0.6, 18);
    this.bodyTiltGroup.add(spotTarget);
    this.headlightSpot.target = spotTarget;
    this.bodyTiltGroup.add(this.headlightSpot);

    // --- Steerable Front Fork + Handlebars + Live Side Mirrors + Dashboard Blinker LEDs ---
    this.handlebarGroup.position.set(0, 0, SCOOTER_SPECS.wheelbase);
    this.bodyTiltGroup.add(this.handlebarGroup);

    this.frontWheel = this.createWheel();
    this.frontWheel.position.set(0, SCOOTER_SPECS.wheelRadius, 0);
    this.handlebarGroup.add(this.frontWheel);

    for (const side of [-1, 1]) {
      const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.78, 8), chromeMat);
      fork.position.set(side * 0.11, 0.62, -0.08);
      fork.rotation.x = -0.22;
      this.handlebarGroup.add(fork);
    }

    const fender = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.42), bodyPaint);
    fender.position.set(0, 0.6, 0.02);
    this.handlebarGroup.add(fender);

    // Instrument dash pod (visible directly in 1st-person!)
    const barCenter = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.11, 0.18), darkMat);
    barCenter.position.set(0, 1.12, -0.21);
    this.handlebarGroup.add(barCenter);

    // 1st-Person Dashboard Blinker Indicator LEDs (◀ Left / ▶ Right)
    const ledGeo = new THREE.BoxGeometry(0.055, 0.024, 0.014);
    const leftDashLed = new THREE.Mesh(ledGeo, this.dashLeftLedMat);
    leftDashLed.position.set(0.1, 1.165, -0.295);
    leftDashLed.rotation.x = -0.35;
    const rightDashLed = new THREE.Mesh(ledGeo, this.dashRightLedMat);
    rightDashLed.position.set(-0.1, 1.165, -0.295);
    rightDashLed.rotation.x = -0.35;
    this.handlebarGroup.add(leftDashLed, rightDashLed);

    const handleBar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.78, 8), chromeMat);
    handleBar.rotation.z = Math.PI / 2;
    handleBar.position.set(0, 1.12, -0.22);
    this.handlebarGroup.add(handleBar);

    // Subtle amber glow lights for left & right turn signals
    this.leftBlinkerGlow = new THREE.PointLight(0xf59e0b, 0, 5.5);
    this.leftBlinkerGlow.position.set(0.42, 1.12, -0.15);
    this.rightBlinkerGlow = new THREE.PointLight(0xf59e0b, 0, 5.5);
    this.rightBlinkerGlow.position.set(-0.42, 1.12, -0.15);
    this.handlebarGroup.add(this.leftBlinkerGlow, this.rightBlinkerGlow);

    for (const side of [-1, 1]) {
      const isLeft = side === 1;
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 8), darkMat);
      grip.rotation.z = Math.PI / 2;
      grip.position.set(side * 0.35, 1.12, -0.22);
      this.handlebarGroup.add(grip);

      // Bar-end amber turn signal pod visible in 1st-person periphery!
      const barEndLamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.032, 10, 8),
        isLeft ? this.leftBlinkerMat : this.rightBlinkerMat
      );
      barEndLamp.position.set(side * 0.44, 1.12, -0.22);
      this.handlebarGroup.add(barEndLamp);

      // --- Real-Time Working Side Mirrors (positioned clearly in 1st-person view!) ---
      const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.25, 8), darkMat);
      stalk.position.set(side * 0.31, 1.24, -0.21);
      stalk.rotation.z = -side * 0.42;
      this.handlebarGroup.add(stalk);

      // Mirror head assembly angled cleanly toward driver's 1st-person eyes
      const mirrorHead = new THREE.Group();
      mirrorHead.position.set(side * 0.41, 1.355, -0.21);
      // Slight inward yaw toward center driver eye & upward tilt
      mirrorHead.rotation.y = side * 0.22;
      mirrorHead.rotation.x = 0.12;

      // Mirror back housing & chrome rim
      const housing = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.145, 0.026), darkMat);
      const rim = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.155, 0.012), chromeMat);
      rim.position.z = -0.01;
      mirrorHead.add(housing, rim);

      // Live Rear-View Mirror Glass Plane facing driver (-Z local)
      const rt = isLeft ? this.leftMirrorRT : this.rightMirrorRT;
      const mirrorGlassMat = new THREE.MeshBasicMaterial({
        map: rt.texture,
        toneMapped: false,
      });
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.128), mirrorGlassMat);
      glass.position.z = -0.018;
      glass.rotation.y = Math.PI; // face driver (-Z)
      mirrorHead.add(glass);
      this.mirrorGlassMeshes.push(glass);

      // Anchor point for the rear-facing mirror camera
      const anchor = isLeft ? this.leftMirrorAnchor : this.rightMirrorAnchor;
      anchor.position.set(side * 0.04, 0, -0.08);
      mirrorHead.add(anchor);

      this.handlebarGroup.add(mirrorHead);
    }

    // Clear mini windshield
    const screenMat = new THREE.MeshStandardMaterial({
      color: 0xbae6fd,
      roughness: 0.1,
      metalness: 0.2,
      transparent: true,
      opacity: 0.32,
    });
    const windscreen = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.32, 0.03), screenMat);
    windscreen.position.set(0, 1.31, -0.08);
    windscreen.rotation.x = -0.32;
    this.handlebarGroup.add(windscreen);

    // Handlebar Smartphone Mount Cradle
    const mountClampMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.7 });
    const cradleStem = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.1, 6), mountClampMat);
    cradleStem.position.set(0, 1.2, -0.19);
    const cradleBack = new THREE.Mesh(new THREE.BoxGeometry(0.165, 0.25, 0.02), mountClampMat);
    cradleBack.position.set(0, 1.3, -0.175);
    cradleBack.rotation.x = -0.34;
    for (const side of [-1, 1]) {
      const claw = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.065, 0.036), mountClampMat);
      claw.position.set(side * 0.088, 1.3, -0.182);
      claw.rotation.x = -0.34;
      this.handlebarGroup.add(claw);
    }
    this.handlebarGroup.add(cradleStem, cradleBack);

    // 3D Smartphone placed inside handlebar cradle with LIVE GPS map texture!
    this.mountedPhone3D.position.set(0, 1.305, -0.192);
    this.mountedPhone3D.rotation.x = -0.34;
    const phoneBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.156, 0.272, 0.015),
      new THREE.MeshStandardMaterial({ color: 0x1e2530, roughness: 0.3, metalness: 0.55 })
    );
    const phoneScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.144, 0.258),
      new THREE.MeshBasicMaterial({
        map: phoneScreenTexture,
        toneMapped: false,
      })
    );
    phoneScreen.position.z = -0.0085;
    phoneScreen.rotation.y = Math.PI;
    this.mountedPhoneHitMesh = phoneScreen;
    this.mountedPhone3D.add(phoneBody, phoneScreen);
    this.mountedPhone3D.visible = false;
    this.handlebarGroup.add(this.mountedPhone3D);

    // Kickstand
    this.kickstandGroup.position.set(0.2, 0.28, 0.45);
    const standLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.34, 6), darkMat);
    standLeg.position.set(0.06, -0.15, -0.02);
    standLeg.rotation.z = 0.35;
    this.kickstandGroup.add(standLeg);
    this.bodyTiltGroup.add(this.kickstandGroup);

    this.riderMountPoint.position.set(0, 0.86, 0.28);
    this.bodyTiltGroup.add(this.riderMountPoint);

    scene.add(this.root);
  }

  private createWheel(): THREE.Group {
    const g = new THREE.Group();
    const r = SCOOTER_SPECS.wheelRadius;
    const width = 0.13;

    const tireGeo = new THREE.CylinderGeometry(r, r, width, 18);
    tireGeo.rotateZ(Math.PI / 2);
    const tire = new THREE.Mesh(
      tireGeo,
      new THREE.MeshStandardMaterial({ color: 0x181c22, roughness: 0.9 })
    );
    tire.castShadow = true;
    g.add(tire);

    const rimGeo = new THREE.CylinderGeometry(r * 0.62, r * 0.62, width + 0.015, 14);
    rimGeo.rotateZ(Math.PI / 2);
    const rim = new THREE.Mesh(
      rimGeo,
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.7, roughness: 0.3 })
    );
    g.add(rim);

    const spoke = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.03, r * 1.0, 0.045),
      new THREE.MeshStandardMaterial({ color: 0x334155 })
    );
    g.add(spoke);

    return g;
  }

  public setPhoneMounted(mounted: boolean): void {
    this.mountedPhone3D.visible = mounted;
  }

  public triggerCargoBoxOpen(): void {
    this.cargoLidTimer = 1.15;
  }

  public setCargoSlotsVisual(occupied: [boolean, boolean, boolean]): void {
    this.cargoSlotOccupied = occupied;
    for (let i = 0; i < 3; i++) {
      this.cargoSlotLedMats[i].emissiveIntensity = occupied[i] ? 2.5 : 0;
    }
  }

  public getCargoBoxWorldPosition(out: THREE.Vector3): THREE.Vector3 {
    // Trigger spot right behind the rear delivery top-box
    out.set(0, 0.8, -0.95);
    return this.root.localToWorld(out);
  }

  public sync(state: ScooterState, elapsedTime: number, dt = 0.016): void {
    if (this.cargoLidTimer > 0) {
      this.cargoLidTimer = Math.max(0, this.cargoLidTimer - dt);
    }
    const targetLidRot = this.cargoLidTimer > 0 ? 1.15 : 0;
    this.cargoLidPivot.rotation.x += (targetLidRot - this.cargoLidPivot.rotation.x) * Math.min(1, dt * 10);
    const lidVisibleOpen = this.cargoLidPivot.rotation.x > 0.12;
    for (let i = 0; i < 3; i++) {
      this.cargoSlotBags[i].visible = lidVisibleOpen && this.cargoSlotOccupied[i];
    }
    const fallenOffset = state.crashed ? 0.24 : 0;
    this.root.position.set(state.x, fallenOffset, state.z);
    this.root.rotation.y = state.heading;

    this.bodyTiltGroup.rotation.z = state.leanAngle;
    this.bodyTiltGroup.rotation.x = state.pitchAngle;

    this.handlebarGroup.rotation.y = state.steerAngle;
    this.frontWheel.rotation.x = state.wheelSpin;
    this.rearWheel.rotation.x = state.wheelSpin;

    this.kickstandGroup.rotation.x = state.mounted || state.crashed ? 1.25 : 0;

    // Lights
    this.headlightSpot.intensity = state.headlights && !state.crashed ? 55 : 0;
    this.headlightMat.emissiveIntensity = state.headlights ? 2.5 : state.mounted ? 0.5 : 0.1;
    this.brakeLightMat.emissiveIntensity = state.braking ? 2.6 : state.headlights ? 0.7 : 0.15;

    const blinkOn = Math.floor(elapsedTime * 2.5) % 2 === 0;
    const leftActive = (state.leftBlinker || state.hazard) && blinkOn;
    const rightActive = (state.rightBlinker || state.hazard) && blinkOn;

    this.leftBlinkerMat.emissiveIntensity = leftActive ? 3.2 : 0;
    this.rightBlinkerMat.emissiveIntensity = rightActive ? 3.2 : 0;
    this.dashLeftLedMat.emissiveIntensity = leftActive ? 3.4 : 0.06;
    this.dashRightLedMat.emissiveIntensity = rightActive ? 3.4 : 0.06;
    this.leftBlinkerGlow.intensity = leftActive ? 2.2 : 0;
    this.rightBlinkerGlow.intensity = rightActive ? 2.2 : 0;
  }

  /**
   * Renders live rear views into both left & right handlebar side mirror textures!
   * Only runs while mounted on the scooter so on-foot performance is untouched.
   */
  public renderMirrors(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    state: ScooterState
  ): void {
    if (!state.mounted || state.crashed) return;

    this.root.updateMatrixWorld(true);

    const backX = -Math.sin(state.heading);
    const backZ = -Math.cos(state.heading);
    const leftX = Math.cos(state.heading);
    const leftZ = -Math.sin(state.heading);

    // Temporarily hide mirror glass planes to avoid sampling the RenderTarget while rendering to it
    for (const m of this.mirrorGlassMeshes) m.visible = false;

    const prevTarget = renderer.getRenderTarget();

    // Left mirror camera: rear + slight outward-left view (shows left lane behind rider!)
    this.leftMirrorAnchor.getWorldPosition(this.tmpMirrorPos);
    this.leftMirrorCam.position.copy(this.tmpMirrorPos);
    this.tmpMirrorTarget.set(
      this.tmpMirrorPos.x + (backX + leftX * 0.22) * 25,
      this.tmpMirrorPos.y - 1.1,
      this.tmpMirrorPos.z + (backZ + leftZ * 0.22) * 25
    );
    this.leftMirrorCam.up.set(0, 1, 0);
    this.leftMirrorCam.lookAt(this.tmpMirrorTarget);
    renderer.setRenderTarget(this.leftMirrorRT);
    renderer.render(scene, this.leftMirrorCam);

    // Right mirror camera: rear + slight outward-right view (shows right lane & curb behind rider!)
    this.rightMirrorAnchor.getWorldPosition(this.tmpMirrorPos);
    this.rightMirrorCam.position.copy(this.tmpMirrorPos);
    this.tmpMirrorTarget.set(
      this.tmpMirrorPos.x + (backX - leftX * 0.22) * 25,
      this.tmpMirrorPos.y - 1.1,
      this.tmpMirrorPos.z + (backZ - leftZ * 0.22) * 25
    );
    this.rightMirrorCam.up.set(0, 1, 0);
    this.rightMirrorCam.lookAt(this.tmpMirrorTarget);
    renderer.setRenderTarget(this.rightMirrorRT);
    renderer.render(scene, this.rightMirrorCam);

    renderer.setRenderTarget(prevTarget);
    for (const m of this.mirrorGlassMeshes) m.visible = true;
  }

  public getFirstPersonEyeWorld(out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 1.56, 0.45);
    return this.bodyTiltGroup.localToWorld(out);
  }
}
