import * as THREE from 'three';
import type { RoadHazardManager } from '../RoadHazardManager';
import { ACTIVE_MAP_DATA } from '../../data/suwonDistricts';
import { wrapAngle } from '../../types';
import { SIGNAL_STOP_LINE_OFFSET, edgeDirection, getSignalAxis, laneBlendDecay, signalSpeedCap } from '../TrafficRules';
import { HazardFrame } from './hazardTypes';

export function buildRivalRiders(host: RoadHazardManager): void {
  const styles: Array<[number, string, number, number]> = [
    [0x14b8a6, '#14b8a6', 0x0f766e, 11.4],
    [0xf97316, '#f97316', 0xc2410c, 12.1],
    [0x3b82f6, '#3b82f6', 0x1d4ed8, 10.9],
    [0xeab308, '#eab308', 0x334155, 11.7],
  ];

  const tireMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4, metalness: 0.3 });
  const helmetMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.25 });
  const visorMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.15, metalness: 0.6 });
  const headLightMat = new THREE.MeshStandardMaterial({ color: 0xfef9c3, emissive: 0xfef08a, emissiveIntensity: 2.2 });
  const tailLightMat = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 1.8 });

  const pool = host.majorNodeIds.length > 0 ? host.majorNodeIds : ACTIVE_MAP_DATA.nodes.map((n) => n.id);

  styles.forEach(([boxHex, colorCss, jacketHex, cruiseSpeed], idx) => {
    const startNode = pool[Math.floor((idx * pool.length) / styles.length + 3) % pool.length];
    const outs = host.adj[startNode];
    const chosen = outs[0];
    if (!chosen) return;

    const g = new THREE.Group();
    const boxMat = new THREE.MeshStandardMaterial({ color: boxHex, roughness: 0.4 });
    const jacketMat = new THREE.MeshStandardMaterial({ color: jacketHex, roughness: 0.78 });

    for (const wz of [-0.62, 0.62]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.14, 10), tireMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(0, 0.26, wz);
      g.add(wheel);
    }
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.42, 1.38), frameMat);
    body.position.set(0, 0.56, 0);
    const front = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.28), frameMat);
    front.position.set(0, 0.84, 0.55);
    const topBox = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.5, 0.52), boxMat);
    topBox.position.set(0, 1.05, -0.58);
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.05), headLightMat);
    hl.position.set(0, 0.94, 0.7);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.05), tailLightMat);
    tl.position.set(0, 0.74, -0.72);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.54, 0.28), jacketMat);
    torso.position.set(0, 1.15, -0.02);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), helmetMat);
    helmet.position.set(0, 1.56, 0.04);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, 0.12), visorMat);
    visor.position.set(0, 1.56, 0.16);
    g.add(body, front, topBox, hl, tl, torso, helmet, visor);

    const pose = host.computeEdgePose(startNode, chosen.to, chosen.dist * 0.3, chosen.dist, chosen.width, 0.22);
    g.position.set(pose.x, 0, pose.z);
    g.rotation.y = pose.heading;
    host.root.add(g);

    const id = `rival-${idx + 1}`;
    host.rivalRiders.push({
      id,
      group: g,
      color: colorCss,
      fromNode: startNode,
      toNode: chosen.to,
      edgeDist: chosen.dist,
      edgeWidth: chosen.width,
      progress: chosen.dist * 0.3,
      x: pose.x,
      z: pose.z,
      heading: pose.heading,
      speed: cruiseSpeed,
      cruiseSpeed,
      blendX: 0,
      blendZ: 0,
    });
    host.rivalRiderMarkers.push({
      id,
      x: pose.x,
      z: pose.z,
      heading: pose.heading,
      color: colorCss,
    });
  });
}

/** Per frame: rival delivery scooters drive the road graph */
export function stepRivalRiders(host: RoadHazardManager, f: HazardFrame): void {
  const nodes = ACTIVE_MAP_DATA.nodes;
  for (let ri = 0; ri < host.rivalRiders.length; ri++) {
    const r = host.rivalRiders[ri];
    const fx = Math.sin(r.heading);
    const fz = Math.cos(r.heading);
    const targetNode = nodes[r.toNode];
    const distToNode = Math.max(0, r.edgeDist - r.progress);

    let mustStop = false;
    let signalCap = Infinity;
    if (targetNode.isSignal) {
      const d = edgeDirection(r.fromNode, r.toNode);
      const sig = getSignalAxis(r.toNode, d.fx, d.fz) === 'ns' ? f.signalState.ns : f.signalState.ew;
      signalCap = signalSpeedCap(r.speed, distToNode - SIGNAL_STOP_LINE_OFFSET, sig);
    }

    const toPlX = f.scooter.x - r.x;
    const toPlZ = f.scooter.z - r.z;
    const distPl = Math.hypot(toPlX, toPlZ);
    const aheadDot = distPl > 0.1 ? (toPlX * fx + toPlZ * fz) / distPl : 0;
    if (distPl < 5.2 && aheadDot > 0.72) mustStop = true;

    const targetSpd = mustStop ? 0 : Math.min(r.cruiseSpeed, signalCap);
    const rBraking = targetSpd < r.speed;
    r.speed += (targetSpd - r.speed) * Math.min(1, f.dt * (rBraking ? 9 : 4.2));
    const rTravel = r.speed * f.dt;
    r.progress += rTravel;
    const rDecay = laneBlendDecay(rTravel);
    r.blendX *= rDecay;
    r.blendZ *= rDecay;

    if (r.progress >= r.edgeDist) {
      const nextEd = host.pickNextGraphEdge(r.fromNode, r.toNode, false);
      const carry = r.progress - r.edgeDist;
      r.fromNode = r.toNode;
      r.toNode = nextEd.to;
      r.edgeDist = nextEd.dist;
      r.edgeWidth = nextEd.width;
      r.progress = Math.min(carry, Math.max(0, r.edgeDist - 0.2));
      const np = host.computeEdgePose(r.fromNode, r.toNode, r.progress, r.edgeDist, r.edgeWidth, 0.22);
      r.blendX = r.x - np.x;
      r.blendZ = r.z - np.z;
    }

    const pose = host.computeEdgePose(r.fromNode, r.toNode, r.progress, r.edgeDist, r.edgeWidth, 0.22);
    r.x = pose.x + r.blendX;
    r.z = pose.z + r.blendZ;
    r.heading = wrapAngle(r.heading + wrapAngle(pose.heading - r.heading) * Math.min(1, f.dt * 9));
    r.group.position.set(r.x, 0, r.z);
    r.group.rotation.y = r.heading;

    host.rivalRiderMarkers[ri].x = r.x;
    host.rivalRiderMarkers[ri].z = r.z;
    host.rivalRiderMarkers[ri].heading = r.heading;
  }
}
