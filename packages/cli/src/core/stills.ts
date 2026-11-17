/**
 * Look before rendering: a few frames rendered straight from the page, assembled into one
 * contact sheet that is quick to review: 2 columns of 640 px for 16:9, 4 columns of 360 px for 9:16.
 */
import { mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Timeline } from '@studio/runtime';
import { launch, selectProfile, type GpuMode } from './browser.js';
import { bundleProject } from './bundle.js';
import { FrameCapturer } from './capture.js';
import { layoutOf } from './config.js';
import { probe } from './encoder.js';
import { log } from './log.js';
import { mediaMounts, resolveVisuals } from './media.js';
import { renderPage } from './page.js';
import { loadTimeline, type Project } from './project.js';
import { startServer } from './server.js';
import { runOrThrow, writeFileAtomic } from './util.js';

/** One time per segment: the middle of its voice (or of the segment when silent). */
function segmentTimes(timeline: Timeline): number[] {
  return timeline.segments.map((s) => {
    const t = s.voice === null ? (s.t0 + s.t1) / 2 : s.voice + s.dur / 2;
    return Math.round(t * 10) / 10;
  });
}

interface SheetLayout {
  readonly w: number;
  readonly h: number;
  readonly cols: number;
}

const LANDSCAPE_SHEET: SheetLayout = { w: 640, h: 360, cols: 2 };
const PORTRAIT_SHEET: SheetLayout = { w: 360, h: 640, cols: 4 };
const sheetFor = (width: number, height: number): SheetLayout => (height > width ? PORTRAIT_SHEET : LANDSCAPE_SHEET);

/** Builds an `xstack` contact sheet of the images, `tile.cols` per row. */
async function contactSheet(images: readonly string[], output: string, tile = LANDSCAPE_SHEET): Promise<void> {
  if (images.length === 0) throw new Error('no image for the contact sheet');
  const inputs = images.flatMap((f) => ['-i', f]);
  const scaled = images.map(
    (_, i) =>
      `[${i}]scale=${tile.w}:${tile.h}:force_original_aspect_ratio=decrease,pad=${tile.w}:${tile.h}:-1:-1[v${i}]`,
  );
  const layout = images.map((_, i) => `${(i % tile.cols) * tile.w}_${Math.floor(i / tile.cols) * tile.h}`).join('|');
  const pads = images.map((_, i) => `[v${i}]`).join('');
  const graph =
    images.length === 1
      ? `${scaled[0]?.replace('[v0]', '')}`
      : `${scaled.join(';')};${pads}xstack=inputs=${images.length}:layout=${layout}:fill=black`;
  await runOrThrow('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', graph, output]);
}

export interface StillsOptions {
  readonly times?: readonly number[];
  readonly gpu: GpuMode;
  readonly signal?: AbortSignal;
}

/** Renders stills at full resolution into .studio/stills and returns the contact sheet path. */
export async function renderStills(project: Project, opts: StillsOptions): Promise<string> {
  const timeline = await loadTimeline(project);
  const times = opts.times?.length ? opts.times : segmentTimes(timeline);
  const bundle = await bundleProject(project);
  bundle.warnings.forEach((w) => log.warn(w));
  const { profile } = await selectProfile(opts.gpu);
  const msaa = profile.hardware ? project.capsule.look.msaa : 0;
  const { visuals } = await resolveVisuals(project, { strict: true });
  const server = await startServer(
    project.paths.bundle,
    renderPage(project.capsule, timeline, { msaa, visuals }),
    mediaMounts(project),
  );
  const browser = await launch(profile);
  await rm(project.paths.stills, { recursive: true, force: true });
  await mkdir(project.paths.stills, { recursive: true });
  const files: string[] = [];
  try {
    const capturer = await FrameCapturer.open(browser, {
      url: server.url,
      layout: layoutOf(project.capsule.format),
      pixelRatio: project.capsule.format.pixelRatio,
      format: 'png',
      quality: 100,
    });
    for (const [i, t] of times.entries()) {
      opts.signal?.throwIfAborted();
      log.progress({ task: 'stills', done: i, total: times.length, unit: 'images' });
      const file = path.join(project.paths.stills, `t${t}.png`);
      await writeFileAtomic(file, await capturer.frame(t));
      files.push(file);
      const errors = capturer.takeErrors();
      errors.forEach((e) => log.warn(`t=${t}: ${e}`));
    }
    log.progress({ task: 'stills', done: times.length, total: times.length, unit: 'images' });
  } finally {
    await browser.close();
    await server.close();
  }
  const sheet = path.join(project.paths.work, 'contact_sheet.png');
  const { width, height } = project.capsule.format;
  await contactSheet(files, sheet, sheetFor(width, height));
  return sheet;
}

/** Extracts frames from a finished video into a contact sheet `<video>_check.png`. */
export async function checkVideo(video: string, times: readonly number[]): Promise<string> {
  const dir = path.join(os.tmpdir(), `studio-check-${process.pid}`);
  await mkdir(dir, { recursive: true });
  try {
    const files: string[] = [];
    for (const [i, t] of times.entries()) {
      const f = path.join(dir, `${i}.png`);
      await runOrThrow('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-ss',
        String(t),
        '-i',
        video,
        '-frames:v',
        '1',
        f,
      ]);
      files.push(f);
    }
    const out = video.replace(/\.[^.]+$/, '') + '_check.png';
    const info = await probe(video);
    await contactSheet(files, out, sheetFor(info.width, info.height));
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
