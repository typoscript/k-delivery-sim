/** Old walk-up villa stairwell: no elevator, 1F~4F terrazzo stairs on foot */
import * as THREE from 'three';
import type { CorridorRoom } from '../CorridorRoom';
import { VILLA_STAIR_FLIGHTS, createDoorSlot, createPlaqueTexture, createTileTexture } from './corridorParts';

/**
 * Builds a realistic 4-story Korean Walk-up Villa (구축 빌라 계단실, 엘리베이터 없음):
 * - 1F entrance (z=-10..-7.2, y=0) with metal exit door + mailboxes
 * - 3 terrazzo stair flights (1F->2F, 2F->3F, 3F->4F) with green iron handrails
 * - 2F, 3F, 4F landings with 2 hinged doors each (201/202, 301/302, 401/402) + painted floor markers
 */
export function buildWalkupVillaStairwell(host: CorridorRoom): void {
  const width = 5.4;
  const zMin = -10.0;
  const zMax = 13.4;
  const totalLen = zMax - zMin;
  const zCenter = (zMin + zMax) * 0.5;
  const maxWallH = 10.4;

  const ambient = new THREE.AmbientLight(0xfff5e4, 0.88);
  host.villaGroup.add(ambient);

  // Classic Korean villa stairwell materials: terrazzo floor, cream plaster + jade green wainscot
  const terrazzoTex = createTileTexture('#c8c2b8', 'rgba(71,85,105,0.34)', 3, 2);
  const terrazzoMat = host.villaFloorMat;
  terrazzoMat.map = terrazzoTex;
  const stairStepMat = new THREE.MeshStandardMaterial({ color: 0xbeb7ac, roughness: 0.78 });
  const nosingMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.55 });
  const upperWallMat = host.villaWallMat;
  const dadoWallMat = host.villaDadoMat;
  const railMat = host.villaRailMat;
  const ceilingMat = host.villaCeilingMat;
  const fixtureMat = host.villaFixtureMat;

  // Enclosing side walls & end walls
  const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(totalLen, maxWallH), upperWallMat);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(-width / 2, maxWallH / 2, zCenter);
  host.villaGroup.add(leftWall);

  const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(totalLen, maxWallH), upperWallMat);
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(width / 2, maxWallH / 2, zCenter);
  host.villaGroup.add(rightWall);

  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(width, 4.0), upperWallMat);
  backWall.position.set(0, 2.0, zMin);
  host.villaGroup.add(backWall);

  const topFarWall = new THREE.Mesh(new THREE.PlaneGeometry(width, 4.2), upperWallMat);
  topFarWall.rotation.y = Math.PI;
  topFarWall.position.set(0, 6.6 + 2.1, zMax);
  host.villaGroup.add(topFarWall);

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
    host.villaGroup.add(slab);

    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(width, len), ceilingMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, ld.y + 3.1, cz);
    host.villaGroup.add(ceil);

    // Jade dado accent stripes on landing walls
    for (const side of [-1, 1]) {
      const dado = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.05, len), dadoWallMat);
      dado.position.set(side * (width / 2 - 0.025), ld.y + 0.52, cz);
      host.villaGroup.add(dado);
    }

    // Warm stairwell sensor light per floor
    const light = new THREE.PointLight(0xffefc8, 10.5, 11, 1.45);
    light.position.set(0, ld.y + 2.75, cz);
    host.villaGroup.add(light);

    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.26), fixtureMat);
    lamp.position.set(0, ld.y + 3.04, cz);
    host.villaGroup.add(lamp);

    // Painted Floor Number Badge on left wall (2F, 3F, 4F)
    if (ld.floor >= 2) {
      const floorSign = new THREE.Mesh(
        new THREE.PlaneGeometry(0.95, 0.44),
        new THREE.MeshBasicMaterial({
          map: createPlaqueTexture(`${ld.floor}F 원룸·빌라`, '#064e3b', '#ecfdf5'),
        })
      );
      floorSign.rotation.y = Math.PI / 2;
      floorSign.position.set(-width / 2 + 0.03, ld.y + 2.25, ld.zStart + 0.55);
      host.villaGroup.add(floorSign);
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
      host.villaGroup.add(stepMesh);

      // Dark anti-slip rubber stair nosing strip on each step edge
      const nose = new THREE.Mesh(new THREE.BoxGeometry(width - 0.16, 0.025, 0.06), nosingMat);
      nose.position.set(0, sy + 0.008, sz - stepDepth * 0.45);
      host.villaGroup.add(nose);
    }

    // Sloped ceiling above stair flight
    const slopeLen = Math.hypot(flightLen, flightRise) + 0.3;
    const slopeAngle = Math.atan2(flightRise, flightLen);
    const midZ = (fl.zStart + fl.zEnd) * 0.5;
    const midY = (fl.yStart + fl.yEnd) * 0.5;
    const sCeil = new THREE.Mesh(new THREE.PlaneGeometry(width, slopeLen), ceilingMat);
    sCeil.rotation.x = Math.PI / 2 - slopeAngle;
    sCeil.position.set(0, midY + 3.15, midZ);
    host.villaGroup.add(sCeil);

    // Left & Right Green Iron Handrails along the stairs
    for (const side of [-1, 1]) {
      const railX = side * (width / 2 - 0.18);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, slopeLen), railMat);
      rail.rotation.x = -slopeAngle;
      rail.position.set(railX, midY + 0.96, midZ);
      host.villaGroup.add(rail);

      for (const frac of [0.15, 0.5, 0.85]) {
        const pz = fl.zStart + flightLen * frac;
        const py = fl.yStart + flightRise * frac;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.95, 0.05), railMat);
        post.position.set(railX, py + 0.48, pz);
        host.villaGroup.add(post);
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
    new THREE.PlaneGeometry(1.55, 0.36),
    new THREE.MeshBasicMaterial({ map: createPlaqueTexture('🚪 1F 원룸·빌라 출구', '#065f46', '#fef08a') })
  );
  exitLabel.position.set(0, 2.58, zMin + 0.08);

  // Classic Korean metal oneroom/villa mailbox bank & parcel shelf on right wall near 1F entrance
  const mailbox = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.88, 1.2),
    new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.55, roughness: 0.4 })
  );
  mailbox.position.set(width / 2 - 0.1, 1.4, -8.6);
  const stairNotice = new THREE.Mesh(
    new THREE.PlaneGeometry(1.35, 0.48),
    new THREE.MeshBasicMaterial({
      map: createPlaqueTexture('🪜 원룸 계단실 (E/V없음)', '#0f172a', '#fde68a'),
    })
  );
  stairNotice.rotation.y = Math.PI / 2;
  stairNotice.position.set(-width / 2 + 0.03, 1.95, -8.4);
  host.villaGroup.add(exitFrame, exitDoor, exitLabel, mailbox, stairNotice);

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
    const slot = createDoorSlot(cfg.x, cfg.y, cfg.z, cfg.facingX, cfg.unit, 0x5c4338);
    host.villaGroup.add(slot.group);
    host.villaDoors.push(slot);
  }
}
