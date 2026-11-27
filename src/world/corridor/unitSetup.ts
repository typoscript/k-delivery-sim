/** Setting the corridor up for a delivery: apartment corridor or villa stairwell, interior style, door plate and NPC */
import type { CorridorRoom } from '../CorridorRoom';
import * as THREE from 'three';
import { InteriorStyle, pickInteriorStyle } from '../interiorThemes';
import { ResidenceKind, clamp } from '../../types';
import {
  APT_LIGHT_INTENSITY,
  APT_PROP_SLOTS,
  VILLA_PROP_SLOTS,
  buildInteriorProp,
  createPlaqueTexture,
  createTileTexture,
} from './corridorParts';

/** Recolours walls, floor, ceiling, doors and lights to the building's theme and rebuilds its props + sign */
export function applyInteriorStyle(
  host: CorridorRoom,
  style: InteriorStyle,
  buildingName: string | undefined,
  unitNumber: string,
): void {
  const t = style.theme;
  host.currentThemeId = t.id;
  const floorTex = createTileTexture(t.floorBase, t.floorGrout, host.isVillaMode ? 3 : 4, host.isVillaMode ? 2 : 12);
  if (host.isVillaMode) {
    host.villaWallMat.color.setHex(t.wall);
    host.villaCeilingMat.color.setHex(t.ceiling);
    host.villaDadoMat.color.setHex(t.dado ?? t.trim);
    host.villaRailMat.color.setHex(t.rail ?? t.trim);
    host.villaFixtureMat.color.setHex(t.lightColor);
    host.villaFloorMat.map?.dispose();
    host.villaFloorMat.map = floorTex;
    host.villaFloorMat.needsUpdate = true;
  } else {
    host.aptWallMat.color.setHex(t.wall);
    host.aptTrimMat.color.setHex(t.trim);
    host.aptCeilingMat.color.setHex(t.ceiling);
    host.aptFixtureMat.color.setHex(t.lightColor);
    for (const l of host.aptLights) {
      l.color.setHex(t.lightColor);
      l.intensity = APT_LIGHT_INTENSITY * t.lightMul;
    }
    host.aptFloorMat.map?.dispose();
    host.aptFloorMat.map = floorTex;
    host.aptFloorMat.needsUpdate = true;
  }
  for (const d of host.getActiveDoors()) {
    d.panelMat.color.setHex(t.door);
    d.carpetMat.color.setHex(t.carpet);
  }

  // Rebuild props and the building name sign for this visit
  host.styleGroup.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      (mat as THREE.MeshBasicMaterial).map?.dispose();
      mat.dispose();
    }
  });
  host.styleGroup.clear();
  const slots = host.isVillaMode ? VILLA_PROP_SLOTS : APT_PROP_SLOTS;
  style.props.forEach((kind, i) => {
    const slot = slots[i % slots.length];
    const prop = buildInteriorProp(kind);
    prop.position.set(slot.x, slot.y, slot.z);
    prop.rotation.y = slot.rotY;
    host.styleGroup.add(prop);
  });
  if (buildingName) {
    const floorNo = Math.floor(parseInt(unitNumber.match(/(\d+)/)?.[1] ?? '0', 10) / 100);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 0.5),
      new THREE.MeshBasicMaterial({
        map: createPlaqueTexture(
          host.isVillaMode ? `🏠 ${buildingName}` : `${buildingName} · ${floorNo}F`,
          '#0f172a',
          '#f8fafc',
          460,
        ),
      }),
    );
    if (host.isVillaMode) {
      // 1F landing, right wall beside the entrance (the left wall has the mailbox and stair notice)
      sign.rotation.y = -Math.PI / 2;
      sign.position.set(2.17, 2.05, -8.6);
    } else {
      // Far end of the corridor, facing the rider stepping out of the elevator
      sign.rotation.y = Math.PI;
      sign.position.set(0, 2.45, 7.97);
    }
    host.styleGroup.add(sign);
  }
}

/**
 * Sets up the shared interior for one delivery: layout (apartment / officetel corridor or villa stairwell),
 * the building's own theme and props (by its id), its name sign, and the target unit door.
 */
