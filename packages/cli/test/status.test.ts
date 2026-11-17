import { describe, expect, it } from 'vitest';
import { nextStep, type ProjectStatus } from '../src/core/status.js';

type Base = Omit<ProjectStatus, 'next'>;
const step = (state: 'fresh' | 'stale' | 'missing') => ({ state, file: '', mtime: state === 'missing' ? null : 1 });

const base: Base = {
  name: 'demo',
  title: 'Demo',
  root: '/p/demo',
  fps: 30,
  duration: 10,
  segments: [],
  voice: 'fresh',
  timeline: step('fresh'),
  music: { ...step('fresh'), withVoice: true },
  stills: step('fresh'),
  renders: [],
  outputs: { final: 'Demo.mp4', draft: 'Demo_brouillon.mp4' },
  cache: { chunks: 0, bytes: 0 },
  apiKey: true,
};
const render = (name: string, stale = false) => ({
  file: `/p/demo/out/${name}`,
  name,
  size: 1,
  mtime: 1,
  draft: name.includes('_brouillon'),
  stale,
});

describe('nextStep', () => {
  it('follows the pipeline order', () => {
    expect(nextStep({ ...base, voice: 'stale' })?.command).toBe('studio tts demo');
    expect(nextStep({ ...base, timeline: step('missing') })?.command).toBe('studio timeline demo');
    expect(nextStep({ ...base, music: { ...step('stale'), withVoice: true } })?.command).toBe('studio music demo');
    expect(nextStep({ ...base, stills: step('missing') })?.command).toBe('studio stills demo');
  });

  it('works without an OpenRouter key by estimating durations', () => {
    const s = { ...base, apiKey: false, voice: 'missing' as const, timeline: step('missing') };
    expect(nextStep(s)?.command).toBe('studio timeline demo --estimate');
    const mixed = { ...s, timeline: step('fresh'), music: { ...step('missing'), withVoice: false } };
    expect(nextStep(mixed)?.command).toBe('studio music demo --no-voice');
  });

  it('asks for a draft, then the final render, then nothing', () => {
    expect(nextStep(base)?.command).toBe('studio render demo --draft');
    expect(nextStep({ ...base, renders: [render('Demo_brouillon.mp4')] })?.command).toBe('studio render demo');
    expect(nextStep({ ...base, renders: [render('Demo_brouillon.mp4', true)] })?.command).toBe(
      'studio render demo --draft',
    );
    expect(nextStep({ ...base, renders: [render('Demo.mp4')] })).toBeNull();
  });
});
