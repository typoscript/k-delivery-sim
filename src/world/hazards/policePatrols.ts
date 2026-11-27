import * as THREE from 'three';
import type { RoadHazardManager } from '../RoadHazardManager';
import { ACTIVE_MAP_DATA } from '../../data/suwonDistricts';
import { wrapAngle } from '../../types';
import { SIGNAL_STOP_LINE_OFFSET, edgeDirection, getSignalAxis, laneBlendDecay, signalSpeedCap } from '../TrafficRules';
import { HazardFrame, PATROL_ENFORCEMENT_FINE, PATROL_SPEED_LIMIT_KMH, SpeedCameraTriggerEvent } from './hazardTypes';

function createPoliceSideTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 256, 96);
  ctx.fillStyle = '#1d4ed8';
  ctx.fillRect(0, 52, 256, 44);
  ctx.fillStyle = '#facc15';
  ctx.fillRect(0, 48, 256, 6);
  ctx.fillStyle = '#0f172a';
  ctx.font = '900 24px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('경기남부경찰', 128, 30);
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 26px sans-serif';
  ctx.fillText('POLICE 112', 128, 82);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildPolicePatrols(host: RoadHazardManager): void {
  const sideTex = createPoliceSideTexture();
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35, metalness: 0.2 });
  const sideMat = new THREE.MeshStandardMaterial({ map: sideTex, roughness: 0.35 });
  const blueHoodMat = new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.35 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.15, metalness: 0.6 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9 });

  const pool = host.majorNodeIds.length > 0 ? host.majorNodeIds : ACTIVE_MAP_DATA.nodes.map((n) => n.id);
  const labels = ['경기남부청 인계지구대 1호차', '수원남부서 효원로 순찰차'];

  for (let i = 0; i < 2; i++) {
    const startNode = pool[Math.floor((i * pool.length) / 2) % pool.length];
    const outs = host.adj[startNode];
    const chosen = outs.find((e) => e.isMajor) ?? outs[0];
    if (!chosen) continue;

    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.92, 0.72, 4.32),
      [sideMat, sideMat, whiteMat, whiteMat, blueHoodMat, blueHoodMat]
    );
    body.position.y = 0.7;
    body.castShadow = true;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.58, 2.2), whiteMat);
    cabin.position.set(0, 1.32, -0.14);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.44, 2.0), glassMat);
    glass.position.set(0, 1.32, -0.14);

    const redBarMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xef4444,
      emissiveIntensity: 2.5,
    });
    const blueBarMat = new THREE.MeshStandardMaterial({
      color: 0x3b82f6,
      emissive: 0x3b82f6,
      emissiveIntensity: 0.2,
    });
    const redBar = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.16, 0.28), redBarMat);
    redBar.position.set(-0.32, 1.7, -0.1);
    const blueBar = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.16, 0.28), blueBarMat);
    blueBar.position.set(0.32, 1.7, -0.1);

    for (const [wx, wz] of [
      [-0.92, 1.3],
      [0.92, 1.3],
      [-0.92, -1.3],
      [0.92, -1.3],
    ]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 10), tireMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(wx, 0.34, wz);
      g.add(w);
    }
    g.add(body, cabin, glass, redBar, blueBar);

    const pose = host.computeEdgePose(startNode, chosen.to, chosen.dist * 0.4, chosen.dist, chosen.width);
    g.position.set(pose.x, 0, pose.z);
    g.rotation.y = pose.heading;
    host.root.add(g);

    const id = `patrol-${i + 1}`;
    host.patrolCars.push({
      id,
      label: labels[i],
      group: g,
      redBarMat,
      blueBarMat,
      fromNode: startNode,
      toNode: chosen.to,
      edgeDist: chosen.dist,
      edgeWidth: chosen.width,
      progress: chosen.dist * 0.4,
      x: pose.x,
      z: pose.z,
      heading: pose.heading,
      speed: 9.2,
      cruiseSpeed: 9.6,
      sirenTimer: 0,
      citeCooldown: 0,
      blendX: 0,
      blendZ: 0,
    });
    host.patrolMarkers.push({
      id,
      x: pose.x,
      z: pose.z,
      heading: pose.heading,
      sirenActive: false,
    });
  }
}

