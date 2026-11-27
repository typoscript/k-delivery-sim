import * as THREE from 'three';
import { GameContext } from './GameContext';
import { DeliveryFlow } from './deliveryFlow';

/**
 * In-world 3D smartphone (in hand or on the handlebar mount): hover hand cursor and direct screen
 * UV touches (accept / reject a call, tap to zoom) without opening the zoomed phone view.
 */
export function installPhoneTouchInput(ctx: GameContext, flow: DeliveryFlow): void {
  const { renderer, camera, dispatch, scooterMesh, playerCtrl, audio, hud, modalUi, handheldPhone3D } = ctx;
  const { tryAcceptIncomingOffer, handleRejectIncomingOffer, handleTogglePhoneZoom } = flow;
  // In-world 3D Smartphone Hover Hand & Direct UV Touch Raycaster (no zoom needed for 3D call accept/reject!)
  const raycaster = new THREE.Raycaster();
  const clickNdc = new THREE.Vector2();
  let downX = 0;
  let downY = 0;

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
    }
  });

  renderer.domElement.addEventListener('pointerup', (e) => {
    if (e.button !== 0) return;
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
        const action = hud.phoneMap.handle3DScreenTouch(uv.x, uv.y, dispatch.activeOffer !== null);
        if (action === 'accept_offer') {
          tryAcceptIncomingOffer(true);
          return;
        }
        if (action === 'reject_offer') {
          handleRejectIncomingOffer();
          return;
        }
      }
      hud.phoneMap.setExternal3DHandHover(false, e.clientX, e.clientY);
      handleTogglePhoneZoom();
    }
  });

}
