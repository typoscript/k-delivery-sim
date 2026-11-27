import { GameContext } from './GameContext';

/** Crash (lowside / wet slip / car or pedestrian hit) and speed bump feedback: ejection, sounds, food damage, toasts */
export function installCrashFeedback(ctx: GameContext): void {
  const { delivery, scooterPhysics, playerCtrl, audio, hud, handheldPhone3D } = ctx;
  // Wire lowside / wet slip / car crash -> rider ejection + crash sound + food damage across all loaded slots!
  scooterPhysics.setOnCrash((crashSide, impactSpeed, cause) => {
    playerCtrl.ejectFromScooter(scooterPhysics.state, crashSide, impactSpeed);
    handheldPhone3D.cancelMountAnimation();
    hud.phoneMap.setZoomed(false);
    if (hud.phoneMap.placement === 'in_hand') {
      hud.stowPhoneToPocket();
    }
    audio.playCrashSound();
    const damageSeverity =
      cause === 'pedestrian_hit'
        ? 'pedestrian_hit'
        : cause === 'rain_manhole' || cause === 'rain_paint' || cause === 'rain_corner'
          ? 'rain_slip'
          : 'normal';
    const { damagedCount, loss } = delivery.applyCrashDamage(damageSeverity);

    const causePrefix =
      cause === 'pedestrian_hit'
        ? '🚨💥 보행자 접촉 사고로 슬립 전도!'
        : cause === 'rain_manhole'
          ? '🌧️💥 빗길 금속 맨홀 뚜껑에서 미끄러져 전도!'
          : cause === 'rain_paint'
            ? '🌧️💥 빗길 횡단보도 흰색 페인트선에서 슬립 전도!'
            : cause === 'rain_corner'
              ? '🌧️💥 빗길 노면 접지력 상실로 전도!'
              : '💥 전도 사고!';

    const dmgStage = scooterPhysics.state.damageLevel;
    const bikeDmgNote = ` (차량 ${dmgStage}단계 파손: 가속력 -${dmgStage * 10}% · 미러 흔들림)`;
    if (damagedCount > 0) {
      hud.showToast(
        `${causePrefix} 배달통 음식 ${damagedCount}건 파손 (-${loss}%)${bikeDmgNote}`,
        4600
      );
    } else {
      hud.showToast(`${causePrefix}${bikeDmgNote}`, 4000);
    }
  });

  // Wire Korean Road Speed Bump suspension thud & high-speed cargo shock damage!
  scooterPhysics.setOnSpeedBump((speedKmh, label) => {
    const intensity = Math.min(1, Math.max(0.2, (speedKmh - 10) / 36));
    audio.playSpeedBumpThud(intensity);
    const res = delivery.applySpeedBumpImpact(speedKmh);
    if (res.damagedCount > 0) {
      if (res.spillHit) {
        audio.playLiquidSlosh();
      }
      hud.showToast(
        `⚠️ ${label} 고속 통과 (${Math.round(speedKmh)}km/h)! 서스펜션 충격으로 배달통 음식 -${res.maxLoss}% 파손 (22km/h 이하 서행 권장)`,
        3600
      );
    }
  });

}
