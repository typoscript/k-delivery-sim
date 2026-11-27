/** Order dispatch events: a call arrives / is taken by a rival / runs out (banner, voice, sounds) */
import type { DispatchCallbacks } from '../../delivery/OrderDispatchManager';
import type { AppRefs } from './appRefs';

export function dispatchCallbacks(r: AppRefs): DispatchCallbacks {
  return {
    onOfferArrived: (offer) => {
      const special = offer.orders.find((o) => o.special)?.special;
      if (special) {
        // Special orders announce themselves: distinct alert, then the usual call alert
        r.audio.playSpecialOrderAlert(special);
        window.setTimeout(() => r.audio.playDispatchCallAlert(), 450);
      } else {
        r.audio.playDispatchCallAlert();
      }
      r.voiceNav.speak(
        special === 'urgent'
          ? '급한 배달 콜이 도착했습니다. 제한시간이 짧습니다.'
          : special === 'group'
            ? '단체 주문 콜이 도착했습니다.'
            : offer.type === 'SINGLE'
              ? '새로운 한집배달 콜이 도착했습니다.'
              : '새로운 알뜰배달 묶음 콜이 도착했습니다.',
      );
      const label = offer.type === 'SINGLE' ? '🚀 한집배달' : '🛵 알뜰배달 (2건 묶음)';
      const hint =
        r.hud.phoneMap.placement === 'pocket'
          ? '[Tab]으로 휴대폰을 꺼낸 뒤 화면을 터치해 20초 내 수락하세요!'
          : '휴대폰 위쪽 콜 배너의 [수락]을 누르세요 (배너를 누르면 자세히)';
      const rivalHint = offer.rival ? ' · 🛵 근처 경쟁 라이더도 노리는 콜!' : '';
      r.hud.showToast(`🔔 신규 콜 도착! ${label} · ₩${offer.totalFee.toLocaleString()}${rivalHint} — ${hint}`, 4500);
    },
    onOfferTakenByRival: (offer) => {
      r.audio.playDispatchExpiredSound();
      const label = offer.type === 'SINGLE' ? '한집배달' : '알뜰배달';
      r.hud.showToast(`🛵 근처 경쟁 라이더가 ${label} 콜(₩${offer.totalFee.toLocaleString()})을 먼저 가져갔어요`, 3600);
    },
    onBoardCallTaken: (order) => {
      // Only worth a word while the rider is looking at the call list
      if (r.hud.phoneMap.isZoomed)
        r.hud.showToast(`🛵 다른 라이더가 #${order.orderNumber} 콜을 가져갔어요 (새 콜로 채워집니다)`, 2600);
    },
    onOfferUrgentTick: () => {
      r.audio.playDispatchCallAlert();
    },
    onOfferExpired: (offer) => {
      r.audio.playDispatchExpiredSound();
      const label = offer.type === 'SINGLE' ? '한집배달' : '알뜰배달';
      r.hud.showToast(`⏱ ${label} 콜 응답 시간 초과 (자동 거절 · 10초 후 새 콜 배정)`, 3200);
    },
  };
}
