import { ACTIVE_MAP_DATA } from '../data/suwonDistricts';
import { GameContext } from './GameContext';

/** Gameplay actions the keyboard handler triggers (defined in main.ts, they close over game flow state) */
export interface KeyboardActions {
  handleContextInteract: () => void;
  handleCycleWeather: () => void;
  handleTogglePhone: () => void;
  handleTogglePhoneZoom: () => void;
}

/**
 * Installs keydown / keyup / blur listeners for all gameplay hotkeys.
 * Returns the live set of currently held key codes (read every frame by the game loop).
 */
export function installKeyboardInput(ctx: GameContext, actions: KeyboardActions): Set<string> {
  const { world, corridorRoom, visorRain, voiceNav, delivery, scooterPhysics, scooterMesh, playerCtrl, camController, audio, hud, modalUi, districtUi, onboardingSettings } = ctx;
  const { handleContextInteract, handleCycleWeather, handleTogglePhone, handleTogglePhoneZoom } = actions;
  const pressed = new Set<string>();


  window.addEventListener('pointerdown', () => audio.ensureStarted(), { once: true });

  window.addEventListener('keydown', (e) => {
    audio.ensureStarted();

    // Let active modal (POS / PIN / Cargo / Camera shutter / Settlement / Transition) handle keys first!
    if (modalUi.handleKeyDown(e)) {
      return;
    }

    const code = e.code;
    if (
      code === 'Space' ||
      code === 'Tab' ||
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight' ||
      code === 'F1'
    ) {
      e.preventDefault();
    }

    const firstPress = !pressed.has(code);
    pressed.add(code);
    if (!firstPress) return;

    // District (P) / Settings (O) menus are modal: only their own toggles, Escape and mute pass through
    if (
      (districtUi.isOpen || onboardingSettings.isSettingsOpen) &&
      code !== 'KeyO' &&
      code !== 'KeyP' &&
      code !== 'Escape' &&
      code !== 'KeyM'
    ) {
      return;
    }

    switch (code) {
      case 'KeyF': {
        const res = playerCtrl.tryToggleMount(
          scooterPhysics.state,
          (mounted) => scooterPhysics.setMounted(mounted),
          world.obstacles,
          delivery.isCarryingFood()
        );
        if (res.changed) {
          const nowRiding = playerCtrl.state.mode === 'riding';
          if (nowRiding) {
            if (hud.phoneMap.placement === 'in_hand') {
              hud.stowPhoneToPocket();
            }
            hud.phoneMap.setZoomed(false);
          } else {
            // Physical phone possession: if mounted on scooter, it stays on the scooter when dismounting!
            hud.phoneMap.setZoomed(false);
          }
          audio.playMountSound(nowRiding);
          camController.syncYawOnModeChange(playerCtrl.state, scooterPhysics.state);

          if (!nowRiding && hud.phoneMap.placement === 'mounted') {
            hud.showToast(
              '하차 완료 (📱 휴대폰이 오토바이 거치대에 남아있습니다 — [Tab]으로 챙기세요)',
              3400
            );
            break;
          }
        }
        hud.showToast(res.message);
        break;
      }
      case 'KeyE': {
        if (playerCtrl.state.mode === 'on_foot') {
          handleContextInteract();
        } else if (playerCtrl.state.mode === 'riding') {
          const on = scooterPhysics.toggleRightBlinker();
          hud.showToast(on ? '▶ 우측 깜빡이 ON (회전 후 자동 해제)' : '우측 깜빡이 OFF', 1600);
        }
        break;
      }
      case 'KeyQ': {
        if (playerCtrl.state.mode === 'riding') {
          const on = scooterPhysics.toggleLeftBlinker();
          hud.showToast(on ? '◀ 좌측 깜빡이 ON (회전 후 자동 해제)' : '좌측 깜빡이 OFF', 1600);
        }
        break;
      }
      case 'KeyX': {
        if (playerCtrl.state.mode === 'riding') {
          const on = scooterPhysics.toggleHazard();
          hud.showToast(on ? '⚠ 비상등 ON' : '비상등 OFF', 1600);
        }
        break;
      }
      case 'KeyL': {
        scooterPhysics.state.headlights = !scooterPhysics.state.headlights;
        hud.showToast(scooterPhysics.state.headlights ? '헤드라이트 ON' : '헤드라이트 OFF');
        break;
      }
      case 'KeyN': {
        const night = world.toggleDayNight();
        delivery.setNightMode(night);
        if (night && !scooterPhysics.state.headlights) {
          scooterPhysics.state.headlights = true;
        }
        hud.showToast(
          night
            ? '🌙 야간 모드 ON! (헤드라이트 3D 빔 자동 점등 · 신규 콜 심야 할증 +₩1,200!)'
            : '☀️ 주간 모드 ON',
          3600
        );
        break;
      }
      case 'KeyU': {
        handleCycleWeather();
        break;
      }
      case 'KeyG': {
        if (!playerCtrl.state.inCorridor && modalUi.activeModal === 'none') {
          if (visorRain.triggerWipe()) {
            audio.playVisorWipeSound();
            hud.showToast('🧤 헬멧 바이저 빗물을 닦아냈습니다!', 1800);
          }
        }
        break;
      }
      case 'KeyO': {
        if (modalUi.activeModal === 'none') {
          districtUi.close();
          onboardingSettings.toggleSettingsModal();
        }
        break;
      }
      case 'KeyP': {
        if (modalUi.activeModal === 'none') {
          onboardingSettings.closeSettingsModal();
          districtUi.toggle();
        }
        break;
      }
      case 'KeyM': {
        const muted = audio.toggleMute();
        voiceNav.setMuted(muted);
        hud.showToast(muted ? '사운드 음소거' : '사운드 켜짐');
        break;
      }
      case 'KeyH': {
        if (playerCtrl.state.mode === 'riding') {
          audio.setHorn(true);
        }
        break;
      }
      case 'KeyR': {
        camController.resetLook();
        break;
      }
      case 'Backspace': {
        if (playerCtrl.state.inCorridor) {
          const sp = corridorRoom.getRescuePoint();
          playerCtrl.teleportTo(sp.x, sp.y, sp.z, sp.heading, true);
          camController.onFootYaw = sp.heading;
        } else {
          scooterPhysics.reset();
          playerCtrl.reset();
          camController.onFootYaw = ACTIVE_MAP_DATA.meta.playerSpawn.heading;
        }
        hud.stowPhoneToPocket();
        scooterMesh.setPhoneMounted(false);
        camController.resetLook();
        delivery.invalidateNavCache();
        hud.showToast('위치 초기화 완료');
        break;
      }
      case 'Tab': {
        handleTogglePhone();
        break;
      }
      case 'KeyV': {
        handleTogglePhoneZoom();
        break;
      }
      case 'Escape': {
        if (districtUi.isOpen) {
          districtUi.close();
        } else if (onboardingSettings.isSettingsOpen) {
          onboardingSettings.closeSettingsModal();
        } else if (hud.phoneMap.isZoomed) {
          handleTogglePhoneZoom();
        }
        break;
      }
      case 'F1': {
        hud.toggleHelp();
        break;
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    pressed.delete(e.code);
    if (e.code === 'KeyH') {
      audio.setHorn(false);
    }
  });

  window.addEventListener('blur', () => {
    pressed.clear();
    audio.setHorn(false);
  });

  return pressed;
}
