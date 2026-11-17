import { describe, expect, it } from 'vitest';
import { pcmRate } from '../src/core/tts.js';

describe('pcmRate', () => {
  it('reads the rate of a PCM content-type', () => {
    expect(pcmRate('audio/pcm;rate=44100')).toBe(44_100);
    expect(pcmRate('audio/pcm; rate=24000; channels=1')).toBe(24_000);
  });

  it('returns null without a rate', () => {
    expect(pcmRate('audio/pcm')).toBeNull();
  });
});
