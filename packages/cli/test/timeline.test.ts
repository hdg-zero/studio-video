import { describe, expect, it } from 'vitest';
import { TimingSpec } from '../src/core/config.js';
import { buildTimeline, estimateDuration } from '../src/core/timeline.js';

const timing = TimingSpec.parse({});
const seg = (id: string, dur: number) => ({ id, mood: 'calm' as const, label: '', key: '', text: 'x', dur });

describe('buildTimeline', () => {
  it('chains lead + voice + tail and appends the credits', () => {
    const tl = buildTimeline([seg('a', 5), seg('b', 4)], timing);
    const [a, b, credits] = tl.segments;
    expect(a).toMatchObject({ t0: 0, voice: 3.2 });
    expect(a?.t1).toBeCloseTo(3.2 + 5 + 1.1);
    expect(b?.t0).toBe(a?.t1);
    expect(b?.voice).toBeCloseTo((a?.t1 ?? 0) + 0.9);
    expect(b?.t1).toBeCloseTo((b?.voice ?? 0) + 4 + 1.8);
    expect(credits).toMatchObject({ id: 'credits', voice: null, dur: 0 });
    expect(tl.duration).toBeCloseTo((credits?.t0 ?? 0) + 6);
  });

  it('omits the credits when their length is 0', () => {
    const tl = buildTimeline([seg('a', 1)], { ...timing, credits: 0 });
    expect(tl.segments.map((s) => s.id)).toEqual(['a']);
  });

  it('estimates reading time', () => {
    expect(estimateDuration('x'.repeat(30), 15)).toBe(2);
  });
});
