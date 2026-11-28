/** Watching how the rider rides each frame: sidewalk / stream-walkway riding (warning or patrol ticket), red-light and pedestrian warnings ahead, and safe stops after a warning */
import type { GameContext } from '../GameContext';
import type { FrameState, LoopState } from '../gameLoop';
import { ALERT_MAX_DIST_M } from '../riderAlerts';
import { ACTIVE_MAP_DATA } from '../../data/suwonDistricts';
import { getSignalAxis, signalNodesNear } from '../../world/TrafficRules';
import { SIDEWALK_MIN_KMH, SIDEWALK_TICKET_FINE, WRONG_WAY_MIN_KMH, WRONG_WAY_TICKET_FINE, isSidewalkOffset } from '../trafficViolations';
import { wrongWayEdgeAt } from '../../world/roadDirections';

/** A stream walkway is judged like a sidewalk this far from the curb (inside the sidewalk band) */
const WALKWAY_AS_SIDEWALK_OFFSET = 2;

export function stepRiderWatch(ctx: GameContext, loop: LoopState, f: FrameState): void {
  const { world, traffic, pedestrians, roadHazards, delivery, scooterPhysics, audio, hud } = ctx;
  const { roadProximity, sidewalkMonitor, wrongWayMonitor, riderAlerts, safeStops, nearSignalIds, issuePatrolTicket } = loop;
  const { dt, isRiding } = f;
  // Sidewalk riding: warning, or a full ticket when a patrol car sees it
  const sx = scooterPhysics.state.x;
  const sz = scooterPhysics.state.z;
  const speedKmh = Math.abs(scooterPhysics.state.speed) * 3.6;
  // a stream walkway counts as a sidewalk (it is one: people stroll there)
  const onWalkway = isRiding && speedKmh >= SIDEWALK_MIN_KMH && world.isOnStreamWalkway(sx, sz);
  const curbOffset = !(isRiding && speedKmh >= SIDEWALK_MIN_KMH)
    ? -1
    : onWalkway
      ? WALKWAY_AS_SIDEWALK_OFFSET
      : roadProximity.curbOffset(sx, sz);
  if (
    sidewalkMonitor.step(dt, {
      isRiding,
      crashed: scooterPhysics.state.crashed,
      speedKmh,
      curbOffset,
      exempt: isSidewalkOffset(curbOffset) && (world.nearestGasStation(sx, sz)?.dist ?? Infinity) < 30,
    })
  ) {
    const ticket = roadHazards.witnessTicket('patrol_sidewalk', sx, sz, speedKmh);
    if (ticket) issuePatrolTicket(ticket, '인도 주행');
    else {
      audio.playPedestrianStartle();
      hud.showToast(
        onWalkway
          ? `🚶 하천 산책로 주행 중! 산책객 위험 · 순찰차에 걸리면 과태료 ₩${SIDEWALK_TICKET_FINE.toLocaleString()}`
          : `🚸 인도 주행 중! 보행자 위험 · 순찰차에 걸리면 과태료 ₩${SIDEWALK_TICKET_FINE.toLocaleString()}`,
        3600,
      );
    }
  }

  // Against a one-way street (역주행): warning, or a ticket when a patrol car sees it
  const wrongEdge =
    isRiding && speedKmh >= WRONG_WAY_MIN_KMH ? wrongWayEdgeAt(sx, sz, scooterPhysics.state.heading) : -1;
  if (wrongWayMonitor.step(dt, { isRiding, crashed: scooterPhysics.state.crashed, speedKmh, wrongEdge })) {
    const ticket = roadHazards.witnessTicket('patrol_wrong_way', sx, sz, speedKmh);
    if (ticket) issuePatrolTicket(ticket, '일방통행 역주행');
    else {
      audio.playKeypadBeep(false);
      hud.showToast(
        `⛔ 일방통행 역주행 중! 돌아가세요 · 순찰차에 걸리면 과태료 ₩${WRONG_WAY_TICKET_FINE.toLocaleString()}`,
        3600,
      );
    }
  }

  // Red light / pedestrian in the path within stopping distance: warn before it is too late
  const fx = Math.sin(scooterPhysics.state.heading);
  const fz = Math.cos(scooterPhysics.state.heading);
  nearSignalIds.length = 0;
  const signalsNear = isRiding
    ? signalNodesNear(sx, sz, ALERT_MAX_DIST_M, nearSignalIds).map((id) => {
        const n = ACTIVE_MAP_DATA.nodes[id];
        const axis = getSignalAxis(id, fx, fz);
        return { id, x: n.x, z: n.z, color: axis === 'ns' ? traffic.signalState.ns : traffic.signalState.ew };
      })
    : [];
  const riderPose = { x: sx, z: sz, heading: scooterPhysics.state.heading, speed: scooterPhysics.state.speed };
  const alert = riderAlerts.step(
    dt,
    isRiding && !scooterPhysics.state.crashed,
    riderPose,
    signalsNear,
    isRiding ? pedestrians.agents : [],
  );
  // Stopped / slowed in time after a warning: rating back + the safe-stop goal
  const safe = isRiding ? safeStops.step(dt, riderPose, scooterPhysics.state.crashed) : null;
  if (safe) {
    const res = delivery.recordSafeStop();
    audio.playGoalSparkle();
    const what = safe === 'safe_stop' ? '👍 안전 정지!' : '👍 보행자 양보!';
    hud.showToast(
      res.ratingGain > 0
        ? `${what} 신뢰 평점 +${res.ratingGain.toFixed(1)} (★ ${res.newRating.toFixed(1)}) · 오늘 ${res.count}회`
        : `${what} 오늘 ${res.count}회`,
      2600,
    );
    for (const g of res.goals) {
      window.setTimeout(
        () => hud.showToast(`🎯 오늘의 목표 달성! ${g.icon} ${g.title} +₩${g.bonus.toLocaleString()}`, 3600),
        2800,
      );
      hud.phoneMap.notify('🎯', '뱅크', `오늘의 목표 달성 · ${g.title} +₩${g.bonus.toLocaleString()}`);
    }
  }
  if (alert) {
    safeStops.onAlert(alert, riderPose);
    audio.playCameraApproachBeep(true);
    hud.showToast(
      alert.kind === 'pedestrian'
        ? `🚸 전방 ${Math.round(alert.distance)}m 보행자 · 감속하세요`
        : `🚦 전방 ${Math.round(alert.distance)}m 빨간불 · 정지하세요`,
      2200,
    );
  }
}
