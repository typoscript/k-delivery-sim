/** Road ribbons, junctions, crosswalks, manholes and the wet-asphalt shader (legacy maps; the open world streams roads per chunk) */
import * as THREE from 'three';
import { excludeFromMirrors, freezeStatic } from './renderLayers';
import { buildInstanced, placeMatrix, NEARBY_INSTANCES } from './instancing';
import { createAsphaltTexture, createManholeTexture, createPuddleRoughnessTexture } from './cityTextures';
import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import type { CityWorld } from './CityWorld';

export interface SignalHazardZone {
  x: number;
  z: number;
  manholes: Array<[number, number]>;
  crosswalkRadius: number;
}

/** Zebra stripe size (stop lines reuse the same instanced geometry, scaled) */
const STRIPE_W = 0.65;
const STRIPE_L = 2.3;
/** Stop line: 0.45 m wide, ~2.4 m behind the crosswalk centre (crosswalk is 2.3 m deep) */
const STOP_LINE_W = 0.45;
const STOP_LINE_FROM_CROSSWALK_M = 2.4;

/** Renders all 218 real Suwon Ingye-dong OSM roads, 나혜석거리 pedestrian plaza, crosswalks & manholes */
export function buildSuwonOsmRoads(host: CityWorld): void {
  host.asphaltMat = new THREE.MeshStandardMaterial({
    map: createAsphaltTexture(),
    roughnessMap: createPuddleRoughnessTexture(),
    roughness: 0.9,
    metalness: 0.04,
  });
  enhanceWetAsphaltMaterial(host, host.asphaltMat);

  host.crosswalkPaintMat = new THREE.MeshStandardMaterial({
    color: 0xf1f5f9,
    roughness: 0.78,
    metalness: 0.05,
  });
  host.manholeMat = new THREE.MeshStandardMaterial({
    map: createManholeTexture(),
    color: 0x6b7280,
    roughness: 0.55,
    metalness: 0.78,
  });

  const yellowLineMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
  const whiteEdgeMat = new THREE.MeshBasicMaterial({ color: 0xe2e8f0 });
  const plazaMat = new THREE.MeshStandardMaterial({ color: 0xc29e83, roughness: 0.84 });

  const nodes = ACTIVE_MAP_DATA.nodes;
  const edges = ACTIVE_MAP_DATA.edges;
  host.plazaMat = plazaMat;

  // Track max width incident to each node for smooth circular asphalt junction caps
  const nodeMaxW = new Float32Array(nodes.length);

  // Unified open world: road surfaces stream in per chunk (merged meshes); only junction props are built here
  for (const e of host.unified ? [] : edges) {
    const na = nodes[e.a];
    const nb = nodes[e.b];
    const dx = nb.x - na.x;
    const dz = nb.z - na.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.5) continue;

    nodeMaxW[e.a] = Math.max(nodeMaxW[e.a], e.width);
    nodeMaxW[e.b] = Math.max(nodeMaxW[e.b], e.width);

    const mx = (na.x + nb.x) * 0.5;
    const mz = (na.z + nb.z) * 0.5;
    const heading = Math.atan2(dx, dz); // 0 = +Z

    const yLevel = e.isMajor ? 0.042 : 0.032;
    const roadMesh = new THREE.Mesh(new THREE.PlaneGeometry(e.width, len), host.asphaltMat);
    roadMesh.rotation.order = 'YXZ';
    roadMesh.rotation.y = heading;
    roadMesh.rotation.x = -Math.PI / 2;
    roadMesh.position.set(mx, yLevel, mz);
    roadMesh.receiveShadow = true;
    host.root.add(roadMesh);

    // Center yellow dashed line on major Suwon boulevards (효원로, 권광로, 경수대로, 권선로)
    if (e.isMajor && len >= 10) {
      const dashStep = 9.0;
      const count = Math.floor((len - 4) / dashStep);
      for (let i = 0; i < count; i++) {
        const frac = (i + 0.5) / count;
        const px = na.x + dx * frac;
        const pz = na.z + dz * frac;
        const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 4.0), yellowLineMat);
        dash.rotation.order = 'YXZ';
        dash.rotation.y = heading;
        dash.rotation.x = -Math.PI / 2;
        dash.position.set(px, yLevel + 0.012, pz);
        host.root.add(dash);
      }
    } else if (!e.isMajor && len >= 14) {
      // Subtle white side shoulder lines on residential streets
      const edgeLine = new THREE.Mesh(new THREE.PlaneGeometry(0.14, len - 4), whiteEdgeMat);
      edgeLine.rotation.order = 'YXZ';
      edgeLine.rotation.y = heading;
      edgeLine.rotation.x = -Math.PI / 2;
      edgeLine.position.set(mx, yLevel + 0.01, mz);
      edgeLine.visible = false; // keep alleyways clean
    }
  }

  // Smooth circular asphalt discs at road nodes so arbitrary-angle junctions connect seamlessly!
  const discGeo = new THREE.CircleGeometry(1, 14);
  discGeo.rotateX(-Math.PI / 2);
  const activeNodes = host.unified ? [] : nodes.filter((n) => nodeMaxW[n.id] > 0);
  const discInst = new THREE.InstancedMesh(discGeo, host.asphaltMat, activeNodes.length);
  discInst.receiveShadow = true;
  const dummy = new THREE.Object3D();
  activeNodes.forEach((n, idx) => {
    const r = nodeMaxW[n.id] * 0.51;
    dummy.position.set(n.x, nodeMaxW[n.id] >= 11 ? 0.043 : 0.033, n.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(r, 1, r);
    dummy.updateMatrix();
    discInst.setMatrixAt(idx, dummy.matrix);
  });
  host.root.add(discInst);

  // Pedestrian Plazas (나혜석거리 / 행리단길 / 수원역 로데오!)
  for (const pl of ACTIVE_MAP_DATA.pedestrianPlazas) {
    for (let i = 0; i < pl.pts.length - 1; i++) {
      const [ax, az] = pl.pts[i];
      const [bx, bz] = pl.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1) continue;
      const heading = Math.atan2(bx - ax, bz - az);
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(pl.width, len + 1.5), plazaMat);
      strip.rotation.order = 'YXZ';
      strip.rotation.y = heading;
      strip.rotation.x = -Math.PI / 2;
      strip.position.set((ax + bx) * 0.5, 0.055, (az + bz) * 0.5);
      strip.receiveShadow = true;
      host.root.add(strip);
    }
  }

  // Crosswalks & Wet Metallic Manhole Covers at Signalized Suwon Intersections!
  const manholeGeo = new THREE.CylinderGeometry(0.74, 0.78, 0.032, 14);
  const manholePositions: Array<[number, number]> = [];
  const stripeGeo = new THREE.PlaneGeometry(STRIPE_W, STRIPE_L);
  stripeGeo.rotateX(-Math.PI / 2);

  const signalNodes = nodes.filter((n) => n.isSignal);
  // Incident edges per node (avoids scanning every edge for every signal on the 8,000-edge city graph)
  const incident = new Map<number, typeof edges>();
  for (const e of edges) {
    for (const id of [e.a, e.b]) {
      const list = incident.get(id);
      if (list) list.push(e);
      else incident.set(id, [e]);
    }
  }
  const crosswalkMatrices: THREE.Matrix4[] = [];
  for (const sn of signalNodes) {
    const localManholes: Array<[number, number]> = [
      [sn.x + 2.8, sn.z + 2.8],
      [sn.x - 2.8, sn.z - 2.6],
    ];
    manholePositions.push(...localManholes);
    host.signalHazardZones.push({
      x: sn.x,
      z: sn.z,
      manholes: localManholes,
      crosswalkRadius: 11.0,
    });

    // Place crosswalk zebra bars on each incident road edge (~7.8m out from junction center)
    for (const e of incident.get(sn.id) ?? []) {
      if (e.dist < 16) continue;
      const other = nodes[e.a === sn.id ? e.b : e.a];
      const dx = other.x - sn.x;
      const dz = other.z - sn.z;
      const len = Math.hypot(dx, dz) || 1;
      const ux = dx / len;
      const uz = dz / len;
      const rx = -uz;
      const rz = ux;
      const heading = Math.atan2(dx, dz);

      const cwCenterX = sn.x + ux * 7.8;
      const cwCenterZ = sn.z + uz * 7.8;
      const halfW = e.width * 0.42;
      for (let off = -halfW; off <= halfW; off += 1.65) {
        crosswalkMatrices.push(placeMatrix(cwCenterX + rx * off, 0.054, cwCenterZ + rz * off, heading));
      }
      // Stop line behind the crosswalk across the lanes coming INTO the junction: traffic heading to the node
      // drives on its right = -r side (forward x up, forward = -u). Same stripe geometry, scaled per instance.
      if (e.width >= 6) {
        const span = e.width / 2 - 0.5;
        const mid = -(0.15 + span / 2);
        const sx = cwCenterX + ux * STOP_LINE_FROM_CROSSWALK_M + rx * mid;
        const sz = cwCenterZ + uz * STOP_LINE_FROM_CROSSWALK_M + rz * mid;
        crosswalkMatrices.push(
          placeMatrix(sx, 0.054, sz, heading, new THREE.Matrix4().makeScale(span / STRIPE_W, 1, STOP_LINE_W / STRIPE_L))
        );
      }
    }
  }
  // Real crosswalks from OSM away from the signalized junctions (mid-block, school / alley crossings), with stop
  // lines on both approaches where they have their own lights
  for (const c of ACTIVE_MAP_DATA.crossings ?? []) {
    const ux = Math.sin(c.h);
    const uz = Math.cos(c.h);
    const rx = -uz;
    const rz = ux;
    const halfW = c.w * 0.42;
    for (let off = -halfW; off <= halfW; off += 1.65) {
      crosswalkMatrices.push(placeMatrix(c.x + rx * off, 0.054, c.z + rz * off, c.h));
    }
    host.crossingPaintZones.push({ x: c.x, z: c.z, ux, uz, halfWidth: c.w / 2 });
    if (c.sig && c.w >= 6) {
      const span = c.w / 2 - 0.5;
      for (const dir of [1, -1]) {
        // traffic heading along dir * u drives on its right (forward x up = dir * r) and stops before the crosswalk
        const mid = dir * (0.15 + span / 2);
        const back = -dir * STOP_LINE_FROM_CROSSWALK_M;
        crosswalkMatrices.push(
          placeMatrix(
            c.x + ux * back + rx * mid,
            0.054,
            c.z + uz * back + rz * mid,
            c.h,
            new THREE.Matrix4().makeScale(span / STRIPE_W, 1, STOP_LINE_W / STRIPE_L),
          ),
        );
      }
    }
  }

  // Every zebra stripe in the city is one instance of a single InstancedMesh (1 draw call)
  if (crosswalkMatrices.length > 0) {
    const stripes = buildInstanced(stripeGeo, host.crosswalkPaintMat, crosswalkMatrices);
    stripes.receiveShadow = true;
    NEARBY_INSTANCES.register(stripes, 220); // 11k stripes city-wide: only the nearby ones
    excludeFromMirrors(stripes);
    host.root.add(stripes);
    freezeStatic(stripes);
  }

  if (manholePositions.length > 0) {
    const mInst = new THREE.InstancedMesh(manholeGeo, host.manholeMat, manholePositions.length);
    mInst.receiveShadow = true;
    manholePositions.forEach(([mx, mz], i) => {
      dummy.position.set(mx, 0.048, mz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mInst.setMatrixAt(i, dummy.matrix);
    });
    mInst.instanceMatrix.needsUpdate = true;
    NEARBY_INSTANCES.register(mInst, 160);
    host.root.add(mInst);
  }
}

