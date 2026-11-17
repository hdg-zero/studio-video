/**
 * @studio/runtime — public API used by capsule scenes.
 *
 * A capsule's `scenes/index.ts` default-exports `defineCapsule({ setup, scenes })`;
 * each scene is `defineScene(id, ctx => frame => { … })`, a pure function of time.
 */
export { boot, defineCapsule } from './engine.js';
export {
  circleSegments,
  dotTexture,
  drawLines,
  makePoints,
  pointsMaterial,
  samplePoints,
  starfield,
  textSprite,
} from './helpers.js';
export type { SampleOptions, TextSpriteOptions } from './helpers.js';
export { clamp, createRng, hashString, lerp, randomTable, smooth } from './math.js';
export type { Rng } from './math.js';
export { splitSubtitles, splitWordCues } from './subtitles.js';
export type { Cue, TimedWord, WordCue, WordCueOptions } from './subtitles.js';
export type {
  BootConfig,
  CapsuleDefinition,
  CapsuleMeta,
  FrameInfo,
  Fit,
  FrameLook,
  Motion,
  SceneContext,
  SceneDefinition,
  SceneUpdate,
  Segment,
  StudioApi,
  SubtitleStyle,
  Timeline,
  Visual,
  WorldContext,
} from './types.js';

import type { SceneContext, SceneDefinition, SceneUpdate } from './types.js';

/** Declares the scene played during the narration segment `id`. */
export const defineScene = (id: string, build: (ctx: SceneContext) => SceneUpdate): SceneDefinition => ({
  id,
  build,
});
