/** Per-frame stage of the game loop (gameLoop.ts calls the stages in order each frame) */
import type { GameContext } from '../GameContext';
import type { FrameState, GameLoopHooks, LoopState } from '../gameLoop';
import { ScooterInput } from '../../vehicle/ScooterPhysics';
import { OnFootInput } from '../../player/PlayerController';

/** Obstacles and road condition, then the scooter (riding or parked) and the player on foot */
export function stepPhysicsFrame(ctx: GameContext, hooks: GameLoopHooks, loop: LoopState, f: FrameState): void {
  const {
    world,
    corridorRoom,
    weather,
    scooterPhysics,
    playerCtrl,
    camController,
    audio,
    modalUi,
    traffic,
    roadHazards,
  } = ctx;
  const { pressed } = hooks;
  const { NEUTRAL_SCOOTER_INPUT } = loop;
  const { dt, inCorridor, isRiding, movementBlocked } = f;
  const allObstacles = inCorridor
    ? []
    : [...world.getCollisionObstacles(), ...traffic.getCarObstacleBoxes(), ...roadHazards.getAllObstacleBoxes()];

  const activeBump = inCorridor ? null : world.getSpeedBumpAt(scooterPhysics.state.x, scooterPhysics.state.z);
  const roadCondition = inCorridor
    ? { isRaining: false, surface: 'none' as const, onSpeedBump: false }
    : {
        // snow is a wet road with even less grip
        isRaining: weather.isRaining || weather.isSnowing,
        isSnowing: weather.isSnowing,
        surface: world.getSlipSurfaceAt(scooterPhysics.state.x, scooterPhysics.state.z),
        onSpeedBump: activeBump !== null,
        speedBumpLabel: activeBump?.label,
      };

  if (isRiding && !movementBlocked) {
    const scooterInput: ScooterInput = {
      throttle: pressed.has('KeyW') || pressed.has('ArrowUp'),
      brake: pressed.has('KeyS') || pressed.has('ArrowDown'),
      steerLeft: pressed.has('KeyA') || pressed.has('ArrowLeft'),
      steerRight: pressed.has('KeyD') || pressed.has('ArrowRight'),
      handbrake: pressed.has('Space'),
    };
    scooterPhysics.step(dt, scooterInput, allObstacles, roadCondition);
    playerCtrl.step(
      dt,
      { forward: 0, strafe: 0, sprint: false, jump: false },
      camController.onFootYaw,
      scooterPhysics.state,
      allObstacles,
    );
  } else {
    if (!inCorridor) {
      // Rider still mounted behind a modal -> coast with neutral controls instead of the parked/kickstand branch
      scooterPhysics.step(dt, isRiding ? NEUTRAL_SCOOTER_INPUT : null, allObstacles, roadCondition);
    }

    if (playerCtrl.state.mode === 'on_foot' && !movementBlocked) {
      const turnDir = (pressed.has('ArrowLeft') ? 1 : 0) - (pressed.has('ArrowRight') ? 1 : 0);
      if (turnDir !== 0) {
        camController.rotateOnFootYaw(turnDir * 2.1 * dt);
      }
    }

    const footInput: OnFootInput = movementBlocked
      ? { forward: 0, strafe: 0, sprint: false, jump: false }
      : {
          forward:
            (pressed.has('KeyW') || pressed.has('ArrowUp') ? 1 : 0) -
            (pressed.has('KeyS') || pressed.has('ArrowDown') ? 1 : 0),
          strafe: (pressed.has('KeyA') ? 1 : 0) - (pressed.has('KeyD') ? 1 : 0),
          sprint: pressed.has('ShiftLeft') || pressed.has('ShiftRight'),
          jump: pressed.has('Space') && modalUi.activeModal !== 'camera',
        };
    playerCtrl.step(
      dt,
      footInput,
      camController.onFootYaw,
      scooterPhysics.state,
      allObstacles,
      (x, z) => corridorRoom.clampPlayerInside(x, z),
      (x, z) => corridorRoom.getFloorYAt(x, z),
      () => audio.playStairFootstep(),
    );
  }
}