/** Per frame: patrol cars drive the road graph (signals, stop for the rider) and ticket speeding riders nearby */
export function stepPolicePatrols(host: RoadHazardManager, f: HazardFrame, onPolicePatrolCite?: (ev: SpeedCameraTriggerEvent) => void): void {
  const nodes = ACTIVE_MAP_DATA.nodes;
  // --- 2. Patrolling Police Cars (Graph Walking + Live >60km/h Enforcement!) ---
  const policeBlink = Math.floor(f.elapsedTime * 7.0) % 2 === 0;
  for (let pi = 0; pi < host.patrolCars.length; pi++) {
    const p = host.patrolCars[pi];
    if (p.citeCooldown > 0) p.citeCooldown = Math.max(0, p.citeCooldown - f.dt);
    if (p.sirenTimer > 0) p.sirenTimer = Math.max(0, p.sirenTimer - f.dt);

    p.redBarMat.emissiveIntensity = policeBlink ? (p.sirenTimer > 0 ? 4.5 : 2.6) : 0.15;
    p.blueBarMat.emissiveIntensity = !policeBlink ? (p.sirenTimer > 0 ? 4.5 : 2.6) : 0.15;

    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    const targetNode = nodes[p.toNode];
    const distToNode = Math.max(0, p.edgeDist - p.progress);

    let mustStop = false;
    let signalCap = Infinity;
    if (targetNode.isSignal) {
      const d = edgeDirection(p.fromNode, p.toNode);
      const sig = getSignalAxis(p.toNode, d.fx, d.fz) === 'ns' ? f.signalState.ns : f.signalState.ew;
      signalCap = signalSpeedCap(p.speed, distToNode - SIGNAL_STOP_LINE_OFFSET, sig);
    }

    const toRiderX = f.scooter.x - p.x;
    const toRiderZ = f.scooter.z - p.z;
    const distRider = Math.hypot(toRiderX, toRiderZ);
    const aheadDot = distRider > 0.1 ? (toRiderX * fx + toRiderZ * fz) / distRider : 0;
    if (distRider < 6.8 && aheadDot > 0.72) mustStop = true;

    const targetSpd = mustStop ? 0 : Math.min(p.cruiseSpeed, signalCap);
    const braking = targetSpd < p.speed;
    p.speed += (targetSpd - p.speed) * Math.min(1, f.dt * (braking ? 8 : 3.5));
    const pTravel = p.speed * f.dt;
    p.progress += pTravel;
    const pDecay = laneBlendDecay(pTravel);
    p.blendX *= pDecay;
    p.blendZ *= pDecay;

    if (p.progress >= p.edgeDist) {
      const nextEd = host.pickNextGraphEdge(p.fromNode, p.toNode, true);
      const carry = p.progress - p.edgeDist;
      p.fromNode = p.toNode;
      p.toNode = nextEd.to;
      p.edgeDist = nextEd.dist;
      p.edgeWidth = nextEd.width;
      p.progress = Math.min(carry, Math.max(0, p.edgeDist - 0.2));
      const np = host.computeEdgePose(p.fromNode, p.toNode, p.progress, p.edgeDist, p.edgeWidth);
      p.blendX = p.x - np.x;
      p.blendZ = p.z - np.z;
    }

    const pose = host.computeEdgePose(p.fromNode, p.toNode, p.progress, p.edgeDist, p.edgeWidth);
    p.x = pose.x + p.blendX;
    p.z = pose.z + p.blendZ;
    p.heading = wrapAngle(p.heading + wrapAngle(pose.heading - p.heading) * Math.min(1, f.dt * 8));
    p.group.position.set(p.x, 0, p.z);
    p.group.rotation.y = p.heading;

    if (
      f.scooter.isRiding &&
      !f.scooter.crashed &&
      p.citeCooldown <= 0 &&
      distRider <= 22.0 &&
      f.speedKmh > PATROL_SPEED_LIMIT_KMH
    ) {
      p.citeCooldown = 18.0;
      p.sirenTimer = 4.5;
      onPolicePatrolCite?.({
        cameraId: p.id,
        label: p.label,
        kind: 'patrol_speeding',
        measuredKmh: Math.round(f.speedKmh),
        limitKmh: PATROL_SPEED_LIMIT_KMH,
        fine: PATROL_ENFORCEMENT_FINE,
      });
    }

    host.patrolMarkers[pi].x = p.x;
    host.patrolMarkers[pi].z = p.z;
    host.patrolMarkers[pi].heading = p.heading;
    host.patrolMarkers[pi].sirenActive = p.sirenTimer > 0;
  }
}