export function enhanceWetAsphaltMaterial(host: CityWorld, mat: THREE.MeshStandardMaterial): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRainWetness = host.roadShaderUniforms.uRainWetness;
    shader.uniforms.uTime = host.roadShaderUniforms.uTime;

    shader.fragmentShader =
      'uniform float uRainWetness;\nuniform float uTime;\n' +
      shader.fragmentShader
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
        float puddleMask = 1.0 - smoothstep(0.08, 0.55, roughnessFactor);
        roughnessFactor = mix(0.90, mix(0.32, 0.055, puddleMask), uRainWetness);`
        )
        .replace(
          '#include <dithering_fragment>',
          `if (uRainWetness > 0.02) {
          float pMask = 1.0 - smoothstep(0.10, 0.55, roughnessFactor);
          #ifdef USE_ROUGHNESSMAP
          float ripple = sin((vRoughnessMapUv.x * 90.0 + vRoughnessMapUv.y * 90.0) + uTime * 8.5) * 0.5 + 0.5;
          #else
          float ripple = 0.5;
          #endif
          float fresnelSheen = (0.055 + 0.14 * pMask) * uRainWetness;
          vec3 skyReflect = vec3(0.56, 0.72, 0.88) * fresnelSheen * (0.85 + 0.15 * ripple);
          gl_FragColor.rgb += skyReflect;
        }
        #include <dithering_fragment>`
        );
  };
}
