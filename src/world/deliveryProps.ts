import * as THREE from 'three';
import { DeliveryLocation, ObstacleBox } from '../types';
import { HandheldFoodBag3D } from '../player/HandheldFoodBag3D';
import { excludeFromMirrors, freezeStatic } from './renderLayers';
import { mergeByVertexColor, mergeStaticByMaterial } from './instancing';
import { applySnowCover } from './snowCover';

const applySnowCoverTo = <T extends THREE.Material>(m: T): T => (applySnowCover(m), m);
import { ProximityCuller } from './openworld/ProximityCuller';
import { WorldPropHost } from './serviceStations';
import { GATE_ARM_UP, GUARD_SPOT, GateState, buildApartmentGrounds, stepGate } from './apartmentGrounds';
import { indexComplexes, isNoGroundVehicleComplex } from '../delivery/apartmentRules';

/** What the guard at an apartment gate did as the rider rode up (shown as a toast by the game) */
export interface ApartmentGateEvent {
  kind: 'welcome' | 'blocked';
  locationId: string;
}


/** Pickup counters & lobby portals are built / shown within this many 200m chunks of the player */
const LOCATION_PROP_RADIUS_CHUNKS = 1;

/** Colliders of lazily built props (apartment cars / guard booths) that exist right now, by location id */
export class PropColliders {
  private readonly byId = new Map<string, ObstacleBox[]>();
  private cache: ObstacleBox[] = [];
  private dirty = false;
  /** Bumped on every change (lets the world's collider list refresh lazily) */
  public version = 0;

  public set(id: string, boxes: ObstacleBox[]): void {
    if (boxes.length === 0 && !this.byId.has(id)) return;
    if (boxes.length === 0) this.byId.delete(id);
    else this.byId.set(id, boxes);
    this.dirty = true;
    this.version++;
  }

  public get all(): ObstacleBox[] {
    if (this.dirty) {
      this.cache = [...this.byId.values()].flat();
      this.dirty = false;
    }
    return this.cache;
  }
}

/**
 * Delivery location props: outdoor pickup counters (POS, awning sign, food tray with ready / cooking LED)
 * and residential glass lobby portals (sign, PIN pad, sliding doors) for every shop and customer spot.
 * Open world: built lazily near the player and disposed when far (ProximityCuller); legacy map: built once.
 */
export class DeliveryLocationProps {
  private readonly lobbyDoors = new Map<
    string,
    { leftDoor: THREE.Mesh; rightDoor: THREE.Mesh; open: boolean }
  >();
  /** Built apartment gates near the player (barrier arm + guard), by location id */
  private readonly gates = new Map<
    string,
    GateState & { arm: THREE.Mesh | null; gx: number; gz: number }
  >();
  /** Lobby whose door is unlocked (kept separately: open-world lobby props are rebuilt when re-approached) */
  private openLobbyId: string | null = null;
  private readonly shopTrays = new Map<
    string,
    { bag: THREE.Group; ledMat: THREE.MeshStandardMaterial }
  >();


  constructor(
    private readonly host: WorldPropHost,
    private readonly root: THREE.Group,
    private readonly culler: ProximityCuller | undefined,
    private readonly locations: readonly DeliveryLocation[],
    /** World spot free for apartment grounds (not on a road, not inside a building; null: not loaded yet) */
    private readonly isFreeGround?: (x: number, z: number) => boolean | null,
    /** Where apartment cars / booths register their colliders while built */
    private readonly colliders?: PropColliders
  ) {}

