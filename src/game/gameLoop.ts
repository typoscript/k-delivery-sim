import { InputActivity, targetFps } from './PowerSaver';
import { GraphicsRuntime } from './GraphicsRuntime';
import { makeStaticContainer, skipHiddenChildrenInMatrixUpdates } from '../world/renderLayers';
import { PerfMonitor } from './PerfMonitor';
import { applyGameClock } from './clockSync';
import { activeRoadProximity } from '../world/roadProximity';
import { RiderAlertMonitor, SafeStopTracker } from './riderAlerts';
import type { SpeedCameraTriggerEvent } from '../world/RoadHazardManager';
import {
  SidewalkRidingMonitor,
  TICKET_RATING_PENALTY,
} from './trafficViolations';

import { GAME_MINUTES_PER_SECOND } from './GameClock';
import { CORRIDOR_ORIGIN_Y } from '../world/CorridorRoom';
import { ScooterInput } from '../vehicle/ScooterPhysics';
import { GameContext } from './GameContext';
import type { RoadProximityGrid } from '../world/roadProximity';
import { stepWorldFrame } from './frame/worldFrame';
import { stepPhysicsFrame } from './frame/physicsFrame';
import { stepDeliveryFrame } from './frame/deliveryFrame';
import { stepVisualsFrame } from './frame/visualsFrame';
import { stepGuidanceFrame } from './frame/guidanceFrame';

/** Game-flow hooks the per-frame loop needs from main.ts */
export interface GameLoopHooks {
  /** Live set of held key codes from installKeyboardInput */
  pressed: Set<string>;
  exitCorridorToStreet: () => void;
  isPlayerNearCargoBox: () => boolean;
  /** True once the MEET_FACE customer NPC has taken the food bag */
  isNpcHoldingFoodBag: () => boolean;
  /** Dynamic resolution + shadow scheduling */
  graphics: GraphicsRuntime;
}

/** Long-lived helpers the per-frame stages share (created once in startGameLoop) */
export interface LoopState {
  roadProximity: RoadProximityGrid;
  sidewalkMonitor: SidewalkRidingMonitor;
  riderAlerts: RiderAlertMonitor;
  /** Follows each warning: stopping / slowing in time counts as a safe stop */
  safeStops: SafeStopTracker;
  /** Reused id buffer for nearby signals */
  nearSignalIds: number[];
  issuePatrolTicket: (ticket: SpeedCameraTriggerEvent, what: string) => void;
  NEUTRAL_SCOOTER_INPUT: ScooterInput;
  perf: PerfMonitor;
  /** The "wading is slow" hint was shown this session */
  wadingHintShown: boolean;
  /** The bridge crosswind hint was shown this session */
  windHintShown: boolean;
  /** The "how to ride ice" tip was shown this session (first fall on ice) */
  iceTipShown: boolean;
}

/** This frame's basics, computed once at the top of the frame */
export interface FrameState {
  dt: number;
  elapsed: number;
  inCorridor: boolean;
  isRiding: boolean;
  /** A modal / menu holds the controls */
  movementBlocked: boolean;
}

/** Upper bound for simulated & rendered frames per second */
export const MAX_FPS = 60;

