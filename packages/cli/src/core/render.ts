/**
 * Parallel, incremental renderer (the worker pool is in render-workers.ts).
 *
 *   bundle ─▶ plan chunks (per segment) ─▶ cache lookup ─▶ worker pool (1 browser + 1 ffmpeg each)
 *          ─▶ concat (-c copy) + audio mux ─▶ out/<Title>.mp4
 *
 * Workers pull chunks from a shared queue (longest first), so heavy and light scenes
 * balance out. Finished chunks are stored under a content key: a later render reuses
 * every chunk whose scene code, timing and settings are unchanged.
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Timeline } from '@studio/runtime';
import { selectProfile, type GpuMode } from './browser.js';
import { bundleProject } from './bundle.js';
import type { ImageFormat } from './capture.js';
import { CREDITS_ID, layoutOf, subtitleStyle } from './config.js';
import { concatAndMux, probe, type AudioSlice, type EncodeSettings, type VideoCodec } from './encoder.js';
import { color, log } from './log.js';
import { resolveVisuals } from './media.js';
import { audioSpan, chunkKey, planChunks, segmentFingerprint, selectSegments } from './plan.js';
import { loadTimeline, outputName, type Project } from './project.js';
import { renderChunks, type PlannedChunk } from './render-workers.js';
import { formatBytes, formatDuration } from './util.js';

export type Quality = 'final' | 'draft';

export interface RenderOptions {
  readonly quality: Quality;
  readonly gpu: GpuMode;
  readonly codec: VideoCodec;
  /** Parallel workers; default: half the CPU threads, at most 8. */
  readonly workers?: number;
  /** Maximum frames per chunk (cache granularity). */
  readonly chunkFrames: number;
  /** Render only these segment ids (a contiguous selection keeps its audio). */
  readonly only?: readonly string[];
  readonly output?: string;
  /** Stops the render (workers, browsers and encoders); finished chunks stay cached. */
  readonly signal?: AbortSignal;
}

interface QualityPreset {
  readonly scale: number;
  readonly crf: number;
  readonly preset: string;
  readonly image: ImageFormat;
  readonly jpegQuality: number;
}

const PRESETS: Record<Quality, QualityPreset> = {
  final: { scale: 1, crf: 16, preset: 'medium', image: 'jpeg', jpegQuality: 95 },
  draft: { scale: 2 / 3, crf: 23, preset: 'veryfast', image: 'jpeg', jpegQuality: 85 },
};

export interface RenderSummary {
  readonly output: string;
  readonly frames: number;
  readonly renderedFrames: number;
  readonly seconds: number;
  readonly renderer: string;
}

