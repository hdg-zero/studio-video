import type * as THREE from 'three';
import type { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { Rng } from './math.js';

/** One timed segment of the capsule (produced by `studio timeline`). */
export interface Segment {
  readonly id: string;
  readonly mood: string;
  readonly label: string;
  /** Headline shown on screen. HTML allowed; `<small>` makes a second line. */
  readonly key: string;
  /** Exactly what the voice says; subtitles are derived from it. */
  readonly text: string;
  /** Voice duration in seconds (0 for silent segments such as the credits). */
  readonly dur: number;
  /** Segment start (s). */
  readonly t0: number;
  /** Voice start (s), or `null` when the segment has no voice. */
  readonly voice: number | null;
  /** Segment end (s). */
  readonly t1: number;
}

export interface Timeline {
  readonly segments: readonly Segment[];
  readonly duration: number;
}

/** Texts displayed by the engine around the scenes. */
export interface CapsuleMeta {
  readonly title: string;
  readonly kicker: string;
  /** HTML; `<b>` for the heading line. */
  readonly credits: string;
  /** Optional closing line shown after the last voice (empty = none). */
  readonly closingLine: string;
}

/** Everything a scene update needs to pose itself for one frame. */
export interface FrameInfo {
  /** Local time: seconds since the segment start. */
  readonly u: number;
  /** Segment length in seconds. */
  readonly len: number;
  /** Global time in seconds. */
  readonly t: number;
  /** Local time at which the voice starts (`seg.voice - seg.t0`, or 0). */
  readonly voiceAt: number;
  readonly seg: Segment;
}

/** Per-frame post-processing and atmosphere; reset to the capsule defaults before every frame. */
export interface FrameLook {
  readonly bloom: UnrealBloomPass;
  readonly fog: THREE.FogExp2;
  readonly background: THREE.Color;
}

export interface WorldContext extends FrameLook {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly timeline: Timeline;
  /** CSS layout size of the frame (the output is this times the pixel ratio). */
  readonly layout: { readonly width: number; readonly height: number };
  /**
   * Taller than wide (vertical video). The camera then keeps a 45° horizontal field of view,
   * so a scene framed for 16:9 shows its centre with more room above and below.
   */
  readonly portrait: boolean;
  /** Looks up a segment by id (throws if it does not exist). */
  segment(id: string): Segment;
}

export interface SceneContext extends WorldContext {
  /** Group owned by this scene; it is only visible while the scene's segment plays. */
  readonly group: THREE.Group;
  /** Seeded from the scene id: adding or reordering scenes never changes another scene's randomness. */
  readonly rng: Rng;
}

export type SceneUpdate = (frame: FrameInfo) => void;

export interface SceneDefinition {
  readonly id: string;
  readonly build: (ctx: SceneContext) => SceneUpdate;
}

export interface CapsuleDefinition {
  /** Shared world (lights, sky, starfield) built once before the scenes. */
  readonly setup?: (ctx: WorldContext) => void | Promise<void>;
  /** Per-frame world update that runs before the active scene (e.g. rotate the starfield). */
  readonly everyFrame?: (t: number) => void;
  readonly scenes: readonly SceneDefinition[];
  /** Scene replayed under the credits (default: the last scene). */
  readonly creditsScene?: string;
  /** Font faces to load before anything is drawn on a canvas, e.g. `600 64px "Space Grotesk"`. */
  readonly fonts?: readonly string[];
}

/** Movement of a still image over its segment (« Ken Burns »). */
export type Motion = 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'pan-up' | 'pan-down' | 'still';

/** How a picture fills the frame: cropped to fill it, or whole on a blurred copy of itself. */
export type Fit = 'cover' | 'contain';

interface MediaVisual {
  readonly fit: Fit;
  /** Darkening over the picture so the texts stay readable (0-1). */
  readonly dim: number;
  readonly caption: string;
  /** Source shown small in a corner (photographer, archive, licence). */
  readonly credit: string;
}

/**
 * A ready-made shot drawn by the engine instead of (or over) a coded 3D scene.
 * Resolved by the CLI: `src` are URLs served next to the page.
 */
export type Visual =
  | (MediaVisual & {
      readonly type: 'image';
      readonly src: string;
      readonly motion: Motion;
      /** Point kept in view while zooming, as fractions of the width and height. */
      readonly focus: readonly [number, number];
    })
  | (MediaVisual & {
      readonly type: 'video';
      /** Folder of numbered frames `000001.jpg`… extracted at the capsule's frame rate. */
      readonly frames: string;
      readonly count: number;
      readonly fps: number;
      readonly loop: boolean;
    })
  | { readonly type: 'title'; readonly text: string; readonly sub: string }
  | { readonly type: 'quote'; readonly text: string; readonly author: string }
  | {
      readonly type: 'stat';
      readonly value: number;
      readonly decimals: number;
      readonly prefix: string;
      readonly suffix: string;
      readonly label: string;
    }
  | { readonly type: 'list'; readonly items: readonly string[]; readonly numbered: boolean }
  | {
      readonly type: 'chart';
      readonly kind: 'bar' | 'line';
      readonly data: readonly { readonly label: string; readonly value: number }[];
      readonly unit: string;
      readonly title: string;
    }
  | { readonly type: 'dates'; readonly events: readonly { readonly date: string; readonly text: string }[] };

export type SubtitleStyle = 'line' | 'words';

/** Values injected by the CLI into the page. */
export interface BootConfig {
  readonly timeline: Timeline;
  readonly meta: CapsuleMeta;
  /** CSS layout size; the output resolution is this times the device pixel ratio. */
  readonly layout: { readonly width: number; readonly height: number };
  /** Ready-made shots by segment id. */
  readonly visuals?: Readonly<Record<string, Visual>>;
  /** `line`: one sentence at a time, at the bottom (default); `words`: a few words at a time, the spoken one highlighted. */
  readonly subtitles?: SubtitleStyle;
  readonly look: {
    readonly background: number;
    readonly accent: number;
    readonly fogDensity: number;
    readonly bloom: number;
    readonly exposure: number;
    /** Multisample anti-aliasing samples for the 3D scene (0 = off). */
    readonly msaa: number;
  };
}

/** API exposed on `window.studio` for the recorder. */
export interface StudioApi {
  readonly ready: true;
  readonly duration: number;
  /** Draws time `t`; the promise resolves once every picture of the frame is decoded. */
  renderAt(t: number): Promise<void> | undefined;
  gpu(): string;
}

declare global {
  interface Window {
    studio?: StudioApi;
    __STUDIO_BOOT__?: BootConfig;
  }
}
