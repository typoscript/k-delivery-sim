import * as THREE from 'three';
import { ColoredPart, mergeColoredParts } from './instancing';

export type PedestrianGender = 'male' | 'female';

export interface PedestrianPalette {
  topHex: number;
  bottomHex: number;
  hairHex: number;
}

export interface PedestrianRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  leftArmPivot: THREE.Group;
  rightArmPivot: THREE.Group;
  leftLegPivot: THREE.Group;
  rightLegPivot: THREE.Group;
  gender: PedestrianGender;
  walkPhase: number;
  palette: PedestrianPalette;
  /** Far LOD: the whole body baked into one vertex-coloured mesh (1 draw call, no limb animation) */
  lowDetail: THREE.Mesh;
  /** Umbrella over the head, made the first time it rains / snows (setPedestrianWeather) */
  umbrella: THREE.Mesh | null;
  /** Umbrella colour (from the outfit) */
  umbrellaColor: number;
  /** Stable 0..1 per pedestrian: who carries an umbrella in which weather */
  umbrellaRoll: number;
  /** 💢 bubble over the head after being splashed (made on first use) */
  angryBubble?: THREE.Sprite;
}

const UMBRELLA_COLORS = [0x1e293b, 0x0ea5e9, 0xdc2626, 0xf8fafc, 0x7c3aed, 0x16a34a, 0xfacc15];
/** Canopy + pole, one vertex-coloured geometry per colour (shared by every pedestrian) */
const UMBRELLA_GEOS = UMBRELLA_COLORS.map((hex) => {
  const canopy = new THREE.ConeGeometry(0.62, 0.3, 8, 1, true);
  const pole = new THREE.CylinderGeometry(0.012, 0.012, 0.62, 4);
  const at = (y: number) => new THREE.Matrix4().makeTranslation(0.08, y, 0.1);
  return mergeColoredParts([
    { geometry: canopy, matrix: at(2.02), color: new THREE.Color(hex) },
    { geometry: pole, matrix: at(1.62), color: new THREE.Color(0x334155) },
  ]);
});
const UMBRELLA_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide });

/** Share of pedestrians under an umbrella: most of them in the rain, fewer in the snow */
const UMBRELLA_SHARE = { rain: 0.8, snow: 0.45 } as const;

/** Shows the umbrella of pedestrians who carry one in this weather */
export function setPedestrianWeather(rig: PedestrianRig, weather: 'clear' | 'cloudy' | 'rain' | 'snow'): void {
  const share = weather === 'rain' || weather === 'snow' ? UMBRELLA_SHARE[weather] : 0;
  const show = rig.umbrellaRoll < share;
  if (show && !rig.umbrella) {
    // created lazily: a dry day builds the exact same scene (three.js draws Math.random for every object's uuid)
    rig.umbrella = new THREE.Mesh(UMBRELLA_GEOS[rig.umbrellaColor], UMBRELLA_MAT);
    rig.umbrella.name = 'pedestrian_umbrella';
    rig.root.add(rig.umbrella);
  }
  if (rig.umbrella) rig.umbrella.visible = show;
}

/** Shared material of every far-LOD pedestrian */
const LOW_DETAIL_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.84 });
/** Shared material of the near rigs' merged parts */
const NEAR_RIG_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });

let privateSeed = 0x2545f491;
/** Runs `fn` with Math.random swapped for a private sequence (unique uuids, global sequence untouched) */
export function withPrivateRandom<T>(fn: () => T): T {
  const orig = Math.random;
  Math.random = () => {
    privateSeed = (Math.imul(privateSeed, 1664525) + 1013904223) >>> 0;
    return privateSeed / 4294967296;
  };
  try {
    return fn();
  } finally {
    Math.random = orig;
  }
}

/** Merges the direct mesh children of `group` (skipping `skip`) into one vertex-coloured mesh in group space */
function mergeRigParts(group: THREE.Object3D, skip: (o: THREE.Object3D) => boolean = () => false): void {
  const meshes = group.children.filter((c) => (c as THREE.Mesh).isMesh && !skip(c)) as THREE.Mesh[];
  if (meshes.length < 2) return;
  const parts: ColoredPart[] = meshes.map((m) => {
    m.updateMatrix();
    return { geometry: m.geometry, matrix: m.matrix.clone(), color: (m.material as THREE.MeshStandardMaterial).color };
  });
  const merged = new THREE.Mesh(mergeColoredParts(parts), NEAR_RIG_MAT);
  merged.castShadow = meshes.some((m) => m.castShadow);
  for (const m of meshes) group.remove(m);
  group.add(merged);
}

