/**
 * Systems the app.ts callbacks reach. app.ts builds this with getters, so a callback reads a system only when it
 * runs (the systems are created further down app.ts than the callbacks that use them).
 */
import type { CityWorld } from '../../world/CityWorld';
import type { GameAudio } from '../../audio/GameAudio';
import type { VoiceNavigator } from '../../audio/VoiceNavigator';
import type { Hud } from '../../ui/Hud';
import type { ModalUi } from '../../ui/ModalUi';
import type { DeliveryManager } from '../../delivery/DeliveryManager';
import type { PlayerController } from '../../player/PlayerController';
import type { ScooterPhysics } from '../../vehicle/ScooterPhysics';
import type { ScooterMesh } from '../../vehicle/ScooterMesh';
import type { BikeGarageSave } from '../../vehicle/ScooterModels';
import type { GameContext } from '../GameContext';
import type { DeliveryFlow } from '../deliveryFlow';

export interface AppRefs {
  readonly world: CityWorld;
  readonly audio: GameAudio;
  readonly voiceNav: VoiceNavigator;
  readonly hud: Hud;
  readonly modalUi: ModalUi;
  readonly delivery: DeliveryManager;
  readonly playerCtrl: PlayerController;
  readonly scooterPhysics: ScooterPhysics;
  readonly scooterMesh: ScooterMesh;
  readonly bikeGarage: BikeGarageSave;
  readonly gameCtx: GameContext;
  readonly flow: DeliveryFlow;
  /** Re-applies bought upgrades to the scooter physics */
  readonly syncScooterUpgrades: () => void;
  /** Blocks purchases the wallet can't cover; true when rejected */
  readonly rejectIfInsufficientFunds: (cost: number) => boolean;
}
