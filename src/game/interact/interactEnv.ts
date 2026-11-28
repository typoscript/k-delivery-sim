import type { GameContext } from '../GameContext';
import type { DeliveryFlowState } from '../deliveryFlow';
import type { BikeGarageSave } from '../../vehicle/ScooterModels';

/** What the [E] interaction handlers need from the delivery flow */
export interface InteractEnv {
  ctx: GameContext;
  state: DeliveryFlowState;
  bikeGarage: BikeGarageSave;
  isPlayerNearCargoBox: () => boolean;
  playerHasPhonePhysically: () => boolean;
  enterElevatorToCorridor: (missionId: string) => void;
  exitCorridorToStreet: () => void;
  finalizeCorridorSettlement: () => void;
  handleTakeDeliveryPhoto: () => void;
  /** 산책로 쉼터: hand the food to the customer on the bench and settle right there */
  handleRiversideHandoff: (missionId: string) => void;
}
