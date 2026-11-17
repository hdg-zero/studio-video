/**
 * The voice drives the timeline: each segment lasts lead + voice + tail, so picture,
 * subtitles and music line up without any manual syncing.
 */
import type { Segment, Timeline } from '@studio/runtime';
import { CREDITS_ID, type SegmentSpec, type TimingSpec } from './config.js';

export type TimedSpec = SegmentSpec & { readonly dur: number };

const r3 = (x: number): number => Math.round(x * 1000) / 1000;

export function buildTimeline(segments: readonly TimedSpec[], timing: TimingSpec): Timeline {
  const out: Segment[] = [];
  let t = 0;
  segments.forEach((s, i) => {
    const lead = i === 0 ? timing.introLead : timing.lead;
    const tail = i === segments.length - 1 ? timing.outroTail : timing.tail;
    const voice = t + lead;
    const end = voice + s.dur + tail;
    out.push({ ...s, t0: r3(t), voice: r3(voice), t1: r3(end) });
    t = end;
  });
  if (timing.credits > 0) {
    out.push({
      id: CREDITS_ID,
      mood: 'finale',
      label: '',
      key: '',
      text: '',
      dur: 0,
      t0: r3(t),
      voice: null,
      t1: r3(t + timing.credits),
    });
    t += timing.credits;
  }
  return { segments: out, duration: r3(t) };
}

/** Reading-time estimate used when no voice has been generated. */
export const estimateDuration = (text: string, charsPerSecond: number): number => r3(text.length / charsPerSecond);
