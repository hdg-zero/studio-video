/** Pipeline steps shared by several commands and by the web UI. */
import { mkdir } from 'node:fs/promises';
import type { Timeline } from '@studio/runtime';
import { log } from './log.js';
import type { Project } from './project.js';
import { buildTimeline, estimateDuration, type TimedSpec } from './timeline.js';
import { clipHash, readManifest } from './tts.js';
import { writeFileAtomic } from './util.js';

export interface TimelineOptions {
  /** Estimate missing or stale voice durations from the text instead of failing. */
  readonly estimate?: boolean;
}

export interface ComputedTimeline {
  readonly timeline: Timeline;
  /** Segments whose duration was estimated (no up-to-date voice clip). */
  readonly estimated: readonly string[];
}

/** The timeline the current capsule and voice clips produce (nothing is written). */
export async function computeTimeline(project: Project): Promise<ComputedTimeline> {
  const { capsule } = project;
  const manifest = await readManifest(project);
  const estimated: string[] = [];
  const timed: TimedSpec[] = capsule.segments.map((s) => {
    const clip = manifest?.clips[s.id];
    if (clip && clip.hash === clipHash(capsule.voice.model, capsule.voice.voice, s.text))
      return { ...s, dur: clip.dur };
    estimated.push(s.id);
    return { ...s, dur: estimateDuration(s.text, capsule.timing.readingSpeed) };
  });
  return { timeline: buildTimeline(timed, capsule.timing), estimated };
}

export async function writeTimeline(project: Project, opts: TimelineOptions = {}): Promise<Timeline> {
  const { capsule } = project;
  const { timeline, estimated } = await computeTimeline(project);
  if (estimated.length && !opts.estimate) {
    throw new Error(
      `no up-to-date voice for: ${estimated.join(', ')}. Run \`studio tts ${project.name}\`, or \`studio timeline ${project.name} --estimate\` to work without voice.`,
    );
  }
  if (estimated.length)
    log.warn(`durées estimées (lecture à ${capsule.timing.readingSpeed} car./s) pour : ${estimated.join(', ')}`);
  await mkdir(project.paths.work, { recursive: true });
  await writeFileAtomic(project.paths.timeline, `${JSON.stringify(timeline, null, 1)}\n`);
  for (const s of timeline.segments)
    log.info(`  ${s.id.padEnd(16)} ${s.t0.toFixed(2).padStart(7)} → ${s.t1.toFixed(2).padStart(7)}`);
  log.ok(`timeline : ${timeline.duration.toFixed(2)} s, ${Math.round(timeline.duration * capsule.format.fps)} images`);
  return timeline;
}
