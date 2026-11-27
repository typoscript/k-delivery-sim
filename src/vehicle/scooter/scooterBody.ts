/** Scooter body meshes built once by ScooterMesh's constructor (split by area of the bike) */
import * as THREE from 'three';
import type { ScooterMesh } from '../ScooterMesh';
import { SCOOTER_SPECS } from '../scooterSpecs';
import { buildCargoBox, buildModelTrims, createScooterWheel } from './scooterParts';

/** Shared materials the build steps use */
export interface ScooterBuildMats {
  bodyPaint: THREE.MeshStandardMaterial;
  accentPaint: THREE.MeshStandardMaterial;
  darkMat: THREE.MeshStandardMaterial;
  chromeMat: THREE.MeshStandardMaterial;
  boxMat: THREE.MeshStandardMaterial;
}

/** Rear wheel, frame & seat, model trims, cargo box, reflector, tail light and rear blinkers */
export function buildRearBody(
  host: ScooterMesh,
  m: ScooterBuildMats,
): { rearWheel: ScooterMesh['rearWheel']; exhaustMesh: ScooterMesh['exhaustMesh'] } {
  const { bodyPaint, accentPaint, darkMat, chromeMat, boxMat } = m;
  // --- Rear Wheel (at z = 0) ---
  const rearWheel = createScooterWheel();
  rearWheel.position.set(0, SCOOTER_SPECS.wheelRadius, 0);
  host.bodyTiltGroup.add(rearWheel);

  // --- Main Scooter Frame & Floorboard ---
  const floorboard = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.12, 1.05), darkMat);
  floorboard.position.set(0, 0.34, 0.65);
  floorboard.castShadow = true;
  host.bodyTiltGroup.add(floorboard);

  const rearBody = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.36, 0.86), bodyPaint);
  rearBody.position.set(0, 0.58, 0.12);
  rearBody.castShadow = true;
  host.bodyTiltGroup.add(rearBody);

  const sideTrim = new THREE.Mesh(new THREE.BoxGeometry(0.49, 0.1, 0.76), accentPaint);
  sideTrim.position.set(0, 0.58, 0.14);
  host.bodyTiltGroup.add(sideTrim);

  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.76), host.seatMat);
  seat.position.set(0, 0.82, 0.22);
  seat.castShadow = true;
  host.bodyTiltGroup.add(seat);

  const exhaustMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.62, 10), chromeMat);
  exhaustMesh.rotation.x = Math.PI / 2 - 0.16;
  exhaustMesh.position.set(-0.27, 0.36, 0.08);
  host.bodyTiltGroup.add(exhaustMesh);

  // --- Model-Specific 3D Trim Kits (Visible in both 3D & 1st-Person Handlebar View!) ---
  buildModelTrims(host.pcxTrimGroup, host.cubTrimGroup, host.evTrimGroup, {
    accent: accentPaint,
    chrome: chromeMat,
    dark: darkMat,
    headlight: host.headlightMat,
  });
  host.cubTrimGroup.visible = false;
  host.evTrimGroup.visible = false;
  host.bodyTiltGroup.add(host.pcxTrimGroup, host.cubTrimGroup, host.evTrimGroup);

  // --- Rear Delivery Thermal Box (hinged lid, 3 slot LEDs, food bag indicators) ---
  buildCargoBox(host.bodyTiltGroup, host.cargoLidPivot, host.cargoSlotLedMats, host.cargoSlotBags, {
    box: boxMat,
    dark: darkMat,
  });

  const reflectMat = new THREE.MeshStandardMaterial({
    color: 0xfef08a,
    emissive: 0xfacc15,
    emissiveIntensity: 0.4,
  });
  const reflectStrip = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.02), reflectMat);
  reflectStrip.position.set(0, 1.15, -0.63);
  host.bodyTiltGroup.add(reflectStrip);

  // Rear tail/brake light & blinkers
  const tailLight = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, 0.06), host.brakeLightMat);
  tailLight.position.set(0, 0.64, -0.33);
  host.bodyTiltGroup.add(tailLight);

  const rearLeftBlink = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.08, 0.06), host.leftBlinkerMat);
  rearLeftBlink.position.set(0.19, 0.64, -0.33);
  host.bodyTiltGroup.add(rearLeftBlink);

  const rearRightBlink = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.08, 0.06), host.rightBlinkerMat);
  rearRightBlink.position.set(-0.19, 0.64, -0.33);
  host.bodyTiltGroup.add(rearRightBlink);
  return { rearWheel, exhaustMesh };
}

