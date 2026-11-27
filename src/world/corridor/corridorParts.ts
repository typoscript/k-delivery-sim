/** Shared corridor building blocks: layout constants, door slots, the customer NPC, canvas textures and decorative props */
import * as THREE from 'three';
import { InteriorPropKind } from '../interiorThemes';
import { HandheldFoodBag3D } from '../../player/HandheldFoodBag3D';

export interface UnitDoorSlot {
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
export const VILLA_STAIR_FLIGHTS = [
  { zStart: -7.2, zEnd: -3.2, yStart: 0.0, yEnd: 2.2 }, // 1F -> 2F
  { zStart: -0.4, zEnd: 3.6, yStart: 2.2, yEnd: 4.4 }, // 2F -> 3F
  { zStart: 6.4, zEnd: 10.4, yStart: 4.4, yEnd: 6.6 }, // 3F -> 4F
] as const;

export const VILLA_FLOOR_Y = [0.0, 2.2, 4.4, 6.6] as const; // index 0=1F, 1=2F, 2=3F, 3=4F
export const APT_LIGHT_INTENSITY = 9.5;

/** Spots where decorative props may stand (against walls, clear of doors, elevator and stairs) */
export const APT_PROP_SLOTS = [
  { x: -2.3, y: 0, z: 7.3, rotY: 0 },
  { x: 2.3, y: 0, z: 1.2, rotY: Math.PI },
] as const;
export const VILLA_PROP_SLOTS = [
  { x: 1.85, y: 0, z: -9.6, rotY: Math.PI },
  { x: -1.85, y: 2.2, z: -0.65, rotY: 0 },
] as const;

export function createDoorSlot(
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
    map: createPlaqueTexture(defaultUnit, '#1e293b', '#f8fafc'),
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
export function buildCustomerNpc(npcGroup: THREE.Group, rightArmPivot: THREE.Group): THREE.Group {
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xf6c9a5, roughness: 0.72 });
  const hairMat = new THREE.MeshStandardMaterial({ color: 0x1e2028, roughness: 0.85 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.78 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.85 });

  for (const sx of [-0.11, 0.11]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.74, 0.16), pantsMat);
    leg.position.set(sx, 0.37, 0);
    npcGroup.add(leg);
  }

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.58, 0.24), shirtMat);
  torso.position.set(0, 1.03, 0);
  npcGroup.add(torso);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.26), skinMat);
  head.position.set(0, 1.48, 0);
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.28), hairMat);
  hair.position.set(0, 1.6, -0.01);
  npcGroup.add(head, hair);

  const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.48, 0.12), shirtMat);
  leftArm.position.set(-0.28, 1.04, 0);
  npcGroup.add(leftArm);

  rightArmPivot.position.set(0.28, 1.24, 0);
  const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.48, 0.12), shirtMat);
  rightArm.position.set(0, -0.22, 0);
  const rightHand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), skinMat);
  rightHand.position.set(0, -0.47, 0);

  const heldBag = HandheldFoodBag3D.createFoodBagMesh();
  heldBag.position.set(0, -0.63, 0.04);
  heldBag.visible = false;

  rightArmPivot.add(rightArm, rightHand, heldBag);
  npcGroup.add(rightArmPivot);

  npcGroup.visible = false;
  return heldBag;
}

export function createTileTexture(bg: string, lineColor: string, rx: number, ry: number): THREE.CanvasTexture {
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
export function createPlaqueTexture(text: string, bg: string, fg: string, width = 256): THREE.CanvasTexture {
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

/** Small low-poly corridor props (lit by the corridor lights; ~1 draw call per part) */
export function buildInteriorProp(kind: InteriorPropKind): THREE.Group {
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
