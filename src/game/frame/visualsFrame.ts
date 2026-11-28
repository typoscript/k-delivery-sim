/** Per-frame stage of the game loop (gameLoop.ts calls the stages in order each frame) */
import { stepDeliveryVisuals } from './deliveryVisualsFrame';
import { stepFirstPerson } from './firstPersonFrame';
import { stepWeatherVisuals } from './weatherVisualsFrame';
import type { GameContext } from '../GameContext';
import type { FrameState, GameLoopHooks, LoopState } from '../gameLoop';
import type { NavigationPlan } from '../../delivery/DeliveryManager';

/** Delivery markers, scooter, first-person hands, camera, photo viewfinder, weather and engine audio */
export function stepVisualsFrame(
  ctx: GameContext,
  hooks: GameLoopHooks,
  loop: LoopState,
  f: FrameState,
  navPlan: NavigationPlan,
): void {
  const { perf } = loop;
  stepDeliveryVisuals(ctx, f, navPlan);
  stepFirstPerson(ctx, hooks, f);
  perf.lap('visuals');
  stepWeatherVisuals(ctx, f);
}