/** Front fairing, headlight, front blinkers, brake glow and the steering headlight beam */
export function buildFrontLights(
  host: ScooterMesh,
  m: ScooterBuildMats,
): {
  brakeGlowLight: ScooterMesh['brakeGlowLight'];
  headlightSpot: ScooterMesh['headlightSpot'];
  headlightFill: ScooterMesh['headlightFill'];
  headlightConeMat: ScooterMesh['headlightConeMat'];
  headlightConeMesh: ScooterMesh['headlightConeMesh'];
} {
  const { bodyPaint, accentPaint } = m;
  // --- Front Fairing & Leg Shield ---
  const frontShield = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.72, 0.34), bodyPaint);
  frontShield.position.set(0, 0.74, 1.18);
  frontShield.rotation.x = -0.22;
  frontShield.castShadow = true;
  host.bodyTiltGroup.add(frontShield);

  const noseAccent = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.34, 0.12), accentPaint);
  noseAccent.position.set(0, 0.8, 1.33);
  noseAccent.rotation.x = -0.22;
  host.bodyTiltGroup.add(noseAccent);

  // Headlight & front blinkers
  const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.13, 0.08), host.headlightMat);
  headlight.position.set(0, 0.78, 1.38);
  host.bodyTiltGroup.add(headlight);

  const frontLeftBlink = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.08, 0.06), host.leftBlinkerMat);
  frontLeftBlink.position.set(0.21, 0.76, 1.36);
  host.bodyTiltGroup.add(frontLeftBlink);

  const frontRightBlink = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.08, 0.06), host.rightBlinkerMat);
  frontRightBlink.position.set(-0.21, 0.76, 1.36);
  host.bodyTiltGroup.add(frontRightBlink);

  // Rear brake tail-light red glow (reflects onto dark/wet asphalt in side mirrors when braking!)
  const brakeGlowLight = new THREE.PointLight(0xef4444, 0, 11, 1.5);
  brakeGlowLight.position.set(0, 0.66, -0.58);
  host.bodyTiltGroup.add(brakeGlowLight);

  // High-power steering-aware 3D Headlight SpotLight + Close Road Fill + Volumetric Beam Cone!
  const headlightSpot = new THREE.SpotLight(0xfff7e0, 0, 82, Math.PI / 3.4, 0.62, 1.05);
  headlightSpot.position.set(0, 0.88, 1.44);
  const spotTarget = new THREE.Object3D();
  spotTarget.position.set(0, -0.75, 22);
  host.bodyTiltGroup.add(spotTarget);
  headlightSpot.target = spotTarget;
  host.bodyTiltGroup.add(headlightSpot);

  const headlightFill = new THREE.PointLight(0xfff7e0, 0, 16, 1.4);
  headlightFill.position.set(0, 0.9, 3.2);
  host.bodyTiltGroup.add(headlightFill);

  const headlightConeMat = new THREE.MeshBasicMaterial({
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
  const headlightConeMesh = new THREE.Mesh(coneGeo, headlightConeMat);
  headlightConeMesh.position.set(0, 0.82, 1.42);
  headlightConeMesh.visible = false;
  host.bodyTiltGroup.add(headlightConeMesh);
  return { brakeGlowLight, headlightSpot, headlightFill, headlightConeMat, headlightConeMesh };
}

/** Steerable fork, dash pod & LEDs, handlebar, blinker glows, windshield and the phone cradle with the live map */
export function buildSteeringAssembly(
  host: ScooterMesh,
  m: ScooterBuildMats,
  phoneScreenTexture: THREE.CanvasTexture,
): {
  frontWheel: ScooterMesh['frontWheel'];
  leftBlinkerGlow: ScooterMesh['leftBlinkerGlow'];
  rightBlinkerGlow: ScooterMesh['rightBlinkerGlow'];
  mountedPhoneHitMesh: ScooterMesh['mountedPhoneHitMesh'];
} {
  const { bodyPaint, darkMat, chromeMat } = m;
  // --- Steerable Front Fork + Handlebars + Live Side Mirrors + Dashboard Blinker LEDs ---
  host.handlebarGroup.position.set(0, 0, SCOOTER_SPECS.wheelbase);
  host.bodyTiltGroup.add(host.handlebarGroup);

  const frontWheel = createScooterWheel();
  frontWheel.position.set(0, SCOOTER_SPECS.wheelRadius, 0);
  host.handlebarGroup.add(frontWheel);

  for (const side of [-1, 1]) {
    const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.78, 8), chromeMat);
    fork.position.set(side * 0.11, 0.62, -0.08);
    fork.rotation.x = -0.22;
    host.handlebarGroup.add(fork);
  }

  const fender = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.42), bodyPaint);
  fender.position.set(0, 0.6, 0.02);
  host.handlebarGroup.add(fender);

  // Instrument dash pod (visible directly in 1st-person!)
  const barCenter = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.11, 0.18), darkMat);
  barCenter.position.set(0, 1.12, -0.21);
  host.handlebarGroup.add(barCenter);

  // 1st-Person Dashboard Blinker Indicator LEDs (◀ Left / ▶ Right) + Digital Fuel Gauge LCD + Low-Fuel LED!
  const ledGeo = new THREE.BoxGeometry(0.055, 0.024, 0.014);
  const leftDashLed = new THREE.Mesh(ledGeo, host.dashLeftLedMat);
  leftDashLed.position.set(0.115, 1.168, -0.295);
  leftDashLed.rotation.x = -0.35;
  const rightDashLed = new THREE.Mesh(ledGeo, host.dashRightLedMat);
  rightDashLed.position.set(-0.115, 1.168, -0.295);
  rightDashLed.rotation.x = -0.35;

  const dashScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.205, 0.076),
    new THREE.MeshBasicMaterial({ map: host.dashTex, toneMapped: false }),
  );
  dashScreen.position.set(0, 1.165, -0.299);
  dashScreen.rotation.y = Math.PI;
  dashScreen.rotation.x = 0.35;

  const fuelWarnLed = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.018, 0.014), host.dashFuelWarnLedMat);
  fuelWarnLed.position.set(0, 1.19, -0.29);
  fuelWarnLed.rotation.x = -0.35;

  host.handlebarGroup.add(leftDashLed, rightDashLed, dashScreen, fuelWarnLed);

  const handleBar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.78, 8), chromeMat);
  handleBar.rotation.z = Math.PI / 2;
  handleBar.position.set(0, 1.12, -0.22);
  host.handlebarGroup.add(handleBar);

  // Subtle amber glow lights for left & right turn signals
  const leftBlinkerGlow = new THREE.PointLight(0xf59e0b, 0, 5.5);
  leftBlinkerGlow.position.set(0.42, 1.12, -0.15);
  const rightBlinkerGlow = new THREE.PointLight(0xf59e0b, 0, 5.5);
  rightBlinkerGlow.position.set(-0.42, 1.12, -0.15);
  host.handlebarGroup.add(leftBlinkerGlow, rightBlinkerGlow);

  for (const side of [-1, 1]) {
    const isLeft = side === 1;
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 8), darkMat);
    grip.rotation.z = Math.PI / 2;
    grip.position.set(side * 0.35, 1.12, -0.22);
    host.handlebarGroup.add(grip);

    // Bar-end amber turn signal pod visible in 1st-person periphery!
    const barEndLamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.032, 10, 8),
      isLeft ? host.leftBlinkerMat : host.rightBlinkerMat,
    );
    barEndLamp.position.set(side * 0.44, 1.12, -0.22);
    host.handlebarGroup.add(barEndLamp);

    // --- Real-Time Working Side Mirrors (positioned clearly in 1st-person view!) ---
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.25, 8), darkMat);
    stalk.position.set(side * 0.31, 1.24, -0.21);
    stalk.rotation.z = -side * 0.42;
    host.handlebarGroup.add(stalk);

    host.handlebarGroup.add(host.mirrors.createHead(side, darkMat, chromeMat));
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
  host.handlebarGroup.add(windscreen);

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
    host.handlebarGroup.add(claw);
  }
  host.handlebarGroup.add(cradleStem, cradleBack);

  // 3D Smartphone placed inside handlebar cradle with LIVE GPS map texture!
  host.mountedPhone3D.position.set(0, 1.305, -0.192);
  host.mountedPhone3D.rotation.x = -0.34;
  const phoneBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.156, 0.272, 0.015),
    new THREE.MeshStandardMaterial({ color: 0x1e2530, roughness: 0.3, metalness: 0.55 }),
  );
  const phoneScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.144, 0.258),
    new THREE.MeshBasicMaterial({
      map: phoneScreenTexture,
      toneMapped: false,
    }),
  );
  phoneScreen.position.z = -0.0085;
  phoneScreen.rotation.y = Math.PI;
  const mountedPhoneHitMesh = phoneScreen;
  host.mountedPhone3D.add(phoneBody, phoneScreen);
  host.mountedPhone3D.visible = false;
  host.handlebarGroup.add(host.mountedPhone3D);
  return { frontWheel, leftBlinkerGlow, rightBlinkerGlow, mountedPhoneHitMesh };
}
