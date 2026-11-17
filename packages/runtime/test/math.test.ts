import { describe, expect, it } from 'vitest';
import { clamp, createRng, lerp, randomTable, smooth } from '../src/math.js';

describe('math', () => {
  it('clamps, lerps and smooths', () => {
    expect(clamp(2)).toBe(1);
    expect(clamp(-1, -0.5, 0.5)).toBe(-0.5);
    expect(lerp(10, 20, 0.25)).toBe(12.5);
    expect(smooth(0, 1, -1)).toBe(0);
    expect(smooth(0, 1, 0.5)).toBe(0.5);
    expect(smooth(0, 1, 2)).toBe(1);
    expect(smooth(1, 0, 0.9)).toBeCloseTo(1 - smooth(0, 1, 0.9));
  });

  it('gives the same sequence for the same seed, in [0, 1)', () => {
    const a = createRng('scene');
    const b = createRng('scene');
    const xs = Array.from({ length: 1000 }, () => a());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    expect(createRng('other')()).not.toBe(xs[0]);
  });

  it('reads random tables with wrap-around', () => {
    const t = randomTable(10, 1);
    expect(t(12)).toBe(t(2));
    expect(t(-1)).toBe(t(9));
  });
});
