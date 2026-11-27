/** Click wiring for the cargo box, camera, settlement, repair shop, convenience store, report and bonus modals */
import type { ScooterModelId, ScooterPaintId } from '../../vehicle/ScooterModels';
import type { UpgradeId } from '../../delivery/RiderCareer';
import type { ConvenienceItemKind, ModalUi } from '../ModalUi';

/** Backdrop click closes; buttons dispatch to the modal callbacks */
export function wireModalClicks(host: ModalUi): void {
  // Cargo Box 3-Slot modal clicks
  host.cargoBackdrop.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target === host.cargoBackdrop) {
      host.closeAll();
      return;
    }
    const btn = target.closest('button') as HTMLButtonElement | null;
    if (!btn) return;
    if (btn.dataset.action === 'close') {
      host.closeAll();
      return;
    }
    if (btn.dataset.slot !== undefined) {
      const slotIdx = Number(btn.dataset.slot);
      if (!Number.isNaN(slotIdx)) {
        host.callbacks.onCargoSlotAction(slotIdx);
      }
    }
  });

  // Camera shutter button
  document.getElementById('camera-shutter-btn')!.addEventListener('click', (e) => {
    e.stopPropagation();
    if (host.activeModal === 'camera') {
      host.callbacks.onTakePhoto();
    }
  });

  // Settlement confirm button
  document.getElementById('settlement-ok-btn')!.addEventListener('click', (e) => {
    e.stopPropagation();
    host.closeAll();
    host.callbacks.onSettlementClose();
  });

  // Repair & Custom Garage Center modal actions
  host.repairBackdrop.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target === host.repairBackdrop) {
      host.closeAll();
      return;
    }
    const btn = target.closest('button') as HTMLButtonElement | null;
    if (!btn) return;
    if (btn.dataset.action === 'close') {
      host.closeAll();
    } else if (btn.dataset.action === 'confirm_repair' && host.repairCost > 0) {
      const cost = host.repairCost;
      host.closeAll();
      host.callbacks.onRepairConfirm(cost);
    } else if (btn.dataset.bikeModel) {
      const modelId = btn.dataset.bikeModel as ScooterModelId;
      const cost = Number(btn.dataset.cost || 0);
      host.callbacks.onSelectBikeModel(modelId, cost);
    } else if (btn.dataset.bikePaint) {
      const paintId = btn.dataset.bikePaint as ScooterPaintId;
      const cost = Number(btn.dataset.cost || 0);
      host.callbacks.onSelectBikePaint(paintId, cost);
    } else if (btn.dataset.upgradeId) {
      const upgradeId = btn.dataset.upgradeId as UpgradeId;
      const cost = Number(btn.dataset.cost || 0);
      host.callbacks.onBuyUpgrade(upgradeId, cost);
    }
  });

  // 24h Convenience Store modal actions
  host.cvsBackdrop.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target === host.cvsBackdrop) {
      host.closeAll();
      return;
    }
    const btn = target.closest('button') as HTMLButtonElement | null;
    if (!btn) return;
    if (btn.dataset.action === 'close') {
      host.closeAll();
    } else if (btn.dataset.item) {
      const item = btn.dataset.item as ConvenienceItemKind;
      const cost = Number(btn.dataset.cost || 1500);
      host.closeAll();
      host.callbacks.onConvenienceBuy(item, cost);
    }
  });

  // Daily Comprehensive Report modal actions
  host.reportBackdrop.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target === host.reportBackdrop) {
      host.closeAll();
      return;
    }
    const btn = target.closest('button') as HTMLButtonElement | null;
    if (btn?.dataset.action === 'close') {
      host.closeAll();
    }
  });

  // Mission Bonus Celebration modal actions
  host.missionBonusBackdrop.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target === host.missionBonusBackdrop) {
      host.closeAll();
      return;
    }
    const btn = target.closest('button') as HTMLButtonElement | null;
    if (btn?.dataset.action === 'close') {
      host.closeAll();
    }
  });
}
