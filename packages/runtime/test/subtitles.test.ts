import { describe, expect, it } from 'vitest';
import { splitSubtitles, splitWordCues } from '../src/subtitles.js';

describe('splitSubtitles', () => {
  it('cuts after sentences and colons and spans exactly the voice', () => {
    const cues = splitSubtitles('Le principe est simple. Au centre : une tour.', 10, 6);
    expect(cues.map((c) => c.text)).toEqual(['Le principe est simple.', 'Au centre :', 'une tour.']);
    expect(cues[0]?.start).toBe(10);
    expect(cues.at(-1)?.end).toBeCloseTo(16);
    cues.slice(1).forEach((c, i) => expect(c.start).toBeCloseTo(cues[i]?.end ?? NaN));
  });

  it('wraps sentences longer than the line limit', () => {
    const long = Array.from({ length: 30 }, (_, i) => `mot${i}`).join(' ') + '.';
    const cues = splitSubtitles(long, 0, 5, { maxLine: 40, wrapAt: 30 });
    expect(cues.length).toBeGreaterThan(1);
    cues.forEach((c) => expect(c.text.length).toBeLessThanOrEqual(30));
  });
});

describe('splitWordCues', () => {
  it('makes short cues that never cross a sentence end and span exactly the voice', () => {
    const cues = splitWordCues(
      "Une tour au centre. Les cellules autour, toutes visibles depuis l'œil du gardien.",
      2,
      8,
    );
    expect(cues[0]?.text).toBe('Une tour au centre.');
    cues.forEach((c) => {
      expect(c.words.length).toBeLessThanOrEqual(4);
      expect(c.text.length).toBeLessThanOrEqual(24);
    });
    expect(cues.find((c) => c.text.startsWith('Les'))?.text).toBe('Les cellules autour,');
    expect(cues[0]?.start).toBe(2);
    expect(cues.at(-1)?.end).toBeCloseTo(10);
    cues.slice(1).forEach((c, i) => expect(c.start).toBeCloseTo(cues[i]?.end ?? NaN));
  });

  it('times the words in order, longer words taking longer', () => {
    const [cue] = splitWordCues('a extraordinairement b', 0, 3);
    const starts = cue?.words.map((w) => w.start) ?? [];
    expect(starts).toEqual([...starts].sort((x, y) => x - y));
    expect((starts[2] ?? 0) - (starts[1] ?? 0)).toBeGreaterThan((starts[1] ?? 0) - (starts[0] ?? 0));
  });

  it('keeps French punctuation with the word before it', () => {
    const cues = splitWordCues('Pourquoi ? Parce que : voilà !', 0, 3);
    expect(cues.map((c) => c.text)).toEqual(['Pourquoi ?', 'Parce que :', 'voilà !']);
  });
});