/**
 * Switches a pedestrian between the articulated 12-part rig (near) and its single merged mesh (far).
 * Returns true when the full rig is active (only then is limb animation worth computing).
 */
export function setPedestrianDetail(rig: PedestrianRig, near: boolean): boolean {
  if (rig.bodyGroup.visible !== near) {
    rig.bodyGroup.visible = near;
    rig.lowDetail.visible = !near;
  }
  return near;
}

// Korean everyday casual street-fashion color palettes
const TOP_PALETTE = [
  0x1e242c, // 블랙 (검정)
  0x475569, // 차콜 그레이 (회색)
  0xcbd5e1, // 라이트 그레이
  0xf1f5f9, // 화이트 (흰색)
  0x1e3a5f, // 네이비
  0xd6c3a5, // 베이지
  0x4d5d48, // 카키/올리브
  0x93c5fd, // 스카이블루
  0x881337, // 버건디
] as const;

const BOTTOM_PALETTE = [
  0x181c22, // 블랙 슬랙스
  0x1e3a6d, // 진청바지
  0x5a82b8, // 연청바지
  0x374151, // 차콜 팬츠
  0xb8a48a, // 베이지 치노
  0x64748b, // 그레이 조거
] as const;

const HAIR_PALETTE = [
  0x161920, // 흑발
  0x2c1f17, // 짙은 갈색
  0x4a3322, // 내추럴 브라운
  0x3f4754, // 흑회색
] as const;

const SKIN_PALETTE = [0xf5c8a3, 0xebc09a] as const;
const SHOE_PALETTE = [0x18181b, 0xe2e8f0] as const;

/**
 * Pure Three.js BoxGeometry Low-Poly Korean Pedestrian Factory (NO SkinnedMesh / NO Bones).
 * Shares all geometries and reuses pooled MeshStandardMaterials across every pedestrian instance
 * to minimize GPU memory & state switches.
 */
export class PedestrianFactory {
  // Shared BoxGeometries (created once, reused across all pedestrian instances!)
  private readonly headGeo: THREE.BoxGeometry;
  private readonly maleHairGeo: THREE.BoxGeometry;
  private readonly femaleHairTopGeo: THREE.BoxGeometry;
  private readonly femaleHairBackGeo: THREE.BoxGeometry;
  private readonly maleTorsoGeo: THREE.BoxGeometry;
  private readonly femaleTorsoGeo: THREE.BoxGeometry;
  private readonly armGeo: THREE.BoxGeometry;
  private readonly handGeo: THREE.BoxGeometry;
  private readonly legGeo: THREE.BoxGeometry;
  private readonly shoeGeo: THREE.BoxGeometry;
  private readonly bagGeo: THREE.BoxGeometry;

  // Reusable Material Pools (created once per palette color!)
  private readonly topMats: THREE.MeshStandardMaterial[];
  private readonly bottomMats: THREE.MeshStandardMaterial[];
  private readonly hairMats: THREE.MeshStandardMaterial[];
  private readonly skinMats: THREE.MeshStandardMaterial[];
  private readonly shoeMats: THREE.MeshStandardMaterial[];
  private readonly bagMat: THREE.MeshStandardMaterial;

