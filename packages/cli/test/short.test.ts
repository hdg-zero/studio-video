import { describe, expect, it } from 'vitest';
import { layoutOf, parseCapsule, subtitleStyle } from '../src/core/config.js';
import { planShort } from '../src/core/short.js';

const raw = {
  $schema: '../../schemas/capsule.schema.json',
  title: 'Le panoptique',
  credits: '<b>Le panoptique</b>Voix : …',
  timing: { readingSpeed: 14 },
  custom: { kept: true },
  segments: [
    { id: 'intro', mood: 'intro', text: 'Une prison idéale.' },
    { id: 'regard', text: 'Être vu sans voir.', visual: { type: 'title', text: 'Le regard' } },
    { id: 'outro', mood: 'finale', text: 'Et aujourd’hui ?' },
  ],
};
const capsule = parseCapsule(raw);

describe('planShort', () => {
  it('keeps the chosen segments in the given order, framed 9:16 with short timings', () => {
    const plan = planShort(raw, capsule, ['regard', 'intro'], { regard: 4, intro: 3 });
    const short = parseCapsule(plan.capsule);
    expect(short.segments.map((s) => s.id)).toEqual(['regard', 'intro']);
    expect(short.segments[0]?.visual).toEqual(capsule.segments[1]?.visual);
    expect(layoutOf(short.format)).toEqual({ width: 720, height: 1280 });
    expect(short.timing.readingSpeed).toBe(14);
    expect(short.timing.credits).toBeLessThan(capsule.timing.credits);
    expect(subtitleStyle(short)).toBe('words');
    expect(plan.capsule.custom).toEqual({ kept: true });
    // 1.2 + 4 + 0.5 | 0.4 + 3 + 1.2 | credits 2.5
    expect(plan.duration).toBeCloseTo(12.8);
    expect(plan.estimated).toEqual([]);
  });

  it('estimates the segments without a voice clip and renames the title in the credits', () => {
    const plan = planShort(raw, capsule, ['outro'], {}, 'Panoptique en 30 s');
    expect(plan.estimated).toEqual(['outro']);
    expect(plan.capsule.title).toBe('Panoptique en 30 s');
    expect(plan.capsule.credits).toBe('<b>Panoptique en 30 s</b>Voix : …');
  });

  it('refuses unknown, repeated or missing segments', () => {
    expect(() => planShort(raw, capsule, ['nope'], {})).toThrow(/unknown segment\(s\): nope \(available: intro/);
    expect(() => planShort(raw, capsule, ['intro', 'intro'], {})).toThrow(/chosen twice: intro/);
    expect(() => planShort(raw, capsule, [], {})).toThrow(/at least one/);
  });
});

describe('subtitleStyle', () => {
  it('follows the orientation unless a style is chosen', () => {
    expect(subtitleStyle(capsule)).toBe('line');
    expect(subtitleStyle(parseCapsule({ ...raw, subtitles: { style: 'words' } }))).toBe('words');
    expect(
      subtitleStyle(parseCapsule({ ...raw, format: { width: 1080, height: 1920 }, subtitles: { style: 'line' } })),
    ).toBe('line');
  });
});
