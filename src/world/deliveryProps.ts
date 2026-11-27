import * as THREE from 'three';
import { DeliveryLocation } from '../types';
import { HandheldFoodBag3D } from '../player/HandheldFoodBag3D';
import { excludeFromMirrors, freezeStatic } from './renderLayers';
import { mergeStaticByMaterial } from './instancing';
import { ProximityCuller } from './openworld/ProximityCuller';
import { WorldPropHost } from './serviceStations';

/** Pickup counters & lobby portals are built / shown within this many 200m chunks of the player */
const LOCATION_PROP_RADIUS_CHUNKS = 1;

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
    private readonly locations: readonly DeliveryLocation[]
  ) {}

  /**
   * Builds outdoor pickup counters & residential glass lobby portals oriented cleanly toward each Suwon road.
   * Open world: thousands of generated spots, so each prop (with its sign texture) is built only when the
   * player comes near and disposed again when far away (ProximityCuller lazy entries).
   */
  public build(): void {
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
    };
    const sharedMats = new Set<THREE.Material>(Object.values(shared));

    for (const loc of this.locations) {
      if (this.culler) {
        // Counters / lobbies are small: draw them within 1 chunk (~200-300m) of the player, not the default 2,
        // which with ~1,800 spots city-wide would add 100+ draw calls while driving
        this.culler.registerLazy(
          this.root,
          loc.x,
          loc.z,
          () => {
            const built = this.buildLocationProp(loc, shared);
            mergeStaticByMaterial(built.object, built.keep);
            excludeFromMirrors(built.object);
            freezeStatic(built.object);
            return { object: built.object, dispose: () => this.disposeLocationProp(loc.id, built.object, sharedMats) };
          },
          LOCATION_PROP_RADIUS_CHUNKS
        );
      } else {
        const built = this.buildLocationProp(loc, shared);
        this.host.addProp(built.object, loc.x, loc.z, undefined, built.keep);
      }
    }
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
      const awning = new THREE.Mesh(
        new THREE.BoxGeometry(3.0, 0.65, 0.25),
        new THREE.MeshBasicMaterial({
          map: this.host.createSignTexture(`${loc.emoji} ${loc.name}`, '#c2410c', '#fff7ed'),
        })
      );
      awning.position.set(0, 2.35, 0.15);

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

  /** Frees a lazily built counter / lobby: its geometries, sign texture and per-prop materials (not the shared ones) */
  private disposeLocationProp(id: string, obj: THREE.Object3D, sharedMats: Set<THREE.Material>): void {
    this.shopTrays.delete(id);
    this.lobbyDoors.delete(id);
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
