import { DeliveryLocation } from '../types';
import { RoadNavigator, RoutePoint, TurnGuidance } from '../world/RoadNavigator';
import { ActiveMission, NavigationPlan, RecommendedStop } from './deliveryTypes';

/** What the route planner needs from DeliveryManager */
export interface RouteMissionSource {
  readonly activeMissions: readonly ActiveMission[];
  readonly activeMission: ActiveMission | null;
  readonly selectedMissionId: string | null;
  getCarryingMission(): ActiveMission | null;
  getMissionById(id: string | null): ActiveMission | null;
}

export interface RoutePlanInput {
  playerX: number;
  playerZ: number;
  playerHeading: number;
  scooterX: number;
  scooterZ: number;
  inCorridor: boolean;
  elapsedTime: number;
}

/**
 * Delivery route guidance: the recommended stop order over up to 3 bundled orders, the current stop
 * (carried food first, then a pinned order, then the recommendation) and the live A* path + turn guidance.
 * Cached and throttled so per-frame cost is near zero while the rider stands still.
 */
export class MissionRoutePlanner {
  private cachedPlan: NavigationPlan | null = null;
  private lastNavX = Infinity;
  private lastNavZ = Infinity;
  private lastNavHeading = Infinity;
  private lastNavFingerprint = '';
  private lastNavTime = -1;

  /** Forces a recompute on the next call (missions changed) */
  public invalidate(): void {
    this.lastNavFingerprint = '';
  }

  /**
   * Computes the optimal valid multi-stop sequence (Recommended Route Guide) for up to 3 bundled orders,
   * then computes the live A* shortest path & turn-by-turn guidance to the active stop.
   * Cached and throttled cleanly so per-frame CPU overhead is near zero.
   */
  public plan(src: RouteMissionSource, p: RoutePlanInput, navigator: RoadNavigator): NavigationPlan {
    const { playerX, playerZ, playerHeading, scooterX, scooterZ, inCorridor, elapsedTime } = p;
    if (inCorridor || src.activeMissions.length === 0) {
      return {
        focusMission: src.activeMission,
        target: null,
        targetPos: null,
        isPickupTarget: false,
        isCargoBoxTarget: false,
        route: [],
        guidance: null,
        recommendedStops: [],
        totalBundleDistance: 0,
      };
    }

    const fp =
      `${src.selectedMissionId ?? 'auto'}|` +
      src.activeMissions.map((m) => `${m.order.id}:${m.phase}:${m.cargoSlot}`).join(',');

    const moved = Math.hypot(playerX - this.lastNavX, playerZ - this.lastNavZ);
    const turned = Math.abs(playerHeading - this.lastNavHeading);
    const dtSince = elapsedTime - this.lastNavTime;

    if (
      this.cachedPlan &&
      fp === this.lastNavFingerprint &&
      moved < 1.8 &&
      turned < 0.22 &&
      dtSince < 0.25
    ) {
      return this.cachedPlan;
    }

    const stops = computeRecommendedStops(src.activeMissions, playerX, playerZ, scooterX, scooterZ);

    // Determine active stop:
    //  1) If carrying food, immediate priority is ALWAYS that carried mission (load to box or drop off)
    //  2) Else if user manually pinned a mission (`selectedMissionId`), focus its next stop
    //  3) Else follow recommendedStops[0]
    let currentStop: RecommendedStop | null = stops[0] ?? null;
    const carrying = src.getCarryingMission();
    if (!carrying && src.selectedMissionId) {
      const pinnedStop = stops.find((s) => s.missionId === src.selectedMissionId);
      if (pinnedStop) {
        currentStop = pinnedStop;
      }
    }

    for (const s of stops) {
      s.isCurrent = currentStop !== null && s.missionId === currentStop.missionId && s.kind === currentStop.kind;
    }

    const focusMission = currentStop ? src.getMissionById(currentStop.missionId) : null;
    const targetPos = currentStop ? { x: currentStop.x, z: currentStop.z } : null;
    const target = currentStop?.location ?? null;
    const isPickupTarget = currentStop?.kind === 'pickup';
    const isCargoBoxTarget = currentStop?.kind === 'load_box';

    let route: RoutePoint[] = [];
    let guidance: TurnGuidance | null = null;

    if (targetPos) {
      if (isCargoBoxTarget) {
        const directDist = Math.hypot(targetPos.x - playerX, targetPos.z - playerZ);
        route = [
          { x: playerX, z: playerZ },
          { x: targetPos.x, z: targetPos.z },
        ];
        guidance = {
          direction: 'arrive',
          distanceToTurn: Math.round(directDist),
          totalDistance: Math.round(directDist),
          instructionText: `배달통 적재 (${Math.round(directDist)}m)`,
        };
      } else {
        const pathRes = navigator.findShortestPath(playerX, playerZ, targetPos.x, targetPos.z);
        route = pathRes.points;
        guidance = navigator.computeTurnGuidance(route, pathRes.distance, playerHeading);
      }
    }

    const totalBundleDistance =
      stops.length > 0 ? Math.round(stops[stops.length - 1].cumulativeDistance) : 0;

    const plan: NavigationPlan = {
      focusMission,
      target,
      targetPos,
      isPickupTarget,
      isCargoBoxTarget,
      route,
      guidance,
      recommendedStops: stops,
      totalBundleDistance,
    };

    this.cachedPlan = plan;
    this.lastNavX = playerX;
    this.lastNavZ = playerZ;
    this.lastNavHeading = playerHeading;
    this.lastNavFingerprint = fp;
    this.lastNavTime = elapsedTime;
    return plan;
  }
}