  /**
   * Builds outdoor pickup counters & residential glass lobby portals oriented cleanly toward each Suwon road.
   * Open world: thousands of generated spots, so each prop (with its sign texture) is built only when the
   * player comes near and disposed again when far away (ProximityCuller lazy entries).
   */
  public build(): void {
    indexComplexes(this.locations);
    const shared = {
      counterMat: new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.35, metalness: 0.45 }),
      darkMat: new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.65 }),
      innerMat: new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 }),
      screenMat: new THREE.MeshStandardMaterial({ color: 0x0ea5e9, emissive: 0x38bdf8, emissiveIntensity: 0.9 }),
      glassDoorMat: new THREE.MeshStandardMaterial({
        color: 0x7dd3fc,
        roughness: 0.12,
        metalness: 0.3,
        transparent: true,
        opacity: 0.48,
      }),
      pinPadMat: new THREE.MeshStandardMaterial({ color: 0x1e293b, emissive: 0x22c55e, emissiveIntensity: 0.6 }),
      shopGlassMat: new THREE.MeshLambertMaterial({ color: 0x3b5068, emissive: 0x3d3322, emissiveIntensity: 0.5 }),
      groundsMat: applySnowCoverTo(new THREE.MeshLambertMaterial({ vertexColors: true })), // snowy car roofs
      // the plain opaque parts of a counter / lobby (counter, pillars, frames, canopy) in one vertex-coloured mesh
      propColorMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 }),
      canopyMats: [0xdc2626, 0x15803d, 0x1d4ed8, 0xea580c, 0x7c3aed, 0x0f766e].map(
        (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75 })
      ),
    };
    const plainMats = new Set<THREE.Material>([shared.counterMat, shared.darkMat, shared.innerMat, ...shared.canopyMats]);
    const sharedMats = new Set<THREE.Material>(
      Object.values(shared).flatMap((m) => (Array.isArray(m) ? m : [m]))
    );

    if (this.culler) {
      // Counters / lobbies are built per chunk: every prop of a chunk comes and goes together, and their plain
      // parts / shared glass / screens are merged across the whole chunk (a handful of draw calls per chunk instead
      // of a few per prop). Drawn within 1 chunk (~200-300m) of the player, not the default 2.
      const byChunk = new Map<string, DeliveryLocation[]>();
      for (const loc of this.locations) {
        const key = this.culler.chunkKeyOf(loc.x, loc.z);
        const list = byChunk.get(key);
        if (list) list.push(loc);
        else byChunk.set(key, [loc]);
      }
      for (const locs of byChunk.values()) {
        this.culler.registerLazy(
          this.root,
          locs[0].x,
          locs[0].z,
          () => this.buildChunkProps(locs, shared, plainMats, sharedMats),
          LOCATION_PROP_RADIUS_CHUNKS
        );
      }
    }

    for (const loc of this.locations) {
      if (this.culler) {
        // Apartment complexes: guard booth + barrier and parked cars beside the lobby, decided once the
        // buildings around are loaded (so nothing lands inside a building)
        if (loc.type === 'residential' && loc.residenceKind === 'apartment' && this.isFreeGround) {
          const isFree = this.isFreeGround;
          this.culler.registerLazy(
            this.root,
            loc.x,
            loc.z,
            () => {
              const frame = this.lobbyFrame(loc);
              const noEntry = isNoGroundVehicleComplex(loc);
              const grounds = buildApartmentGrounds(loc.id, frame.toWorld, isFree, shared.groundsMat, noEntry);
              if (grounds === 'wait') return null;
              const holder = new THREE.Group();
              holder.position.copy(frame.position);
              holder.rotation.y = frame.heading;
              if (grounds.mesh) holder.add(grounds.mesh);
              if (grounds.arm) {
                holder.add(grounds.arm);
                const g = frame.toWorld(GUARD_SPOT.x, GUARD_SPOT.z);
                this.gates.set(loc.id, { arm: grounds.arm, gx: g.x, gz: g.z, noEntry, lift: 0, open: false, spoke: false });
              }
              this.colliders?.set(loc.id, grounds.obstacles);
              excludeFromMirrors(holder);
              freezeStatic(holder);
              return {
                object: holder,
                dispose: () => {
                  grounds.mesh?.geometry.dispose();
                  grounds.arm?.geometry.dispose();
                  this.gates.delete(loc.id);
                  this.colliders?.set(loc.id, []);
                },
              };
            },
            LOCATION_PROP_RADIUS_CHUNKS
          );
        }
      } else {
        const built = this.buildLocationProp(loc, shared);
        this.host.addProp(built.object, loc.x, loc.z, undefined, built.keep);
      }
    }
  }

  /**
   * All counters / lobbies of one chunk under one holder (placed at the first prop, so merged vertices stay small
   * numbers), merged across the chunk: plain parts into one vertex-coloured mesh, then by shared material. Signs
   * (own texture per spot) and the moving doors / tray bags stay separate.
   */
  private buildChunkProps(
    locs: readonly DeliveryLocation[],
    shared: Parameters<DeliveryLocationProps['buildLocationProp']>[1] & { propColorMat: THREE.Material },
    plainMats: ReadonlySet<THREE.Material>,
    sharedMats: Set<THREE.Material>
  ): { object: THREE.Object3D; dispose: () => void } {
    const holder = new THREE.Group();
    const keeps: Array<(o: THREE.Object3D) => boolean> = [];
    for (const loc of locs) {
      const built = this.buildLocationProp(loc, shared);
      if (holder.children.length === 0) holder.position.set(built.object.position.x, 0, built.object.position.z);
      built.object.position.sub(holder.position);
      holder.add(built.object);
      keeps.push(built.keep);
    }
    const keep = (o: THREE.Object3D) => keeps.some((k) => k(o));
    mergeByVertexColor(holder, plainMats, shared.propColorMat, keep);
    mergeStaticByMaterial(holder, keep);
    excludeFromMirrors(holder);
    freezeStatic(holder);
    return { object: holder, dispose: () => this.disposeLocationProps(locs, holder, sharedMats) };
  }

  /** Where a location's prop stands (slightly back from the interaction point) and its lobby-local -> world map */
  private lobbyFrame(loc: DeliveryLocation): {
    position: THREE.Vector3;
    heading: number;
    toWorld: (lx: number, lz: number) => { x: number; z: number };
  } {
    const heading = loc.facingHeading ?? 0;
    const position = new THREE.Vector3(loc.x - Math.sin(heading) * 1.1, 0.05, loc.z - Math.cos(heading) * 1.1);
    const cos = Math.cos(heading);
    const sin = Math.sin(heading);
    return {
      position,
      heading,
      toWorld: (lx, lz) => ({ x: position.x + lx * cos + lz * sin, z: position.z - lx * sin + lz * cos }),
    };
  }

  private buildLocationProp(
    loc: DeliveryLocation,
    m: {
      counterMat: THREE.Material;
      darkMat: THREE.Material;
      innerMat: THREE.Material;
      screenMat: THREE.Material;
      glassDoorMat: THREE.Material;
      pinPadMat: THREE.Material;
      shopGlassMat: THREE.Material;
      canopyMats: THREE.Material[];
      groundsMat: THREE.Material;
    }
  ): { object: THREE.Group; keep: (o: THREE.Object3D) => boolean } {
    const heading = loc.facingHeading ?? 0;
    const g = new THREE.Group();
    // Place slightly back from the interaction point so player stands cleanly on sidewalk facing counter/lobby
    const backX = -Math.sin(heading) * 1.1;
    const backZ = -Math.cos(heading) * 1.1;
    g.position.set(loc.x + backX, 0.05, loc.z + backZ);
    g.rotation.y = heading;

    if (loc.type === 'shop') {
      const counter = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.05, 0.72), m.counterMat);
      counter.position.set(0, 0.52, 0);
      const signMat = new THREE.MeshBasicMaterial({
        map: this.host.createSignTexture(`${loc.emoji} ${loc.name}`, '#c2410c', '#fff7ed'),
      });
      const awning = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.65, 0.25), signMat);
      awning.position.set(0, 2.35, 0.15);

      // Shopfront behind the counter: lit glass front between pillars, a striped canopy and the big signboard
      // (same sign texture as the counter: no extra texture per shop)
      const front = new THREE.Mesh(new THREE.BoxGeometry(3.8, 2.9, 0.12), m.shopGlassMat);
      front.position.set(0, 1.45, -1.35);
      const pillarL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 4.4, 0.3), m.darkMat);
      pillarL.position.set(-2.0, 2.2, -1.35);
      const pillarR = pillarL.clone();
      pillarR.position.x = 2.0;
      const header = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.35, 0.3), m.darkMat);
      header.position.set(0, 3.05, -1.35);
      const canopyMat = m.canopyMats[Math.abs(hashString(loc.id)) % m.canopyMats.length];
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.06, 1.15), canopyMat);
      canopy.position.set(0, 2.95, -0.85);
      canopy.rotation.x = 0.22;
      const bigSign = new THREE.Mesh(new THREE.BoxGeometry(4.0, 1.0, 0.24), signMat);
      bigSign.position.set(0, 3.75, -1.3);
      g.add(front, pillarL, pillarR, header, canopy, bigSign);

      const posStand = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.34, 0.24), m.darkMat);
      posStand.position.set(0.82, 1.18, 0.08);
      posStand.rotation.x = -0.35;
      const posScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.22), m.screenMat);
      posScreen.position.set(0.82, 1.21, 0.21);
      posScreen.rotation.x = -0.35;

      const tray = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.032, 0.42), m.darkMat);
      tray.position.set(-0.35, 1.06, 0.04);
      const trayLedMat = new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        emissive: 0xfacc15,
        emissiveIntensity: 0.08,
      });
      const trayLed = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.035, 0.03), trayLedMat);
      trayLed.position.set(-0.35, 1.07, 0.25);

      const trayBag = HandheldFoodBag3D.createFoodBagMesh();
      trayBag.position.set(-0.35, 1.21, 0.04);
      trayBag.scale.set(1.12, 1.12, 1.12);
      trayBag.visible = false;

      // syncShopPickupTrays() refreshes the bag / LED from the delivery state every frame
      this.shopTrays.set(loc.id, { bag: trayBag, ledMat: trayLedMat });
      g.add(counter, awning, posStand, posScreen, tray, trayLed, trayBag);
      return { object: g, keep: (o) => o === trayBag };
    }

    const isVilla = loc.residenceKind === 'walkup_villa';
    const archFrame = new THREE.Mesh(new THREE.BoxGeometry(3.0, 2.7, 0.42), m.darkMat);
    archFrame.position.set(0, 1.35, 0);
    const innerCut = new THREE.Mesh(new THREE.BoxGeometry(2.35, 2.4, 0.45), m.innerMat);
    innerCut.position.set(0, 1.2, -0.02);

    const leftDoor = new THREE.Mesh(new THREE.BoxGeometry(1.12, 2.34, 0.08), m.glassDoorMat);
    leftDoor.position.set(-0.56, 1.18, 0.22);
    const rightDoor = new THREE.Mesh(new THREE.BoxGeometry(1.12, 2.34, 0.08), m.glassDoorMat);
    rightDoor.position.set(0.56, 1.18, 0.22);

    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.36, 0.08), m.pinPadMat);
    pad.position.set(1.32, 1.3, 0.22);

    const signBg = isVilla ? '#065f46' : '#1e3a8a';
    const lobbySign = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 0.62, 0.2),
      new THREE.MeshBasicMaterial({
        map: this.host.createSignTexture(`${loc.emoji} ${loc.name}`, signBg, '#f8fafc'),
      })
    );
    lobbySign.position.set(0, 3.0, 0.16);

    // A lobby rebuilt while its door is unlocked starts open (updateLobbyDoors animates from here)
    this.lobbyDoors.set(loc.id, { leftDoor, rightDoor, open: this.openLobbyId === loc.id });
    g.add(archFrame, innerCut, leftDoor, rightDoor, pad, lobbySign);

    return { object: g, keep: (o) => o === leftDoor || o === rightDoor };
  }

  /** Frees a chunk's lazily built counters / lobbies: geometries, sign textures and per-prop materials (not shared) */
  private disposeLocationProps(
    locs: readonly DeliveryLocation[],
    obj: THREE.Object3D,
    sharedMats: Set<THREE.Material>
  ): void {
    for (const loc of locs) {
      this.shopTrays.delete(loc.id);
      this.lobbyDoors.delete(loc.id);
    }
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (sharedMats.has(mat)) continue;
        (mat as THREE.MeshBasicMaterial).map?.dispose();
        mat.dispose();
      }
    });
  }

  public setLobbyDoorOpen(locationId: string | null): void {
    this.openLobbyId = locationId;
    for (const [id, entry] of this.lobbyDoors.entries()) {
      entry.open = locationId === id;
    }
  }

  public syncShopPickupTrays(
    cookingShopIds: Set<string>,
    readyShopIds: Set<string>,
    elapsedTime: number
  ): void {
    const pulse = 0.5 + 0.5 * Math.sin(elapsedTime * 5.5);
    for (const [shopId, entry] of this.shopTrays.entries()) {
      const isReady = readyShopIds.has(shopId);
      const isCooking = cookingShopIds.has(shopId);
      entry.bag.visible = isReady;
      if (isReady) {
        entry.ledMat.emissive.setHex(0x22c55e);
        entry.ledMat.emissiveIntensity = 1.6 + pulse * 1.4;
      } else if (isCooking) {
        entry.ledMat.emissive.setHex(0xfacc15);
        entry.ledMat.emissiveIntensity = 1.0 + pulse * 1.6;
      } else {
        entry.ledMat.emissiveIntensity = 0.08;
      }
    }
  }

  /**
   * Apartment gates around the rider: riding up to a guard lifts the barrier, except at a 지상 차량 출입 금지
   * complex where it stays down. Returns what a guard said this frame when the gate belongs to a delivery
   * destination (`isDestination`), so the game can show it; null otherwise.
   */
  public updateApartmentGates(
    dt: number,
    px: number,
    pz: number,
    riding: boolean,
    isDestination: (locationId: string) => boolean
  ): ApartmentGateEvent | null {
    let event: ApartmentGateEvent | null = null;
    for (const [id, g] of this.gates) {
      const before = g.lift;
      const said = stepGate(g, Math.hypot(px - g.gx, pz - g.gz), riding, dt);
      if (said && !event && isDestination(id)) event = { kind: said, locationId: id };
      if (g.lift === before || !g.arm) continue;
      g.arm.rotation.z = g.lift * GATE_ARM_UP;
      // grounds are frozen static props: push the moving arm's matrices explicitly
      g.arm.updateMatrix();
      g.arm.updateMatrixWorld(true);
    }
    return event;
  }

  public updateLobbyDoors(dt: number): void {
    const step = Math.min(1, dt * 6);
    for (const entry of this.lobbyDoors.values()) {
      const targetL = entry.open ? -1.42 : -0.56;
      const targetR = entry.open ? 1.42 : 0.56;
      const dl = (targetL - entry.leftDoor.position.x) * step;
      const dr = (targetR - entry.rightDoor.position.x) * step;
      if (Math.abs(dl) < 1e-4 && Math.abs(dr) < 1e-4) continue;
      entry.leftDoor.position.x += dl;
      entry.rightDoor.position.x += dr;
      // Lobby groups are frozen static props: push the moved doors' matrices explicitly
      for (const door of [entry.leftDoor, entry.rightDoor]) {
        door.updateMatrix();
        door.updateMatrixWorld(true);
      }
    }
  }
}

/** Small deterministic string hash (canopy colour per shop) */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}
