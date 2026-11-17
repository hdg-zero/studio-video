/**
 * The production steps as plain functions of (project, options, signal), so the CLI commands
 * and the web UI's job queue run exactly the same code.
 */
import { checkVoices, mixSoundtrack } from './audio.js';
import type { GpuMode } from './browser.js';
import type { VideoCodec } from './encoder.js';
import { log } from './log.js';
import type { Project } from './project.js';
import { render, type RenderSummary } from './render.js';
import { computeTimeline, writeTimeline } from './steps.js';
import { renderStills } from './stills.js';
import { apiKeyAvailable, generateVoices } from './tts.js';

export const ACTIONS = ['tts', 'timeline', 'music', 'stills', 'render', 'make'] as const;
export type ActionKind = (typeof ACTIONS)[number];

export const GPU_MODES: readonly GpuMode[] = ['auto', 'gpu', 'cpu'];
export const CODECS: readonly VideoCodec[] = ['x264', 'vaapi', 'nvenc'];

/** Every option of every step; each step reads the ones it understands. */
export interface ActionOptions {
  /** tts: regenerate these ids · render: only these segments. */
  readonly only?: readonly string[] | undefined;
  readonly force?: boolean | undefined;
  readonly check?: boolean | undefined;
  readonly estimate?: boolean | undefined;
  readonly noVoice?: boolean | undefined;
  readonly times?: readonly number[] | undefined;
  readonly draft?: boolean | undefined;
  readonly gpu?: GpuMode | undefined;
  readonly codec?: VideoCodec | undefined;
  readonly workers?: number | undefined;
  readonly chunkFrames?: number | undefined;
  readonly output?: string | undefined;
}

export type ActionResult =
  | { readonly kind: 'tts'; readonly clips: number }
  | { readonly kind: 'timeline'; readonly duration: number; readonly segments: number }
  | { readonly kind: 'music'; readonly file: string }
  | { readonly kind: 'stills'; readonly file: string }
  | ({ readonly kind: 'render' | 'make' } & RenderSummary);

export async function runAction(
  project: Project,
  kind: ActionKind,
  opts: ActionOptions,
  signal?: AbortSignal,
): Promise<ActionResult> {
  switch (kind) {
    case 'tts': {
      const manifest = await generateVoices(project, { only: opts.only, force: Boolean(opts.force), signal });
      if (opts.check) await checkVoices(project, signal);
      return { kind, clips: Object.keys(manifest.clips).length };
    }
    case 'timeline': {
      const tl = await writeTimeline(project, { estimate: Boolean(opts.estimate) });
      return { kind, duration: tl.duration, segments: tl.segments.length };
    }
    case 'music':
      return { kind, file: await mixSoundtrack(project, { noVoice: Boolean(opts.noVoice), signal }) };
    case 'stills':
      return { kind, file: await renderStills(project, { times: opts.times, gpu: opts.gpu ?? 'auto', signal }) };
    case 'render':
      return { kind, ...(await renderWith(project, opts, signal)) };
    case 'make': {
      const hasKey = apiKeyAvailable();
      if (hasKey) await generateVoices(project, { signal });
      else log.warn('pas de clé OpenRouter : voix en cache uniquement');
      await writeTimeline(project, { estimate: !hasKey });
      const { estimated } = await computeTimeline(project);
      signal?.throwIfAborted();
      await mixSoundtrack(project, { noVoice: estimated.length === project.capsule.segments.length, signal });
      return { kind, ...(await renderWith(project, opts, signal)) };
    }
  }
}

function renderWith(project: Project, opts: ActionOptions, signal: AbortSignal | undefined): Promise<RenderSummary> {
  return render(project, {
    quality: opts.draft ? 'draft' : 'final',
    gpu: opts.gpu ?? 'auto',
    codec: opts.codec ?? 'x264',
    workers: opts.workers,
    chunkFrames: opts.chunkFrames ?? 90,
    only: opts.only,
    output: opts.output,
    signal,
  });
}