/**
 * Exact optimal valid stop ordering (TSP with pickup->dropoff precedence) over <= 3 active orders.
 * Uses Manhattan road-grid metric for ultra-fast (<0.05ms) evaluation of all valid sequences (<= 90).
 */
export function computeRecommendedStops(
  activeMissions: readonly ActiveMission[],
  playerX: number,
  playerZ: number,
  scooterX: number,
  scooterZ: number
): RecommendedStop[] {
  if (activeMissions.length === 0) return [];

  interface StepCandidate {
    mission: ActiveMission;
    kind: 'pickup' | 'load_box' | 'dropoff';
    x: number;
    z: number;
    location: DeliveryLocation | null;
  }

  const forcedFirst: StepCandidate[] = [];
  const missions = activeMissions;

  // 0 = needs pickup then dropoff, 1 = needs dropoff only, 2 = already handled/done
  const initialStage: number[] = missions.map((m) => {
    if (m.phase === 'to_pickup' || m.phase === 'cooking_wait' || m.phase === 'pickup_ready') return 0;
    if (m.phase === 'carrying_to_box') {
      forcedFirst.push({
        mission: m,
        kind: 'load_box',
        x: scooterX,
        z: scooterZ,
        location: null,
      });
      return 1; // after loading into box, still needs dropoff
    }
    if (m.phase === 'carrying_to_lobby' || m.phase === 'lobby_unlocked') {
      forcedFirst.push({
        mission: m,
        kind: 'dropoff',
        x: m.order.customer.x,
        z: m.order.customer.z,
        location: m.order.customer,
      });
      return 2; // already forced as immediate first stop
    }
    if (m.phase === 'cargo_loaded') return 1;
    return 2;
  });

  const startX = forcedFirst.length > 0 ? forcedFirst[forcedFirst.length - 1].x : playerX;
  const startZ = forcedFirst.length > 0 ? forcedFirst[forcedFirst.length - 1].z : playerZ;

  let bestCost = Infinity;
  let bestTail: StepCandidate[] = [];

  const manhattan = (ax: number, az: number, bx: number, bz: number) =>
    Math.abs(ax - bx) + Math.abs(az - bz);

  const search = (
    cx: number,
    cz: number,
    stages: number[],
    costSoFar: number,
    seq: StepCandidate[]
  ) => {
    if (costSoFar >= bestCost) return;

    let remaining = false;
    for (let i = 0; i < missions.length; i++) {
      if (stages[i] < 2) {
        remaining = true;
        const m = missions[i];
        const isPickup = stages[i] === 0;
        const loc = isPickup ? m.order.shop : m.order.customer;
        const nextCost = costSoFar + manhattan(cx, cz, loc.x, loc.z);

        stages[i]++;
        seq.push({
          mission: m,
          kind: isPickup ? 'pickup' : 'dropoff',
          x: loc.x,
          z: loc.z,
          location: loc,
        });
        search(loc.x, loc.z, stages, nextCost, seq);
        seq.pop();
        stages[i]--;
      }
    }

    if (!remaining && costSoFar < bestCost) {
      bestCost = costSoFar;
      bestTail = [...seq];
    }
  };

  search(startX, startZ, [...initialStage], 0, []);

  const fullSeq = [...forcedFirst, ...bestTail];
  const result: RecommendedStop[] = [];
  let prevX = playerX;
  let prevZ = playerZ;
  let cumDist = 0;

  for (let i = 0; i < fullSeq.length; i++) {
    const st = fullSeq[i];
    const leg = Math.round(manhattan(prevX, prevZ, st.x, st.z));
    cumDist += leg;
    prevX = st.x;
    prevZ = st.z;

    const m = st.mission;
    const slotTag = m.cargoSlot !== null ? ` · 슬롯 ${m.cargoSlot + 1}` : '';
    result.push({
      missionId: m.order.id,
      orderNumber: m.order.orderNumber,
      kind: st.kind,
      location: st.location,
      x: st.x,
      z: st.z,
      label:
        st.kind === 'pickup'
          ? m.order.shop.name
          : st.kind === 'load_box'
            ? '오토바이 배달통 적재'
            : `${m.order.customer.name} ${m.order.unitNumber}`,
      sublabel:
        st.kind === 'pickup'
          ? `픽업 #${m.order.orderNumber} · ${m.order.menuName}`
          : st.kind === 'load_box'
            ? `손에 든 #${m.order.orderNumber} 적재 후 이동`
            : `배달 #${m.order.orderNumber}${slotTag} · PIN ${m.order.doorPin}`,
      emoji:
        st.kind === 'pickup' ? m.order.shop.emoji : st.kind === 'load_box' ? '📦' : m.order.customer.emoji,
      cargoSlot: m.cargoSlot,
      legDistance: leg,
      cumulativeDistance: cumDist,
      isCurrent: i === 0,
    });
  }

  return result;
}
