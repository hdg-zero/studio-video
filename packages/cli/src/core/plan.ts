/**
 * Render planning (pure, unit-tested): which frames go into which chunk, and the cache key of each chunk.
 *
 * Chunks never cross a segment boundary. A chunk therefore depends on one segment only,
 * and editing one scene re-renders that scene's chunks and nothing else.
 */
import type { Segment, Timeline } from '@studio/runtime';
import { CREDITS_ID } from './config.js';
import { sha256 } from './util.js';

export interface Chunk {
  readonly segment: string;
  /** First frame (inclusive). */
  readonly start: number;
  /** Last frame (exclusive). */
  readonly end: number;
}

export const frameCount = (timeline: Timeline, fps: number): number => Math.round(timeline.duration * fps);

/** First frame whose time `i / fps` falls at or after `t`. */
const firstFrameAt = (t: number, fps: number): number => Math.ceil(t * fps - 1e-6);

/**
 * Splits every segment's frames into chunks of at most `maxFrames`, of balanced sizes.
 * Frame `i` shows time `i / fps` and belongs to the segment with `t0 <= i / fps < t1`.
 */
export function planChunks(timeline: Timeline, fps: number, maxFrames: number): Chunk[] {
  const total = frameCount(timeline, fps);
  const chunks: Chunk[] = [];
  timeline.segments.forEach((seg, i) => {
    const start = Math.min(total, firstFrameAt(seg.t0, fps));
    const end = i === timeline.segments.length - 1 ? total : Math.min(total, firstFrameAt(seg.t1, fps));
    const n = end - start;
    if (n <= 0) return;
    const pieces = Math.ceil(n / maxFrames);
    for (let k = 0; k < pieces; k++) {
      chunks.push({
        segment: seg.id,
        start: start + Math.floor((k * n) / pieces),
        end: start + Math.floor(((k + 1) * n) / pieces),
      });
    }
  });
  return chunks;
}

export interface KeyInputs {
  /** Bundle fingerprint shared by all frames. */
  readonly globalHash: string;
  /** Code fingerprint of the scene drawing this segment. */
  readonly sceneHash: string;
  /** Texts and settings that change pixels everywhere (titles, credits, format, encoder). */
  readonly settings: unknown;
}

/** Bump to invalidate every cached chunk after a change in the render pipeline itself. */
const PIPELINE_VERSION = 2;

/** Segment data a chunk's pixels depend on (the credits also show the source scene and the closing line). */
export function segmentFingerprint(timeline: Timeline, seg: Segment, creditsScene: string | undefined): unknown {
  if (seg.id !== CREDITS_ID) return seg;
  const source = timeline.segments.find((s) => s.id === creditsScene);
  return { seg, source };
}

export function chunkKey(chunk: Chunk, segmentData: unknown, k: KeyInputs): string {
  return sha256(
    JSON.stringify({ v: PIPELINE_VERSION, chunk, segmentData, settings: k.settings }),
    k.globalHash,
    k.sceneHash,
  ).slice(0, 32);
}

/** The segments to render: all of them, or the `only` ones (unknown ids are an error). */
export function selectSegments(timeline: Timeline, only: readonly string[] | undefined): Set<string> {
  const ids = timeline.segments.map((s) => s.id);
  if (!only?.length) return new Set(ids);
  const unknown = only.filter((id) => !ids.includes(id));
  if (unknown.length) throw new Error(`unknown segment(s): ${unknown.join(', ')} (available: ${ids.join(', ')})`);
  return new Set(only);
}

/** Part of the soundtrack (seconds) under the planned chunks: all of it, a contiguous slice, or none. */
export function audioSpan(
  timeline: Timeline,
  planned: readonly Chunk[],
  fps: number,
): { offset: number; duration: number } | null {
  const first = planned[0];
  const last = planned.at(-1);
  if (!first || !last) return null;
  const contiguous = planned.every((c, i) => i === 0 || c.start === (planned[i - 1] as Chunk).end);
  if (!contiguous) return null;
  if (first.start === 0 && last.end === frameCount(timeline, fps)) return { offset: 0, duration: timeline.duration };
  return { offset: first.start / fps, duration: (last.end - first.start) / fps };
}

/** Longest chunks first: the classic LPT heuristic keeps all workers busy until the end. */
export const scheduleOrder = <T extends Chunk>(chunks: readonly T[]): T[] =>
  [...chunks].sort((a, b) => b.end - b.start - (a.end - a.start));
