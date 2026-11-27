/** Scooter mesh parts: wheels, the per-model trim kits and the rear delivery box with its 3 cargo slots */
import * as THREE from 'three';
import { SCOOTER_SPECS } from '../ScooterPhysics';

export function createScooterWheel(): THREE.Group {
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

export interface TrimMaterials {
  accent: THREE.Material;
  chrome: THREE.Material;
  dark: THREE.Material;
  headlight: THREE.Material;
}

/** Fills the PCX / Super Cub / EV-PRO trim groups (only the current model's group is shown) */
export function buildModelTrims(pcx: THREE.Group, cub: THREE.Group, ev: THREE.Group, m: TrimMaterials): void {
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
  pcx.add(pcxScreen);
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, 0.34), m.accent);
    wing.position.set(s * 0.26, 0.78, 1.08);
    pcx.add(wing);
  }
  
  // 2) Classic Super Cub 110 Trim: Retro cream leg-shield wings + chrome round headlight bezel + luggage bar
  const retroCreamMat = new THREE.MeshStandardMaterial({ color: 0xfef9c3, roughness: 0.42 });
  for (const s of [-1, 1]) {
    const legWing = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.56, 0.1), retroCreamMat);
    legWing.position.set(s * 0.28, 0.66, 1.12);
    legWing.rotation.y = s * 0.35;
    cub.add(legWing);
  }
  const roundLampRim = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.14, 16), m.chrome);
  roundLampRim.rotation.x = Math.PI / 2;
  roundLampRim.position.set(0, 1.14, 1.3);
  const roundLampGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.088, 0.15, 16), m.headlight);
  roundLampGlass.rotation.x = Math.PI / 2;
  roundLampGlass.position.set(0, 1.14, 1.31);
  const frontBasket = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.2), m.chrome);
  frontBasket.position.set(0, 0.9, 1.43);
  cub.add(roundLampRim, roundLampGlass, frontBasket);
  cub.visible = false;
  
  // 3) High-Output Electric EV-PRO Trim: Cyber-cyan LED lightbar + glowing battery frame bars + aero visor
  const evCyanMat = new THREE.MeshStandardMaterial({
    color: 0x22d3ee,
    emissive: 0x06b6d4,
    emissiveIntensity: 1.8,
    roughness: 0.2,
  });
  const evLightBar = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.055, 0.08), evCyanMat);
  evLightBar.position.set(0, 0.94, 1.38);
  const evVisor = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.03), m.dark);
  evVisor.position.set(0, 1.24, 1.24);
  evVisor.rotation.x = -0.62;
  for (const s of [-1, 1]) {
    const battBar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.84), evCyanMat);
    battBar.position.set(s * 0.255, 0.42, 0.56);
    ev.add(battBar);
  }
  ev.add(evLightBar, evVisor);
  ev.visible = false;
}

/** Rear rack, thermal box, hinged lid with the 3 slot LEDs and the 3 food bag indicators, added to `parent` */
export function buildCargoBox(
  parent: THREE.Group,
  lidPivot: THREE.Group,
  slotLedMats: readonly THREE.Material[],
  slotBags: THREE.Mesh[],
  m: { box: THREE.Material; dark: THREE.Material }
): void {
  // --- Rear Delivery Thermal Box ---
  const rack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.48), m.dark);
  rack.position.set(0, 0.88, -0.34);
  parent.add(rack);

  const deliveryBox = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.48, 0.52), m.box);
  deliveryBox.position.set(0, 1.14, -0.36);
  deliveryBox.castShadow = true;
  deliveryBox.receiveShadow = true;
  parent.add(deliveryBox);

  // Hinged top lid pivot at front edge of delivery box (z = -0.10, y = 1.38)
  lidPivot.position.set(0, 1.38, -0.1);
  const boxLid = new THREE.Mesh(new THREE.BoxGeometry(0.59, 0.07, 0.55), m.dark);
  boxLid.position.set(0, 0.02, -0.26);
  lidPivot.add(boxLid);

  // 3-Slot Cargo Status LED Bars on rear lid edge (Slot 1 left -> Slot 3 right)
  const ledSlotGeo = new THREE.BoxGeometry(0.11, 0.036, 0.03);
  for (let i = 0; i < 3; i++) {
    const slotLed = new THREE.Mesh(ledSlotGeo, slotLedMats[i]);
    slotLed.position.set((1 - i) * 0.145, 0.02, -0.54);
    lidPivot.add(slotLed);
  }
  parent.add(lidPivot);

  // 3 interior cargo slot food bag indicators (visible only while lid is open & slot occupied)
  const bagGeo = new THREE.BoxGeometry(0.135, 0.22, 0.34);
  const bagMat = new THREE.MeshStandardMaterial({ color: 0xd9a96f, roughness: 0.85 });
  for (let i = 0; i < 3; i++) {
    const bag = new THREE.Mesh(bagGeo, bagMat);
    bag.position.set((1 - i) * 0.16, 1.29, -0.36);
    bag.visible = false;
    slotBags.push(bag);
    parent.add(bag);
  }
}
