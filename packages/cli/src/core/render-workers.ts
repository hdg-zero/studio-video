/**
 * Worker pool of the renderer: each worker owns one browser page and encodes the chunks it pulls
 * from a shared queue (longest first) with its own ffmpeg process.
 *
 * Within a chunk, the next frame is captured while ffmpeg still encodes the previous one, so the
 * browser and the encoder work at the same time instead of waiting for each other.
 */
import { rename, rm } from 'node:fs/promises';
import os from 'node:os';
import type { Browser } from 'playwright';
import type { Timeline, Visual } from '@studio/runtime';
import { launch, type BrowserProfile } from './browser.js';
import { FrameCapturer } from './capture.js';
import { encoderArgs, FrameEncoder, type EncodeSettings } from './encoder.js';
import { color, log } from './log.js';
import { mediaMounts } from './media.js';
import { renderPage } from './page.js';
import { scheduleOrder, type Chunk } from './plan.js';
import type { Project } from './project.js';
import { startServer } from './server.js';
import { abortReason, formatDuration } from './util.js';

/** A chunk to render and the cache file it is stored in. */
export interface PlannedChunk extends Chunk {
  readonly key: string;
  readonly file: string;
}

export interface WorkerSettings {
  readonly layout: { width: number; height: number };
  readonly pixelRatio: number;
  readonly encode: Omit<EncodeSettings, 'threads'>;
  readonly jpegQuality: number;
  readonly msaa: number;
  readonly visuals: Readonly<Record<string, Visual>>;
  readonly workers: number | undefined;
  readonly signal: AbortSignal | undefined;
}

/** Renders `chunks` into their cache files; the first failure (or a cancellation) stops every worker. */
export async function renderChunks(
  project: Project,
  timeline: Timeline,
  chunks: readonly PlannedChunk[],
  profile: BrowserProfile,
  renderer: string,
  s: WorkerSettings,
): Promise<void> {
  const cpus = os.availableParallelism();
  const workers = Math.max(1, Math.min(s.workers ?? Math.min(8, Math.floor(cpus / 2)), chunks.length));
  const threads = Math.max(1, Math.floor(cpus / workers));
  log.step(
    `rendu : ${workers} worker(s) · WebGL ${profile.hardware ? color.green(renderer) : color.yellow(`${renderer} (CPU)`)}`,
  );
  if (!profile.hardware)
    log.warn('rendu logiciel (SwiftShader) : lent. `studio doctor` explique comment activer le GPU.');

  const server = await startServer(
    project.paths.bundle,
    renderPage(project.capsule, timeline, { msaa: s.msaa, visuals: s.visuals }),
    mediaMounts(project),
  );
  const queue = scheduleOrder(chunks);
  const total = chunks.reduce((n, c) => n + c.end - c.start, 0);
  let done = 0;
  // shared by the workers and the abort handler
  const state: { aborted: Error | null } = { aborted: null };
  const throwIfAborted = (): void => {
    if (state.aborted) throw state.aborted;
  };
  const encoders = new Set<FrameEncoder>();
  const browsers: Browser[] = [];
  const t0 = performance.now();

  const onAbort = (): void => {
    state.aborted ??= s.signal ? abortReason(s.signal) : new Error('cancelled');
    for (const e of encoders) e.abort();
  };
  if (s.signal?.aborted) onAbort();
  s.signal?.addEventListener('abort', onAbort, { once: true });
  const ticker = setInterval(() => {
    const elapsed = (performance.now() - t0) / 1000;
    const rate = done / Math.max(elapsed, 1e-3);
    // no rate before the first frame (a browser takes a few seconds to start)
    if (done === 0) log.progress({ task: 'render', done, total, unit: 'images' });
    else log.progress({ task: 'render', done, total, rate, eta: (total - done) / rate, unit: 'images' });
  }, 1000);

  const worker = async (): Promise<void> => {
    const browser = await launch(profile);
    browsers.push(browser);
    const capturer = await FrameCapturer.open(browser, {
      url: server.url,
      layout: s.layout,
      pixelRatio: s.pixelRatio,
      format: s.encode.input,
      quality: s.jpegQuality,
    });
    try {
      for (let chunk = queue.shift(); chunk && !state.aborted; chunk = queue.shift()) {
        const tmp = `${chunk.file}.part.mp4`;
        const enc = new FrameEncoder(encoderArgs({ ...s.encode, threads }, tmp));
        encoders.add(enc);
        // the previous frame's write, still waiting for ffmpeg to take it (back-pressure)
        let writing: Promise<void> = Promise.resolve();
        try {
          for (let i = chunk.start; i < chunk.end; i++) {
            throwIfAborted();
            const image = await capturer.frame(i / s.encode.fps);
            await writing;
            writing = enc.write(image);
            // awaited before the next write: mark it handled while the next frame is captured
            writing.catch(() => undefined);
            done++;
          }
          await writing;
          await enc.finish();
          await rename(tmp, chunk.file);
        } catch (err) {
          enc.abort();
          await rm(tmp, { force: true });
          throw err;
        } finally {
          encoders.delete(enc);
        }
        for (const e of new Set(capturer.takeErrors())) log.warn(`[${chunk.segment}] ${e}`);
      }
    } finally {
      await capturer.close();
    }
  };

  // the first failure stops every worker (no point rendering the rest of a broken capsule)
  const guarded = (): Promise<void> =>
    worker().catch((err: unknown) => {
      state.aborted ??= err as Error;
      for (const e of encoders) e.abort();
      throw err;
    });
  try {
    const results = await Promise.allSettled(Array.from({ length: workers }, guarded));
    // the first error wins: a cancellation makes the encoders fail, report the cancellation
    throwIfAborted();
    const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failure) throw failure.reason;
  } finally {
    clearInterval(ticker);
    s.signal?.removeEventListener('abort', onAbort);
    for (const e of encoders) e.abort();
    await Promise.all(browsers.map((b) => b.close().catch(() => undefined)));
    await server.close();
  }
  const elapsed = (performance.now() - t0) / 1000;
  log.progress({ task: 'render', done: total, total, rate: total / elapsed, eta: 0, unit: 'images' });
  log.ok(`${total} images rendues en ${formatDuration(elapsed)} (${(total / elapsed).toFixed(1)} i/s)`);
}
