/**
 * Customers waiting on the stream walkway benches (산책로 쉼터): while a riverside order is on its way the customer
 * sits on the bench looking at the water; when the rider walks up with the food they stand and turn to take it, and
 * after the hand-over they wave for a few seconds before leaving. Rigs come from the pedestrian factory (private
 * random sequence: the crowd's behaviour fingerprint is untouched). The pose maths is pure and unit tested.
 */
import * as THREE from 'three';
import { PedestrianFactory, PedestrianRig, setPedestrianDetail, withPrivateRandom } from './PedestrianFactory';
import type { DeliveryLocation } from '../types';

/** A customer appears on the bench only while the rider is this close (no rig for far-away orders) */
export const BENCH_SHOW_M = 140;
/** Within this distance of a rider carrying the food, the customer stands up to take it */
export const BENCH_STAND_M = 4;
/** Seconds the customer stays (waving) after the hand-over */
export const BENCH_GOODBYE_SEC = 6;
/** Seat: this far back from the bench spot along the facing (the prop stands 1.1 m back, the seat is its centre) */
const SEAT_BACK_M = 1.1;

export type BenchPose = 'sitting' | 'standing' | 'waving';

/**
 * Pose for a waiting customer: standing up to take the food when the rider carries it within reach, else sitting;
 * waving once the order was handed over (`delivered`)
 */
export function benchPose(delivered: boolean, carryingNear: boolean): BenchPose {
  if (delivered) return 'waving';
  return carryingNear ? 'standing' : 'sitting';
}

/** Where a bench's customer sits (world x, z) and which way they face (the water) */
export function benchSeat(loc: DeliveryLocation): { x: number; z: number; heading: number } {
  const h = loc.facingHeading ?? 0;
  return { x: loc.x - Math.sin(h) * SEAT_BACK_M, z: loc.z - Math.cos(h) * SEAT_BACK_M, heading: h };
}

interface Seated {
  rig: PedestrianRig;
  loc: DeliveryLocation;
  /** Seconds left of the goodbye wave (null while still waiting for the food) */
  goodbye: number | null;
  t: number;
}

export class BenchCustomers {
  public readonly root = new THREE.Group();
  private readonly factory = new PedestrianFactory();
  private readonly seated = new Map<string, Seated>();
  private readonly pool: PedestrianRig[] = [];

  constructor(parent: THREE.Object3D) {
    this.root.name = 'bench_customers';
    parent.add(this.root);
  }

  /** Locations with a customer on the bench right now (tests / debugging) */
  public poses(): Array<{ id: string; pose: BenchPose }> {
    return [...this.seated.values()].map((s) => ({ id: s.loc.id, pose: this.poseOf(s, false) }));
  }

  private poseOf(s: Seated, carryingNear: boolean): BenchPose {
    return benchPose(s.goodbye !== null, carryingNear);
  }

  /**
   * `waiting`: riverside customers with an order on its way; `carryingTo`: the bench the rider is carrying food to
   * (null when not carrying). A customer who drops out of `waiting` (handed over) waves goodbye, then leaves.
   */
  public update(
    dt: number,
    px: number,
    pz: number,
    waiting: readonly DeliveryLocation[],
    carryingTo: string | null,
  ): void {
    const ids = new Set(waiting.map((l) => l.id));
    for (const [id, s] of this.seated) {
      if (!ids.has(id) && s.goodbye === null) s.goodbye = BENCH_GOODBYE_SEC;
      const far = Math.hypot(s.rig.root.position.x - px, s.rig.root.position.z - pz) > BENCH_SHOW_M + 20;
      if ((s.goodbye !== null && s.goodbye <= 0) || far) this.release(id);
    }
    for (const loc of waiting) {
      if (this.seated.has(loc.id) || Math.hypot(loc.x - px, loc.z - pz) > BENCH_SHOW_M) continue;
      const rig = this.pool.pop() ?? withPrivateRandom(() => this.factory.createPedestrian());
      this.root.add(rig.root);
      this.seated.set(loc.id, { rig, loc, goodbye: null, t: 0 });
    }
    for (const s of this.seated.values()) {
      s.t += dt;
      if (s.goodbye !== null) s.goodbye -= dt;
      const seat = benchSeat(s.loc);
      const near = carryingTo === s.loc.id && Math.hypot(seat.x - px, seat.z - pz) < BENCH_STAND_M;
      this.pose(s, this.poseOf(s, near), seat, px, pz);
    }
  }

  private pose(s: Seated, pose: BenchPose, seat: { x: number; z: number; heading: number }, px: number, pz: number): void {
    const r = s.rig;
    const toRider = Math.atan2(px - seat.x, pz - seat.z);
    setPedestrianDetail(r, true);
    if (pose === 'sitting') {
      // on the seat (0.45 m) looking at the water: hips down, thighs forward, arms resting
      r.root.position.set(seat.x, -0.42, seat.z);
      r.root.rotation.y = seat.heading;
      r.leftLegPivot.rotation.x = -1.45;
      r.rightLegPivot.rotation.x = -1.45;
      r.leftArmPivot.rotation.x = -0.5;
      r.rightArmPivot.rotation.x = -0.5;
      r.rightArmPivot.rotation.z = 0;
    } else {
      // up in front of the bench, facing the rider; an arm out for the bag or waving
      r.root.position.set(seat.x + Math.sin(seat.heading) * 0.5, 0, seat.z + Math.cos(seat.heading) * 0.5);
      r.root.rotation.y = toRider;
      r.leftLegPivot.rotation.x = 0;
      r.rightLegPivot.rotation.x = 0;
      r.leftArmPivot.rotation.x = 0;
      if (pose === 'standing') {
        r.rightArmPivot.rotation.x = -1.2;
        r.rightArmPivot.rotation.z = 0;
      } else {
        r.rightArmPivot.rotation.x = -2.6;
        r.rightArmPivot.rotation.z = Math.sin(s.t * 9) * 0.45;
      }
    }
    r.root.updateMatrix();
  }

  private release(id: string): void {
    const s = this.seated.get(id);
    if (!s) return;
    s.rig.root.removeFromParent();
    this.pool.push(s.rig);
    this.seated.delete(id);
  }
}
