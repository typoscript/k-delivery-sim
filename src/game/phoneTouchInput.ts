import * as THREE from 'three';
import { GameContext } from './GameContext';
import { DeliveryFlow } from './deliveryFlow';
import { DOUBLE_TAP_MS, DoubleTapZoomGesture } from '../ui/phone/doubleTapZoom';

/**
 * In-world 3D smartphone (in hand or on the handlebar mount): hover hand cursor and direct screen
 * UV touches (accept / reject a call, tap to zoom) without opening the zoomed phone view.
 * Map-app zoom on the screen: tap, then press again and drag (down = in, up = out); a double tap zooms in.
 * A plain tap opens the zoomed phone view once the double-tap window has passed.
 */
export function installPhoneTouchInput(ctx: GameContext, flow: DeliveryFlow): void {
  const { renderer, camera, dispatch, scooterMesh, playerCtrl, audio, hud, modalUi, handheldPhone3D, camController } = ctx;
  const { tryAcceptIncomingOffer, handleRejectIncomingOffer, handleTogglePhoneZoom } = flow;
  // In-world 3D Smartphone Hover Hand & Direct UV Touch Raycaster (no zoom needed for 3D call accept/reject!)
  const raycaster = new THREE.Raycaster();
  const clickNdc = new THREE.Vector2();
  let downX = 0;
  let downY = 0;
  const zoomGesture = new DoubleTapZoomGesture();
  /** Press that started on the phone screen (the gesture follows it) */
  let phonePress = false;
  let pendingZoomOpen: number | null = null;
  const cancelPendingZoomOpen = () => {
    if (pendingZoomOpen !== null) window.clearTimeout(pendingZoomOpen);
    pendingZoomOpen = null;
  };
  /** The handlebar navigation map has its own zoom (heading-up), the handheld map the regular one */
  const isNavMap = () => hud.phoneMap.placement === 'mounted' && playerCtrl.state.mode === 'riding';
  const getZoom = () => (isNavMap() ? hud.phoneMap.view.navZoomLevel : hud.phoneMap.view.zoomLevel);
  const setZoom = (z: number) => {
    if (isNavMap()) hud.phoneMap.view.navZoomLevel = z;
    else hud.phoneMap.view.zoomLevel = z;
  };

  const getVisible3DPhoneTargets = (): THREE.Object3D[] => {
    const targets: THREE.Object3D[] = [];
    if (
      modalUi.activeModal !== 'none' ||
      hud.phoneMap.placement === 'pocket' ||
      hud.phoneMap.isZoomed
    ) {
      return targets;
    }
    if (hud.phoneMap.placement === 'in_hand') targets.push(handheldPhone3D.hitMesh);
    if (hud.phoneMap.placement === 'mounted' && playerCtrl.state.mode === 'riding') {
      targets.push(scooterMesh.mountedPhoneHitMesh);
    }
    return targets;
  };

  renderer.domElement.addEventListener('pointermove', (e) => {
    if (phonePress) {
      const z = zoomGesture.move(e.clientX, e.clientY);
      if (z !== null) {
        setZoom(z);
        camController.yieldPointerToPhone();
        return;
      }
    }
    const targets = getVisible3DPhoneTargets();
    if (targets.length === 0) {
      hud.phoneMap.setExternal3DHandHover(false, e.clientX, e.clientY);
      return;
    }
    clickNdc.x = (e.clientX / window.innerWidth) * 2 - 1;
    clickNdc.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(clickNdc, camera);
    const hits = raycaster.intersectObjects(targets, false);
    hud.phoneMap.setExternal3DHandHover(hits.length > 0, e.clientX, e.clientY);
  });

  renderer.domElement.addEventListener('pointerleave', () => {
    hud.phoneMap.setExternal3DHandHover(false, 0, 0);
  });

  renderer.domElement.addEventListener('pointerdown', (e) => {
    downX = e.clientX;
    downY = e.clientY;
    if (e.button !== 0) return;
    const targets = getVisible3DPhoneTargets();
    if (targets.length === 0) return;
    clickNdc.x = (e.clientX / window.innerWidth) * 2 - 1;
    clickNdc.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(clickNdc, camera);
    if (raycaster.intersectObjects(targets, false).length > 0) {
      hud.phoneMap.triggerExternal3DHandTap(e.clientX, e.clientY);
      phonePress = true;
      if (zoomGesture.down(performance.now(), e.clientX, e.clientY, getZoom())) {
        // Second press of a double tap: it zooms; the first tap must not open the zoomed view
        cancelPendingZoomOpen();
        camController.yieldPointerToPhone();
      }
    }
  });

  renderer.domElement.addEventListener('pointerup', (e) => {
    if (e.button !== 0) return;
    if (phonePress) {
      phonePress = false;
      const wasZooming = zoomGesture.zooming;
      const tapZoom = zoomGesture.up(performance.now(), e.clientX, e.clientY);
      if (wasZooming) {
        if (tapZoom !== null) setZoom(tapZoom);
        camController.yieldPointerToPhone();
        return;
      }
    }
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;

    const targets = getVisible3DPhoneTargets();
    if (targets.length === 0) return;

    clickNdc.x = (e.clientX / window.innerWidth) * 2 - 1;
    clickNdc.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(clickNdc, camera);

    const hits = raycaster.intersectObjects(targets, false);
    if (hits.length > 0) {
      audio.ensureStarted();
      const uv = hits[0].uv;
      if (uv) {
        const action = hud.phoneMap.handle3DScreenTouch(uv.x, uv.y, dispatch.activeOffer?.id ?? null);
        if (action === 'accept_offer') {
          tryAcceptIncomingOffer(true);
          return;
        }
        if (action === 'reject_offer') {
          handleRejectIncomingOffer();
          return;
        }
        if (action === 'expand_offer') return; // banner opened the full call card
      }
      hud.phoneMap.setExternal3DHandHover(false, e.clientX, e.clientY);
      // Open the zoomed view unless this tap turns out to be the first half of a double tap
      cancelPendingZoomOpen();
      pendingZoomOpen = window.setTimeout(() => {
        pendingZoomOpen = null;
        handleTogglePhoneZoom();
      }, DOUBLE_TAP_MS);
    }
  });

}
