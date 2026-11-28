/**
 * The order of the per-frame stages matters (world before physics before delivery, the camera after the scooter
 * moved, the HUD last ...). This pins it: a refactor that moves a stage call fails here on purpose.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The step...() calls in a source file, in order */
function stageCalls(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  return [...src.matchAll(/\b(step[A-Z]\w*)\(/g)].map((m) => m[1]).filter((n) => !src.includes(`function ${n}(`));
}

describe('frame stage order', () => {
  it('the game loop runs the stages in this order', () => {
    expect(stageCalls('src/game/gameLoop.ts')).toEqual([
      'stepWorldFrame',
      'stepPhysicsFrame',
      'stepDeliveryFrame',
      'stepVisualsFrame',
      'stepGuidanceFrame',
    ]);
  });

  it('each stage runs its parts in this order', () => {
    expect(stageCalls('src/game/frame/worldFrame.ts')).toEqual([
      'stepRoadConditions',
      'stepRiderWatch',
      'stepCorridorFrame',
    ]);
    expect(stageCalls('src/game/frame/visualsFrame.ts')).toEqual([
      'stepDeliveryVisuals',
      'stepFirstPerson',
      'stepWeatherVisuals',
    ]);
    expect(stageCalls('src/game/frame/guidanceFrame.ts')).toEqual(['stepVoiceGuidance', 'stepPhoneBattery']);
  });
});