  constructor() {
    this.headGeo = new THREE.BoxGeometry(0.24, 0.25, 0.24);
    this.maleHairGeo = new THREE.BoxGeometry(0.26, 0.1, 0.26);
    this.femaleHairTopGeo = new THREE.BoxGeometry(0.27, 0.11, 0.27);
    this.femaleHairBackGeo = new THREE.BoxGeometry(0.26, 0.28, 0.08);
    this.maleTorsoGeo = new THREE.BoxGeometry(0.4, 0.56, 0.22);
    this.femaleTorsoGeo = new THREE.BoxGeometry(0.35, 0.52, 0.2);
    this.armGeo = new THREE.BoxGeometry(0.11, 0.44, 0.11);
    this.handGeo = new THREE.BoxGeometry(0.095, 0.095, 0.095);
    this.legGeo = new THREE.BoxGeometry(0.14, 0.66, 0.14);
    this.shoeGeo = new THREE.BoxGeometry(0.145, 0.08, 0.22);
    this.bagGeo = new THREE.BoxGeometry(0.18, 0.24, 0.09);

    this.topMats = TOP_PALETTE.map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.82 }));
    this.bottomMats = BOTTOM_PALETTE.map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.86 }));
    this.hairMats = HAIR_PALETTE.map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.88 }));
    this.skinMats = SKIN_PALETTE.map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.72 }));
    this.shoeMats = SHOE_PALETTE.map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.78 }));
    this.bagMat = new THREE.MeshStandardMaterial({ color: 0x262930, roughness: 0.75 });
  }

  /** Creates a lightweight articulated low-poly pedestrian mesh with shoulder & hip pivots */
  public createPedestrian(genderOverride?: PedestrianGender): PedestrianRig {
    const gender: PedestrianGender = genderOverride ?? (Math.random() < 0.5 ? 'male' : 'female');
    const isFemale = gender === 'female';

    const topIdx = Math.floor(Math.random() * this.topMats.length);
    const botIdx = Math.floor(Math.random() * this.bottomMats.length);
    const hairIdx = Math.floor(Math.random() * this.hairMats.length);
    const skinMat = this.skinMats[Math.floor(Math.random() * this.skinMats.length)];
    const shoeMat = this.shoeMats[Math.floor(Math.random() * this.shoeMats.length)];

    const topMat = this.topMats[topIdx];
    const bottomMat = this.bottomMats[botIdx];
    const hairMat = this.hairMats[hairIdx];

    const root = new THREE.Group();
    const bodyGroup = new THREE.Group();
    root.add(bodyGroup);

    const hipY = isFemale ? 0.7 : 0.74;
    const torsoH = isFemale ? 0.52 : 0.56;
    const shoulderY = hipY + torsoH - 0.05;
    const armOffsetX = isFemale ? 0.235 : 0.265;
    const legOffsetX = isFemale ? 0.095 : 0.11;

    // --- Torso ---
    const torso = new THREE.Mesh(isFemale ? this.femaleTorsoGeo : this.maleTorsoGeo, topMat);
    torso.position.set(0, hipY + torsoH * 0.5, 0);
    torso.castShadow = true;
    bodyGroup.add(torso);

    // Optional casual backpack/crossbag (~40% of Korean pedestrians)
    if (Math.random() < 0.4) {
      const bag = new THREE.Mesh(this.bagGeo, this.bagMat);
      bag.position.set(0, hipY + torsoH * 0.52, -0.15);
      bodyGroup.add(bag);
    }

    // --- Head & Hair ---
    const headY = hipY + torsoH + 0.145;
    const head = new THREE.Mesh(this.headGeo, skinMat);
    head.position.set(0, headY, 0);
    head.castShadow = true;
    bodyGroup.add(head);

    if (isFemale) {
      const hairTop = new THREE.Mesh(this.femaleHairTopGeo, hairMat);
      hairTop.position.set(0, headY + 0.1, -0.01);
      const hairBack = new THREE.Mesh(this.femaleHairBackGeo, hairMat);
      hairBack.position.set(0, headY - 0.05, -0.115);
      bodyGroup.add(hairTop, hairBack);
    } else {
      const hair = new THREE.Mesh(this.maleHairGeo, hairMat);
      hair.position.set(0, headY + 0.1, -0.01);
      bodyGroup.add(hair);
    }

    // --- Left & Right Shoulder Pivots (Arms) ---
    const buildArm = (x: number): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.position.set(x, shoulderY, 0);

      const upper = new THREE.Mesh(this.armGeo, topMat);
      upper.position.set(0, -0.21, 0);
      upper.castShadow = true;

      const hand = new THREE.Mesh(this.handGeo, skinMat);
      hand.position.set(0, -0.45, 0);

      pivot.add(upper, hand);
      bodyGroup.add(pivot);
      return pivot;
    };

    const leftArmPivot = buildArm(armOffsetX);
    const rightArmPivot = buildArm(-armOffsetX);

    // --- Left & Right Hip Pivots (Legs + Shoes) ---
    const buildLeg = (x: number): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.position.set(x, hipY, 0);

      const leg = new THREE.Mesh(this.legGeo, bottomMat);
      leg.position.set(0, -0.33, 0);
      leg.castShadow = true;

      const shoe = new THREE.Mesh(this.shoeGeo, shoeMat);
      shoe.position.set(0, -0.68, 0.035);

      pivot.add(leg, shoe);
      bodyGroup.add(pivot);
      return pivot;
    };

    const leftLegPivot = buildLeg(legOffsetX);
    const rightLegPivot = buildLeg(-legOffsetX);

    // Far LOD: bake every visible part (rest pose) into one geometry with per-vertex colours
    root.updateMatrixWorld(true);
    const parts: ColoredPart[] = [];
    bodyGroup.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      parts.push({
        geometry: m.geometry,
        matrix: m.matrixWorld.clone(),
        color: (m.material as THREE.MeshStandardMaterial).color,
      });
    });
    const lowDetail = new THREE.Mesh(mergeColoredParts(parts), LOW_DETAIL_MAT);
    lowDetail.visible = false;
    root.add(lowDetail);

    // Near rig: the static body parts become one vertex-coloured mesh and each limb one more (12-14 -> 5 draw calls).
    // Built with a private random source: three.js draws Math.random for every new object's uuid, and the crowd's
    // walk is driven by Math.random too, so this keeps the pedestrians' behaviour exactly as before.
    withPrivateRandom(() => {
      mergeRigParts(
        bodyGroup,
        (o) => o === leftArmPivot || o === rightArmPivot || o === leftLegPivot || o === rightLegPivot,
      );
      for (const pivot of [leftArmPivot, rightArmPivot, leftLegPivot, rightLegPivot]) mergeRigParts(pivot);
    });

    // Umbrella (colour from the outfit picks: no extra random draws, the crowd stays the same)
    const umbrellaColor = (topIdx * 7 + botIdx * 3 + hairIdx) % UMBRELLA_COLORS.length;

    // Slight natural height variation across individuals
    const heightScale = isFemale ? 0.92 + Math.random() * 0.07 : 0.97 + Math.random() * 0.09;
    root.scale.set(heightScale, heightScale, heightScale);

    return {
      root,
      bodyGroup,
      leftArmPivot,
      rightArmPivot,
      leftLegPivot,
      rightLegPivot,
      gender,
      lowDetail,
      umbrella: null,
      umbrellaColor,
      umbrellaRoll: ((topIdx * 31 + botIdx * 17 + hairIdx * 13) % 100) / 100,
      walkPhase: Math.random() * Math.PI * 2,
      palette: {
        topHex: TOP_PALETTE[topIdx],
        bottomHex: BOTTOM_PALETTE[botIdx],
        hairHex: HAIR_PALETTE[hairIdx],
      },
    };
  }

  /**
   * Lightweight procedural Math.sin() walk-cycle animation (NO SkinnedMesh / Bones!).
   * - Moving (speed > 0.05): swings opposite arms & legs smoothly around shoulder/hip pivots.
   * - Stopped (speed === 0): smoothly interpolates limbs back to crisp Idle attention posture (0 rad).
   */
  public static updateWalkAnimation(rig: PedestrianRig, speed: number, dt: number): void {
    const clampedDt = Math.min(dt, 0.05);
    const blend = Math.min(1, clampedDt * 12);

    // Smoothly recover any startled/fallen torso & arm-splay rotations back to upright neutral
    rig.bodyGroup.rotation.x += (0 - rig.bodyGroup.rotation.x) * blend;
    rig.bodyGroup.rotation.z += (0 - rig.bodyGroup.rotation.z) * blend;
    rig.leftArmPivot.rotation.z += (0 - rig.leftArmPivot.rotation.z) * blend;
    rig.rightArmPivot.rotation.z += (0 - rig.rightArmPivot.rotation.z) * blend;

    if (speed > 0.05) {
      rig.walkPhase += speed * clampedDt * 4.4;
      const strideAmp = Math.min(speed / 1.55, 1.0);
      const swing = Math.sin(rig.walkPhase);

      const targetLeftLeg = swing * 0.62 * strideAmp;
      const targetRightLeg = -targetLeftLeg;
      const targetLeftArm = -swing * 0.52 * strideAmp;
      const targetRightArm = -targetLeftArm;
      const targetBob = Math.abs(swing) * 0.042 * strideAmp;

      rig.leftLegPivot.rotation.x += (targetLeftLeg - rig.leftLegPivot.rotation.x) * blend;
      rig.rightLegPivot.rotation.x += (targetRightLeg - rig.rightLegPivot.rotation.x) * blend;
      rig.leftArmPivot.rotation.x += (targetLeftArm - rig.leftArmPivot.rotation.x) * blend;
      rig.rightArmPivot.rotation.x += (targetRightArm - rig.rightArmPivot.rotation.x) * blend;
      rig.bodyGroup.position.y += (targetBob - rig.bodyGroup.position.y) * blend;
    } else {
      // Smooth return to standing Idle posture (arms & legs at rest = 0)
      rig.leftLegPivot.rotation.x += (0 - rig.leftLegPivot.rotation.x) * blend;
      rig.rightLegPivot.rotation.x += (0 - rig.rightLegPivot.rotation.x) * blend;
      rig.leftArmPivot.rotation.x += (0 - rig.leftArmPivot.rotation.x) * blend;
      rig.rightArmPivot.rotation.x += (0 - rig.rightArmPivot.rotation.x) * blend;
      rig.bodyGroup.position.y += (0 - rig.bodyGroup.position.y) * blend;
    }
  }

  /**
   * Procedural startled / flinch animation when a scooter approaches within 3.5m on the sidewalk.
   * Pedestrian hunches defensively, raises both arms to shield themselves, and steps back.
   */
  public static updateStartledAnimation(rig: PedestrianRig, reactPhase: number, dt: number): void {
    const clampedDt = Math.min(dt, 0.05);
    const blend = Math.min(1, clampedDt * 16);
    const flinch = Math.sin(reactPhase * 18) * 0.06;

    // Hunch slightly & brace backward
    rig.bodyGroup.position.y += (-0.12 - rig.bodyGroup.position.y) * blend;
    rig.bodyGroup.rotation.x += (0.2 + flinch - rig.bodyGroup.rotation.x) * blend;
    rig.bodyGroup.rotation.z += (flinch * 0.7 - rig.bodyGroup.rotation.z) * blend;

    // Raise both arms defensively in front of chest/face
    rig.leftArmPivot.rotation.x += (-1.75 + flinch - rig.leftArmPivot.rotation.x) * blend;
    rig.rightArmPivot.rotation.x += (-1.75 - flinch - rig.rightArmPivot.rotation.x) * blend;
    rig.leftArmPivot.rotation.z += (0.34 - rig.leftArmPivot.rotation.z) * blend;
    rig.rightArmPivot.rotation.z += (-0.34 - rig.rightArmPivot.rotation.z) * blend;

    // Wide defensive stance on legs
    rig.leftLegPivot.rotation.x += (-0.28 - rig.leftLegPivot.rotation.x) * blend;
    rig.rightLegPivot.rotation.x += (0.26 - rig.rightLegPivot.rotation.x) * blend;
  }

  /**
   * Procedural knocked-down / fallen animation when directly struck by a moving scooter (>= 5 km/h).
   */
  public static updateFallenAnimation(rig: PedestrianRig, fallSide: number, dt: number): void {
    const clampedDt = Math.min(dt, 0.05);
    const blend = Math.min(1, clampedDt * 14);
    const side = fallSide === 0 ? 1 : Math.sign(fallSide);

    // Topple flat onto the sidewalk pavement
    rig.bodyGroup.position.y += (0.14 - rig.bodyGroup.position.y) * blend;
    rig.bodyGroup.rotation.x += (-1.48 - rig.bodyGroup.rotation.x) * blend;
    rig.bodyGroup.rotation.z += (side * 0.24 - rig.bodyGroup.rotation.z) * blend;

    // Sprawled arms and legs
    rig.leftArmPivot.rotation.x += (-2.05 - rig.leftArmPivot.rotation.x) * blend;
    rig.rightArmPivot.rotation.x += (-1.45 - rig.rightArmPivot.rotation.x) * blend;
    rig.leftArmPivot.rotation.z += (0.58 - rig.leftArmPivot.rotation.z) * blend;
    rig.rightArmPivot.rotation.z += (-0.52 - rig.rightArmPivot.rotation.z) * blend;

    rig.leftLegPivot.rotation.x += (0.28 - rig.leftLegPivot.rotation.x) * blend;
    rig.rightLegPivot.rotation.x += (-0.22 - rig.rightLegPivot.rotation.x) * blend;
  }
}

