/** Turn-by-turn guidance from a route: next turn direction and distance, and its Korean instruction text */
import type { RoutePoint, TurnDirection, TurnGuidance } from '../RoadNavigator';

/**
 * Computes turn-by-turn navigation instruction for the 3D handlebar minimap.
 * Uses Three.js right-handed XZ coordinates: heading=0 -> +Z, +X is LEFT, -X is RIGHT.
 */
export function computeTurnGuidance(points: RoutePoint[], totalDistance: number, heading: number): TurnGuidance {
  if (points.length < 2 || totalDistance <= 14) {
    const dist = Math.max(0, Math.round(totalDistance));
    return {
      direction: 'arrive',
      distanceToTurn: dist,
      totalDistance: dist,
      instructionText: dist <= 6 ? '목적지 도착!' : `${dist}m 앞 목적지`,
    };
  }

  const fwdX = Math.sin(heading);
  const fwdZ = Math.cos(heading);

  let firstSegIdx = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const d = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z);
    if (d >= 4.0) {
      firstSegIdx = i;
      break;
    }
  }

  const s0 = points[firstSegIdx];
  const s1 = points[firstSegIdx + 1];
  const sLen = Math.hypot(s1.x - s0.x, s1.z - s0.z);
  if (sLen > 0.5) {
    const ux = (s1.x - s0.x) / sLen;
    const uz = (s1.z - s0.z) / sLen;
    const alignDot = fwdX * ux + fwdZ * uz;
    if (alignDot < -0.55 && totalDistance > 18) {
      return {
        direction: 'uturn',
        distanceToTurn: Math.round(totalDistance),
        totalDistance: Math.round(totalDistance),
        instructionText: '경로 반대 방향 · 유턴하세요',
      };
    }
  }

  let accum = 0;
  for (let i = 0; i < points.length - 2; i++) {
    const a = points[i];
    const b = points[i + 1];
    const c = points[i + 2];
    const dx1 = b.x - a.x;
    const dz1 = b.z - a.z;
    const dx2 = c.x - b.x;
    const dz2 = c.z - b.z;
    const l1 = Math.hypot(dx1, dz1);
    const l2 = Math.hypot(dx2, dz2);
    accum += l1;

    if (l1 < 2.0 || l2 < 2.0) continue;

    const u1x = dx1 / l1;
    const u1z = dz1 / l1;
    const u2x = dx2 / l2;
    const u2z = dz2 / l2;
    const dot = u1x * u2x + u1z * u2z;

    if (dot < 0.78) {
      const crossY = u1z * u2x - u1x * u2z;
      const turnDir: TurnDirection = crossY >= 0 ? 'left' : 'right';
      const turnDist = Math.max(1, Math.round(accum));
      const label = turnDir === 'left' ? '좌회전' : '우회전';

      if (turnDist > 140) {
        return {
          direction: 'straight',
          distanceToTurn: turnDist,
          totalDistance: Math.round(totalDistance),
          instructionText: `${turnDist}m 직진 후 ${label}`,
        };
      }
      return {
        direction: turnDir,
        distanceToTurn: turnDist,
        totalDistance: Math.round(totalDistance),
        instructionText: turnDist <= 15 ? `잠시 후 ${label}` : `${turnDist}m 앞 ${label}`,
      };
    }
  }

  const rem = Math.max(1, Math.round(totalDistance));
  return {
    direction: rem <= 25 ? 'arrive' : 'straight',
    distanceToTurn: rem,
    totalDistance: rem,
    instructionText: rem <= 25 ? `${rem}m 앞 목적지 도착` : `${rem}m 직진`,
  };
}
