import * as THREE from 'three';
import { SCOOTER_SPECS, ScooterState } from './ScooterPhysics';
import {
  SCOOTER_MODELS,
  SCOOTER_PAINTS,
  ScooterModelId,
  ScooterPaintId,
} from './ScooterModels';


/** Side mirror view distance */
const MIRROR_FAR_M = 150;
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
  private mirrorFrame = 0;
  private readonly rightMirrorCam: THREE.PerspectiveCamera;
  private readonly leftMirrorAnchor = new THREE.Object3D();
  private readonly rightMirrorAnchor = new THREE.Object3D();
  private readonly mirrorGlassMeshes: THREE.Mesh[] = [];
  private readonly mirrorHeads: Array<{ group: THREE.Group; side: number }> = [];
  private readonly tmpMirrorPos = new THREE.Vector3();
  private readonly tmpMirrorTarget = new THREE.Vector3();

  // 3D Handlebar Instrument Cluster (Fuel Gauge & Low-Fuel Warning LED)
  private readonly dashCanvas: HTMLCanvasElement;
  private readonly dashCtx: CanvasRenderingContext2D;
  private readonly dashTex: THREE.CanvasTexture;
  private readonly dashFuelWarnLedMat: THREE.MeshStandardMaterial;
  private lastDashDrawTime = -1;

  private readonly headlightSpot: THREE.SpotLight;
  private readonly headlightFill: THREE.PointLight;
  private readonly headlightConeMesh: THREE.Mesh;
  private readonly headlightConeMat: THREE.MeshBasicMaterial;
  private readonly brakeGlowLight: THREE.PointLight;
  private readonly headlightMat: THREE.MeshStandardMaterial;
  private readonly brakeLightMat: THREE.MeshStandardMaterial;
  private readonly leftBlinkerMat: THREE.MeshStandardMaterial;
  private readonly rightBlinkerMat: THREE.MeshStandardMaterial;
  private readonly dashLeftLedMat: THREE.MeshStandardMaterial;
  private readonly dashRightLedMat: THREE.MeshStandardMaterial;
  private readonly leftBlinkerGlow: THREE.PointLight;
  private readonly rightBlinkerGlow: THREE.PointLight;

  // Dynamic bike model & custom paint materials / trim groups (PCX / Super Cub / Electric EV-PRO)
  private readonly bodyPaintMat: THREE.MeshStandardMaterial;
  private readonly accentPaintMat: THREE.MeshStandardMaterial;
  private readonly seatMat: THREE.MeshStandardMaterial;
  private readonly boxMat: THREE.MeshStandardMaterial;
  private readonly exhaustMesh: THREE.Mesh;
  private readonly pcxTrimGroup = new THREE.Group();
  private readonly cubTrimGroup = new THREE.Group();
  private readonly evTrimGroup = new THREE.Group();

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
    this.dashFuelWarnLedMat = new THREE.MeshStandardMaterial({
      color: 0x450a0a,
      emissive: 0xef4444,
      emissiveIntensity: 0.05,
    });

    this.dashCanvas = document.createElement('canvas');
    this.dashCanvas.width = 256;
    this.dashCanvas.height = 96;
    this.dashCtx = this.dashCanvas.getContext('2d')!;
    this.dashTex = new THREE.CanvasTexture(this.dashCanvas);
    this.dashTex.colorSpace = THREE.SRGBColorSpace;
    this.dashTex.minFilter = THREE.LinearFilter;
    this.dashTex.magFilter = THREE.LinearFilter;
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

    // 150m is plenty for a 256px mirror and lets frustum culling drop far chunks
    this.leftMirrorCam = new THREE.PerspectiveCamera(62, 256 / 160, 0.25, MIRROR_FAR_M);
    this.rightMirrorCam = new THREE.PerspectiveCamera(62, 256 / 160, 0.25, MIRROR_FAR_M);

    this.root.add(this.bodyTiltGroup);

    this.bodyPaintMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.3,
      metalness: 0.25,
    });
    const bodyPaint = this.bodyPaintMat;
    this.accentPaintMat = new THREE.MeshStandardMaterial({
      color: 0x0ea5e9,
      roughness: 0.35,
      metalness: 0.2,
    });
    const accentPaint = this.accentPaintMat;
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x1e242c,
      roughness: 0.72,
      metalness: 0.2,
    });
    this.seatMat = new THREE.MeshStandardMaterial({
      color: 0x1e242c,
      roughness: 0.72,
      metalness: 0.15,
    });
    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      roughness: 0.22,
      metalness: 0.85,
    });
    this.boxMat = new THREE.MeshStandardMaterial({
      color: 0x14b8a6,
      roughness: 0.42,
      metalness: 0.1,
    });
    const boxMat = this.boxMat;

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

    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.76), this.seatMat);
    seat.position.set(0, 0.82, 0.22);
    seat.castShadow = true;
    this.bodyTiltGroup.add(seat);

    this.exhaustMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.62, 10), chromeMat);
    this.exhaustMesh.rotation.x = Math.PI / 2 - 0.16;
    this.exhaustMesh.position.set(-0.27, 0.36, 0.08);
    this.bodyTiltGroup.add(this.exhaustMesh);

    // --- Model-Specific 3D Trim Kits (Visible in both 3D & 1st-Person Handlebar View!) ---
    // 1) PCX 125 Trim: Tall sporty smoked windscreen & sharp fairing winglets
    const pcxScreenMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      transparent: true,
      opacity: 0.46,
      roughness: 0.12,
      metalness: 0.3,
    });
    const pcxScreen = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.34, 0.025), pcxScreenMat);
    pcxScreen.position.set(0, 1.24, 1.24);
    pcxScreen.rotation.x = -0.45;
    this.pcxTrimGroup.add(pcxScreen);
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, 0.34), accentPaint);
      wing.position.set(s * 0.26, 0.78, 1.08);
      this.pcxTrimGroup.add(wing);
    }
    this.bodyTiltGroup.add(this.pcxTrimGroup);

    // 2) Classic Super Cub 110 Trim: Retro cream leg-shield wings + chrome round headlight bezel + luggage bar
    const retroCreamMat = new THREE.MeshStandardMaterial({ color: 0xfef9c3, roughness: 0.42 });
    for (const s of [-1, 1]) {
      const legWing = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.56, 0.1), retroCreamMat);
      legWing.position.set(s * 0.28, 0.66, 1.12);
      legWing.rotation.y = s * 0.35;
      this.cubTrimGroup.add(legWing);
    }
    const roundLampRim = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.14, 16), chromeMat);
    roundLampRim.rotation.x = Math.PI / 2;
    roundLampRim.position.set(0, 1.14, 1.3);
    const roundLampGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.088, 0.15, 16), this.headlightMat);
    roundLampGlass.rotation.x = Math.PI / 2;
    roundLampGlass.position.set(0, 1.14, 1.31);
    const frontBasket = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.2), chromeMat);
    frontBasket.position.set(0, 0.9, 1.43);
    this.cubTrimGroup.add(roundLampRim, roundLampGlass, frontBasket);
    this.cubTrimGroup.visible = false;
    this.bodyTiltGroup.add(this.cubTrimGroup);

    // 3) High-Output Electric EV-PRO Trim: Cyber-cyan LED lightbar + glowing battery frame bars + aero visor
    const evCyanMat = new THREE.MeshStandardMaterial({
      color: 0x22d3ee,
      emissive: 0x06b6d4,
      emissiveIntensity: 1.8,
      roughness: 0.2,
    });
    const evLightBar = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.055, 0.08), evCyanMat);
    evLightBar.position.set(0, 0.94, 1.38);
    const evVisor = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.03), darkMat);
    evVisor.position.set(0, 1.24, 1.24);
    evVisor.rotation.x = -0.62;
    for (const s of [-1, 1]) {
      const battBar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.84), evCyanMat);
      battBar.position.set(s * 0.255, 0.42, 0.56);
      this.evTrimGroup.add(battBar);
    }
    this.evTrimGroup.add(evLightBar, evVisor);
    this.evTrimGroup.visible = false;
    this.bodyTiltGroup.add(this.evTrimGroup);

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

    // Rear brake tail-light red glow (reflects onto dark/wet asphalt in side mirrors when braking!)
    this.brakeGlowLight = new THREE.PointLight(0xef4444, 0, 11, 1.5);
    this.brakeGlowLight.position.set(0, 0.66, -0.58);
    this.bodyTiltGroup.add(this.brakeGlowLight);

    // High-power steering-aware 3D Headlight SpotLight + Close Road Fill + Volumetric Beam Cone!
    this.headlightSpot = new THREE.SpotLight(0xfff7e0, 0, 82, Math.PI / 3.4, 0.62, 1.05);
    this.headlightSpot.position.set(0, 0.88, 1.44);
    const spotTarget = new THREE.Object3D();
    spotTarget.position.set(0, -0.75, 22);
    this.bodyTiltGroup.add(spotTarget);
    this.headlightSpot.target = spotTarget;
    this.bodyTiltGroup.add(this.headlightSpot);

    this.headlightFill = new THREE.PointLight(0xfff7e0, 0, 16, 1.4);
    this.headlightFill.position.set(0, 0.9, 3.2);
    this.bodyTiltGroup.add(this.headlightFill);

    this.headlightConeMat = new THREE.MeshBasicMaterial({
      color: 0xfff8dc,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const coneGeo = new THREE.ConeGeometry(3.4, 15.5, 18, 1, true);
    coneGeo.translate(0, -7.75, 0);
    coneGeo.rotateX(Math.PI / 2 + 0.06);
    this.headlightConeMesh = new THREE.Mesh(coneGeo, this.headlightConeMat);
    this.headlightConeMesh.position.set(0, 0.82, 1.42);
    this.headlightConeMesh.visible = false;
    this.bodyTiltGroup.add(this.headlightConeMesh);

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

    // 1st-Person Dashboard Blinker Indicator LEDs (◀ Left / ▶ Right) + Digital Fuel Gauge LCD + Low-Fuel LED!
    const ledGeo = new THREE.BoxGeometry(0.055, 0.024, 0.014);
    const leftDashLed = new THREE.Mesh(ledGeo, this.dashLeftLedMat);
    leftDashLed.position.set(0.115, 1.168, -0.295);
    leftDashLed.rotation.x = -0.35;
    const rightDashLed = new THREE.Mesh(ledGeo, this.dashRightLedMat);
    rightDashLed.position.set(-0.115, 1.168, -0.295);
    rightDashLed.rotation.x = -0.35;

    const dashScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.205, 0.076),
      new THREE.MeshBasicMaterial({ map: this.dashTex, toneMapped: false })
    );
    dashScreen.position.set(0, 1.165, -0.299);
    dashScreen.rotation.y = Math.PI;
    dashScreen.rotation.x = 0.35;

    const fuelWarnLed = new THREE.Mesh(
      new THREE.BoxGeometry(0.032, 0.018, 0.014),
      this.dashFuelWarnLedMat
    );
    fuelWarnLed.position.set(0, 1.19, -0.29);
    fuelWarnLed.rotation.x = -0.35;

    this.handlebarGroup.add(leftDashLed, rightDashLed, dashScreen, fuelWarnLed);

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

      this.mirrorHeads.push({ group: mirrorHead, side });
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

  public sync(
    state: ScooterState,
    elapsedTime: number,
    dt = 0.016,
    isNight = false,
    rainIntensity = 0
  ): void {
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

    // Real Road-Illuminating 3D Headlight Beam (sweeps into turns!) & Brake Tail-Light Glow
    const beamOn = state.headlights && !state.crashed;
    const beamHex =
      state.modelId === 'electric' ? 0xd8f3ff : state.modelId === 'cub' ? 0xffe8b6 : 0xfff8e2;
    this.headlightSpot.color.setHex(beamHex);
    this.headlightFill.color.setHex(beamHex);
    this.headlightConeMat.color.setHex(beamHex);

    // Aim headlight beam smoothly in the steering direction so dark corners light up!
    const steerSweepX = Math.sin(state.steerAngle) * 9.5;
    this.headlightSpot.target.position.set(steerSweepX, -0.75, 22);
    this.headlightSpot.intensity = beamOn ? (isNight ? 155 : 48) : 0;
    this.headlightFill.intensity = beamOn && isNight ? 14 : 0;

    const showCone = beamOn && (isNight || rainIntensity > 0.25);
    this.headlightConeMesh.visible = showCone;
    if (showCone) {
      this.headlightConeMesh.rotation.y = state.steerAngle * 0.55;
      this.headlightConeMat.opacity = isNight ? 0.085 + rainIntensity * 0.065 : rainIntensity * 0.045;
    }

    this.headlightMat.emissiveIntensity = state.headlights ? 3.0 : state.mounted ? 0.5 : 0.1;
    this.brakeLightMat.emissiveIntensity = state.braking ? 3.6 : state.headlights ? 0.95 : 0.15;
    this.brakeGlowLight.intensity = !state.crashed && isNight ? (state.braking ? 13 : state.headlights ? 2.4 : 0) : 0;

    const blinkOn = Math.floor(elapsedTime * 2.5) % 2 === 0;
    const leftActive = (state.leftBlinker || state.hazard) && blinkOn;
    const rightActive = (state.rightBlinker || state.hazard) && blinkOn;

    this.leftBlinkerMat.emissiveIntensity = leftActive ? 3.2 : 0;
    this.rightBlinkerMat.emissiveIntensity = rightActive ? 3.2 : 0;
    this.dashLeftLedMat.emissiveIntensity = leftActive ? 3.4 : 0.06;
    this.dashRightLedMat.emissiveIntensity = rightActive ? 3.4 : 0.06;
    this.leftBlinkerGlow.intensity = leftActive ? 2.2 : 0;
    this.rightBlinkerGlow.intensity = rightActive ? 2.2 : 0;

    // Low-fuel flashing red warning LED on 3D dashboard (<= 10% fuel)
    const fuelWarnBlink = state.lowFuelWarning && Math.floor(elapsedTime * 4.0) % 2 === 0;
    this.dashFuelWarnLedMat.emissiveIntensity = fuelWarnBlink ? 3.8 : state.lowFuelWarning ? 0.6 : 0.04;

    // Exterior crash damage visual: crooked & vibrating side mirrors!
    const speedVib = 0.35 + Math.min(Math.abs(state.speed) / 14, 1) * 0.9;
    for (const mh of this.mirrorHeads) {
      if (state.damageLevel > 0) {
        const rattle = Math.sin(elapsedTime * (22 + mh.side * 5)) * 0.045 * state.damageLevel * speedVib;
        const crook = mh.side * 0.065 * state.damageLevel;
        mh.group.rotation.y = mh.side * 0.22 + crook + rattle * 0.65;
        mh.group.rotation.x = 0.12 - 0.04 * state.damageLevel + rattle;
        mh.group.rotation.z = mh.side * 0.08 * state.damageLevel + rattle * 0.5;
      } else {
        mh.group.rotation.y = mh.side * 0.22;
        mh.group.rotation.x = 0.12;
        mh.group.rotation.z = 0;
      }
    }

    // Update 3D Digital Dashboard Fuel Gauge LCD (~12Hz throttle)
    if (elapsedTime - this.lastDashDrawTime >= 0.08 || this.lastDashDrawTime < 0) {
      this.lastDashDrawTime = elapsedTime;
      this.renderDashboardCluster(state, elapsedTime);
    }
  }

  public applyCustomization(modelId: ScooterModelId, paintId: ScooterPaintId): void {
    const paint = SCOOTER_PAINTS[paintId];
    this.bodyPaintMat.color.setHex(paint.bodyHex);
    this.accentPaintMat.color.setHex(paint.accentHex);
    this.boxMat.color.setHex(paint.boxHex);

    // Classic Super Cub gets warm saddle-brown leather seat; PCX/EV get matte charcoal
    this.seatMat.color.setHex(modelId === 'cub' ? 0x7c3f1d : 0x1e242c);
    this.exhaustMesh.visible = modelId !== 'electric';

    this.pcxTrimGroup.visible = modelId === 'pcx';
    this.cubTrimGroup.visible = modelId === 'cub';
    this.evTrimGroup.visible = modelId === 'electric';
  }

  private renderDashboardCluster(state: ScooterState, elapsedTime: number): void {
    const ctx = this.dashCtx;
    const w = this.dashCanvas.width;
    const h = this.dashCanvas.height;
    const spec = SCOOTER_MODELS[state.modelId];

    ctx.fillStyle = spec.isElectric ? '#051520' : '#090f1a';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = state.lowFuelWarning ? '#ef4444' : spec.isElectric ? '#06b6d4' : '#1e3a5f';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, w - 4, h - 4);

    // Top row: Speed + Model Badge + Fuel/Battery %
    const kmh = Math.round(Math.abs(state.speed) * 3.6);
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${String(kmh).padStart(2, '0')}`, 14, 28);

    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('km/h', 56, 33);

    if (state.damageLevel > 0) {
      ctx.fillStyle = '#fb923c';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`🔧 -${state.damageLevel * 10}%`, w * 0.54, 28);
    } else {
      ctx.fillStyle = spec.isElectric ? '#22d3ee' : state.modelId === 'cub' ? '#fde68a' : '#94a3b8';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(spec.shortBadge, w * 0.54, 28);
    }

    const fuelPct = Math.round(state.fuel);
    const lowBlink = state.lowFuelWarning && Math.floor(elapsedTime * 4) % 2 === 0;
    ctx.fillStyle =
      state.outOfFuel || lowBlink
        ? '#ef4444'
        : state.lowFuelWarning
          ? '#fca5a5'
          : spec.isElectric
            ? '#22d3ee'
            : '#34d399';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'right';
    const energyIcon = spec.isElectric ? '⚡' : '⛽';
    ctx.fillText(state.outOfFuel ? 'EMPTY!' : `${energyIcon}${fuelPct}%`, w - 12, 28);

    // Bottom row: 10-segment 3D Fuel/Battery Bar Gauge (E [||||||||..] F)
    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('E', 14, 68);
    ctx.fillStyle = spec.isElectric ? '#22d3ee' : '#38bdf8';
    ctx.textAlign = 'right';
    ctx.fillText('F', w - 14, 68);

    const segs = 10;
    const barX = 34;
    const barW = w - 68;
    const segW = (barW - (segs - 1) * 4) / segs;
    const filled = Math.ceil((state.fuel / 100) * segs);

    for (let i = 0; i < segs; i++) {
      const sx = barX + i * (segW + 4);
      const active = i < filled && state.fuel > 0.01;
      if (active) {
        ctx.fillStyle =
          state.lowFuelWarning
            ? lowBlink
              ? '#ef4444'
              : '#7f1d1d'
            : i < 2
              ? '#f59e0b'
              : spec.isElectric
                ? '#06b6d4'
                : '#22c55e';
      } else {
        ctx.fillStyle = '#1e293b';
      }
      ctx.fillRect(sx, 54, segW, 24);
    }

    this.dashTex.needsUpdate = true;
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
    // Reuse this frame's shadow map instead of re-rendering it for every mirror pass
    // (each renderer.render() would otherwise redraw the whole shadow map again)
    const prevShadowAuto = renderer.shadowMap.autoUpdate;
    const prevShadowNeeds = renderer.shadowMap.needsUpdate;
    renderer.shadowMap.autoUpdate = false;
    // A scheduled shadow refresh must happen in the MAIN pass (the mirror cameras don't see the
    // main-camera-only props, so a mirror pass would bake a shadow map without them)
    renderer.shadowMap.needsUpdate = false;
    // Alternate the mirrors: each one refreshes every other frame (~30Hz at 60fps), halving the cost
    this.mirrorFrame++;
    const doLeft = this.mirrorFrame % 2 === 0;

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
    if (doLeft) {
      renderer.setRenderTarget(this.leftMirrorRT);
      renderer.render(scene, this.leftMirrorCam);
    }

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
    if (!doLeft) {
      renderer.setRenderTarget(this.rightMirrorRT);
      renderer.render(scene, this.rightMirrorCam);
    }

    renderer.setRenderTarget(prevTarget);
    renderer.shadowMap.autoUpdate = prevShadowAuto;
    renderer.shadowMap.needsUpdate = prevShadowNeeds;
    for (const m of this.mirrorGlassMeshes) m.visible = true;
  }

  public getFirstPersonEyeWorld(out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 1.56, 0.45);
    return this.bodyTiltGroup.localToWorld(out);
  }
}
