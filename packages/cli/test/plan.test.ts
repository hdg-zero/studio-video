import { describe, expect, it } from 'vitest';
import type { Timeline } from '@studio/runtime';
import {
  audioSpan,
  chunkKey,
  frameCount,
  planChunks,
  scheduleOrder,
  segmentFingerprint,
  selectSegments,
} from '../src/core/plan.js';

const mk = (id: string, t0: number, t1: number) => ({
  id,
  mood: 'calm',
  label: '',
  key: '',
  text: '',
  dur: 1,
  t0,
  voice: t0,
  t1,
});
const timeline: Timeline = {
  segments: [mk('a', 0, 3.25), mk('b', 3.25, 10), { ...mk('credits', 10, 12), voice: null }],
  duration: 12,
};

describe('planChunks', () => {
  const chunks = planChunks(timeline, 30, 90);

  it('covers every frame exactly once, in order', () => {
    expect(chunks[0]?.start).toBe(0);
    expect(chunks.at(-1)?.end).toBe(frameCount(timeline, 30));
    chunks.slice(1).forEach((c, i) => expect(c.start).toBe(chunks[i]?.end));
  });

  it('never crosses a segment boundary and respects the size limit', () => {
    for (const c of chunks) {
      const seg = timeline.segments.find((s) => s.id === c.segment);
      expect(c.start / 30).toBeGreaterThanOrEqual(seg?.t0 ?? NaN);
      expect((c.end - 1) / 30).toBeLessThan(seg?.t1 ?? NaN);
      expect(c.end - c.start).toBeLessThanOrEqual(90);
    }
  });

  it('balances the chunks of a segment', () => {
    const b = chunks.filter((c) => c.segment === 'b').map((c) => c.end - c.start);
    expect(Math.max(...b) - Math.min(...b)).toBeLessThanOrEqual(1);
  });

  it('schedules the longest chunks first', () => {
    const sizes = scheduleOrder(chunks).map((c) => c.end - c.start);
    expect(sizes).toEqual([...sizes].sort((x, y) => y - x));
  });
});

describe('chunkKey', () => {
  const chunk = { segment: 'b', start: 100, end: 190 };
  const base = { globalHash: 'g', sceneHash: 's', settings: { w: 1920 } };
  const key = chunkKey(chunk, { t0: 1 }, base);

  it('is stable', () => expect(chunkKey(chunk, { t0: 1 }, base)).toBe(key));
  it.each([
    ['scene code', { ...base, sceneHash: 's2' }, { t0: 1 }],
    ['shared code', { ...base, globalHash: 'g2' }, { t0: 1 }],
    ['settings', { ...base, settings: { w: 1280 } }, { t0: 1 }],
    ['segment timing', base, { t0: 2 }],
  ])('changes with the %s', (_, inputs, data) => expect(chunkKey(chunk, data, inputs)).not.toBe(key));

  it('makes the credits depend on the scene they replay', () => {
    const credits = timeline.segments[2];
    if (!credits) throw new Error('fixture');
    expect(segmentFingerprint(timeline, credits, 'b')).toMatchObject({ source: { id: 'b' } });
  });
});

describe('selectSegments', () => {
  it('selects every segment by default, the named ones otherwise', () => {
    expect([...selectSegments(timeline, undefined)]).toEqual(['a', 'b', 'credits']);
    expect([...selectSegments(timeline, ['b'])]).toEqual(['b']);
  });

  it('rejects an unknown segment', () => {
    expect(() => selectSegments(timeline, ['zz'])).toThrow(/unknown segment/);
  });
});

describe('audioSpan', () => {
  const chunks = planChunks(timeline, 30, 90);

  it('takes the whole soundtrack for a full render', () => {
    expect(audioSpan(timeline, chunks, 30)).toEqual({ offset: 0, duration: 12 });
  });

  it('takes a slice for a contiguous selection', () => {
    const b = chunks.filter((c) => c.segment === 'b');
    const first = b[0]?.start ?? 0;
    const span = audioSpan(timeline, b, 30);
    expect(span?.offset).toBeCloseTo(first / 30);
    expect(span?.duration).toBeCloseTo(((b.at(-1)?.end ?? 0) - first) / 30);
  });

  it('has no soundtrack for gaps or nothing', () => {
    expect(
      audioSpan(
        timeline,
        chunks.filter((c) => c.segment !== 'b'),
        30,
      ),
    ).toBeNull();
    expect(audioSpan(timeline, [], 30)).toBeNull();
  });
});
