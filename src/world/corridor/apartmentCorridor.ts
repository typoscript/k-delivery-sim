/** Modern apartment / officetel corridor: elevator cabin, 4 units per floor */
import * as THREE from 'three';
import type { CorridorRoom } from '../CorridorRoom';
import { APT_LIGHT_INTENSITY, createDoorSlot, createPlaqueTexture, createTileTexture } from './corridorParts';

export function buildApartmentCorridor(host: CorridorRoom): void {
  const width = 5.4;
  const length = 16.0;
  const height = 3.1;

  // Dedicated interior corridor lighting (independent of outdoor sun!)
  const ambient = new THREE.AmbientLight(0xfff7ed, 0.95);
  host.aptGroup.add(ambient);

  for (const lz of [-5.2, 0.0, 5.2]) {
    const pLight = new THREE.PointLight(0xfff1d6, APT_LIGHT_INTENSITY, 12, 1.5);
    pLight.position.set(0, height - 0.35, lz);
    host.aptGroup.add(pLight);
    host.aptLights.push(pLight);

    const fixture = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.35), host.aptFixtureMat);
    fixture.position.set(0, height - 0.05, lz);
    host.aptGroup.add(fixture);
  }

  const floorTex = createTileTexture('#d6d3cd', 'rgba(100,116,139,0.28)', 4, 12);
  host.aptFloorMat.map = floorTex;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, length), host.aptFloorMat);
  floor.rotation.x = -Math.PI / 2;
  host.aptGroup.add(floor);

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(width, length), host.aptCeilingMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = height;
  host.aptGroup.add(ceiling);

  const wallMat = host.aptWallMat;
  const trimMat = host.aptTrimMat;

  const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(length, height), wallMat);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(-width / 2, height / 2, 0);
  host.aptGroup.add(leftWall);

  const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(length, height), wallMat);
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(width / 2, height / 2, 0);
  host.aptGroup.add(rightWall);

  const farWall = new THREE.Mesh(new THREE.PlaneGeometry(width, height), wallMat);
  farWall.rotation.y = Math.PI;
  farWall.position.set(0, height / 2, length / 2);
  host.aptGroup.add(farWall);

  // End wall at z = -8.0 with doorway opening (x in [-0.92, 0.92], y in [0, 2.28]) leading into the 3D Elevator Cabin!
  const elevWallL = new THREE.Mesh(new THREE.PlaneGeometry(1.78, height), wallMat);
  elevWallL.position.set(-1.81, height / 2, -length / 2);
  const elevWallR = new THREE.Mesh(new THREE.PlaneGeometry(1.78, height), wallMat);
  elevWallR.position.set(1.81, height / 2, -length / 2);
  const elevWallTop = new THREE.Mesh(new THREE.PlaneGeometry(1.84, height - 2.28), wallMat);
  elevWallTop.position.set(0, 2.28 + (height - 2.28) * 0.5, -length / 2);
  host.aptGroup.add(elevWallL, elevWallR, elevWallTop);

  for (const side of [-1, 1]) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, length), trimMat);
    base.position.set(side * (width / 2 - 0.03), 0.07, 0);
    host.aptGroup.add(base);
  }

  // --- Interactive 3D Korean Apartment Elevator Cabin (z = -10.4 .. -8.0) & Sliding Steel Doors! ---
  const steelMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    metalness: 0.72,
    roughness: 0.3,
  });
  const cabinWallMat = new THREE.MeshStandardMaterial({
    color: 0xb8c2cc,
    metalness: 0.62,
    roughness: 0.32,
  });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.45, metalness: 0.4 });
  const mirrorMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    metalness: 0.92,
    roughness: 0.08,
  });

  // Corridor-side elevator doorframe (left/right jambs + header so opening stays clear!)
  const frameL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.38, 0.2), frameMat);
  frameL.position.set(-0.98, 1.19, -length / 2 + 0.04);
  const frameR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.38, 0.2), frameMat);
  frameR.position.set(0.98, 1.19, -length / 2 + 0.04);
  const frameTop = new THREE.Mesh(new THREE.BoxGeometry(2.12, 0.18, 0.2), frameMat);
  frameTop.position.set(0, 2.34, -length / 2 + 0.04);

  // Animated Sliding Stainless-Steel Elevator Doors
  host.elevDoorL = new THREE.Mesh(new THREE.BoxGeometry(0.92, 2.24, 0.08), steelMat);
  host.elevDoorL.position.set(-0.46, 1.12, -length / 2 + 0.04);
  host.elevDoorR = new THREE.Mesh(new THREE.BoxGeometry(0.92, 2.24, 0.08), steelMat);
  host.elevDoorR.position.set(0.46, 1.12, -length / 2 + 0.04);

  // Live Dynamic LED Floor Display Texture (shared by corridor header + inside-cabin header!)
  host.elevLedCanvas = document.createElement('canvas');
  host.elevLedCanvas.width = 256;
  host.elevLedCanvas.height = 96;
  host.elevLedCtx = host.elevLedCanvas.getContext('2d')!;
  host.elevLedTex = new THREE.CanvasTexture(host.elevLedCanvas);
  host.elevLedTex.colorSpace = THREE.SRGBColorSpace;
  host.redrawElevatorLedDisplay(1, 'idle');

  const ledMat = new THREE.MeshBasicMaterial({ map: host.elevLedTex });
  const elevCorridorLed = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.32), ledMat);
  elevCorridorLed.position.set(0, 2.66, -length / 2 + 0.06);

  // Corridor-side elevator call button
  host.elevCallBtnMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    emissive: 0xf59e0b,
    emissiveIntensity: 0.7,
  });
  const callBtn = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.32, 0.06), host.elevCallBtnMat);
  callBtn.position.set(1.32, 1.15, -length / 2 + 0.05);
  host.aptGroup.add(frameL, frameR, frameTop, host.elevDoorL, host.elevDoorR, elevCorridorLed, callBtn);

  // Walkable 3D Elevator Cabin Enclosure (x in [-1.14, 1.14], z in [-10.4, -8.0], h = 2.62)
  const cabinW = 2.28;
  const cabinD = 2.4;
  const cabinH = 2.62;
  const cabinCz = -length / 2 - cabinD * 0.5; // -9.2

  const cabinFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(cabinW, cabinD),
    new THREE.MeshStandardMaterial({
      map: createTileTexture('#475569', 'rgba(226,232,240,0.35)', 2, 2),
      roughness: 0.42,
      metalness: 0.15,
    })
  );
  cabinFloor.rotation.x = -Math.PI / 2;
  cabinFloor.position.set(0, 0.005, cabinCz);

  const cabinCeil = new THREE.Mesh(
    new THREE.PlaneGeometry(cabinW, cabinD),
    new THREE.MeshBasicMaterial({ color: 0xfefce8 })
  );
  cabinCeil.rotation.x = Math.PI / 2;
  cabinCeil.position.set(0, cabinH, cabinCz);

  const cabinLight = new THREE.PointLight(0xfffbeb, 8.5, 6.5, 1.4);
  cabinLight.position.set(0, cabinH - 0.2, cabinCz);

  const cabBack = new THREE.Mesh(new THREE.PlaneGeometry(cabinW, cabinH), cabinWallMat);
  cabBack.position.set(0, cabinH / 2, cabinCz - cabinD / 2);

  const cabLeft = new THREE.Mesh(new THREE.PlaneGeometry(cabinD, cabinH), cabinWallMat);
  cabLeft.rotation.y = Math.PI / 2;
  cabLeft.position.set(-cabinW / 2, cabinH / 2, cabinCz);

  const cabRight = new THREE.Mesh(new THREE.PlaneGeometry(cabinD, cabinH), cabinWallMat);
  cabRight.rotation.y = -Math.PI / 2;
  cabRight.position.set(cabinW / 2, cabinH / 2, cabinCz);

  // Interior front transom above cabin door + live LED floor display facing inside cabin!
  const cabFrontTop = new THREE.Mesh(new THREE.PlaneGeometry(cabinW, cabinH - 2.24), cabinWallMat);
  cabFrontTop.rotation.y = Math.PI;
  cabFrontTop.position.set(0, 2.24 + (cabinH - 2.24) * 0.5, -length / 2 - 0.02);

  const cabLed = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.3), ledMat);
  cabLed.rotation.y = Math.PI;
  cabLed.position.set(0, 2.42, -length / 2 - 0.04);

  // Rear wall mirror & stainless handrail (classic Korean apartment elevator!)
  const cabMirror = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.25), mirrorMat);
  cabMirror.position.set(0, 1.52, cabinCz - cabinD / 2 + 0.02);
  const cabRailBack = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 1.9, 8), steelMat);
  cabRailBack.rotation.z = Math.PI / 2;
  cabRailBack.position.set(0, 0.92, cabinCz - cabinD / 2 + 0.1);

  // Left wall apartment elevator notice board
  const cabNotice = new THREE.Mesh(
    new THREE.PlaneGeometry(0.75, 0.95),
    new THREE.MeshBasicMaterial({
      map: createPlaqueTexture('아파트 안내\n금연 · CCTV', '#1e3a8a', '#e0f2fe'),
    })
  );
  cabNotice.rotation.y = Math.PI / 2;
  cabNotice.position.set(-cabinW / 2 + 0.02, 1.5, cabinCz);

  // Right wall Interactive Floor Button Panel (층수 조작반)
  const panelBack = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.15, 0.42), frameMat);
  panelBack.position.set(cabinW / 2 - 0.04, 1.25, -length / 2 - 0.55);

  host.elevBtnGlowMat = new THREE.MeshStandardMaterial({
    color: 0xfef08a,
    emissive: 0xf59e0b,
    emissiveIntensity: 0.25,
  });
  const inactiveBtnMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4 });
  // Mini 2x6 floor button matrix + glowing highlighted target button!
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 2; col++) {
      const isLit = row === 4 && col === 1;
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(0.025, 0.065, 0.065),
        isLit ? host.elevBtnGlowMat : inactiveBtnMat
      );
      b.position.set(
        cabinW / 2 - 0.075,
        0.92 + row * 0.11,
        -length / 2 - 0.46 - col * 0.16
      );
      host.aptGroup.add(b);
    }
  }

  host.aptGroup.add(
    cabinFloor,
    cabinCeil,
    cabinLight,
    cabBack,
    cabLeft,
    cabRight,
    cabFrontTop,
    cabLed,
    cabMirror,
    cabRailBack,
    cabNotice,
    panelBack
  );

  const doorConfigs: Array<{ x: number; y: number; z: number; facingX: number; defaultUnit: string }> = [
    { x: -width / 2 + 0.04, y: 0, z: -1.6, facingX: 1, defaultUnit: '1401호' },
    { x: width / 2 - 0.04, y: 0, z: -1.6, facingX: -1, defaultUnit: '1402호' },
    { x: -width / 2 + 0.04, y: 0, z: 4.0, facingX: 1, defaultUnit: '1403호' },
    { x: width / 2 - 0.04, y: 0, z: 4.0, facingX: -1, defaultUnit: '1404호' },
  ];

  for (const cfg of doorConfigs) {
    const slot = createDoorSlot(cfg.x, cfg.y, cfg.z, cfg.facingX, cfg.defaultUnit, 0x3b4859);
    host.aptGroup.add(slot.group);
    host.aptDoors.push(slot);
  }
}
