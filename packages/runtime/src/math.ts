/**
 * Pure numeric helpers shared by every scene.
 *
 * Scenes must be pure functions of time (frames are rendered out of order by parallel
 * workers), so randomness always comes from a seeded generator, never from `Math.random`.
 */

export type Rng = () => number;

/** Clamps `x` to `[min, max]`. */
export const clamp = (x: number, min = 0, max = 1): number => Math.min(max, Math.max(min, x));

/** Linear interpolation from `a` to `b`. */
export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/**
 * Hermite smoothstep: 0 before `a`, 1 after `b`, smooth in between.
 * `a > b` gives a decreasing ramp, which is handy for fade-outs.
 */
export const smooth = (a: number, b: number, x: number): number => {
  const k = clamp((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};

/** 32-bit FNV-1a hash of a string, used to derive stable per-scene seeds. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Mulberry32: fast, well-distributed 32-bit PRNG. Returns floats in `[0, 1)`.
 * Same seed, same sequence, on every machine and in every worker.
 */
export function createRng(seed: number | string): Rng {
  let s = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `n` precomputed random values in `[0, 1)`, read as `table(i)` (indices wrap around):
 * cheap, stable per-instance variation inside update loops.
 */
export function randomTable(n: number, seed: number | string): (i: number) => number {
  const rng = createRng(seed);
  const table = new Float32Array(n);
  for (let i = 0; i < n; i++) table[i] = rng();
  return (i) => table[((i % n) + n) % n] as number;
}
