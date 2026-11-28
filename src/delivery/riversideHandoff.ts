/**
 * The 산책로 쉼터 hand-over as the game runs it (deliveryFlow calls these; riversideFlow.test.ts calls the same):
 * at the bench, a carried riverside order becomes an in-person hand-over and settles on the spot; closing the
 * settlement ends the delivery right there (no corridor to walk out of).
 */
import type { ActiveMission } from './deliveryTypes';
import type { DeliveryManager } from './DeliveryManager';

/** The rider at a bench with that bench's food in hand: [E] hands it over */
export function isBenchHandoff(m: ActiveMission | null | undefined): boolean {
  return !!m && m.phase === 'carrying_to_lobby' && m.order.customer.residenceKind === 'riverside';
}

/**
 * Starts the hand-over of `missionId` (the customer takes the food): the mission is ready to settle. False when
 * it is not a carried riverside order.
 */
export function startBenchHandoff(delivery: DeliveryManager, missionId: string): boolean {
  const m = delivery.getMissionById(missionId);
  if (!m || !isBenchHandoff(m)) return false;
  m.phase = 'meet_waiting';
  return true;
}

/** The settlement of a hand-over was closed: the delivery ends on the walkway */
export function finishBenchHandoff(delivery: DeliveryManager): void {
  delivery.finishAfterCorridorExit();
}

/** Search radius for a dry sidewalk spot when a bench floods */
const RELOCATE_MAX_M = 90;

/**
 * Where a bench customer moves when the walkway floods: the nearest sidewalk spot (1.5-4 m from a road edge) within
 * RELOCATE_MAX_M, searched in rings around the bench; null when none (the order stays at the bench).
 */
export function relocatedSpot(
  bench: { x: number; z: number },
  curbOffset: (x: number, z: number) => number,
): { x: number; z: number } | null {
  for (let r = 4; r <= RELOCATE_MAX_M; r += 4) {
    const steps = Math.max(8, Math.round((2 * Math.PI * r) / 4));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const x = bench.x + Math.sin(a) * r;
      const z = bench.z + Math.cos(a) * r;
      const c = curbOffset(x, z);
      if (c >= 1.5 && c <= 4) return { x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 };
    }
  }
  return null;
}

/**
 * The walkways flooded: every bench order on its way moves to the nearest sidewalk spot and its customer says so in
 * the messenger. Returns how many orders moved.
 */
export function relocateBenchOrders(
  delivery: DeliveryManager,
  curbOffset: (x: number, z: number) => number,
): number {
  let moved = 0;
  for (const m of delivery.activeMissions) {
    const c = m.order.customer;
    if (c.residenceKind !== 'riverside' || c.relocated || m.phase === 'corridor_exit' || m.phase === 'meet_waiting') {
      continue;
    }
    const spot = relocatedSpot(c, curbOffset);
    if (!spot) continue;
    m.order.customer = { ...c, x: spot.x, z: spot.z, name: `${c.name} 앞 인도`, relocated: true };
    moved++;
    delivery.messenger.post(
      `c:${m.order.id}`,
      { kind: 'customer', title: `${c.name} ${m.order.unitNumber}`, icon: '🙋', missionId: m.order.id },
      {
        from: 'them',
        text: '물이 불어서 산책로가 통제됐어요 😥 위쪽 인도로 올라와 있을게요! 지도에서 바뀐 위치로 와 주세요',
        time: delivery.clockLabel(),
      },
    );
  }
  if (moved > 0) delivery.invalidateNavCache();
  return moved;
}
