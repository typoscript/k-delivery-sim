import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { streamFlowSpeed, streamSoundLevel } from './streamWater';
import { ChunkMaterials, buildChunkMeshes } from './openworld/ChunkMeshBuilder';

const mat = () => new THREE.MeshBasicMaterial();
const MATS: ChunkMaterials = {
  walls: { shop: mat(), apt: mat(), villa: mat(), public: mat() },
  roof: mat(),
  road: mat(),
  roadLine: mat(),
  park: mat(),
  water: mat(),
  plaza: mat(),
  farBuildings: mat(),
};
const chunk = {
  ix: 0,
  iz: 0,
  buildings: [],
  parks: [],
  waters: [],
  waterLines: [{ name: '수원천', width: 10, pts: [[0, 0], [0, 150]] as Array<[number, number]> }],
  pedestrianPlazas: [],
};
const roads = { nodes: [], edges: [], discNodeIds: [], nodeMaxWidth: new Float32Array(0) };
const meshesWith = (root: THREE.Object3D, m: THREE.Material) => {
  let n = 0;
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material === m) n++;
  });
  return n;
};

describe('running stream water', () => {
  it('flows faster after rain', () => {
    expect(streamFlowSpeed(0)).toBeCloseTo(0.6);
    expect(streamFlowSpeed(1)).toBeCloseTo(2);
    expect(streamFlowSpeed(5)).toBeCloseTo(2);
  });

  it('is heard near the water, louder in the rain, silent far away', () => {
    expect(streamSoundLevel(0, 0)).toBeCloseTo(0.55);
    expect(streamSoundLevel(0, 1)).toBe(1);
    expect(streamSoundLevel(20, 0)).toBeLessThan(streamSoundLevel(5, 0));
    expect(streamSoundLevel(50, 1)).toBe(0);
    expect(streamSoundLevel(Infinity, 1)).toBe(0);
  });

  it('streams get their own flowing mesh when the material is given, still water otherwise', () => {
    const stream = mat();
    const own = buildChunkMeshes(chunk, roads, { ...MATS, stream });
    expect(meshesWith(own.group, stream)).toBe(1);
    expect(meshesWith(own.group, MATS.water)).toBe(0); // no lakes in this chunk
    const shared = buildChunkMeshes(chunk, roads, MATS);
    expect(meshesWith(shared.group, MATS.water)).toBe(1);
  });
});
