/** Keyboard input while a modal is open (key repeats ignored; Esc closes, digits feed the keypads, ...) */
import type { ModalUi } from '../ModalUi';

/** Handles physical keyboard input when POS / PIN / Cargo / Camera / Settlement modal is open */
export function handleKeyDown(host: ModalUi, e: KeyboardEvent): boolean {
  if (host.activeModal === 'none') return false;

  // Swallow OS key auto-repeat: holding Space/E/Enter must not chain shutter -> settlement close, or E open -> close
  if (e.repeat) {
    e.preventDefault();
    return true;
  }

  if (host.activeModal === 'transition') {
    e.preventDefault();
    return true;
  }

  if (host.activeModal === 'cargo') {
    e.preventDefault();
    if (e.key === 'Escape' || e.code === 'KeyE') {
      host.closeAll();
    } else if (e.key === '1' || e.key === '2' || e.key === '3') {
      host.callbacks.onCargoSlotAction(Number(e.key) - 1);
    }
    return true;
  }

  if (host.activeModal === 'fuel') {
    e.preventDefault();
    if (host.fuel.isFueling) return true;
    if (e.key === 'Escape') {
      host.closeAll();
    } else if (e.key === 'Enter' || e.code === 'KeyE' || e.code === 'Space') {
      host.fuel.begin();
    }
    return true;
  }

  if (host.activeModal === 'repair') {
    e.preventDefault();
    if (e.key === 'Escape') {
      host.closeAll();
    } else if ((e.key === 'Enter' || e.code === 'Space') && host.repairCost > 0) {
      const cost = host.repairCost;
      host.closeAll();
      host.callbacks.onRepairConfirm(cost);
    }
    return true;
  }

  if (host.activeModal === 'convenience') {
    e.preventDefault();
    if (e.key === 'Escape' || e.code === 'KeyE') {
      host.closeAll();
    } else if (e.key === '1') {
      host.closeAll();
      host.callbacks.onConvenienceBuy('energy_drink', 1500);
    } else if (e.key === '2') {
      host.closeAll();
      host.callbacks.onConvenienceBuy('iced_coffee', 1200);
    } else if (e.key === '3') {
      host.closeAll();
      host.callbacks.onConvenienceBuy('power_bank', 2000);
    }
    return true;
  }

  if (host.activeModal === 'daily_report' || host.activeModal === 'mission_bonus') {
    if (e.key === 'Escape' || e.key === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      host.closeAll();
    }
    return true;
  }

  if (host.activeModal === 'pos') {
    e.preventDefault();
    if (e.key === 'Escape') {
      host.closeAll();
    } else {
      host.pos.handleKey(e.key);
    }
    return true;
  }

  if (host.activeModal === 'pin') {
    e.preventDefault();
    if (e.key === 'Escape') {
      host.closeAll();
    } else {
      host.pin.handleKey(e.key);
    }
    return true;
  }

  if (host.activeModal === 'camera') {
    if (e.code === 'Space' || e.key === 'Enter') {
      e.preventDefault();
      host.callbacks.onTakePhoto();
      return true;
    }
    return false;
  }

  if (host.activeModal === 'settlement') {
    if (e.key === 'Enter' || e.code === 'Space' || e.key === 'Escape') {
      e.preventDefault();
      host.closeAll();
      host.callbacks.onSettlementClose();
    }
    return true;
  }

  return false;
}
