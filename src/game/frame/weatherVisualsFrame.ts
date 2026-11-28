/** Weather and sound each frame: rain particles, visor droplets, wet roads, flowing streams, snow cover, rain / water / engine audio */
import { streamSoundLevel } from '../../world/streamWater';
import type { GameContext } from '../GameContext';
import type { FrameState } from '../gameLoop';

export function stepWeatherVisuals(ctx: GameContext, f: FrameState): void {
  const { camera, world, weather, visorRain, scooterPhysics, audio } = ctx;
  const { dt, elapsed, inCorridor, isRiding } = f;
  // Weather local rain particles (InstancedMesh), 1st-person helmet visor droplets, wet asphalt & audio!
  weather.update(dt, camera.position.x, camera.position.y, camera.position.z, inCorridor, world.isNight);
  // a raincoat's hood keeps most drops off the visor
  const visorRainMul = ctx.delivery.hasUpgrade('raincoat') ? 0.35 : 1;
  visorRain.update(dt, weather.rainIntensity * visorRainMul, inCorridor, scooterPhysics.state.speed, isRiding);
  if (!inCorridor) {
    world.updateWeatherVisuals(weather.rainIntensity, elapsed);
    world.streamWater?.update(dt, weather.rainIntensity);
    // running water near a stream (louder after rain)
    const lx = isRiding ? scooterPhysics.state.x : ctx.playerCtrl.state.x;
    const lz = isRiding ? scooterPhysics.state.z : ctx.playerCtrl.state.z;
    audio.setWater(streamSoundLevel(world.distanceToStream(lx, lz), weather.rainIntensity));
  } else {
    audio.setWater(0);
    audio.setWind(0);
  }
  // snow keeps settling (and melting) while the rider is indoors too
  world.updateSnowCover(dt, weather.isSnowing);
  audio.updateWeatherAudio(weather.rainIntensity, inCorridor);
  audio.update(scooterPhysics.state, elapsed);
}
