/** Where the phone is (pocket / hand / handlebar mount), the zoomed view and the overlays that follow them */
import type { PhoneMap } from '../PhoneMap';
import { PhonePlacement } from './types';

export function setPlacement(host: PhoneMap, next: PhonePlacement): void {
  // on the handlebar the phone is the rider's navigation: back to the delivery app
  if (next === 'mounted' && host.placement !== 'mounted') host.setApp('delivery');
  host.placement = next;
  if (next === 'pocket') {
    host.isZoomed = false;
  }
  host.last3DRenderTime = -1;
  host.lastZoomMapRenderTime = -1;
  host.syncOverlayVisibility();
}

export function setZoomed(host: PhoneMap, zoomed: boolean): boolean {
  host.view.isMapDragging = false;
  host.view.dragPointerId = null;
  host.view.panVelX = 0;
  host.view.panVelZ = 0;
  host.zoomCanvas.classList.remove('dragging');
  if (host.placement === 'pocket') {
    host.isZoomed = false;
    host.syncOverlayVisibility();
    return false;
  }
  host.isZoomed = zoomed;
  host.syncOverlayVisibility();
  if (host.isZoomed) {
    host.lastSheetFingerprint = '';
    requestAnimationFrame(() => host.syncZoomCanvasSize());
  } else {
    host.view.followPlayer = true;
    host.followBtn.classList.add('active');
    host.touchHandEl.classList.remove('active', 'tapping');
    host.last3DRenderTime = -1;
    host.lastZoomMapRenderTime = -1;
  }
  return host.isZoomed;
}

export function toggleZoom(host: PhoneMap, isRiding: boolean): { zoomed: boolean; message: string } {
  if (host.placement === 'pocket') {
    return { zoomed: false, message: '먼저 [Tab]으로 휴대폰을 꺼내거나 거치대에 놓으세요' };
  }
  // Realistic physical possession restriction: phone left on scooter cannot be opened while on foot!
  if (host.placement === 'mounted' && !isRiding) {
    return {
      zoomed: false,
      message: '🚫 휴대폰이 오토바이 거치대에 있습니다! 오토바이 근처에서 [Tab]으로 먼저 챙기세요',
    };
  }
  const next = host.setZoomed(!host.isZoomed);
  return {
    zoomed: next,
    message: next
      ? '🔍 휴대폰 확대 보기 (묶음 콜 · 추천 동선 · 지도 조작 · V로 축소)'
      : host.placement === 'mounted'
        ? '오토바이 거치대 3D 내비게이션 시점으로 복귀'
        : '손에 든 3D 휴대폰 시점으로 복귀',
  };
}

export function toggleWithTab(
  host: PhoneMap,
  isRiding: boolean,
  nearScooter: boolean,
): { placement: PhonePlacement; anim?: 'mount' | 'unmount'; blocked?: boolean; message: string } {
  if (isRiding) {
    if (host.placement === 'mounted') {
      host.setPlacement('pocket');
      return {
        placement: 'pocket',
        anim: 'unmount',
        message: '📱 거치대에서 휴대폰을 빼서 주머니에 넣었습니다',
      };
    }
    host.setPlacement('mounted');
    return {
      placement: 'mounted',
      anim: 'mount',
      message: '📱 거치대에 휴대폰 장착! 라이딩 내비게이션 모드 활성화',
    };
  }

  if (host.placement === 'mounted') {
    if (!nearScooter) {
      return {
        placement: 'mounted',
        blocked: true,
        message: '🚫 휴대폰이 오토바이 거치대에 꽂혀 있습니다! 오토바이로 가서 [Tab]으로 챙기세요',
      };
    }
    host.setPlacement('pocket');
    return {
      placement: 'pocket',
      anim: 'unmount',
      message: '📱 오토바이 거치대에서 휴대폰을 챙겨 주머니에 넣었습니다',
    };
  }

  if (host.placement === 'in_hand') {
    host.setPlacement('pocket');
    return {
      placement: 'pocket',
      message: '휴대폰을 주머니에 넣었습니다',
    };
  }

  host.setPlacement('in_hand');
  return {
    placement: 'in_hand',
    message: '✋ 주머니에서 휴대폰을 꺼냈습니다 ([V] 또는 휴대폰 클릭으로 확대)',
  };
}

export function syncOverlayVisibility(host: PhoneMap): void {
  const showZoomModal = host.placement !== 'pocket' && host.isZoomed;
  host.zoomBackdropEl.classList.toggle('hidden', !showZoomModal);
  host.phoneEl.classList.toggle('mode-hand', host.placement === 'in_hand');
  host.phoneEl.classList.toggle('mode-mounted', host.placement === 'mounted');
  host.pocketPillEl.classList.toggle('hidden', showZoomModal);

  if (host.placement === 'in_hand') {
    host.placementTagEl.textContent = '✋ 손에 든 휴대폰 (확대 보기)';
    host.stowBtn.textContent = '주머니로';
  } else if (host.placement === 'mounted') {
    host.placementTagEl.textContent = '🛵 오토바이 거치대 내비게이션 (확대 보기)';
    host.stowBtn.textContent = '분리';
  }
}

export function syncZoomCanvasSize(host: PhoneMap): void {
  const rect = host.zoomCanvas.getBoundingClientRect();
  if (rect.width < 10 || rect.height < 10) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const targetW = Math.round(rect.width * dpr);
  const targetH = Math.round(rect.height * dpr);
  if (host.zoomCanvas.width !== targetW || host.zoomCanvas.height !== targetH) {
    host.zoomCanvas.width = targetW;
    host.zoomCanvas.height = targetH;
  }
}