/** Starts the requestAnimationFrame loop: simulation step for every system, then rendering */
export function startGameLoop(ctx: GameContext, hooks: GameLoopHooks): void {
  const { renderer, scene, camera, world, traffic, pedestrians, roadHazards, delivery, scooterPhysics, scooterMesh, playerCtrl, audio, hud, modalUi, districtUi, onboardingSettings } = ctx;

  const NEUTRAL_SCOOTER_INPUT: ScooterInput = {
    throttle: false,
    brake: false,
    steerLeft: false,
    steerRight: false,
    handbrake: false,
  };

  const roadProximity = activeRoadProximity();
  const sidewalkMonitor = new SidewalkRidingMonitor();
  const riderAlerts = new RiderAlertMonitor();
  const safeStops = new SafeStopTracker();
  const nearSignalIds: number[] = [];
  /** Red-light / sidewalk ticket written by a patrol car: fine, rider rating, siren and the ticket card */
  const issuePatrolTicket = (ticket: SpeedCameraTriggerEvent, what: string) => {
    const res = delivery.applyTrafficTicket(ticket.fine, TICKET_RATING_PENALTY, ticket.kind === 'patrol_sidewalk' ? 'sidewalk' : 'signal');
    audio.playPoliceSiren();
    hud.triggerSpeedCameraFlash();
    hud.showFineTicketPopup(ticket);
    hud.showToast(
      `🚓 ${ticket.label} 현장 단속! (${what}) 과태료 -₩${res.fine.toLocaleString()} · 신뢰 평점 ${res.newRating.toFixed(1)}`,
      4600
    );
  };

  let lastTime = performance.now();
  let elapsed = 0;

  scene.matrixWorldAutoUpdate = false;
  // Containers that never move: keep them from force-updating every descendant each frame
  for (const c of [scene, traffic.root, pedestrians.root, roadHazards.root]) makeStaticContainer(c);
  world.markStaticContainers();
  skipHiddenChildrenInMatrixUpdates(pedestrians.root);
  skipHiddenChildrenInMatrixUpdates(roadHazards.root);

  // F9 / ?perf=1 profiler overlay, `window.__perf.benchmark()` for A/B measurements
  const perf = new PerfMonitor(renderer);
  perf.setSun(world.sunLight);
  perf.setSceneInfo((): Record<string, string | number> => {
    const st = world.streamingStats;
    const p = playerCtrl.state;
    const g = hooks.graphics;
    const gfx = {
      해상도: `${g.pixelRatio.toFixed(2)}x${g.autoResolution ? ' (자동)' : ''}`,
      목표fps: currentTargetFps < MAX_FPS ? `${currentTargetFps} (절전)` : `${currentTargetFps}`,
      그림자: g.profile.shadows ? `${g.profile.shadowMapSize}px/${g.profile.shadowInterval}f` : '끔',
    };
    return st
      ? { ...gfx, 청크: st.built, 건물: st.buildings, 위치: `${Math.round(p.x)},${Math.round(p.z)}` }
      : { ...gfx, 위치: `${Math.round(p.x)},${Math.round(p.z)}` };
  });
  (window as unknown as { __perf: PerfMonitor }).__perf = perf;
  const loop: LoopState = { roadProximity, sidewalkMonitor, riderAlerts, safeStops, nearSignalIds, issuePatrolTicket, NEUTRAL_SCOOTER_INPUT, perf, wadingHintShown: false, windHintShown: false, iceTipShown: false };
  // 60fps cap: on 120Hz (ProMotion) / 144Hz displays rAF fires 2x+ as often; skipping the extra
  // callbacks roughly halves GPU/CPU load (and laptop heat) with no visible difference.
  // 1.5ms of slack so a 60Hz display's slightly early callbacks are never dropped.
  let lastFrameAt = -Infinity;
  // Idle / menu power saving: 30fps while nothing needs 60 (decided at the end of each frame)
  const activity = new InputActivity();
  let currentTargetFps = MAX_FPS;
  (window as unknown as { __power: () => number }).__power = () => currentTargetFps;

  function animate(now: number): void {
    requestAnimationFrame(animate);
    // Fresh input while power-saving -> render at the 60fps pace right away (no 33ms wait)
    const pace = activity.secondsSince(now) < 0.1 ? MAX_FPS : currentTargetFps;
    if (now - lastFrameAt < 1000 / pace - 1.5) return;
    const frameIntervalMs = lastFrameAt > 0 ? now - lastFrameAt : 16.7;
    lastFrameAt = now;
    perf.beginFrame(now);

    const dt = Math.max(0, Math.min((now - lastTime) / 1000, 0.05));
    lastTime = now;
    elapsed += dt;

    // Game time of day: dusk / dawn lighting, night surcharge, rush-hour demand (1 real s = 1 game min)
    ctx.clock.advance(dt);
    applyGameClock(ctx, true, dt * GAME_MINUTES_PER_SECOND);

    const inCorridor = playerCtrl.state.inCorridor;
    const isRiding = playerCtrl.state.mode === 'riding';
    const movementBlocked =
      modalUi.isBlockingMovement() || onboardingSettings.isSettingsOpen || districtUi.isOpen;

    const f: FrameState = { dt, elapsed, inCorridor, isRiding, movementBlocked };
    stepWorldFrame(ctx, hooks, loop, f);
    perf.lap('hazards');
    stepPhysicsFrame(ctx, hooks, loop, f);
    perf.lap('physics');
    const navPlan = stepDeliveryFrame(ctx, hooks, loop, f);
    perf.lap('delivery/nav');
    stepVisualsFrame(ctx, hooks, loop, f, navPlan);
    stepGuidanceFrame(ctx, hooks, loop, f, navPlan);
    perf.lap('hud/phone');
    // Update all world matrices ONCE per frame; the mirror passes and the main pass reuse them
    // (renderer.render() would otherwise traverse the whole scene again for every pass)
    scene.updateMatrixWorld();
    perf.lap('matrices');
    // Only render scooter mirrors when outdoors & riding
    // Shadow refresh schedule + dynamic resolution (driven by the measured GPU frame time)
    // Fallback (no GPU timer) uses the frame interval: discount the deliberate 30fps power-save gap
    const pacedInterval = currentTargetFps < MAX_FPS ? frameIntervalMs - (1000 / currentTargetFps - 1000 / MAX_FPS) : frameIntervalMs;
    hooks.graphics.frame(dt, perf.gpuFrameMs, pacedInterval, perf.isBenchmarking);
    if (!inCorridor && isRiding && !perf.flags.skipMirrors) {
      perf.gpuBegin('mirrors');
      scooterMesh.renderMirrors(renderer, scene, scooterPhysics.state);
      perf.gpuEnd();
    } else {
      perf.clearGpuLatest('mirrors');
    }
    perf.lap('mirrors');

    void CORRIDOR_ORIGIN_Y;
    perf.gpuBegin('main');
    renderer.render(scene, camera);
    perf.gpuEnd();
    perf.lap('render');
    perf.endFrame();

    currentTargetFps = targetFps({
      enabled: onboardingSettings.settings.powerSaving && !perf.isMeasuring,
      photoMode: modalUi.activeModal === 'camera',
      menuOpen: movementBlocked,
      phoneZoomed: hud.phoneMap.isZoomed,
      moving:
        Math.abs(scooterPhysics.state.speed) > 0.3 ||
        playerCtrl.state.moveSpeed > 0.1 ||
        playerCtrl.state.mode === 'knockdown',
      secondsSinceInput: activity.secondsSince(now),
    });
  }

  requestAnimationFrame(animate);
}
