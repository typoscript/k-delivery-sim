import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { NearbyInstances, buildInstanced, mergeByVertexColor, mergeStaticByMaterial } from './instancing';
import { VehicleFleetRenderer } from './VehicleFleetRenderer';

const meshes = (o: THREE.Object3D) => {
  const out: THREE.Mesh[] = [];
  o.traverse((c) => (c as THREE.Mesh).isMesh && out.push(c as THREE.Mesh));
  return out;
};

describe('mergeStaticByMaterial', () => {
  it('merges same-material parts, keeps other materials and kept (moving) parts separate', () => {
    const steel = new THREE.MeshStandardMaterial();
    const glass = new THREE.MeshStandardMaterial();
    const g = new THREE.Group();
    g.position.set(100, 0, 50);
    g.rotation.y = 0.7;
    const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), steel);
    a.position.set(2, 0, 0);
    const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), steel);
    const sub = new THREE.Group();
    sub.position.set(0, 3, 0);
    const c = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), steel);
    sub.add(c);
    const pane = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), glass);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), steel);
    g.add(a, b, sub, pane, door);

    g.updateMatrixWorld(true);
    const before = new THREE.Box3().setFromObject(g);
    const saved = mergeStaticByMaterial(g, (o) => o === door);
    g.updateMatrixWorld(true);
    const after = new THREE.Box3().setFromObject(g);

    expect(saved).toBe(2); // a + b + c -> 1
    const ms = meshes(g);
    expect(ms).toHaveLength(3); // merged steel, glass pane, door
    expect(ms.filter((m) => m.material === steel)).toHaveLength(2); // merged + kept door
    expect(ms).toContain(door);
    // world-space footprint unchanged
    expect(after.min.distanceTo(before.min)).toBeLessThan(1e-4);
    expect(after.max.distanceTo(before.max)).toBeLessThan(1e-4);
  });
});

describe('VehicleFleetRenderer', () => {
  it('draws the whole fleet with a fixed number of instanced meshes', () => {
    const root = new THREE.Group();
    const fleet = new VehicleFleetRenderer(root, [0xffffff, 0x111111, 0xf97316], [false, false, true], 2);
    const instanced = meshes(root).filter((m) => (m as THREE.InstancedMesh).isInstancedMesh);
    expect(instanced).toHaveLength(fleet.drawCalls);
    expect(fleet.drawCalls).toBe(13);
  });

  it('places each vehicle and its 4 wheels, and lights brakes per car', () => {
    const root = new THREE.Group();
    const fleet = new VehicleFleetRenderer(root, [0xffffff, 0x111111], [false, true], 0);
    fleet.setCar(0, { x: 10, z: 20, heading: Math.PI / 2, braking: false, wheelSpin: 0 });
    fleet.setCar(1, { x: -5, z: 3, heading: 0, braking: true, wheelSpin: 1.2 });
    fleet.commit();
    const all = meshes(root) as THREE.InstancedMesh[];
    const body = all[0];
    const m = new THREE.Matrix4();
    body.getMatrixAt(1, m);
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    expect(p.x).toBeCloseTo(-5);
    expect(p.z).toBeCloseTo(3);
    // wheels layer has 4 instances per car
    const wheels = all.find((x) => x.count === 8)!;
    expect(wheels).toBeDefined();
    // car 1 braking -> brighter brake colour than car 0
    const brake = all[3];
    const c0 = new THREE.Color();
    const c1 = new THREE.Color();
    brake.getColorAt(0, c0);
    brake.getColorAt(1, c1);
    expect(c1.r).toBeGreaterThan(c0.r * 2);
    // non-taxi car 0 has a collapsed (invisible) roof cap, taxi car 1 a real one
    const cap = all[4];
    cap.getMatrixAt(0, m);
    expect(new THREE.Vector3().setFromMatrixScale(m).x).toBe(0);
    cap.getMatrixAt(1, m);
    expect(new THREE.Vector3().setFromMatrixScale(m).x).toBeCloseTo(1);
  });
});

describe('NearbyInstances', () => {
  it('draws only the instances within the radius, re-picked after the player moves far enough', () => {
    const mats = [0, 100, 500, 1000].map((x) => new THREE.Matrix4().makeTranslation(x, 0, 0));
    const mesh = buildInstanced(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), mats);
    const culler = new NearbyInstances(40);
    culler.register(mesh, 150);
    culler.update(0, 0);
    expect(mesh.count).toBe(2); // x = 0 and 100
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(1, m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).x).toBe(100);
    culler.update(20, 0); // moved < 40 m: unchanged
    expect(mesh.count).toBe(2);
    culler.update(900, 0);
    expect(mesh.count).toBe(1);
    mesh.getMatrixAt(0, m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).x).toBe(1000);
    culler.update(5000, 0);
    expect(mesh.count).toBe(0);
    culler.update(450, 0); // back: 500 within reach, the original matrices are kept
    expect(mesh.count).toBe(1);
    mesh.getMatrixAt(0, m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).x).toBe(500);
  });
});

describe('mergeByVertexColor', () => {
  it('merges plain parts of different colours into one vertex-coloured mesh, keeping the rest', () => {
    const red = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x0000ff });
    const sign = new THREE.MeshBasicMaterial();
    const target = new THREE.MeshStandardMaterial({ vertexColors: true });
    const g = new THREE.Group();
    const box = () => new THREE.BoxGeometry();
    const a = new THREE.Mesh(box(), red);
    const b = new THREE.Mesh(box(), blue);
    b.position.x = 3;
    const door = new THREE.Mesh(box(), red);
    const s = new THREE.Mesh(box(), sign);
    g.add(a, b, door, s);
    const saved = mergeByVertexColor(g, new Set([red, blue]), target, (o) => o === door);
    expect(saved).toBe(1);
    const meshes = g.children as THREE.Mesh[];
    expect(meshes).toContain(door);
    expect(meshes).toContain(s);
    const merged = meshes.find((m) => m.material === target)!;
    const col = merged.geometry.getAttribute('color');
    const pos = merged.geometry.getAttribute('position');
    // the blue box (moved to x = 3) keeps its colour in the merged mesh
    let blueRight = true;
    for (let i = 0; i < pos.count; i++) if (pos.getX(i) > 2 && col.getZ(i) < 0.5) blueRight = false;
    expect(blueRight).toBe(true);
    expect(g.children).toHaveLength(3);
  });
});