let angryMaterial: THREE.SpriteMaterial | null = null;

/** Shared 💢 sprite material (canvas emoji texture, made on first use) */
function angryBubbleMaterial(): THREE.SpriteMaterial | null {
  if (angryMaterial) return angryMaterial;
  if (typeof document === 'undefined') return null; // no canvas (headless tests)
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.font = '48px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('💢', 32, 36);
  angryMaterial = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false, transparent: true });
  return angryMaterial;
}

/** Shows / hides the 💢 bubble over a pedestrian's head (`bob` 0..1 lifts it a little) */
export function setAngryBubble(rig: PedestrianRig, visible: boolean, bob = 0): void {
  if (!visible && !rig.angryBubble) return;
  if (!rig.angryBubble) {
    const mat = angryBubbleMaterial();
    if (!mat) return;
    // private random: the sprite's uuid must not shift the crowd's Math.random sequence
    rig.angryBubble = withPrivateRandom(() => new THREE.Sprite(mat));
    rig.angryBubble.scale.set(0.42, 0.42, 0.42);
    rig.angryBubble.name = 'angry_bubble';
    rig.root.add(rig.angryBubble);
  }
  rig.angryBubble.visible = visible;
  rig.angryBubble.position.set(0, 2.05 + bob * 0.12, 0);
}
