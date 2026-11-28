/** Outdoor road conditions under the rider each frame: rain puddles, bridge crosswind, wading in a stream and black ice (crossing it / the warning ahead) */
import { WIND_MIN_KMH, bridgeGust, windLevelFor, windRollFor } from '../bridgeWind';
import type { GameContext } from '../GameContext';
import type { FrameState, LoopState } from '../gameLoop';
import { ICE_PASS_COUNTER } from '../../delivery/careerHistory';
/** Puddles slow the scooter (speed decay per second) above this speed (m/s) */
const PUDDLE_DRAG = 1.4;
const PUDDLE_MIN_SPEED = 3;
/** Faster than this (m/s, ~22 km/h) the splash reaches people on the sidewalk */
const PUDDLE_SPLASH_PEOPLE_SPEED = 6;

export function stepRoadConditions(ctx: GameContext, loop: LoopState, f: FrameState): void {
  const { world, pedestrians, delivery, scooterPhysics, playerCtrl, audio, hud } = ctx;
  const { dt, elapsed, isRiding } = f;
  // Rain puddles: riding through one at speed drags the scooter and splashes the visor (once per puddle)
  if (isRiding && world.puddles.puddles.length > 0) {
    const sp = scooterPhysics.state;
    const puddle = world.puddles.puddleAt(sp.x, sp.z);
    if (puddle && Math.abs(sp.speed) > PUDDLE_MIN_SPEED) {
      sp.speed *= Math.exp(-PUDDLE_DRAG * dt);
      if (puddle.id !== world.puddles.splashedId) {
        world.puddles.splashedId = puddle.id;
        ctx.visorRain.splash(Math.min(34, 10 + Math.abs(sp.speed) * 1.6));
        audio.playCargoBoxSound();
        audio.onCue?.('💦 첨벙 (물웅덩이)');
        // fast through a puddle by the sidewalk: people nearby get soaked
        const soaked =
          Math.abs(sp.speed) > PUDDLE_SPLASH_PEOPLE_SPEED ? pedestrians.splashNear(puddle.x, puddle.z, 4.5) : 0;
        if (soaked > 0) {
          const lost = delivery.penalizePuddleSplash();
          delivery.messenger.post(
            'notice',
            { kind: 'notice', title: '민원 · 알림', icon: '📢' },
            {
              from: 'them',
              text: `🙍 행인 민원 접수: "흙탕물 튀기고 그냥 가면 어떡해요!" (행인 ${soaked}명 · 신뢰 평점 -${lost.toFixed(1)})`,
              time: ctx.clock.label,
            },
          );
          audio.playPedestrianStartle();
          hud.showToast(
            `💢 행인 ${soaked}명에게 흙탕물을 튀겼어요! 웅덩이 근처에선 천천히 (신뢰 평점 -${lost.toFixed(1)})`,
            3400,
          );
        } else {
          hud.showToast('💦 첨벙! 물웅덩이 — 속도가 줄고 바이저에 물이 튀었어요 ([G]로 닦기)', 2400);
        }
      }
    }
  }
  // Crosswind on bridges: gusts push the scooter sideways (more in rain / snow); told once per session
  if (isRiding) {
    const sp = scooterPhysics.state;
    const onBridge = world.roadStructures.structureAt(sp.x, sp.z, sp.heading) === 'bridge';
    const gust = onBridge ? bridgeGust(elapsed, world.weatherMode, Math.abs(sp.speed) * 3.6) : 0;
    // the rider leans into the wind and hears it rush past (fades out off the bridge)
    ctx.camController.windRoll = windRollFor(gust);
    audio.setWind(onBridge && Math.abs(sp.speed) * 3.6 >= WIND_MIN_KMH ? windLevelFor(gust) : 0);
    if (gust !== 0) {
      // rider's right = forward x up = (-fz, 0, fx) with forward (sin h, cos h)
      const fx = Math.sin(sp.heading);
      const fz = Math.cos(sp.heading);
      sp.x += -fz * gust * dt;
      sp.z += fx * gust * dt;
      if (!loop.windHintShown) {
        loop.windHintShown = true;
        hud.showToast('🌬️ 다리 위 옆바람! 핸들이 살짝 밀려요 — 비·눈 오는 날엔 더 세요', 3000);
      }
    }
  } else {
    ctx.camController.windRoll = 0;
    audio.setWind(0);
  }
  // Streams on foot: wading through the water is slow (stepping stones and bridges are the way across)
  const wading =
    !isRiding && playerCtrl.state.mode === 'on_foot' && world.isWadingAt(playerCtrl.state.x, playerCtrl.state.z);
  if (wading && !playerCtrl.wading) {
    audio.playCargoBoxSound();
    if (!loop.wadingHintShown) {
      loop.wadingHintShown = true;
      hud.showToast('🌊 하천에 들어갔어요 — 물속에선 걸음이 느려요 · 징검다리나 다리로 건너세요', 3200);
    }
  }
  playerCtrl.wading = wading;
  // Crossing black ice without going down counts toward the 빙판 마스터 achievement
  if (isRiding && world.blackIce.isActive) {
    const sp = scooterPhysics.state;
    const on = world.blackIce.patchAt(sp.x, sp.z, sp.heading);
    const bi = world.blackIce;
    if (on && bi.crossingId !== on.id) {
      bi.crossingId = on.id;
      bi.crashedOnCrossing = false;
    }
    if (bi.crossingId >= 0 && sp.crashed && !bi.crashedOnCrossing) {
      bi.crashedOnCrossing = true;
      // the first fall on ice this session: how to ride it
      if (!loop.iceTipShown) {
        loop.iceTipShown = true;
        window.setTimeout(
          () =>
            hud.showToast(
              '🧊 빙판 요령: 얼음 위에선 브레이크·급회전 대신 스로틀을 살짝 풀고 곧게 지나가세요 · 다리 위가 반짝이면 얼어 있어요',
              5200,
            ),
          1600,
        );
      }
    }
    if (!on && bi.crossingId >= 0) {
      if (!bi.crashedOnCrossing) {
        delivery.progress.bump(ICE_PASS_COUNTER);
        hud.showToast('⛸️ 빙판 무사 통과! (빙판 마스터 업적)', 1800);
      }
      bi.crossingId = -1;
    }
  }
  // Black ice ahead (winter nights): warn once per patch while riding toward it
  if (isRiding && world.blackIce.isActive) {
    const ice = world.blackIce.nearest(
      scooterPhysics.state.x,
      scooterPhysics.state.z,
      32,
      false,
      scooterPhysics.state.heading,
    );
    if (ice && ice.id !== world.blackIce.warnedId) {
      world.blackIce.warnedId = ice.id;
      audio.playCameraApproachBeep(false);
      audio.onCue?.('🧊 결빙 경고음');
      hud.showToast(
        ice.onBridge
          ? '🧊 다리 위 결빙 주의! 다리는 가장 먼저 얼어요 — 미리 속도를 줄이고 브레이크·급회전 금지'
          : '🧊 결빙 주의! 앞 그늘진 노면 블랙아이스 — 미리 속도를 줄이고 브레이크·급회전 금지',
        3400,
      );
    }
  }
}