export async function render(project: Project, opts: RenderOptions): Promise<RenderSummary> {
  const started = performance.now();
  const { capsule, paths } = project;
  const timeline = await loadTimeline(project);
  const preset = PRESETS[opts.quality];
  const fps = capsule.format.fps;
  const pixelRatio = capsule.format.pixelRatio * preset.scale;
  const layout = layoutOf(capsule.format);
  const width = Math.round((layout.width * pixelRatio) / 2) * 2;
  const height = Math.round((layout.height * pixelRatio) / 2) * 2;

  // MSAA doubles the cost of software WebGL: only worth it on a real GPU
  const { profile, renderer } = await selectProfile(opts.gpu);
  const msaa = profile.hardware ? capsule.look.msaa : 0;

  log.step(`bundle ${project.name}`);
  const bundle = await bundleProject(project);
  bundle.warnings.forEach((w) => log.warn(w));
  const { visuals, fingerprints } = await resolveVisuals(project, { strict: true });

  const encode: Omit<EncodeSettings, 'threads'> = {
    codec: opts.codec,
    fps,
    quality: preset.crf,
    preset: preset.preset,
    input: preset.image,
  };
  const settings = {
    width,
    height,
    pixelRatio,
    encode,
    jpegQuality: preset.jpegQuality,
    meta: [capsule.title, capsule.kicker, capsule.credits, capsule.closingLine, capsule.language],
    look: { ...capsule.look, msaa },
    subtitles: subtitleStyle(capsule),
  };
  const creditsScene = timeline.segments.filter((s) => s.id !== CREDITS_ID).at(-1)?.id;
  const chunkDir = path.join(paths.chunks, opts.quality);
  await mkdir(chunkDir, { recursive: true });

  const selected = selectSegments(timeline, opts.only);
  const segments = new Map(timeline.segments.map((s) => [s.id, s]));
  const planned: PlannedChunk[] = planChunks(timeline, fps, opts.chunkFrames)
    .filter((c) => selected.has(c.segment))
    .map((c) => {
      const seg = segments.get(c.segment) as Timeline['segments'][number];
      const sceneId = c.segment === CREDITS_ID ? (creditsScene ?? c.segment) : c.segment;
      const key = chunkKey(c, segmentFingerprint(timeline, seg, creditsScene), {
        globalHash: bundle.globalHash,
        // a ready-made shot without a scene file depends on its description and files only
        sceneHash:
          (bundle.sceneHashes.get(sceneId) ?? (fingerprints.has(sceneId) ? '' : bundle.fallbackHash)) +
          (fingerprints.get(sceneId) ?? ''),
        settings,
      });
      return { ...c, key, file: path.join(chunkDir, `${key}.mp4`) };
    });
  const missing = planned.filter((c) => !existsSync(c.file));
  const totalFrames = planned.reduce((n, c) => n + c.end - c.start, 0);
  const missingFrames = missing.reduce((n, c) => n + c.end - c.start, 0);
  log.info(
    `${totalFrames} images (${width}×${height}, ${fps} i/s) · ${planned.length - missing.length}/${planned.length} morceaux en cache · ${missingFrames} images à rendre`,
  );

  if (missing.length) {
    await renderChunks(project, timeline, missing, profile, renderer, {
      layout,
      pixelRatio,
      encode,
      jpegQuality: preset.jpegQuality,
      msaa,
      visuals,
      workers: opts.workers,
      signal: opts.signal,
    });
  }

  opts.signal?.throwIfAborted();
  // concat + mux
  const listFile = path.join(paths.work, `concat-${opts.quality}.txt`);
  await writeFile(listFile, planned.map((c) => `file '${c.file.replace(/'/g, "'\\''")}'`).join('\n'));
  const span = existsSync(paths.mix) ? audioSpan(timeline, planned, fps) : null;
  const audio: AudioSlice | null = span && { file: paths.mix, ...span };
  const suffix = (opts.quality === 'draft' ? '_brouillon' : '') + (opts.only?.length ? `_${opts.only.join('-')}` : '');
  const output = opts.output ?? path.join(paths.out, `${outputName(capsule.title)}${suffix}.mp4`);
  await mkdir(path.dirname(output), { recursive: true });
  log.step('assemblage et mixage audio');
  await concatAndMux(listFile, audio, output);
  if (!opts.only?.length) await pruneChunks(chunkDir, new Set(planned.map((c) => path.basename(c.file))));

  const info = await probe(output);
  const seconds = (performance.now() - started) / 1000;
  log.ok(
    `${output}\n  ${info.width}×${info.height} · ${info.duration.toFixed(2)} s (attendu ${(totalFrames / fps).toFixed(2)} s) · ${formatBytes(info.size)} · audio ${info.hasAudio ? 'oui' : color.yellow('non')} · ${formatDuration(seconds)}`,
  );
  if (!audio) log.warn('pas de mixage audio : lancez `studio music` pour ajouter voix et musique');
  return { output, frames: totalFrames, renderedFrames: missingFrames, seconds, renderer };
}

/** Keeps the cache bounded: only the chunks of the latest full render are kept. */
async function pruneChunks(dir: string, keep: ReadonlySet<string>): Promise<void> {
  for (const f of await readdir(dir)) {
    if (!keep.has(f)) await rm(path.join(dir, f), { force: true });
  }
}