export function configureForUnit(
  host: CorridorRoom,
  targetUnitNumber: string,
  residenceKind: ResidenceKind = 'apartment',
  building?: { id: string; name: string },
): void {
  host.isVillaMode = residenceKind === 'walkup_villa';
  host.aptGroup.visible = !host.isVillaMode;
  host.villaGroup.visible = host.isVillaMode;
  host.applyInteriorStyle(
    pickInteriorStyle(residenceKind, building?.id ?? targetUnitNumber),
    building?.name,
    targetUnitNumber,
  );

  const numMatch = targetUnitNumber.match(/(\d+)/);
  const num = numMatch ? parseInt(numMatch[1], 10) : host.isVillaMode ? 302 : 1402;
  const floor = Math.floor(num / 100);
  const unitNum = num % 100;

  host.foodPlacedOnMat = false;
  host.placedFoodBag.visible = false;

  // Reset all doors closed and NPC state
  host.targetDoorOpenAngle = 0;
  host.currentDoorOpenAngle = 0;
  host.npcVisible = false;
  host.npcStepTarget = 0;
  host.npcStepCur = 0;
  host.npcArmReachTarget = 0;
  host.npcArmReachCur = 0;
  host.bellFlashTimer = 0;
  host.npcGroup.visible = false;
  host.npcHeldBag.visible = false;
  host.npcRightArmPivot.rotation.x = 0;

  const doors = host.getActiveDoors();

  if (host.isVillaMode) {
    // Villa has 6 fixed doors: index 0..1 = 2F (201/202), 2..3 = 3F (301/302), 4..5 = 4F (401/402)
    const clampedFloor = clamp(floor, 2, 4);
    const sideIdx = unitNum % 2 === 0 ? 1 : 0;
    host.targetDoorIndex = (clampedFloor - 2) * 2 + sideIdx;

    for (let i = 0; i < doors.length; i++) {
      doors[i].doorPivot.rotation.y = 0;
      const f = 2 + Math.floor(i / 2);
      const u = (i % 2) + 1;
      const label = `${f}0${u}호`;
      doors[i].unitNumber = label;
      const isTarget = i === host.targetDoorIndex;
      doors[i].bellLedMat.emissive.setHex(isTarget ? 0x22c55e : 0x38bdf8);
      doors[i].bellLedMat.emissiveIntensity = isTarget ? 1.5 : 0.35;

      const oldMap = doors[i].plaqueMat.map;
      doors[i].plaqueMat.map = createPlaqueTexture(
        label,
        isTarget ? '#065f46' : '#1e293b',
        isTarget ? '#a7f3d0' : '#f8fafc',
      );
      doors[i].plaqueMat.needsUpdate = true;
      if (oldMap) oldMap.dispose();
    }
  } else {
    const unitIdx = clamp(unitNum - 1, 0, 3);
    host.targetDoorIndex = unitIdx;

    // Reset real 3D Apartment Elevator Cabin at 1F ready to ride up to target floor!
    host.elevatorTargetFloor = clamp(floor, 2, 20);
    host.elevatorCurrentFloor = 1;
    host.elevatorPhase = 'idle_1f';
    host.elevatorStepTimer = 0;
    const floorsDelta = Math.max(1, host.elevatorTargetFloor - 1);
    // Total ride time smoothly scaled between ~2.0s (low floors) and ~3.4s (high floors)
    host.elevatorSecPerFloor = clamp(2.8 / floorsDelta, 0.18, 0.55);
    host.elevDoorOpenCur = 0;
    host.elevDoorOpenTarget = 0;
    host.elevRideVibeY = 0;
    host.elevDoorL.position.x = -0.46;
    host.elevDoorR.position.x = 0.46;
    host.elevBtnGlowMat.emissiveIntensity = 0.3;
    host.elevCallBtnMat.emissiveIntensity = 0.4;
    host.redrawElevatorLedDisplay(1, 'idle');

    for (let i = 0; i < doors.length; i++) {
      doors[i].doorPivot.rotation.y = 0;
      const label = `${floor}0${i + 1}호`;
      doors[i].unitNumber = label;
      const isTarget = i === host.targetDoorIndex;
      doors[i].bellLedMat.emissive.setHex(isTarget ? 0x22c55e : 0x38bdf8);
      doors[i].bellLedMat.emissiveIntensity = isTarget ? 1.4 : 0.35;

      const oldMap = doors[i].plaqueMat.map;
      doors[i].plaqueMat.map = createPlaqueTexture(
        label,
        isTarget ? '#065f46' : '#1e293b',
        isTarget ? '#a7f3d0' : '#f8fafc',
      );
      doors[i].plaqueMat.needsUpdate = true;
      if (oldMap) oldMap.dispose();
    }
  }

  const target = doors[host.targetDoorIndex];
  target.group.add(host.npcGroup);
  host.npcGroup.position.set(0.05, 0, -0.78);
  host.npcGroup.rotation.set(0, 0, 0);

  host.targetHighlightRing.position.set(target.matX, target.y + 0.032, target.matZ);
  host.targetHighlightRing.visible = true;
}
