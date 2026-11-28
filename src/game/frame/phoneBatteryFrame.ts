/** The phone battery each frame: drain by use, wireless charging on the handlebar mount, low / dead warnings */
import type { GameContext } from '../GameContext';
import type { FrameState } from '../gameLoop';
import { getUpgradeEffects } from '../../delivery/RiderCareer';

export function stepPhoneBattery(ctx: GameContext, f: FrameState): void {
  const { voiceNav, delivery, scooterPhysics, audio, hud } = ctx;
  const { dt } = f;
  // Step smartphone battery drain & handlebar-mount wireless charging (2x faster with fast_charger upgrade!)
  const chargeSpeedMul = getUpgradeEffects(delivery.career.upgrades).chargeSpeedMul;
  hud.phoneMap.stepBattery(
    dt,
    scooterPhysics.state.engineOn,
    () => {
      audio.playWirelessChargeStart();
      hud.showToast(
        chargeSpeedMul > 1.5
          ? '⚡ 고속 무선충전 거치대 작동! (2배 속도로 초고속 충전 중)'
          : '⚡ 오토바이 거치대 무선충전 시작! (주행 중 배터리 자동 충전)',
        2600,
      );
    },
    () => {
      audio.playLowBatteryBeep();
      voiceNav.speak('휴대폰 배터리가 부족합니다. 거치대에 장착해 충전하세요.');
      hud.showToast('🪫 휴대폰 배터리 15% 이하! 오토바이 거치대 [Tab] 무선충전 또는 🏪 편의점 충전 필요', 4200);
    },
    () => {
      audio.playLowBatteryBeep();
      hud.showToast(
        '🪫 휴대폰 배터리 방전! 오토바이 거치대 [Tab] 시동 무선충전 또는 🏪 K-24 편의점에서 충전하세요',
        4600,
      );
    },
    chargeSpeedMul,
  );
}
